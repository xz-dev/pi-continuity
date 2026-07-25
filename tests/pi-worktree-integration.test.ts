import { createServer, type Server } from "node:http";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import {
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	type AssistantMessage,
	type Model,
} from "@earendil-works/pi-ai";
import { SessionManager, type InlineExtension } from "@earendil-works/pi-coding-agent";
import { createContinuityExtension, CONTROL_TYPE, foldBranch } from "../extensions/continuity.js";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "pi-test-harness";

const OPAQUE = "opaque-joint-checkpoint";
const CHECKPOINT_OUTPUT = [
	{ type: "message", id: "msg_joint", role: "assistant", status: "completed", content: [{ type: "output_text", text: "retained", annotations: [] }] },
	{ type: "compaction", id: "cmp_joint", encrypted_content: OPAQUE },
];
const generated = {
	task: "Verify joint lifecycle",
	doneWhen: "Integration tests pass",
	forbid: ["No real network"],
	status: "active",
	established: ["Pi owns compaction"],
	open: ["None"],
	next: ["Commit tests"],
};
const usage = { input: 2, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 3, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

type RequestRecord = { path: string; body: Record<string, unknown> };
type LocalResponses = { baseUrl: string; requests: RequestRecord[]; waitForCompact(): Promise<void>; releaseCompact(): void; close(): Promise<void> };

async function localResponses(options: { overflowFirst?: boolean; failCompact?: boolean; delayCompact?: boolean } = {}): Promise<LocalResponses> {
	const requests: RequestRecord[] = [];
	let overflow = options.overflowFirst ?? false;
	let compactStarted!: () => void;
	const started = new Promise<void>((resolve) => { compactStarted = resolve; });
	let release!: () => void;
	const blocked = options.delayCompact ? new Promise<void>((resolve) => { release = resolve; }) : Promise.resolve();
	const server = createServer(async (request, response) => {
		let raw = "";
		for await (const chunk of request) raw += chunk;
		const body = raw ? JSON.parse(raw) as Record<string, unknown> : {};
		requests.push({ path: request.url ?? "", body });
		if (request.url?.endsWith("/responses/compact")) {
			compactStarted(); await blocked;
			response.writeHead(options.failCompact ? 503 : 200, { "content-type": "application/json" });
			response.end(JSON.stringify(options.failCompact ? { error: { message: "compact failed" } } : {
				id: "resp_joint", object: "response.compaction", created_at: 1, output: CHECKPOINT_OUTPUT,
				usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
			}));
			return;
		}
		if (overflow) {
			overflow = false; response.writeHead(400, { "content-type": "application/json" });
			response.end(JSON.stringify({ error: { message: "prompt is too long", code: "context_length_exceeded" } })); return;
		}
		const events = [
			{ type: "response.output_item.added", item: { type: "message", id: "msg", role: "assistant", status: "in_progress", content: [] } },
			{ type: "response.content_part.added", part: { type: "output_text", text: "" } },
			{ type: "response.output_text.delta", delta: "ok" },
			{ type: "response.output_item.done", item: { type: "message", id: "msg", role: "assistant", status: "completed", content: [{ type: "output_text", text: "ok" }] } },
			{ type: "response.completed", response: { id: "resp", status: "completed", usage: { input_tokens: 20, output_tokens: 2, total_tokens: 22, input_tokens_details: { cached_tokens: 0 } } } },
		];
		response.writeHead(200, { "content-type": "text/event-stream" });
		response.end(`${events.map((event) => `data: ${JSON.stringify(event)}`).join("\n\n")}\n\n`);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	return {
		baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, requests,
		waitForCompact: () => started, releaseCompact: () => release?.(),
		close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
	};
}

function continuityFactory(sequence: string[], statuses: string[] = []): InlineExtension {
	const extension = createContinuityExtension({
		complete: async () => ({ content: [{ type: "text", text: JSON.stringify(generated) }], stopReason: "stop", usage }) as never,
		newCheckpointId: () => "joint-checkpoint",
		now: () => new Date("2026-07-25T00:00:00.000Z"),
	});
	return (pi) => {
		extension(pi);
		pi.on("session_before_compact", () => { sequence.push("before"); statuses.push("before"); });
		pi.on("session_compact", (_event, ctx) => { sequence.push("session_compact"); statuses.push(foldBranch(ctx.sessionManager.getBranch() as never[]).checkpoint?.checkpointId ?? "none"); });
	};
}

function observer(sequence: string[], requests: unknown[] = []): InlineExtension {
	return (pi) => {
		pi.on("before_provider_request", (event) => { requests.push(structuredClone(event.payload)); return event.payload; });
	};
}
function seed(harness: Harness, model?: Model<any>, tokens = 100): void {
	const active = model ?? harness.getModel();
	harness.settingsManager.applyOverrides({ compaction: { keepRecentTokens: 1 } });
	harness.sessionManager.appendMessage({ role: "user", content: "early portable history", timestamp: 1 });
	harness.sessionManager.appendMessage({ ...fauxAssistantMessage("early answer"), api: active.api, provider: active.provider, model: active.id, usage: { ...usage, input: tokens, totalTokens: tokens }, timestamp: 2 });
	harness.session.agent.state.model = active;
	harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
}
function nativeModel(harness: Harness, baseUrl: string, id?: string, realm = "joint:realm"): Model<"openai-responses"> {
	const base = id ? harness.getModel(id)! : harness.getModel();
	return { ...base, api: "openai-responses", baseUrl, compat: { responsesCompaction: { adapter: "openai-responses-compact-v1", realm, modelFamily: "joint" } } } as Model<"openai-responses">;
}
function boundaries(harness: Harness) { return harness.sessionManager.getEntries().filter((entry) => entry.type === "compaction_boundary"); }
function current(harness: Harness) { return foldBranch(harness.sessionManager.getBranch() as never[]).checkpoint?.checkpointId; }
function textSummary(harness: Harness, value = "text summary") {
	harness.session.agent.streamFunction = (model) => {
		const stream = createAssistantMessageEventStream();
		queueMicrotask(() => stream.push({ type: "done", reason: "stop", message: { ...fauxAssistantMessage(value), api: model.api, provider: model.provider, model: model.id, usage } }));
		return stream;
	};
}

const harnesses: Harness[] = [];
const servers: LocalResponses[] = [];
afterEach(async () => { while (harnesses.length) harnesses.pop()?.cleanup(); while (servers.length) await servers.pop()?.close(); });

describe("Pi worktree + pi-continuity real compaction lifecycle", () => {
	it("manual text fallback commits before continuity becomes current", async () => {
		const order: string[] = [], statuses: string[] = [];
		const harness = await createHarness({ extensionFactories: [continuityFactory(order, statuses)] }); harnesses.push(harness);
		seed(harness); textSummary(harness);
		const outcome = await harness.session.compact();
		expect(outcome.kind).toBe("text"); expect(boundaries(harness)).toHaveLength(1);
		expect(statuses).toEqual(["before", "joint-checkpoint"]); expect(current(harness)).toBe("joint-checkpoint");
		expect(harness.sessionManager.getEntries().filter((entry) => entry.type === "compaction" || entry.type === "provider_checkpoint")).toHaveLength(0);
	});

	it("manual native checkpoint commits one sanitized lifecycle boundary", async () => {
		const local = await localResponses(); servers.push(local); const order: string[] = [];
		const harness = await createHarness({ extensionFactories: [continuityFactory(order)] }); harnesses.push(harness);
		seed(harness, nativeModel(harness, local.baseUrl));
		const outcome = await harness.session.compact();
		expect(outcome).toMatchObject({ kind: "checkpoint", projectionCount: 1 });
		expect(outcome).not.toHaveProperty("summary"); expect(local.requests.filter((r) => r.path.endsWith("/responses/compact"))).toHaveLength(1);
		expect(boundaries(harness)).toHaveLength(1); expect(current(harness)).toBe("joint-checkpoint");
		const eventBoundary = harness.eventsOfType("compaction_end").at(-1)?.result;
		expect(JSON.stringify(eventBoundary)).not.toContain(OPAQUE);
	});

	it("threshold text and native paths continue the pending real prompt exactly once", async () => {
		const text = await createHarness({ models: [{ id: "faux-1", contextWindow: 200 }], settings: { compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 100 } }, extensionFactories: [continuityFactory([])] }); harnesses.push(text);
		seed(text, undefined, 150); textSummary(text); await text.session.prompt("text pending prompt");
		expect(text.sessionManager.getEntries().filter((e) => e.type === "message" && JSON.stringify(e).includes("text pending prompt"))).toHaveLength(1); expect(boundaries(text)).toHaveLength(1);
		const local = await localResponses(); servers.push(local);
		const native = await createHarness({ models: [{ id: "faux-1", contextWindow: 200 }], settings: { compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 100 } }, extensionFactories: [continuityFactory([])] }); harnesses.push(native);
		seed(native, nativeModel(native, local.baseUrl), 150); await native.session.prompt("native pending prompt");
		expect(local.requests.filter((r) => r.path.endsWith("/responses"))).toHaveLength(1); expect(boundaries(native)).toHaveLength(1); expect(current(native)).toBe("joint-checkpoint");
	});

	it("overflow native success commits before exactly one retry and invents no turn", async () => {
		const local = await localResponses({ overflowFirst: true }); servers.push(local); const lifecycle: string[] = [];
		const harness = await createHarness({ settings: { compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 0 } }, extensionFactories: [continuityFactory(lifecycle)] }); harnesses.push(harness);
		seed(harness, nativeModel(harness, local.baseUrl)); await harness.session.prompt("authorized overflow prompt");
		expect(local.requests.map((r) => r.path)).toEqual(["/v1/responses", "/v1/responses/compact", "/v1/responses"]);
		expect(lifecycle).toEqual(["before", "session_compact"]); expect(current(harness)).toBe("joint-checkpoint");
		expect(harness.sessionManager.getEntries().filter((e) => e.type === "message" && JSON.stringify(e).includes("authorized overflow prompt"))).toHaveLength(1);
	});

	it("cancel is fail-closed and legacy replacement remains exclusive", async () => {
		const local = await localResponses(); servers.push(local);
		const cancel = await createHarness({ extensionFactories: [continuityFactory([]), (pi) => pi.on("session_before_compact", () => ({ cancel: true }))] }); harnesses.push(cancel);
		seed(cancel, nativeModel(cancel, local.baseUrl)); await expect(cancel.session.compact()).rejects.toThrow(/cancel/i);
		expect(local.requests).toHaveLength(0); expect(boundaries(cancel)).toHaveLength(0); expect(current(cancel)).toBeUndefined();
		const replacement = await createHarness({ extensionFactories: [continuityFactory([]), (pi) => pi.on("session_before_compact", (event) => ({ compaction: { summary: "legacy replacement", firstKeptEntryId: event.preparation.firstKeptEntryId, tokensBefore: event.preparation.tokensBefore } }))] }); harnesses.push(replacement);
		seed(replacement, nativeModel(replacement, local.baseUrl)); const outcome = await replacement.session.compact();
		expect(outcome).toMatchObject({ kind: "text", summary: "legacy replacement", fromExtension: true, projectionCount: 1 }); expect(local.requests).toHaveLength(0); expect(current(replacement)).toBe("joint-checkpoint");
	});

	it("primary and real expected-state failures commit nothing or retry", async () => {
		const failed = await localResponses({ failCompact: true }); servers.push(failed);
		const primary = await createHarness({ extensionFactories: [continuityFactory([])] }); harnesses.push(primary); seed(primary, nativeModel(primary, failed.baseUrl));
		await expect(primary.session.compact()).rejects.toThrow(); expect(boundaries(primary)).toHaveLength(0); expect(current(primary)).toBeUndefined();
		const delayed = await localResponses({ delayCompact: true, overflowFirst: true }); servers.push(delayed);
		const barrier = await createHarness({ settings: { compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 0 } }, extensionFactories: [continuityFactory([])] }); harnesses.push(barrier); seed(barrier, nativeModel(barrier, delayed.baseUrl));
		const pending = barrier.session.prompt("overflow barrier prompt"); await delayed.waitForCompact(); await barrier.session.reload(); delayed.releaseCompact(); await pending.catch(() => undefined);
		expect(boundaries(barrier)).toHaveLength(0); expect(delayed.requests.filter((r) => r.path.endsWith("/responses"))).toHaveLength(1); expect(current(barrier)).toBeUndefined();
	});

	it("compatible projection uses opaque checkpoint and incompatible switch preserves portable history", async () => {
		const local = await localResponses(); servers.push(local); const observed: unknown[] = [];
		const harness = await createHarness({ models: [{ id: "compatible" }, { id: "portable" }], extensionFactories: [continuityFactory([]), observer([], observed)] }); harnesses.push(harness);
		const compatible = nativeModel(harness, local.baseUrl, "compatible"); seed(harness, compatible); await harness.session.compact(); await harness.session.prompt("compatible request");
		expect(JSON.stringify(local.requests.at(-1)?.body)).toContain(OPAQUE); expect(JSON.stringify(local.requests.at(-1)?.body)).toContain("Verify joint lifecycle");
		const incompatible = { ...harness.getModel("portable")!, api: "openai-responses", baseUrl: local.baseUrl } as Model<"openai-responses">;
		await harness.session.setModel(incompatible); await harness.session.prompt("incompatible request");
		const body = JSON.stringify(local.requests.at(-1)?.body); expect(body).not.toContain(OPAQUE); expect(body).toContain("early portable history"); expect(body).toContain("Verify joint lifecycle");
		expect(JSON.stringify(observed.at(-1))).not.toContain(OPAQUE);
	});

	it("reopens persisted JSONL and rebuilds branch checkpoints, controls, and later clearing boundary", async () => {
		const dir = join(tmpdir(), `pi-continuity-joint-${Date.now()}`); mkdirSync(dir, { recursive: true });
		try {
			const manager = SessionManager.create(dir, dir); manager.appendMessage({ role: "user", content: "root", timestamp: 1 });
			const root = manager.getLeafId()!;
			manager.appendMessage({ ...fauxAssistantMessage("persist"), timestamp: 2 });
			const harness = await createHarness({ extensionFactories: [continuityFactory([])] }); harnesses.push(harness);
			// Real lifecycle creates the projection; persist the equivalent boundary through Pi's public append API.
			seed(harness); textSummary(harness); await harness.session.compact();
			const sourceBoundary = boundaries(harness)[0] as any;
			manager.appendCompactionBoundary({
				...sourceBoundary.boundary,
				primary: { ...sourceBoundary.boundary.primary, firstKeptEntryId: root },
			}, { expected: manager.captureCompactionBoundaryAppendState() });
			manager.appendCustomEntry(CONTROL_TYPE, { schema: "pi.continuity.control", version: 1, operation: "set", field: "task", value: "Locked task" });
			const file = manager.getSessionFile()!; const reopened = SessionManager.open(file);
			expect(foldBranch(reopened.getBranch() as never[]).checkpoint?.effective.task).toBe("Locked task");
			reopened.branch(root); reopened.appendMessage({ role: "user", content: "fork", timestamp: 3 }); expect(foldBranch(reopened.getBranch() as never[]).checkpoint).toBeUndefined();
			expect(readFileSync(file, "utf8")).not.toContain(OPAQUE);
		} finally { rmSync(dir, { recursive: true, force: true }); }
	});
});
