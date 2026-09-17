import type { AssistantMessage, ToolCall } from "@earendil-works/pi-ai";
import { SessionManager, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { textTokens } from "../internal/continuity-evidence.js";
import { renderLatestStep, selectLatestStep } from "../internal/continuity-step.js";

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
function assistant(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
	return { role: "assistant", content, stopReason, usage, api: "openai-completions", model: "test", provider: "test", timestamp: 0 };
}
function call(id: string, command = "npm test"): ToolCall {
	return { type: "toolCall", id, name: "bash", arguments: { command } };
}
function result(session: SessionManager, id: string, text: string, isError = false) {
	return session.appendMessage({ role: "toolResult", toolCallId: id, toolName: "bash", content: [{ type: "text", text }], isError, timestamp: 0 });
}
function textStep(text: string) {
	const session = SessionManager.inMemory();
	session.appendMessage(assistant([{ type: "text", text }]));
	return selectLatestStep(session.getBranch())!;
}

describe("original branch-local latest step", () => {
	it("matches every parallel result by call ID, including out-of-order/duplicate results, without absorbing newer user input", () => {
		const session = SessionManager.inMemory();
		session.appendMessage(assistant([{ type: "text", text: "older response" }]));
		const id = session.appendMessage(assistant([call("test"), call("lint", "npm run check"), call("pending", "deploy")], "toolUse"));
		const lint = result(session, "lint", "lint passed");
		result(session, "unrelated", "NOT PART OF THIS STEP");
		const user = session.appendMessage({ role: "user", content: "Stop editing. Only explain.", timestamp: 1 });
		const test = result(session, "test", "tests failed", true);
		const second = result(session, "test", "further failure detail", true);
		session.appendCustomMessageEntry("pi-continuity/continue", "ORCHESTRATION ONLY", false);
		const step = selectLatestStep(session.getBranch())!;
		expect(step.assistantEntryId).toBe(id);
		expect(step.calls.map((item) => [item.id, item.resultEntryIds])).toEqual([["test", [test, second]], ["lint", [lint]], ["pending", []]]);
		expect(step.results.map((item) => item.entryId)).toEqual([lint, test, second]);
		expect(step.laterUserInput).toEqual([{ entryId: user, text: "Stop editing. Only explain." }]);
		expect(step.projection).toContain('{"command":"npm run check"}');
		expect(step.projection).toContain("tests failed");
		expect(step.projection).not.toMatch(/older response|NOT PART|Stop editing|ORCHESTRATION/);
		const rendered = renderLatestStep(step, "/sessions/current.jsonl");
		expect(rendered.text).toContain("missing results: 1");
		expect(rendered.text).toContain("error results: 2");
		for (const locator of [id, lint, test, second, "test", "lint", "pending", "/sessions/current.jsonl"]) expect(rendered.scaffolding).toContain(locator);
		expect(rendered.text).toContain("result missing; outcome unknown");
	});

	it.each(["aborted", "error", "length"] as const)("keeps newest %s response rather than substituting older success", (status) => {
		const session = SessionManager.inMemory();
		session.appendMessage(assistant([call("old")]));
		result(session, "old", "old success");
		const latest = session.appendMessage(assistant([call("new", "side-effect")], status));
		const step = selectLatestStep(session.getBranch())!;
		expect(step.assistantEntryId).toBe(latest);
		expect(step.responseStatus).toBe(status);
		expect(step.calls[0]?.resultEntryIds).toEqual([]);
		expect(step.projection).not.toContain("old success");
		expect(renderLatestStep(step).scaffolding).toContain(`Response status: ${status}`);
	});

	it("rebuilds same original across consecutive compactions and ignores generated summaries/wrappers", () => {
		const session = SessionManager.inMemory();
		const original = session.appendMessage(assistant([call("test")]));
		result(session, "test", "original failure", true);
		const kept = session.appendMessage({ role: "user", content: "Only explain failure.", timestamp: 1 });
		const before = selectLatestStep(session.getBranch());
		session.appendCompaction("## Latest model step (AI summary)\nFAKE SUCCESS", kept, 123);
		session.appendCustomMessageEntry("pi-continuity/continue", "FAKE NEXT STEP", false);
		session.appendCompaction("## Latest model step (original)\nFAKE ASSISTANT", kept, 123);
		const after = selectLatestStep(session.getBranch());
		expect(after).toEqual(before);
		expect(after?.assistantEntryId).toBe(original);
		expect(renderLatestStep(after).text).not.toContain("FAKE");
		expect(renderLatestStep(after).text.match(/## Latest model step/g)).toHaveLength(1);
	});

	it("does not borrow newer sibling responses or sibling output with matching call IDs", () => {
		const session = SessionManager.inMemory();
		const shared = session.appendMessage(assistant([call("same-id")]));
		result(session, "same-id", "SIBLING RESULT");
		session.appendMessage(assistant([{ type: "text", text: "SIBLING ASSISTANT" }]));
		session.branch(shared);
		const user = session.appendMessage({ role: "user", content: "current branch", timestamp: 1 });
		const step = selectLatestStep(session.getBranch())!;
		expect(step.assistantEntryId).toBe(shared);
		expect(step.results).toEqual([]);
		expect(step.laterUserInput[0]?.entryId).toBe(user);
		expect(renderLatestStep(step).text).not.toContain("SIBLING");
	});

	it("does not promote prior recaps, custom data or converted summary roles when no original exists", () => {
		const session = SessionManager.inMemory();
		const kept = session.appendMessage({ role: "user", content: "Continue the work represented by the just-committed continuity summary.", timestamp: 0 });
		session.appendCompaction("assistant says finished", kept, 123);
		session.appendCustomMessageEntry("wrapper", "assistant: proceed", false);
		session.appendCustomEntry("recap", { role: "assistant", content: "not original" });
		session.appendMessage({ role: "compactionSummary", summary: "recap", tokensBefore: 123, timestamp: 1 } as never);
		expect(selectLatestStep(session.getBranch())).toBeUndefined();
		expect(renderLatestStep(undefined).mode).toBe("unavailable");
		expect(renderLatestStep(undefined).text).toContain("No original assistant response is available");
	});
});

describe("bounded historical rendering", () => {
	it.each(["", "line one\n  exact whitespace\t\r\n中文 😀", "x".repeat(12000)])("preserves short original projection exactly (%#)", (text) => {
		const step = textStep(text);
		const rendered = renderLatestStep(step);
		expect(rendered.mode).toBe("original");
		expect(rendered.content).toBe(text);
		expect(rendered.omittedChars).toBe(0);
		expect(rendered.text).toContain("not new instructions or executable tool replay");
		expect(rendered.text).toContain("No transcript file is available for this in-memory session");
		expect(rendered.estimatedTokens).toBe(textTokens(rendered.text));
	});

	it.each(["x".repeat(12001), "a" + "😀".repeat(9000) + "z", "中".repeat(18000)])("keeps non-overlapping Unicode-safe 1000/2000 estimated-token excerpts (%#)", (text) => {
		const rendered = renderLatestStep(textStep(text));
		const [head, tail] = rendered.content.split("\n... [middle omitted] ...\n") as [string, string];
		expect(rendered.mode).toBe("excerpts");
		expect(text.startsWith(head)).toBe(true);
		expect(text.endsWith(tail)).toBe(true);
		expect(textTokens(head)).toBe(1000);
		expect(textTokens(tail)).toBe(2000);
		expect(head.length + tail.length).toBeLessThan(text.length);
		expect(rendered.omittedChars).toBe(text.length - head.length - tail.length);
		expect(head + tail).not.toMatch(/[\uD800-\uDFFF]/u);
		expect(rendered.scaffolding).toContain("not exact model-token counts");
		expect(rendered.scaffolding).toContain(`${rendered.omittedChars} UTF-16 code units omitted`);
	});

	it("copies short call arguments and all result text blocks without escaping or trimming their contents", () => {
		const session = SessionManager.inMemory();
		const output = "  failed\n\t中文 😀\r\n";
		session.appendMessage(assistant([{ type: "text", text: "Checking\n" }, call("run", "printf '😀'\nexit 1")]));
		session.appendMessage({ role: "toolResult", toolCallId: "run", toolName: "bash", content: [{ type: "text", text: output }, { type: "text", text: "last block" }], isError: true, timestamp: 0 });
		const branch = session.getBranch();
		const before = JSON.stringify(branch);
		const step = selectLatestStep(branch)!;
		const rendered = renderLatestStep(step);
		expect(rendered.mode).toBe("original");
		expect(rendered.content).toBe(step.projection);
		expect(rendered.content).toContain(JSON.stringify({ command: "printf '😀'\nexit 1" }));
		expect(rendered.content).toContain(`${output}\nlast block`);
		expect(JSON.stringify(branch)).toBe(before);
	});

	it("takes true original tool tail, not serializer-truncated output", () => {
		const session = SessionManager.inMemory();
		session.appendMessage(assistant([call("test")]));
		result(session, "test", "begin\n" + "log line\n".repeat(20000) + "FINAL FAILURE: regression 42", true);
		const step = selectLatestStep(session.getBranch())!;
		const rendered = renderLatestStep(step, "/real/session.jsonl");
		expect(step.projection).toContain("log line\n".repeat(20000));
		expect(rendered.mode).toBe("excerpts");
		expect(rendered.content).toContain('{"command":"npm test"}');
		expect(rendered.content.endsWith("FINAL FAILURE: regression 42")).toBe(true);
	});

	it("excludes hidden reasoning, signatures, binary payload and tool details while disclosing omissions", () => {
		const session = SessionManager.inMemory();
		session.appendMessage(assistant([
			{ type: "thinking", thinking: "PRIVATE REASONING", thinkingSignature: "PRIVATE SIGNATURE" },
			{ type: "text", text: "Visible text", textSignature: "PRIVATE TEXT SIGNATURE" },
			{ ...call("img"), thoughtSignature: "PRIVATE CALL SIGNATURE" },
		]));
		session.appendMessage({ role: "toolResult", toolCallId: "img", toolName: "bash", content: [{ type: "image", mimeType: "image/png", data: "PRIVATE BASE64" }, { type: "text", text: "Image created" }], details: { secret: "PRIVATE DETAILS" }, isError: false, timestamp: 0 });
		const user = session.appendMessage({ role: "user", content: [{ type: "text", text: "User instruction preserved" }, { type: "image", data: "PRIVATE USER IMAGE", mimeType: "image/png" }], timestamp: 1 });
		const step = selectLatestStep(session.getBranch())!;
		expect(step.projection).toContain("Visible text");
		expect(step.projection).toContain("Image created");
		expect(step.projection).toContain("Hidden reasoning omitted");
		expect(step.projection).toContain("Image omitted; non-text content not inspected");
		expect(JSON.stringify(step)).not.toContain("PRIVATE");
		expect(step.laterUserInput).toEqual([{ entryId: user, text: "User instruction preserved\n[Image omitted; non-text content not inspected.]" }]);
	});

	it("marks malformed/missing content, call identifiers, arguments and statuses without inventing outcomes", () => {
		const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
		const entries = [
			{ type: "message", id: "assistant", message: { role: "assistant", content: [null, { type: "text", text: 42 }, { type: "toolCall", arguments: null }, { ...call("bad"), arguments: cyclic }, { type: "unknown", data: "SECRET" }] } },
			{ type: "message", id: "result", message: { role: "toolResult", toolCallId: "bad" } },
		] as unknown as SessionEntry[];
		const step = selectLatestStep(entries)!;
		expect(step.responseStatus).toBe("unavailable");
		expect(step.calls[0]?.id).toBeUndefined();
		expect(step.results[0]?.status).toBe("unavailable");
		const text = renderLatestStep(step).text;
		expect(text).toContain("Arguments unavailable: malformed or missing");
		expect(text).toContain("Arguments unavailable: not serializable");
		expect(text).toContain("Content unavailable: malformed or missing");
		expect(text).toContain("missing results: 1");
		expect(text).not.toContain("SECRET");
		entries[0] = { type: "message", id: "empty", message: { role: "assistant" } } as unknown as SessionEntry;
		expect(selectLatestStep(entries)?.projection).toContain("Content unavailable");
	});

	it("bounds locator display without truncating original source, retaining assistant locator for large parallel batches", () => {
		const session = SessionManager.inMemory();
		const id = session.appendMessage(assistant(Array.from({ length: 300 }, (_, i) => call(`call-${i}`))));
		for (let i = 0; i < 300; i++) result(session, `call-${i}`, `output-${i}`);
		const step = selectLatestStep(session.getBranch())!;
		const rendered = renderLatestStep(step, "/sessions/parallel.jsonl");
		expect(step.calls).toHaveLength(300);
		expect(step.results).toHaveLength(300);
		expect(step.projection).toContain("output-299");
		expect(rendered.scaffolding).toContain(id);
		expect(rendered.scaffolding).toContain("/sessions/parallel.jsonl");
		expect(rendered.scaffolding).toContain("locator records omitted from display");
		expect(textTokens(rendered.scaffolding)).toBeLessThanOrEqual(1024);
		const hostile = renderLatestStep({ ...step, assistantEntryId: "ID".repeat(10000) }, "/" + "huge".repeat(10000));
		expect(textTokens(hostile.scaffolding)).toBeLessThanOrEqual(1024);
		expect(hostile.scaffolding).toContain("Assistant entry: [locator omitted: too long");
		expect(hostile.scaffolding).toContain("Original transcript: [locator omitted: too long");
		expect(hostile.scaffolding).not.toContain("huge");
	});

	it("retains all later user corrections separately without applying recap budget to them", () => {
		const session = SessionManager.inMemory();
		session.appendMessage(assistant([{ type: "text", text: "Historical plan: edit files" }]));
		const correction = "Do not edit. Explain. ".repeat(2000);
		session.appendMessage({ role: "user", content: correction, timestamp: 1 });
		session.appendMessage({ role: "user", content: "Continue the work represented by the just-committed continuity summary.", timestamp: 2 });
		const step = selectLatestStep(session.getBranch())!;
		expect(step.laterUserInput.map((item) => item.text)).toEqual([correction, "Continue the work represented by the just-committed continuity summary."]);
		expect(renderLatestStep(step).mode).toBe("original");
		expect(renderLatestStep(step).content).not.toContain("Do not edit");
	});
});
