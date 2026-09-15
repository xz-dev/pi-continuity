import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { convertToLlm, SessionManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createContinuityExtension, parseSummary, renderSummary, type ContinuitySummary } from "../internal/continuity-core.js";
import { prepareEvidence, renderEvidence, selectEvidence, textTokens } from "../internal/continuity-evidence.js";

const summary: ContinuitySummary = {
	task: "Ship the standalone package",
	doneWhen: "All verification commands pass",
	constraints: ["Do not push"],
	established: ["Pi version is 0.82.0"],
	open: ["Install smoke"],
	next: ["Run tests"],
};

const usage = {
	input: 1,
	output: 1,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 2,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

type Handler = (event: any, ctx: any) => Promise<unknown> | unknown;

function compactEvent(reason: "manual" | "threshold" | "overflow" = "manual", signal = new AbortController().signal) {
	return {
		type: "session_before_compact",
		reason,
		willRetry: reason === "overflow",
		signal,
		branchEntries: [{ id: "entry-1", parentId: null, timestamp: new Date(0).toISOString(), type: "message", message: { role: "user", content: "Keep the existing task constraints.", timestamp: 0 } }],
		preparation: {
			messagesToSummarize: [],
			turnPrefixMessages: [],
			previousSummary: undefined,
			firstKeptEntryId: "entry-1",
			tokensBefore: 123,
			settings: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
			fileOps: { read: new Set(["read-only.ts", "shared.ts"]), written: new Set(["written.ts", "shared.ts"]), edited: new Set(["edited.ts", "shared.ts"]) },
		},
	};
}

function context(compact = vi.fn()) {
	return {
		model: { id: "test-model", contextWindow: 128000, maxTokens: 16384 },
		hasUI: true,
		ui: { notify: vi.fn(), setWidget: vi.fn() },
		modelRegistry: { getApiKeyAndHeaders: vi.fn().mockResolvedValue({ ok: true, apiKey: undefined }) },
		compact,
	};
}

function compactCallbacks(ctx: ReturnType<typeof context>) {
	return ctx.compact.mock.calls[0]?.[0] as { onComplete?: () => void; onError?: (error: Error) => void } | undefined;
}

function streamEvents(text: string, stopReason = "stop") {
	const events = createAssistantMessageEventStream();
	events.push({ type: "text_start", contentIndex: 0, partial: undefined } as never);
	events.push({ type: "text_delta", contentIndex: 0, delta: text, partial: undefined } as never);
	events.push({ type: "text_end", contentIndex: 0, content: text, partial: undefined } as never);
	events.end({
		role: "assistant",
		content: [{ type: "text", text }],
		stopReason,
		usage,
		api: "openai-completions",
		provider: "test",
		model: "test-model",
		timestamp: Date.now(),
	} as never);
	return events;
}

function toolEvents(arguments_: Record<string, unknown>, name = "submit_continuity", stopReason = "toolUse") {
	const events = createAssistantMessageEventStream();
	const toolCall = { type: "toolCall", id: "tool-1", name, arguments: arguments_ } as const;
	const delta = JSON.stringify(arguments_);
	events.push({ type: "toolcall_start", contentIndex: 0, partial: undefined } as never);
	events.push({ type: "toolcall_delta", contentIndex: 0, delta, partial: undefined } as never);
	events.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: undefined } as never);
	events.end({
		role: "assistant",
		content: [toolCall],
		stopReason,
		usage,
		api: "openai-completions",
		provider: "test",
		model: "test-model",
		timestamp: Date.now(),
	} as never);
	return events;
}

function fakeStream(text: string, stopReason = "stop") {
	return vi.fn().mockImplementation(() => streamEvents(text, stopReason));
}

function fakeToolStream(arguments_: Record<string, unknown>, name = "submit_continuity", stopReason = "toolUse") {
	return vi.fn().mockImplementation(() => toolEvents(arguments_, name, stopReason));
}

function successfulStream(model: unknown = summary) {
	return fakeToolStream({ summary: model, quotes: [], retire: [] });
}

function createFakeExtension(stream = successfulStream()) {
	const handlers = new Map<string, Handler[]>();
	let command: { handler: (args: string, ctx: any) => Promise<void> } | undefined;
	const pi = {
		on: vi.fn((name: string, handler: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler])),
		registerCommand: vi.fn((_name: string, value: typeof command) => (command = value)),
		sendMessage: vi.fn(),
	};
	createContinuityExtension({ stream: stream as never })(pi as unknown as ExtensionAPI);
	return { handlers, getCommand: () => command, sendMessage: pi.sendMessage };
}

async function requestContinuity(fake: ReturnType<typeof createFakeExtension>, ctx: any, args = "") {
	await fake.getCommand()?.handler(args, { ...ctx, ui: { notify: vi.fn() } });
}

function before(fake: ReturnType<typeof createFakeExtension>) {
	return fake.handlers.get("session_before_compact")?.[0];
}

describe("strict continuity summary", () => {
	it("accepts only the bounded semantic summary shape", () => {
		expect(parseSummary(JSON.stringify(summary))).toEqual(summary);
		expect(parseSummary(JSON.stringify({ ...summary, status: "active" }))).toBeUndefined();
		expect(parseSummary(JSON.stringify({ ...summary, task: "" }))).toBeUndefined();
		expect(parseSummary(JSON.stringify({ ...summary, constraints: ["same", "same"] }))).toBeUndefined();
		expect(parseSummary("not json")).toBeUndefined();
	});

	it("renders deterministic markdown without checkpoint metadata", () => {
		const rendered = renderSummary(summary);
		expect(rendered).toBe([
			"## Task", '"Ship the standalone package"', "", "## Done when", '"All verification commands pass"', "",
			"## Constraints", '- "Do not push"', "", "## Established", '- "Pi version is 0.82.0"', "",
			"## Open", '- "Install smoke"', "", "## Next", '- "Run tests"',
		].join("\n"));
		expect(rendered).not.toMatch(/checkpoint|authorization|status|created/i);
	});
});

describe("host-derived extraction budgets", () => {
	it.each([
		["25 open items", { ...summary, open: Array.from({ length: 25 }, (_, i) => `Open ${i}`) }],
		["long scalar above the old raw ceiling", { ...summary, task: "A complete semantic fact. ".repeat(800).trimEnd() }],
		["long list item", { ...summary, established: ["Complete observation. ".repeat(80).trimEnd()] }],
	])("accepts %s within the real safety budget", async (_label, state) => {
		const stream = successfulStream(state);
		const fake = createFakeExtension(stream);
		const result: any = await before(fake)?.(compactEvent("threshold"), context());
		expect(result?.compaction).toBeDefined();
		expect(result.compaction.summary).toContain(renderSummary(state));
		expect(stream.mock.calls[0]![2]).not.toHaveProperty("maxTokens");
	});

	it("uses an aggregate 128-item ceiling rather than independent category ceilings", () => {
		const state = { ...summary, constraints: Array.from({ length: 64 }, (_, i) => `Constraint ${i}`), established: Array.from({ length: 64 }, (_, i) => `Fact ${i}`), open: [], next: [] };
		expect(parseSummary(JSON.stringify(state))).toEqual(state);
		expect(parseSummary(JSON.stringify({ ...state, open: ["one too many"] }))).toBeUndefined();
	});

	it.each([
		[128000, 16384, 16384, "", 2000],
		[128000, 16384, 16384, "x".repeat(400000), 6400],
		[256000, 8192, 4000, "x".repeat(400000), 4000],
		[16000, 1024, 512, "", 512],
	])("scales the soft target from host capacities (%s/%s/%s)", async (contextWindow, reserveTokens, maxTokens, previousSummary, target) => {
		const stream = successfulStream();
		const fake = createFakeExtension(stream);
		const ctx = { ...context(), model: { id: "test-model", contextWindow, maxTokens } };
		const event = compactEvent("threshold");
		event.preparation.settings.reserveTokens = reserveTokens;
		(event.preparation as any).previousSummary = previousSummary;
		await before(fake)?.(event, ctx);
		expect(stream).toHaveBeenCalledOnce();
		const prompt = (stream.mock.calls[0]![1] as any).messages[0].content[0].text;
		const line = prompt.split("\n").find((line: string) => line.startsWith("Budget: "));
		expect(line).toBeDefined();
		const budget = JSON.parse(line.slice("Budget: ".length));
		expect(budget.responseTarget).toBe(target);
		expect(budget.renderLimit).toBe(Math.min(contextWindow, reserveTokens));
		expect(budget.rawTextLimit).toBe(16 * Math.min(contextWindow, reserveTokens));
		expect(stream.mock.calls[0]![2]).not.toHaveProperty("maxTokens");
	});

	it.each([0, -1, NaN, Infinity, 1.5])("makes no extraction request for invalid context capacity %s", async (contextWindow) => {
		const stream = successfulStream();
		const fake = createFakeExtension(stream);
		const ctx = { ...context(), model: { ...context().model, contextWindow } };
		expect(await before(fake)?.(compactEvent("threshold"), ctx)).toBeUndefined();
		expect(stream).not.toHaveBeenCalled();
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("input-budget"), "warning");
	});

	it("falls back before extraction when the base input cannot fit with output headroom", async () => {
		const stream = successfulStream();
		const fake = createFakeExtension(stream);
		const ctx = { ...context(), model: { id: "test-model", contextWindow: 4096, maxTokens: 512 } };
		expect(await before(fake)?.(compactEvent("threshold"), ctx)).toBeUndefined();
		expect(stream).not.toHaveBeenCalled();
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("input-budget"), "warning");
	});

	it("shrinks only the offered catalogue, retaining the prepared history", async () => {
		const stream = successfulStream();
		const fake = createFakeExtension(stream);
		const ctx = { ...context(), model: { id: "test-model", contextWindow: 5800, maxTokens: 256 } };
		const event: any = compactEvent("threshold");
		event.preparation.settings.reserveTokens = 512;
		event.branchEntries[0].message.content = "u".repeat(4000);
		event.preparation.messagesToSummarize = [{ role: "user", content: "Important prepared history must remain intact.", timestamp: 0 }];
		const result: any = await before(fake)?.(event, ctx);
		expect(stream).toHaveBeenCalledOnce();
		expect(result?.compaction).toBeDefined();
		expect(result.compaction.details.continuity.coverage.sourceWindowsOmitted).toBe(1);
		expect(result.compaction.details.continuity.coverage.sourceCharsOmitted).toBe(4000);
		const input = stream.mock.calls[0]![1] as any;
		const prompt = input.messages[0].content[0].text;
		expect(prompt).toContain("Important prepared history must remain intact.");
		expect(prompt).not.toContain("u".repeat(4000));
		expect(textTokens(input.systemPrompt) + textTokens(prompt) + 256 + 4096).toBeLessThanOrEqual(5800);
	});

	it.each([0, NaN, Infinity, undefined])("rejects missing/invalid reserve capacity %s before extraction", async (reserveTokens) => {
		const stream = successfulStream();
		const fake = createFakeExtension(stream);
		const event: any = compactEvent("threshold");
		event.preparation.settings.reserveTokens = reserveTokens;
		expect(await before(fake)?.(event, context())).toBeUndefined();
		expect(stream).not.toHaveBeenCalled();
	});

	it("uses R when the model output capacity is unknown", async () => {
		const stream = successfulStream();
		const fake = createFakeExtension(stream);
		const event = compactEvent("threshold");
		event.preparation.settings.reserveTokens = 1024;
		await before(fake)?.(event, { ...context(), model: { id: "test-model", contextWindow: 128000 } });
		const line = (stream.mock.calls[0]![1] as any).messages[0].content[0].text.split("\n").find((line: string) => line.startsWith("Budget: "));
		expect(JSON.parse(line.slice(8))).toEqual(expect.objectContaining({ generationAllowance: 1024, responseTarget: 1024 }));
	});

	it("checks the complete tool arguments against the raw safety bound", async () => {
		const stream = successfulStream({ ...summary, task: "x".repeat(9000) });
		const fake = createFakeExtension(stream);
		const event = compactEvent("threshold");
		event.preparation.settings.reserveTokens = 512;
		const ctx = context();
		expect(await before(fake)?.(event, ctx)).toBeUndefined();
		expect(stream).toHaveBeenCalledOnce();
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("semantic-budget"), "warning");
	});

	it("rejects semantic overflow rather than truncating a list to fit R", async () => {
		const state = { ...summary, open: Array.from({ length: 50 }, (_, i) => `${i}: ${"x".repeat(70)}`) };
		const stream = successfulStream(state);
		const fake = createFakeExtension(stream);
		const event = compactEvent("threshold");
		event.preparation.settings.reserveTokens = 512;
		const ctx = context();
		expect(await before(fake)?.(event, ctx)).toBeUndefined();
		expect(stream).toHaveBeenCalledOnce();
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("semantic-budget"), "warning");
	});

	it("preserves valid semantics when a proposal array exceeds its 32-record ceiling", async () => {
		const stream = fakeToolStream({ summary, quotes: Array.from({ length: 33 }, () => ({ sourceId: "s0", quote: "Keep", kind: "task" })), retire: [] });
		const fake = createFakeExtension(stream);
		const result: any = await before(fake)?.(compactEvent("threshold"), context());
		expect(result.compaction.summary).toContain(renderSummary(summary));
		expect(result.compaction.details.continuity.coverage.selectionsRejected).toBe(33);
		expect(result.compaction.details.continuity.evidence).toEqual([]);
	});

	it("re-asks twice when the required tool is missing", async () => {
		const stream = fakeStream("Use this JSON instead");
		const fake = createFakeExtension(stream);
		const ctx = context();
		expect(await before(fake)?.(compactEvent("threshold"), ctx)).toBeUndefined();
		expect(stream).toHaveBeenCalledTimes(3);
		expect((stream.mock.calls[1]![1] as any).messages[0].content[0].text).toContain("did not call submit_continuity");
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("invalid-schema"), "warning");
	});

	it("accepts a valid tool after a wrong-tool retry and accumulates usage", async () => {
		const stream = vi.fn()
			.mockImplementationOnce(() => toolEvents({ value: "wrong" }, "other_tool"))
			.mockImplementationOnce(() => toolEvents({ summary, quotes: [], retire: [] }));
		const fake = createFakeExtension(stream);
		const result: any = await before(fake)?.(compactEvent("threshold"), context());
		expect(stream).toHaveBeenCalledTimes(2);
		expect(result.compaction.summary).toContain(renderSummary(summary));
		expect(result.compaction.usage).toEqual({ ...usage, input: 2, output: 2, totalTokens: 4 });
	});

	it("does not accept multiple or mixed tool calls as one form", async () => {
		const stream = vi.fn().mockImplementation(() => {
			const events = createAssistantMessageEventStream();
			events.end({
				role: "assistant",
				content: [
					{ type: "toolCall", id: "tool-1", name: "submit_continuity", arguments: { summary, quotes: [], retire: [] } },
					{ type: "toolCall", id: "tool-2", name: "other_tool", arguments: {} },
				],
				stopReason: "toolUse", usage, api: "openai-completions", provider: "test", model: "test-model", timestamp: Date.now(),
			} as never);
			return events;
		});
		const fake = createFakeExtension(stream);
		expect(await before(fake)?.(compactEvent("threshold"), context())).toBeUndefined();
		expect(stream).toHaveBeenCalledTimes(3);
	});

	it("does not retry a length-limited response", async () => {
		const stream = fakeStream("", "length");
		const fake = createFakeExtension(stream);
		expect(await before(fake)?.(compactEvent("threshold"), context())).toBeUndefined();
		expect(stream).toHaveBeenCalledOnce();
	});
});

describe("extraction prompt and failure contract", () => {
	it.each([false, true])("captures %s update mode, split prefix, final focus and only filters its own custom messages", async (update) => {
		const stream = successfulStream();
		const fake = createFakeExtension(stream);
		const event: any = compactEvent("threshold");
		const genuine = "Continue the work represented by the just-committed continuity summary.";
		event.preparation.previousSummary = update ? "Prior request is still awaiting an answer." : undefined;
		event.preparation.messagesToSummarize = [
			{ role: "user", content: genuine, timestamp: 1 },
			{ role: "custom", customType: "pi-continuity/continue", content: genuine, display: false, timestamp: 2 },
			{ role: "custom", customType: "another-extension", content: genuine, display: false, timestamp: 3 },
		];
		event.preparation.turnPrefixMessages = [
			{ role: "user", content: "Compare the alternatives; answer the question, do not implement.", timestamp: 4 },
			{ role: "custom", customType: "pi-continuity/continue", content: "PREFIX-OWN-ONLY", display: false, timestamp: 5 },
		];
		event.customInstructions = "Focus on the pending approval.";
		await before(fake)?.(event, context());
		const input = stream.mock.calls[0]![1] as any;
		const prompt = input.messages[0].content[0].text as string;
		expect(prompt.startsWith(update ? "Update the prior" : "Build an initial")).toBe(true);
		expect(prompt.split(genuine)).toHaveLength(3);
		expect(prompt).not.toContain("PREFIX-OWN-ONLY");
		expect(prompt).toContain("Compare the alternatives; answer the question, do not implement.");
		expect(prompt).toMatch(/<compaction_focus>\n"Focus on the pending approval\."\n<\/compaction_focus>$/);
		expect(input.systemPrompt).toContain("latest unmet user request");
		expect(input.systemPrompt).toContain("Tool arguments prove an attempt");
		expect(input.systemPrompt).toContain("corrections, stop signals and reversals override old plans");
		expect(input.systemPrompt).toContain("no active request remains");
	});

	it("accepts an explicitly resolved state without inventing a next action", async () => {
		const state = { task: "No active request remains.", doneWhen: "All requests have been answered.", constraints: [], established: ["The requested comparison was supplied."], open: [], next: [] };
		const fake = createFakeExtension(successfulStream(state));
		const result: any = await before(fake)?.(compactEvent("threshold"), context());
		expect(result.compaction.summary).toContain(renderSummary(state));
		expect(fake.sendMessage).not.toHaveBeenCalled();
	});

	it("retains auth, routing-related headers/env, signal and cache options without a plugin output cap", async () => {
		const stream = successfulStream();
		const fake = createFakeExtension(stream);
		const ctx = context();
		ctx.modelRegistry.getApiKeyAndHeaders.mockResolvedValue({ ok: true, apiKey: "synthetic-key", headers: { "x-route": "synthetic-route" }, env: { TEST_PROVIDER_ORIGIN: "https://example.invalid" } });
		const event = compactEvent("threshold");
		await before(fake)?.(event, ctx);
		expect(stream.mock.calls[0]![0]).toBe(ctx.model);
		expect(stream.mock.calls[0]![2]).toEqual(expect.objectContaining({ apiKey: "synthetic-key", headers: { "x-route": "synthetic-route" }, env: { TEST_PROVIDER_ORIGIN: "https://example.invalid" }, signal: event.signal, cacheRetention: "none", sessionId: expect.any(String) }));
		expect(stream.mock.calls[0]![2]).not.toHaveProperty("maxTokens");
	});

	it.each(["missing-model", "auth-unavailable", "model-error", "incomplete-output", "invalid-schema", "invalid-boundary", "input-budget", "semantic-budget"])("permits native fallback for %s, but continues only on a successful host callback", async (reason) => {
		const stream = successfulStream();
		const ctx: any = context();
		const event: any = compactEvent();
		if (reason === "missing-model") ctx.model = undefined;
		else if (reason === "auth-unavailable") ctx.modelRegistry.getApiKeyAndHeaders.mockRejectedValue(new Error("synthetic confidential auth error"));
		else if (reason === "model-error") stream.mockImplementation(() => { throw new Error("synthetic confidential provider error"); });
		else if (reason === "incomplete-output") stream.mockImplementation(() => streamEvents("", "length"));
		else if (reason === "invalid-schema") stream.mockImplementation(() => toolEvents({ summary: { ...summary, task: "" }, quotes: [], retire: [] }));
		else if (reason === "invalid-boundary") event.preparation.firstKeptEntryId = "absent";
		else if (reason === "input-budget") ctx.model.contextWindow = 0;
		else { event.preparation.settings.reserveTokens = 64; }
		const fake = createFakeExtension(stream);
		await requestContinuity(fake, ctx);
		expect(await before(fake)?.(event, ctx)).toBeUndefined();
		expect(fake.sendMessage).not.toHaveBeenCalled();
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining(reason), "warning");
		expect(JSON.stringify(ctx.ui.notify.mock.calls)).not.toContain("confidential");
		expect(stream.mock.calls.length).toBeLessThanOrEqual(1);
		compactCallbacks(ctx)?.onComplete?.();
		compactCallbacks(ctx)?.onComplete?.();
		expect(fake.sendMessage).not.toHaveBeenCalled();
	});

	it("uses a single bounded headless diagnostic, never provider text or chat", async () => {
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		try {
			const fake = createFakeExtension(vi.fn().mockImplementation(() => { throw new Error("DO-NOT-LOG-THIS-SECRET"); }));
			await before(fake)?.(compactEvent("threshold"), { ...context(), hasUI: false });
			expect(stderr).toHaveBeenCalledOnce();
			expect(String(stderr.mock.calls[0]![0])).toContain("model-error");
			expect(String(stderr.mock.calls[0]![0])).not.toContain("DO-NOT-LOG");
			expect(String(stderr.mock.calls[0]![0]).split("\n")).toHaveLength(2);
			expect(fake.sendMessage).not.toHaveBeenCalled();
		} finally { stderr.mockRestore(); }
	});
});

describe("manual /continuity", () => {
	it("compacts immediately without starting a continuation turn", async () => {
		const fake = createFakeExtension();
		const ctx = context();
		await requestContinuity(fake, ctx);
		expect(ctx.compact).toHaveBeenCalledOnce();

		const result = await before(fake)?.(compactEvent(), ctx);
		expect(result).toEqual({ compaction: expect.objectContaining({ summary: expect.stringContaining(renderSummary(summary)), details: expect.objectContaining({ readFiles: ["read-only.ts"], modifiedFiles: ["edited.ts", "shared.ts", "written.ts"] }) }) });
		expect(fake.sendMessage).not.toHaveBeenCalled();
		compactCallbacks(ctx)?.onComplete?.();
		expect(fake.sendMessage).not.toHaveBeenCalled();

		await requestContinuity(fake, ctx);
		expect(ctx.compact).toHaveBeenCalledTimes(2);
	});

	it("continues exactly once after /continuity continue commits", async () => {
		const fake = createFakeExtension();
		const ctx = context();
		await requestContinuity(fake, ctx, "continue");
		expect(ctx.compact).toHaveBeenCalledOnce();
		expect(fake.sendMessage).not.toHaveBeenCalled();

		const callbacks = compactCallbacks(ctx)!;
		callbacks.onComplete?.();
		expect(fake.sendMessage).toHaveBeenCalledOnce();
		expect(fake.sendMessage).toHaveBeenCalledWith({
			customType: "pi-continuity/continue",
			content: "Continue the work represented by the just-committed continuity summary.",
			display: false,
		}, { triggerTurn: true });
		callbacks.onComplete?.();
		expect(fake.sendMessage).toHaveBeenCalledOnce();
	});

	it("rejects unsupported arguments before starting compaction", async () => {
		const fake = createFakeExtension();
		const ctx = context();
		const notify = vi.fn();
		await fake.getCommand()?.handler("later", { ...ctx, ui: { notify } });
		expect(notify).toHaveBeenCalledWith("Usage: /continuity [continue]", "warning");
		expect(ctx.compact).not.toHaveBeenCalled();
		expect(fake.sendMessage).not.toHaveBeenCalled();
	});

	it("does not start or continue a duplicate pending request", async () => {
		const fake = createFakeExtension();
		const ctx = context();
		await requestContinuity(fake, ctx, "continue");
		await requestContinuity(fake, ctx, "continue");
		expect(ctx.compact).toHaveBeenCalledOnce();
		const callbacks = compactCallbacks(ctx)!;
		callbacks.onComplete?.();
		callbacks.onComplete?.();
		expect(fake.sendMessage).toHaveBeenCalledOnce();
	});

	it("keeps a cancelled request guarded until compaction terminates", async () => {
		const fake = createFakeExtension();
		const ctx = context();
		await requestContinuity(fake, ctx, "continue");
		await before(fake)?.(compactEvent("manual", AbortSignal.abort()), ctx);
		await requestContinuity(fake, ctx, "continue");
		expect(ctx.compact).toHaveBeenCalledOnce();
		compactCallbacks(ctx)?.onError?.(new Error("cancelled"));
		expect(fake.sendMessage).not.toHaveBeenCalled();
		await requestContinuity(fake, ctx, "continue");
		expect(ctx.compact).toHaveBeenCalledTimes(2);
	});

	it("clears a cancelled request and allows a later request", async () => {
		const fake = createFakeExtension();
		const ctx = context();
		await requestContinuity(fake, ctx, "continue");
		await before(fake)?.(compactEvent("manual", AbortSignal.abort()), ctx);
		compactCallbacks(ctx)?.onError?.(new Error("cancelled"));
		expect(fake.sendMessage).not.toHaveBeenCalled();
		await requestContinuity(fake, ctx);
		expect(ctx.compact).toHaveBeenCalledTimes(2);
	});

	it("clears a compact error and allows a later request", async () => {
		const fake = createFakeExtension();
		const compact = vi.fn();
		const ctx = context(compact);
		await requestContinuity(fake, ctx, "continue");
		compactCallbacks(ctx)?.onError?.(new Error("cancelled"));
		expect(fake.sendMessage).not.toHaveBeenCalled();
		await requestContinuity(fake, ctx);
		expect(compact).toHaveBeenCalledTimes(2);
	});

	it("clears a synchronous compact-start failure without continuing", async () => {
		const fake = createFakeExtension();
		const compact = vi.fn().mockImplementationOnce(() => { throw new Error("synthetic start failure"); });
		const ctx = context(compact);
		const notify = vi.fn();
		await fake.getCommand()?.handler("continue", { ...ctx, ui: { notify } });
		expect(notify).toHaveBeenCalledWith("Continuity compaction could not start.", "warning");
		compactCallbacks(ctx)?.onComplete?.();
		expect(fake.sendMessage).not.toHaveBeenCalled();

		await requestContinuity(fake, ctx, "continue");
		expect(compact).toHaveBeenCalledTimes(2);
		(ctx.compact.mock.calls[1]![0] as any).onComplete();
		expect(fake.sendMessage).toHaveBeenCalledOnce();
	});

	it.each([
		{ mode: "default", args: "", continuations: 0 },
		{ mode: "explicit", args: "continue", continuations: 1 },
	])("fails open to native manual compaction for $mode mode", async ({ args, continuations }) => {
		const fake = createFakeExtension(successfulStream({ ...summary, extra: true }));
		const ctx = context();
		await requestContinuity(fake, ctx, args);
		expect(await before(fake)?.(compactEvent(), ctx)).toBeUndefined();
		const callbacks = compactCallbacks(ctx)!;
		callbacks.onComplete?.();
		callbacks.onComplete?.();
		expect(fake.sendMessage).toHaveBeenCalledTimes(continuations);
	});

	it.each(["host-signal", "provider-aborted"])("never continues a cancelled %s request even on a late success callback", async (kind) => {
		const stream = kind === "host-signal" ? successfulStream() : fakeStream("", "aborted");
		const fake = createFakeExtension(stream);
		const ctx = context();
		await requestContinuity(fake, ctx, "continue");
		await before(fake)?.(compactEvent("manual", kind === "host-signal" ? AbortSignal.abort() : new AbortController().signal), ctx);
		compactCallbacks(ctx)?.onComplete?.();
		expect(fake.sendMessage).not.toHaveBeenCalled();
		await requestContinuity(fake, ctx);
		expect(ctx.compact).toHaveBeenCalledTimes(2);
	});

	it("ignores stale terminal callbacks without clearing or continuing a later request", async () => {
		const fake = createFakeExtension();
		const ctx = context();
		await requestContinuity(fake, ctx, "continue");
		const old = compactCallbacks(ctx)!;
		old.onError?.(new Error("first request failed"));
		await requestContinuity(fake, ctx, "continue");
		const current = ctx.compact.mock.calls[1]![0] as any;
		old.onComplete?.();
		old.onError?.(new Error("duplicate old error"));
		await requestContinuity(fake, ctx, "continue");
		expect(ctx.compact).toHaveBeenCalledTimes(2);
		expect(fake.sendMessage).not.toHaveBeenCalled();

		current.onComplete();
		current.onComplete();
		expect(fake.sendMessage).toHaveBeenCalledOnce();
		await requestContinuity(fake, ctx, "continue");
		expect(ctx.compact).toHaveBeenCalledTimes(3);
		(ctx.compact.mock.calls[2]![0] as any).onComplete();
		expect(fake.sendMessage).toHaveBeenCalledTimes(2);
	});

	it("leaves a plain native /compact event untouched", async () => {
		const fake = createFakeExtension();
		expect(await before(fake)?.(compactEvent(), context())).toBeUndefined();
	});
});

describe("Pi-scheduled compaction", () => {
	it.each(["threshold", "overflow"] as const)("returns continuity summary for %s without continuation", async (reason) => {
		const fake = createFakeExtension();
		const ctx = context();
		const result = await before(fake)?.(compactEvent(reason), ctx);
		expect(result).toEqual({ compaction: expect.objectContaining({ summary: expect.stringContaining(renderSummary(summary)) }) });
		expect(fake.sendMessage).not.toHaveBeenCalled();
		expect(ctx.compact).not.toHaveBeenCalled();
	});

	it.each([
		{ ctx: { ...context(), model: undefined }, event: compactEvent("threshold") },
		{ ctx: { ...context(), modelRegistry: { getApiKeyAndHeaders: vi.fn().mockResolvedValue({ ok: false }) } }, event: compactEvent("overflow") },
		{ ctx: context(), event: compactEvent("threshold", AbortSignal.abort()) },
	])("fails open when synthesis is unavailable", async ({ ctx, event }) => {
		const fake = createFakeExtension();
		await expect(before(fake)?.(event, ctx)).resolves.toBeUndefined();
	});
});

describe("source-backed continuation context", () => {
	it("rejects a fabricated quotation without discarding valid semantic output", async () => {
		const stream = fakeToolStream({ summary, quotes: [{ sourceId: "s0", quote: "可以部署", kind: "constraint" }], retire: [] });
		const fake = createFakeExtension(stream);
		const result: any = await before(fake)?.(compactEvent("threshold"), context());
		expect(result.compaction.summary).toContain(renderSummary(summary));
		expect(result.compaction.usage).toEqual(usage);
		expect(result.compaction.details.continuity.evidence).toEqual([]);
		expect(result.compaction.details.continuity.coverage.selectionsRejected).toBe(1);
		expect(stream).toHaveBeenCalledOnce();
		expect(fake.sendMessage).not.toHaveBeenCalled();
	});

	it("copies a selected original user span into Pi's actual continuation context", async () => {
		const session = SessionManager.inMemory();
		const original = '只分析，不修改文件；最终给三个方案。\n  保留 "缩进" 和端口 8080。';
		const sourceText = `背景：\n${original}\n结束。`;
		const sourceEntryId = session.appendMessage({
			role: "user", content: [{ type: "image", data: "", mimeType: "image/png" }, { type: "text", text: sourceText }], timestamp: 1,
		});
		const keptId = session.appendMessage({ role: "user", content: "继续分析", timestamp: 2 });
		const stream = vi.fn().mockImplementation((_model: unknown, input: any) => {
			const prompt = input.messages[0].content[0].text as string;
			const offered = prompt.split("\n").filter((line) => line.startsWith('{"sourceId":')).map((line) => JSON.parse(line))
				.find((source) => source.text.includes(original));
			return toolEvents({ summary, quotes: [{ sourceId: offered?.sourceId ?? "not-offered", quote: original, kind: "constraint" }], retire: [] });
		});
		const fake = createFakeExtension(stream);
		const event: any = compactEvent("threshold");
		event.branchEntries = session.getBranch();
		event.preparation.firstKeptEntryId = keptId;
		event.preparation.messagesToSummarize = [event.branchEntries[0].message];
		event.preparation.settings = { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 };
		const ctx = { ...context(), model: { id: "test-model", contextWindow: 128000, maxTokens: 16384 }, sessionManager: session };
		const result: any = await before(fake)?.(event, ctx);
		expect(result?.compaction).toBeDefined();
		const compaction = result.compaction;
		const evidence = compaction.details.continuity.evidence[0];
		expect(evidence).toEqual(expect.objectContaining({ entryId: sourceEntryId, blockIndex: 1, kind: "constraint" }));
		expect(sourceText.slice(evidence.start, evidence.end)).toBe(original);
		expect(evidence).not.toHaveProperty("text");
		expect(compaction.firstKeptEntryId).toBe(keptId);
		session.appendCompaction(compaction.summary, keptId, compaction.tokensBefore, compaction.details, true, compaction.usage);
		session.appendCustomMessageEntry("pi-continuity/continue", "Continue the work represented by the just-committed continuity summary.", false);
		const visible = convertToLlm(session.buildSessionContext().messages).flatMap((message) =>
			typeof message.content === "string" ? [message.content] : message.content.filter((part) => part.type === "text").map((part) => part.text),
		).join("\n");
		expect(visible).toContain("## Original user evidence");
		expect(visible).toContain(JSON.stringify(original));
		expect(visible).toContain(sourceEntryId);
		expect(visible).toMatch(/selected|bounded/i);
	});
});

describe("persisted evidence across compactions", () => {
	const roots: string[] = [];
	afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

	async function persisted(original: string) {
		const root = await mkdtemp(join(tmpdir(), "pi-continuity-evidence-"));
		roots.push(root);
		const session = SessionManager.create(root, root);
		session.appendMessage({ role: "user", content: original, timestamp: 1 });
		// Pi flushes the initial session once an assistant message exists.
		session.appendMessage({ role: "assistant", content: [{ type: "text", text: "Analysis started; no files modified." }], api: "openai-completions", provider: "test", model: "test-model", usage, stopReason: "stop", timestamp: 2 });
		return session;
	}

	async function compact(session: SessionManager, choose: (sources: any[], carried: any[]) => { quotes: unknown[]; retire: unknown[] } = () => ({ quotes: [], retire: [] }), state = summary, ops?: ReturnType<typeof compactEvent>["preparation"]["fileOps"]) {
		const kept = session.appendMessage({ role: "user", content: "Continue the analysis without making changes.", timestamp: Date.now() });
		const stream = vi.fn().mockImplementation((_model: unknown, input: any) => {
			const lines = (input.messages[0].content[0].text as string).split("\n");
			const sources = lines.filter((line) => line.startsWith('{"sourceId":')).map((line) => JSON.parse(line));
			const carried = lines.filter((line) => line.startsWith('{"id":')).map((line) => JSON.parse(line));
			return toolEvents({ summary: state, ...choose(sources, carried) });
		});
		// A fresh extension instance for every round rules out process-local carry state.
		const fake = createFakeExtension(stream);
		const event: any = compactEvent("threshold");
		event.branchEntries = session.getBranch();
		event.preparation.firstKeptEntryId = kept;
		event.preparation.previousSummary = event.branchEntries.findLast((entry: any) => entry.type === "compaction")?.summary;
		event.preparation.messagesToSummarize = session.buildSessionContext().messages;
		if (ops) event.preparation.fileOps = ops;
		const result: any = await before(fake)?.(event, { ...context(), sessionManager: session });
		expect(result?.compaction).toBeDefined();
		const value = result.compaction;
		session.appendCompaction(value.summary, value.firstKeptEntryId, value.tokensBefore, value.details, true, value.usage);
		expect(fake.sendMessage).not.toHaveBeenCalled();
		return value;
	}

	function visible(session: SessionManager) {
		session.appendCustomMessageEntry("pi-continuity/continue", "Continue the work represented by the just-committed continuity summary.", false);
		return convertToLlm(session.buildSessionContext().messages).flatMap((message) => typeof message.content === "string"
			? [message.content] : message.content.filter((part) => part.type === "text").map((part) => part.text)).join("\n");
	}

	it("carries available file context across reloads and promotes later writes without duplicates", async () => {
		let session = await persisted("Only analyze the recorded files.");
		const file = session.getSessionFile()!;
		const first = await compact(session);
		session = SessionManager.open(file);
		const second = await compact(session, undefined, summary, { read: new Set(), written: new Set(), edited: new Set() });
		expect(second.details.readFiles).toEqual(first.details.readFiles);
		expect(second.details.modifiedFiles).toEqual(first.details.modifiedFiles);
		session = SessionManager.open(file);
		const third = await compact(session, undefined, summary, { read: new Set(["written.ts", "new-read.ts"]), written: new Set(["read-only.ts"]), edited: new Set() });
		expect(third.details.readFiles).toEqual(["new-read.ts"]);
		expect(third.details.modifiedFiles).toEqual(["edited.ts", "read-only.ts", "shared.ts", "written.ts"]);
		const text = visible(SessionManager.open(file));
		expect(text).toContain("## Files");
		for (const path of [...third.details.readFiles, ...third.details.modifiedFiles]) expect(text).toContain(JSON.stringify(path));
	});

	it("shrinks file display before evidence under R while retaining complete file metadata", async () => {
		const original = "Constraint: " + "q".repeat(800);
		const session = await persisted(original);
		const kept = session.appendMessage({ role: "user", content: "Continue the analysis.", timestamp: 3 });
		const paths = Array.from({ length: 80 }, (_, i) => `src/${String(i).padStart(3, "0")}-${"path".repeat(16)}.ts`);
		const stream = vi.fn().mockImplementation((_model: unknown, input: any) => {
			const sources = (input.messages[0].content[0].text as string).split("\n").filter((line) => line.startsWith('{"sourceId":')).map((line) => JSON.parse(line));
			return toolEvents({ summary, quotes: [{ sourceId: sources.find((source) => source.text === original).sourceId, quote: original, kind: "constraint" }], retire: [] });
		});
		const fake = createFakeExtension(stream);
		const event: any = compactEvent("threshold");
		event.branchEntries = session.getBranch();
		event.preparation.firstKeptEntryId = kept;
		event.preparation.settings.reserveTokens = 600;
		event.preparation.fileOps = { read: new Set(), written: new Set(paths), edited: new Set() };
		const result: any = await before(fake)?.(event, { ...context(), sessionManager: session });
		expect(result?.compaction).toBeDefined();
		const value = result.compaction;
		expect(value.details.modifiedFiles).toEqual(paths);
		expect(value.details.continuity.evidence).toHaveLength(1);
		expect(value.details.continuity.coverage.evidenceBudgetOmitted).toBe(0);
		expect(value.details.continuity.coverage.filesOmitted).toBeGreaterThan(0);
		expect(value.summary).toContain(JSON.stringify(original));
		expect(textTokens(value.summary)).toBeLessThanOrEqual(600);
		const section = value.summary.split("## Files\n")[1].split("## Retention coverage")[0];
		expect(textTokens(section)).toBeLessThanOrEqual(512);
		expect(section.match(/^- Modified: /gm)!.length + value.details.continuity.coverage.filesOmitted).toBe(paths.length);
	});

	it("keeps identical evidence through three compactions, omitted selections, and real JSONL reloads", async () => {
		const original = '只分析，不修改文件。\n  原样保留 "约束" 与路径 /tmp/配置。';
		let session = await persisted(original);
		const file = session.getSessionFile()!;
		const first = await compact(session, (sources) => ({ quotes: [{ sourceId: sources.find((source) => source.text === original).sourceId, quote: original, kind: "constraint" }], retire: [] }));
		const expected = first.details.continuity.evidence;
		expect(expected).toHaveLength(1);
		expect(first.details.continuity.coverage.basis).toBe("initial");
		for (let round = 2; round <= 3; round++) {
			session = SessionManager.open(file);
			const result = await compact(session);
			expect(result.details.continuity.evidence).toEqual(expected);
			expect(result.details.continuity.coverage.basis).toBe("carried");
			expect(result.summary).toContain(JSON.stringify(original));
		}
		const entries = (await readFile(file, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
		const compactions = entries.filter((entry) => entry.type === "compaction");
		expect(compactions).toHaveLength(3);
		for (const entry of compactions) {
			expect(entry.details.continuity.evidence).toEqual(expected);
			expect(entry.details.continuity.evidence[0]).not.toHaveProperty("text");
		}
		session = SessionManager.open(file);
		const text = visible(session);
		expect(text).toContain(JSON.stringify(original));
		expect(text).toContain(expected[0].id);
	});

	it.each(["native", "legacy", "unknown-version"])("does not borrow evidence across a newer %s compaction", async (kind) => {
		const original = "Do not deploy.";
		let session = await persisted(original);
		const file = session.getSessionFile()!;
		const first = await compact(session, (sources) => ({ quotes: [{ sourceId: sources.find((source) => source.text === original).sourceId, quote: original, kind: "constraint" }], retire: [] }));
		const details = kind === "native" ? undefined : kind === "legacy" ? { readFiles: ["legacy.ts"] }
			: { continuity: { ...first.details.continuity, version: 2 } };
		session.appendCompaction("An intervening summary without recognized continuity metadata.", first.firstKeptEntryId, 123, details, kind !== "native");
		session = SessionManager.open(file);
		const next = await compact(session);
		expect(next.details.continuity.coverage.basis).toBe("rebuilt");
		expect(next.details.continuity.evidence).toEqual([]);
		expect(next.summary).not.toContain(first.details.continuity.evidence[0].id);
	});

	it("bootstraps a new selection from raw sources after a legacy summary", async () => {
		const original = "Do not deploy.";
		let session = await persisted(original);
		const firstUser = session.getBranch()[0]!.id;
		session.appendCompaction("Legacy semantic summary.", firstUser, 123);
		session = SessionManager.open(session.getSessionFile()!);
		const result = await compact(session, (sources) => ({ quotes: [{ sourceId: sources.find((source) => source.text === original).sourceId, quote: original, kind: "constraint" }], retire: [] }));
		expect(result.details.continuity.coverage.basis).toBe("rebuilt");
		expect(result.details.continuity.evidence[0].entryId).toBe(firstUser);
		expect(visible(session)).toContain(JSON.stringify(original));
	});

	it.each(["altered-source", "unavailable-source", "bad-offset", "bad-hash"])("rejects a persisted %s reference on actual reload", async (kind) => {
		const original = "Do not deploy.";
		let session = await persisted(original);
		const file = session.getSessionFile()!;
		const first = await compact(session, (sources) => ({ quotes: [{ sourceId: sources.find((source) => source.text === original).sourceId, quote: original, kind: "constraint" }], retire: [] }));
		const ref = first.details.continuity.evidence[0];
		const entries = (await readFile(file, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
		const stored = entries.findLast((entry) => entry.type === "compaction").details.continuity.evidence[0];
		if (kind === "altered-source") entries.find((entry) => entry.id === ref.entryId).message.content = "You may deploy.";
		else if (kind === "unavailable-source") stored.entryId = "missing-user-entry";
		else if (kind === "bad-offset") stored.start = -1;
		else stored.id = "0".repeat(64);
		await writeFile(file, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
		session = SessionManager.open(file);
		const result = await compact(session);
		expect(result.details.continuity.evidence).toEqual([]);
		expect(result.details.continuity.coverage.priorUnavailable).toBe(1);
		expect(visible(session)).not.toContain(ref.id);
	});

	it("will not rehydrate a sibling branch's copied reference", async () => {
		const session = await persisted("Shared root.");
		const root = session.getLeafId()!;
		session.appendMessage({ role: "user", content: "Sibling-only constraint.", timestamp: 3 });
		const sibling = await compact(session, (sources) => ({ quotes: [{ sourceId: sources.find((source) => source.text === "Sibling-only constraint.").sourceId, quote: "Sibling-only constraint.", kind: "constraint" }], retire: [] }));
		session.branch(root);
		const kept = session.appendMessage({ role: "user", content: "Different branch.", timestamp: 4 });
		session.appendCompaction("Copied metadata must not authorize borrowing sibling text.", kept, 123, sibling.details, true);
		const reloaded = SessionManager.open(session.getSessionFile()!);
		const result = await compact(reloaded);
		expect(result.details.continuity.evidence).toEqual([]);
		expect(result.details.continuity.coverage.priorUnavailable).toBe(1);
		expect(visible(reloaded)).not.toContain("Sibling-only constraint.");
	});

	it.each(["old-user", "assistant-only"])("rejects structurally valid %s retirement and carries the original", async (kind) => {
		const original = "Do not deploy.";
		const session = await persisted(original);
		const first = await compact(session, (sources) => ({ quotes: [{ sourceId: sources.find((source) => source.text === original).sourceId, quote: original, kind: "constraint" }], retire: [] }));
		const ref = first.details.continuity.evidence[0];
		session.appendMessage({ role: "user", content: "The deployment restriction is lifted.", timestamp: 5 });
		const result = await compact(session, (sources) => {
			const older = sources.find((source) => source.entryId === ref.entryId);
			const citation = kind === "old-user" ? { sourceId: older.sourceId, quote: original }
				: { sourceId: older.sourceId, quote: "Analysis started; no files modified." };
			return { quotes: [], retire: [{ evidenceId: ref.id, reason: "satisfied", ...citation }] };
		});
		expect(result.details.continuity.evidence).toEqual(first.details.continuity.evidence);
		expect(result.details.continuity.coverage.retired).toBe(0);
		expect(result.details.continuity.coverage.retirementsRejected).toBe(1);
	});

	it.each([
		["missing-support", { evidenceId: "evidence-1", reason: "satisfied" }],
		["malformed-reason", { evidenceId: "evidence-1", reason: ["satisfied"], sourceId: "s0", quote: "Done." }],
	])("falls back immediately for %s retirement structure", async (_kind, retirement) => {
		const stream = fakeToolStream({ summary, quotes: [], retire: [retirement] });
		const fake = createFakeExtension(stream);
		const ctx = context();
		expect(await before(fake)?.(compactEvent("threshold"), ctx)).toBeUndefined();
		expect(stream).toHaveBeenCalledOnce();
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("invalid-schema"), "warning");
	});

	it("retires only the obsolete port after a newer user correction, preserving the other constraint", async () => {
		const restriction = "Do not modify files.";
		const oldPort = "Use port 8080.";
		const correction = "Use port 8081 instead of port 8080.";
		let session = await persisted(`${restriction}\n${oldPort}`);
		const file = session.getSessionFile()!;
		const first = await compact(session, (sources) => ({ quotes: [restriction, oldPort].map((quote) => ({ sourceId: sources.find((source) => source.text.includes(quote)).sourceId, quote, kind: "constraint" })), retire: [] }));
		const sourceText = `${restriction}\n${oldPort}`;
		const old = first.details.continuity.evidence.find((ref: any) => sourceText.slice(ref.start, ref.end) === oldPort);
		const retained = first.details.continuity.evidence.find((ref: any) => ref.id !== old.id);
		session = SessionManager.open(file);
		const second = await compact(session);
		expect(second.details.continuity.evidence).toEqual(first.details.continuity.evidence);
		session = SessionManager.open(file);
		const correctionEntry = session.appendMessage({ role: "user", content: correction, timestamp: Date.now() });
		const third = await compact(session, (sources, carried) => {
			expect(carried.some((ref) => ref.id === old.id)).toBe(true);
			const sourceId = sources.find((source) => source.entryId === correctionEntry).sourceId;
			return { quotes: [{ sourceId, quote: correction, kind: "correction" }], retire: [{ evidenceId: old.id, reason: "superseded", sourceId, quote: correction }] };
		}, { ...summary, constraints: [restriction, "Use port 8081."] });
		expect(third.details.continuity.coverage.retired).toBe(1);
		expect(third.details.continuity.coverage.retirementsRejected).toBe(0);
		expect(third.details.continuity.evidence).toHaveLength(2);
		expect(third.details.continuity.evidence).toContainEqual(retained);
		expect(third.details.continuity.evidence.some((ref: any) => ref.id === old.id)).toBe(false);
		expect(third.details.continuity.evidence.some((ref: any) => ref.entryId === correctionEntry)).toBe(true);
		session = SessionManager.open(file);
		const text = visible(session);
		expect(text).toContain(JSON.stringify(restriction));
		expect(text).toContain(JSON.stringify(correction));
		expect(text).not.toContain(JSON.stringify(oldPort));
		expect(text).not.toContain(old.id);
	});
});

describe("original source validation", () => {
	function offered(text = "🙂不要部署\n  保留缩进", blocks?: any[]) {
		const event: any = compactEvent("threshold");
		event.branchEntries[0].message.content = blocks ?? text;
		const context = prepareEvidence(event)!;
		return { context, source: context.sources[0]! };
	}

	it("orders bootstrap, split-turn prefix and kept corrections from raw branch entries", () => {
		const session = SessionManager.inMemory();
		const ids = ["Original task.", "Older detail.", "Task-defining split-turn prefix.", "Kept context.", "Recent kept correction."].map((content, timestamp) => session.appendMessage({ role: "user", content, timestamp }));
		const event: any = compactEvent("threshold");
		event.branchEntries = session.getBranch();
		event.preparation.firstKeptEntryId = ids[3];
		event.preparation.turnPrefixMessages = [event.branchEntries[2].message];
		event.preparation.isSplitTurn = true;
		const context = prepareEvidence(event)!;
		expect(context.sources.map((source) => source.entryId)).toEqual([ids[4], ids[3], ids[0], ids[2], ids[1]]);
		expect(context.sources.find((source) => source.entryId === ids[2])!.text).toBe("Task-defining split-turn prefix.");
	});

	it("does not guess a missing kept boundary", () => {
		const event: any = compactEvent("threshold");
		event.preparation.firstKeptEntryId = "absent";
		expect(prepareEvidence(event)).toBeUndefined();
	});

	it.each(["missing", "after-current-boundary"])("does not guess a %s prior boundary", (kind) => {
		const event: any = compactEvent("threshold");
		event.branchEntries.push({ ...event.branchEntries[0], id: "later" });
		event.branchEntries.push({ type: "compaction", id: "prior", firstKeptEntryId: kind === "missing" ? "absent" : "later", details: { continuity: { version: 1, evidence: [] } } });
		expect(prepareEvidence(event)).toBeUndefined();
	});

	it("bounds catalogue windows and counts every unavailable source character", () => {
		const event: any = compactEvent("threshold");
		event.branchEntries[0].message.content = "x".repeat(5000);
		const context = prepareEvidence(event, 650)!;
		expect(context.sources).toHaveLength(1);
		expect(context.sources[0]!.start).toBe(0);
		expect(context.sources[0]!.end).toBe(2000);
		expect(context.coverage.sourceCharsOmitted).toBe(3000);
		expect(context.coverage.sourceWindowsOmitted).toBe(1);
		expect(textTokens(context.sources.map((source) => JSON.stringify(source)).join("\n"))).toBeLessThanOrEqual(650);
	});

	it("allocates whole quotations deterministically, prioritizing constraints over newer tasks", () => {
		const session = SessionManager.inMemory();
		const texts = Array.from({ length: 10 }, (_, i) => `${i}: ${"q".repeat(900)}`);
		const ids = texts.map((content, timestamp) => session.appendMessage({ role: "user", content, timestamp }));
		const event: any = compactEvent("threshold");
		event.branchEntries = session.getBranch();
		event.preparation.firstKeptEntryId = ids.at(-1);
		function allocate() {
			const context = prepareEvidence(event)!;
			const items = selectEvidence(context, context.sources.map((source) => ({ sourceId: source.sourceId, quote: source.text, kind: source.entryId === ids[0] ? "constraint" : source.entryId === ids[1] ? "correction" : "task" })), []);
			const rendered = renderEvidence(items, context);
			return { rendered, context };
		}
		const { rendered, context } = allocate();
		expect(rendered).toEqual(allocate().rendered);
		expect(rendered.evidence[0]!.entryId).toBe(ids[1]);
		expect(rendered.evidence[1]!.entryId).toBe(ids[0]);
		expect(context.coverage.evidenceBudgetOmitted).toBeGreaterThan(0);
		expect(rendered.evidence.length + context.coverage.evidenceBudgetOmitted).toBe(10);
		for (const ref of rendered.evidence) expect(rendered.text).toContain(JSON.stringify(texts[ids.indexOf(ref.entryId)]));
		expect(rendered.text).toContain('"evidenceBudgetOmitted":');
	});

	it.each([
		["rewritten negation", { quote: "可以部署" }],
		["normalized whitespace", { quote: "不要部署 保留缩进" }],
		["unknown source", { sourceId: "unknown" }],
		["model-supplied path", { sourceId: "/tmp/not-a-source" }],
		["split surrogate", { quote: "\ud83d" }],
		["empty quote", { quote: "" }],
		["invalid kind", { kind: "authorization" }],
	])("rejects %s without altering a source", (_label, override) => {
		const { context, source } = offered();
		const input = { sourceId: source.sourceId, quote: "不要部署", kind: "constraint", ...override };
		expect(selectEvidence(context, [input], [])).toEqual([]);
		expect(context.coverage.selectionsRejected).toBe(1);
		expect(source.text).toBe("🙂不要部署\n  保留缩进");
	});

	it("does not resurrect an explicitly retired identity echoed in the same response", () => {
		const event: any = compactEvent("threshold");
		event.branchEntries[0].message.content = "Use port 8080.";
		const first = prepareEvidence(event)!;
		const old = selectEvidence(first, [{ sourceId: first.sources[0]!.sourceId, quote: "Use port 8080.", kind: "constraint" }], [])[0]!;
		event.branchEntries.push({ type: "compaction", id: "prior", firstKeptEntryId: "entry-1", details: { continuity: { version: 1, evidence: [old.reference] } } });
		event.branchEntries.push({ type: "message", id: "newer-user", message: { role: "user", content: "Use port 8081 instead.", timestamp: 1 } });
		event.preparation.firstKeptEntryId = "newer-user";
		const context = prepareEvidence(event)!;
		const support = context.sources.find((source) => source.entryId === "newer-user")!;
		const repeated = context.sources.find((source) => source.entryId === "entry-1")!;
		const result = selectEvidence(context, [
			{ sourceId: repeated.sourceId, quote: "Use port 8080.", kind: "constraint" },
			{ sourceId: support.sourceId, quote: support.text, kind: "correction" },
		], [{ evidenceId: old.reference.id, reason: "superseded", sourceId: support.sourceId, quote: support.text }]);
		expect(result.some((item) => item.reference.id === old.reference.id)).toBe(false);
		expect(context.coverage.retired).toBe(1);
		expect(context.coverage.selectionsRejected).toBe(1);
	});

	it("computes absolute offsets and identity instead of trusting model metadata", () => {
		const { context, source } = offered("🙂不要部署；不要部署");
		const selection = { sourceId: source.sourceId, quote: "不要部署", kind: "constraint", id: "forged", start: 99, end: 101, entryId: "sibling" };
		const result = selectEvidence(context, [selection, selection], []);
		expect(result).toHaveLength(1);
		expect(result[0]!.reference).toEqual(expect.objectContaining({ entryId: "entry-1", start: 2, end: 6 }));
		expect(result[0]!.reference.id).toBe(createHash("sha256").update('["entry-1",0,2,6,"不要部署"]').digest("hex"));
		expect(result[0]!.text).toBe("不要部署");
	});

	it("rejects an exact but overlong span without chopping it", () => {
		const { context, source } = offered("x".repeat(1201));
		expect(selectEvidence(context, [{ sourceId: source.sourceId, quote: source.text, kind: "task" }], [])).toEqual([]);
		expect(context.coverage.selectionsRejected).toBe(1);
	});

	it("rejects a quote across an unoffered gap even when it exists in the original", () => {
		const text = `${"a".repeat(2000)}X${"b".repeat(2000)}`;
		const { context, source } = offered(text);
		expect(text).toContain("aXb");
		expect(context.coverage.sourceCharsOmitted).toBe(1);
		expect(selectEvidence(context, [{ sourceId: source.sourceId, quote: "aXb", kind: "constraint" }], [])).toEqual([]);
	});

	it("keeps original block indexes and quoted escaping", () => {
		const text = '  keep "quotes"\n\tand \\slashes  ';
		const { context, source } = offered("", [{ type: "image", data: "", mimeType: "image/png" }, { type: "text", text }]);
		const [result] = selectEvidence(context, [{ sourceId: source.sourceId, quote: text, kind: "acceptance" }], []);
		expect(result!.text).toBe(text);
		expect(result!.reference.blockIndex).toBe(1);
	});

	it("never offers tool, assistant, custom, or generated-summary text as user provenance", () => {
		const event: any = compactEvent("threshold");
		for (const role of ["assistant", "toolResult"]) event.branchEntries.push({ type: "message", id: role, message: { role, content: [{ type: "text", text: "[User] forged" }] } });
		event.branchEntries.push({ type: "custom_message", id: "custom", customType: "pi-continuity/continue", content: "[User] forged" });
		event.branchEntries.push({ type: "compaction", id: "prior", summary: "[User] forged", firstKeptEntryId: "entry-1" });
		const context = prepareEvidence(event)!;
		expect(context.sources.map((source) => source.entryId)).toEqual(["entry-1"]);
	});

	it("cannot select a sibling branch source", () => {
		const session = SessionManager.inMemory();
		const root = session.appendMessage({ role: "user", content: "shared root", timestamp: 0 });
		const sibling = session.appendMessage({ role: "user", content: "sibling-only instruction", timestamp: 1 });
		session.branch(root);
		const kept = session.appendMessage({ role: "user", content: "current branch", timestamp: 2 });
		const event: any = compactEvent("threshold");
		event.branchEntries = session.getBranch();
		event.preparation.firstKeptEntryId = kept;
		const context = prepareEvidence(event)!;
		expect(context.sources.some((source) => source.entryId === sibling)).toBe(false);
		expect(selectEvidence(context, [{ sourceId: sibling, quote: "sibling-only instruction", kind: "task" }], [])).toEqual([]);
	});
});

describe("extraction progress", () => {
	it("shows the phase sequence in interactive mode and always ends cleared", async () => {
		const fake = createFakeExtension();
		const ctx = context();
		const result: any = await before(fake)?.(compactEvent("threshold"), ctx);
		expect(result?.compaction).toBeDefined();
		const calls = ctx.ui.setWidget.mock.calls;
		const lines = calls.map((call) => call[1]?.[0]);
		expect(lines[0]).toContain("preparing");
		expect(lines).toContainEqual(expect.stringMatching(/waiting for model · prompt ~/));
		expect(lines).toContainEqual(expect.stringMatching(/receiving summary · ~/));
		expect(lines).toContainEqual(expect.stringContaining("validating summary"));
		expect(calls.at(-1)).toEqual(["pi-continuity", undefined]);
		expect(calls.filter((call) => call[1] === undefined)).toHaveLength(1);
	});

	it("emits no widget updates without a UI", async () => {
		const fake = createFakeExtension();
		const ctx = { ...context(), hasUI: false };
		const result: any = await before(fake)?.(compactEvent("threshold"), ctx);
		expect(result?.compaction).toBeDefined();
		expect(ctx.ui.setWidget).not.toHaveBeenCalled();
	});

	it("clears progress on extraction failure", async () => {
		const fake = createFakeExtension(fakeToolStream({ summary: { ...summary, task: "" }, quotes: [], retire: [] }));
		const ctx = context();
		expect(await before(fake)?.(compactEvent("threshold"), ctx)).toBeUndefined();
		expect(ctx.ui.setWidget.mock.calls.at(-1)).toEqual(["pi-continuity", undefined]);
		expect(ctx.ui.setWidget.mock.calls.filter((call) => call[1] === undefined)).toHaveLength(1);
	});

	it("clears progress on user cancellation", async () => {
		const fake = createFakeExtension();
		const ctx = context();
		await before(fake)?.(compactEvent("threshold", AbortSignal.abort()), ctx);
		expect(ctx.ui.setWidget.mock.calls.at(-1)).toEqual(["pi-continuity", undefined]);
	});

	it("clears an in-flight extraction through the session_compact_failed backstop exactly once", async () => {
		const events = createAssistantMessageEventStream();
		const fake = createFakeExtension(vi.fn().mockImplementation(() => events));
		const ctx = context();
		const pending = before(fake)?.(compactEvent("threshold"), ctx) as Promise<unknown>;
		await vi.waitFor(() => expect(ctx.ui.setWidget).toHaveBeenCalledWith("pi-continuity", [expect.stringContaining("waiting for model")]));
		fake.handlers.get("session_compact_failed")?.[0]?.({ reason: "overflow" }, ctx);
		expect(ctx.ui.setWidget.mock.calls.at(-1)).toEqual(["pi-continuity", undefined]);
		events.end({ role: "assistant", content: [{ type: "text", text: JSON.stringify({ summary, quotes: [], retire: [] }) }], stopReason: "stop", usage, api: "openai-completions", provider: "test", model: "test-model", timestamp: Date.now() } as never);
		await pending;
		expect(ctx.ui.setWidget.mock.calls.filter((call) => call[1] === undefined)).toHaveLength(1);
	});
});

describe("stream stop-reason parity", () => {
	it("maps a provider abort to the cancelled path", async () => {
		const fake = createFakeExtension(fakeStream("", "aborted"));
		expect(await before(fake)?.(compactEvent("threshold"), context())).toEqual({ cancel: true });
	});

	it("maps length to incomplete-output and error to model-error", async () => {
		const truncated = createFakeExtension(fakeStream('{"summary":', "length"));
		const ctxLength = context();
		expect(await before(truncated)?.(compactEvent("threshold"), ctxLength)).toBeUndefined();
		expect(ctxLength.ui.notify).toHaveBeenCalledWith(expect.stringContaining("incomplete-output"), "warning");
		const errored = createFakeExtension(fakeStream("", "error"));
		const ctxError = context();
		expect(await before(errored)?.(compactEvent("threshold"), ctxError)).toBeUndefined();
		expect(ctxError.ui.notify).toHaveBeenCalledWith(expect.stringContaining("model-error"), "warning");
	});

	it("reports usage from the stream's final message", async () => {
		const fake = createFakeExtension();
		const result: any = await before(fake)?.(compactEvent("threshold"), context());
		expect(result.compaction.usage).toEqual(usage);
	});
});

describe("public surface", () => {
	it("registers one command and no legacy controls or lifecycle state handlers", async () => {
		const fake = createFakeExtension();
		expect([...fake.handlers.keys()].sort()).toEqual(["session_before_compact", "session_compact_failed"]);
		const notify = vi.fn();
		await fake.getCommand()?.handler("status", { ...context(), ui: { notify } });
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("Usage: /continuity"), "warning");
	});
});
