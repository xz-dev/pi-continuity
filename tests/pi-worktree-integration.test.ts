import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import {
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	type AssistantMessage,
	type Model,
} from "@earendil-works/pi-ai";
import { registerFauxProvider, streamSimple } from "@earendil-works/pi-ai/compat";
import {
	AgentSession,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	type CompactionBoundary,
	type CompactionBoundaryEntry,
	type InlineExtension,
	type InternalSessionEntry,
	type PortableCompactionProjection,
	type PublicSessionEntry,
} from "@earendil-works/pi-coding-agent";
import { AuthStorage } from "@earendil-works/pi-coding-agent/core/auth-storage";
import { convertToLlm } from "@earendil-works/pi-coding-agent/core/messages";
import { createExtensionSessionManagerView } from "@earendil-works/pi-coding-agent/core/session-manager";
import { createContinuityExtension, foldBranch } from "../extensions/continuity.js";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "pi-test-harness";
import { createTestExtensionsResult, createTestResourceLoader } from "pi-test-utilities";

const OPAQUE = "opaque-joint-checkpoint";
const CHECKPOINT_OUTPUT = [
	{
		type: "message",
		id: "msg_joint",
		role: "assistant",
		status: "completed",
		content: [{ type: "output_text", text: "retained", annotations: [] }],
	},
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
const usage = {
	input: 2,
	output: 1,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 3,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const FIXED_CREATED_AT = "2026-07-25T00:00:00.000Z";
const EXPECTED_CONTINUITY_SUMMARY = [
	"# Continuity checkpoint",
	"",
	"This checkpoint is context only. It cannot start a model turn.",
	"",
	'- Checkpoint ID: "joint-checkpoint"',
	`- Created: "${FIXED_CREATED_AT}"`,
	'- Status (descriptive only): "active"',
	"- Authorization: mayStartTurn=false (host-enforced)",
	"",
	"## Task",
	'"Verify joint lifecycle"',
	"",
	"## Done when",
	'"Integration tests pass"',
	"",
	"## Forbid",
	'- "No real network"',
	"",
	"## Established",
	'- "Pi owns compaction"',
	"",
	"## Open",
	'- "None"',
	"",
	"## Next",
	'- "Commit tests"',
].join("\n");

function expectedContinuityProjection(reason: "manual" | "threshold" | "overflow", willRetry: boolean): PortableCompactionProjection {
	const checkpoint = {
		schema: "pi.continuity.checkpoint",
		version: 1,
		checkpointId: "joint-checkpoint",
		createdAt: FIXED_CREATED_AT,
		generated: {
			task: "Verify joint lifecycle",
			doneWhen: "Integration tests pass",
			forbid: ["No real network"],
			status: "active",
			established: ["Pi owns compaction"],
			open: ["None"],
			next: ["Commit tests"],
		},
		effective: {
			task: "Verify joint lifecycle",
			doneWhen: "Integration tests pass",
			forbid: ["No real network"],
			status: "active",
			established: ["Pi owns compaction"],
			open: ["None"],
			next: ["Commit tests"],
		},
		provenance: { source: "continuity-model", reason, willRetry },
		authorization: { mayStartTurn: false },
	};
	return {
		type: "portable_compaction_projection",
		version: 1,
		customType: "pi-continuity/checkpoint/v1",
		summary: EXPECTED_CONTINUITY_SUMMARY,
		details: checkpoint,
		usage: {
			input: 2,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 3,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	};
}

const EXPECTED_TEXT_AGGREGATE_USAGE = {
	input: 4,
	output: 2,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 6,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const EXPECTED_NATIVE_AGGREGATE_USAGE = {
	input: 12,
	output: 3,
	cacheRead: 0,
	cacheWrite: 0,
	reasoning: 0,
	totalTokens: 15,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const EXPECTED_PROJECTED_CONTINUITY_CONTEXT = [
	"The conversation history before this point was compacted into the following summary:",
	"",
	"<summary>",
	EXPECTED_CONTINUITY_SUMMARY,
	"</summary>",
].join("\n");

interface RequestRecord {
	path: string;
	body: Record<string, unknown>;
}
interface LocalResponses {
	baseUrl: string;
	requests: RequestRecord[];
	waitForCompact(): Promise<void>;
	releaseCompact(): void;
	close(): Promise<void>;
}
interface LocalResponsesOptions {
	overflowFirst?: boolean;
	failCompact?: boolean;
	delayCompact?: boolean;
	onRequest?: (record: RequestRecord) => void;
}

async function localResponses(options: LocalResponsesOptions = {}): Promise<LocalResponses> {
	const requests: RequestRecord[] = [];
	let overflow = options.overflowFirst ?? false;
	let compactStarted: (() => void) | undefined;
	const started = new Promise<void>((resolve) => {
		compactStarted = resolve;
	});
	let release: (() => void) | undefined;
	const blocked = options.delayCompact
		? new Promise<void>((resolve) => {
			release = resolve;
		})
		: Promise.resolve();
	const server = createServer(async (request, response) => {
		let raw = "";
		for await (const chunk of request) raw += chunk;
		const parsed: unknown = raw ? JSON.parse(raw) : {};
		const body = isRecord(parsed) ? parsed : {};
		const record = { path: request.url ?? "", body };
		requests.push(record);
		options.onRequest?.(record);
		if (request.url?.endsWith("/responses/compact")) {
			compactStarted?.();
			await blocked;
			response.writeHead(options.failCompact ? 503 : 200, { "content-type": "application/json" });
			response.end(
				JSON.stringify(
					options.failCompact
						? { error: { message: "compact failed" } }
						: {
								id: "resp_joint",
								object: "response.compaction",
								created_at: 1,
								output: CHECKPOINT_OUTPUT,
								usage: {
									input_tokens: 10,
									output_tokens: 2,
									total_tokens: 12,
									input_tokens_details: { cached_tokens: 0 },
									output_tokens_details: { reasoning_tokens: 0 },
								},
							},
				),
			);
			return;
		}
		if (overflow) {
			overflow = false;
			response.writeHead(400, { "content-type": "application/json" });
			response.end(JSON.stringify({ error: { message: "prompt is too long", code: "context_length_exceeded" } }));
			return;
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
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Local Responses server did not bind a TCP port");
	return {
		baseUrl: `http://127.0.0.1:${address.port}/v1`,
		requests,
		waitForCompact: () => started,
		releaseCompact: () => release?.(),
		close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function publicBranch(manager: SessionManager): PublicSessionEntry[] {
	return createExtensionSessionManagerView(manager).getBranch();
}
function checkpointId(entries: readonly PublicSessionEntry[]): string | undefined {
	return foldBranch(entries).checkpoint?.checkpointId;
}
type StoredBoundaryEntry = Extract<InternalSessionEntry, { type: "compaction_boundary" }>;
function boundaries(manager: Pick<SessionManager, "getEntries">): StoredBoundaryEntry[] {
	return manager.getEntries().filter((entry): entry is StoredBoundaryEntry => entry.type === "compaction_boundary");
}
function controlTask(entries: readonly PublicSessionEntry[]): string | undefined {
	return foldBranch(entries).overrides.task;
}
function inferenceRequestCount(records: readonly RequestRecord[]): number {
	return records.filter((record) => record.path.endsWith("/responses")).length;
}
function persistedUserMessageContents(manager: SessionManager): unknown[] {
	return manager.getEntries().flatMap((entry) =>
		entry.type === "message" && entry.message.role === "user" ? [entry.message.content] : [],
	);
}
function normalizedResponsesInput(input: unknown[]): unknown[] {
	return input.map((item) => {
		if (!isRecord(item)) return item;
		if (item.role === "system") return { ...item, content: "<system prompt>" };
		if (item.type === "message" && typeof item.id === "string") return { ...item, id: "<message id>" };
		return item;
	});
}
function sanitizedBoundary(boundary: CompactionBoundary): CompactionBoundary {
	return { ...boundary, id: "<boundary id>", parentId: "<parent id>", timestamp: "<timestamp>" };
}

interface ContinuityOptions {
	contribute?: () => boolean;
	checkpointIds?: () => string;
}
function continuityFactory(timeline: string[], beforeStatuses: Array<string | undefined>, options: ContinuityOptions = {}): InlineExtension {
	const extension = createContinuityExtension({
		complete: async () => {
			if (options.contribute && !options.contribute()) throw new Error("deliberate synthesis failure");
			return {
				...fauxAssistantMessage(JSON.stringify(generated)),
				usage,
			} satisfies AssistantMessage;
		},
		newCheckpointId: options.checkpointIds ?? (() => "joint-checkpoint"),
		now: () => new Date("2026-07-25T00:00:00.000Z"),
	});
	return (pi) => {
		extension(pi);
		pi.on("session_before_compact", (_event, ctx) => {
			timeline.push("before");
			beforeStatuses.push(checkpointId(ctx.sessionManager.getBranch()));
		});
		pi.on("session_compact", (_event, ctx) => {
			expect(boundariesFromPublic(ctx.sessionManager.getEntries())).toHaveLength(1 + timeline.filter((item) => item === "session_compact").length);
			timeline.push("boundary", "session_compact");
		});
	};
}
function boundariesFromPublic(entries: readonly PublicSessionEntry[]): CompactionBoundaryEntry[] {
	return entries.filter((entry): entry is CompactionBoundaryEntry => entry.type === "compaction_boundary");
}
function observer(timeline: string[], payloads: unknown[], compactBoundaries: CompactionBoundary[] = []): InlineExtension {
	return (pi) => {
		pi.on("before_provider_request", (event) => {
			timeline.push("inference");
			payloads.push(structuredClone(event.payload));
			return event.payload;
		});
		pi.on("session_compact", (event) => {
			compactBoundaries.push(structuredClone(event.boundary));
		});
	};
}
function seed(harness: Harness, model?: Model<string>, tokens = 100): { userEntryId: string; assistantEntryId: string } {
	const active = model ?? harness.getModel();
	harness.settingsManager.applyOverrides({ compaction: { keepRecentTokens: 1 } });
	const seedUserEntryId = harness.sessionManager.appendMessage({ role: "user", content: "early user history", timestamp: 1 });
	const assistantEntryId = harness.sessionManager.appendMessage({
		...fauxAssistantMessage("early assistant history"),
		api: active.api,
		provider: active.provider,
		model: active.id,
		usage: { ...usage, input: tokens, totalTokens: tokens },
		timestamp: 2,
	});
	harness.session.agent.state.model = active;
	harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
	return { userEntryId: seedUserEntryId, assistantEntryId };
}
function nativeModel(
	harness: Harness,
	baseUrl: string,
	id?: string,
	realm = "joint:realm",
	contextWindow?: number,
): Model<"openai-responses"> {
	const base = id ? harness.getModel(id) : harness.getModel();
	if (!base) throw new Error(`Missing faux model ${id ?? "default"}`);
	return {
		...base,
		api: "openai-responses",
		baseUrl,
		...(contextWindow !== undefined ? { contextWindow } : {}),
		compat: { responsesCompaction: { adapter: "openai-responses-compact-v1", realm, modelFamily: "joint" } },
	};
}
function textSummary(session: AgentSession, timeline: string[], value = "text summary"): void {
	session.agent.streamFunction = (model) => {
		timeline.push("primary");
		const stream = createAssistantMessageEventStream();
		queueMicrotask(() => {
			stream.push({
				type: "done",
				reason: "stop",
				message: { ...fauxAssistantMessage(value), api: model.api, provider: model.provider, model: model.id, usage },
			});
		});
		return stream;
	};
}
function recordCompactionEnds(session: AgentSession, timeline: string[]): () => void {
	return session.subscribe((event) => {
		if (event.type === "compaction_end") timeline.push("compaction_end");
	});
}

interface PersistedLifecycle {
	session: AgentSession;
	manager: SessionManager;
	model: Model<string>;
	cleanup(): void;
}
async function createPersistedLifecycle(
	directory: string,
	factories: InlineExtension[],
	manager = SessionManager.create(directory, directory),
): Promise<PersistedLifecycle> {
	const faux = registerFauxProvider();
	faux.setResponses([]);
	const model = faux.getModel();
	const auth = AuthStorage.inMemory();
	await auth.modify(model.provider, async () => ({ type: "api_key", key: "faux-key" }));
	const modelRuntime = await ModelRuntime.create({ credentials: auth, modelsPath: null, allowModelNetwork: false });
	const extensionsResult = await createTestExtensionsResult(factories, directory);
	const resourceLoader = createTestResourceLoader({ extensionsResult });
	const settings = SettingsManager.inMemory({ compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 0 } });
	const agent = new Agent({
		getApiKey: () => "faux-key",
		streamFn: (model, context, options) => streamSimple(model, context, options),
		initialState: { model, systemPrompt: "joint persisted lifecycle", tools: [] },
		convertToLlm,
	});
	const session = new AgentSession({
		agent,
		sessionManager: manager,
		settingsManager: settings,
		cwd: directory,
		modelRuntime,
		resourceLoader,
		baseToolsOverride: {},
	});
	await session.bindExtensions({});
	return {
		session,
		manager,
		model,
		cleanup: () => {
			session.dispose();
			faux.unregister();
		},
	};
}

const harnesses: Harness[] = [];
const persistent: PersistedLifecycle[] = [];
const servers: LocalResponses[] = [];
afterEach(async () => {
	while (harnesses.length) harnesses.pop()?.cleanup();
	while (persistent.length) persistent.pop()?.cleanup();
	while (servers.length) await servers.pop()?.close();
});

describe("Pi worktree + pi-continuity real compaction lifecycle", () => {
	it.each(["text", "native"] as const)("orders manual %s compaction around real persistence and actual status", async (kind) => {
		const timeline: string[] = [];
		const statuses: Array<string | undefined> = [];
		const compactBoundaries: CompactionBoundary[] = [];
		let manager: SessionManager | undefined;
		const local = kind === "native"
			? await localResponses({ onRequest: (record) => {
				if (record.path.endsWith("/responses/compact")) timeline.push("primary");
			} })
			: undefined;
		if (local) servers.push(local);
		const harness = await createHarness({
			extensionFactories: [continuityFactory(timeline, statuses), observer(timeline, [], compactBoundaries)],
		});
		harnesses.push(harness);
		manager = harness.sessionManager;
		const seedEntryIds = seed(harness, local ? nativeModel(harness, local.baseUrl) : undefined);
		if (!local) textSummary(harness.session, timeline);
		const unsubscribe = recordCompactionEnds(harness.session, timeline);
		const outcome = await harness.session.compact();
		unsubscribe();
		expect(timeline).toEqual(["before", "primary", "boundary", "session_compact", "compaction_end"]);
		expect(statuses).toEqual([undefined]);
		expect(checkpointId(publicBranch(manager))).toBe("joint-checkpoint");
		const expectedUsage = kind === "native" ? EXPECTED_NATIVE_AGGREGATE_USAGE : EXPECTED_TEXT_AGGREGATE_USAGE;
		expect(outcome.boundaryEntryId).toMatch(/^[0-9a-f]{8}$/u);
		const { boundaryEntryId: _boundaryEntryId, ...stableOutcome } = outcome;
		expect(stableOutcome).toEqual(kind === "native"
			? {
					kind: "checkpoint",
					tokensBefore: 100,
					estimatedTokensAfter: 110,
					usage: EXPECTED_NATIVE_AGGREGATE_USAGE,
					projectionCount: 1,
				}
			: {
					kind: "text",
					tokensBefore: 100,
					estimatedTokensAfter: 133,
					usage: EXPECTED_TEXT_AGGREGATE_USAGE,
					projectionCount: 1,
					summary: "No prior history.\n\n---\n\n**Turn Context (split turn):**\n\ntext summary",
					firstKeptEntryId: seedEntryIds.assistantEntryId,
					details: { readFiles: [], modifiedFiles: [] },
					fromExtension: false,
				});
		expect(boundaries(manager)).toHaveLength(1);
		expect(compactBoundaries).toHaveLength(1);
		const publicBoundary = boundariesFromPublic(publicBranch(manager))[0]?.boundary;
		expect(compactBoundaries[0]).toEqual(publicBoundary);
		expect(sanitizedBoundary(compactBoundaries[0])).toEqual({
			id: "<boundary id>",
			parentId: "<parent id>",
			timestamp: "<timestamp>",
			version: 1,
			kind: kind === "native" ? "checkpoint" : "text",
			tokensBefore: 100,
			...(kind === "text"
				? {
						text: {
							summary: "No prior history.\n\n---\n\n**Turn Context (split turn):**\n\ntext summary",
							firstKeptEntryId: seedEntryIds.assistantEntryId,
							details: { readFiles: [], modifiedFiles: [] },
							fromExtension: false,
						},
					}
				: {}),
			projections: [expectedContinuityProjection("manual", false)],
			usage: expectedUsage,
		});
		if (kind === "native") {
			expect(compactBoundaries[0]).not.toHaveProperty("checkpoint");
			expect(JSON.stringify(compactBoundaries[0])).not.toContain(OPAQUE);
		}
	});

	it("cancels before transport or public checkpoint state even after earlier contributions", async () => {
		const timeline: string[] = [];
		const statuses: Array<string | undefined> = [];
		let laterHandlerCalled = false;
		const local = await localResponses();
		servers.push(local);
		const harness = await createHarness({
			extensionFactories: [
				continuityFactory(timeline, statuses),
				(pi) => pi.on("session_before_compact", (event) => ({
					compaction: {
						summary: "discarded replacement",
						firstKeptEntryId: event.preparation.firstKeptEntryId,
						tokensBefore: event.preparation.tokensBefore,
					},
				})),
				(pi) => pi.on("session_before_compact", () => ({ cancel: true })),
				(pi) => pi.on("session_before_compact", () => {
					laterHandlerCalled = true;
				}),
			],
		});
		harnesses.push(harness);
		seed(harness, nativeModel(harness, local.baseUrl));
		const successfulEndsBefore = harness.eventsOfType("compaction_end").filter((event) => event.result !== undefined).length;

		await expect(harness.session.compact()).rejects.toThrow(/cancel/i);

		expect(statuses).toEqual([undefined]);
		expect(local.requests).toHaveLength(0);
		expect(inferenceRequestCount(local.requests)).toBe(0);
		expect(boundaries(harness.sessionManager)).toHaveLength(0);
		expect(timeline).toEqual(["before"]);
		expect(laterHandlerCalled).toBe(false);
		expect(checkpointId(publicBranch(harness.sessionManager))).toBeUndefined();
		expect(harness.eventsOfType("compaction_end").filter((event) => event.result !== undefined)).toHaveLength(successfulEndsBefore);
	});

	it("uses the last genuine legacy replacement as the sole text primary", async () => {
		const timeline: string[] = [];
		const statuses: Array<string | undefined> = [];
		const compactBoundaries: CompactionBoundary[] = [];
		let replacementFirstKeptEntryId: string | undefined;
		const local = await localResponses();
		servers.push(local);
		const harness = await createHarness({
			extensionFactories: [
				continuityFactory(timeline, statuses),
				(pi) => pi.on("session_before_compact", (event) => ({
					compaction: {
						summary: "superseded legacy summary",
						firstKeptEntryId: event.preparation.firstKeptEntryId,
						tokensBefore: event.preparation.tokensBefore,
						details: { replacement: 1 },
					},
				})),
				(pi) => pi.on("session_before_compact", (event) => {
					replacementFirstKeptEntryId = event.preparation.firstKeptEntryId;
					return {
						compaction: {
							summary: "winning legacy summary",
							firstKeptEntryId: event.preparation.firstKeptEntryId,
							tokensBefore: event.preparation.tokensBefore,
							details: { replacement: 2 },
						},
					};
				}),
				observer(timeline, [], compactBoundaries),
			],
		});
		harnesses.push(harness);
		seed(harness, nativeModel(harness, local.baseUrl));
		textSummary(harness.session, timeline, "built-in summary must not run");

		const outcome = await harness.session.compact();
		if (!replacementFirstKeptEntryId) throw new Error("Replacement did not receive a valid first kept entry");
		expect(harness.sessionManager.getEntry(replacementFirstKeptEntryId)).toBeDefined();

		expect(local.requests).toHaveLength(0);
		expect(timeline).toEqual(["before", "boundary", "session_compact"]);
		expect(statuses).toEqual([undefined]);
		expect(outcome).toMatchObject({
			kind: "text",
			summary: "winning legacy summary",
			firstKeptEntryId: replacementFirstKeptEntryId,
			details: { replacement: 2 },
			fromExtension: true,
			projectionCount: 1,
		});
		expect(boundaries(harness.sessionManager)).toHaveLength(1);
		expect(boundaries(harness.sessionManager)[0]?.boundary.primary).toMatchObject({
			kind: "text",
			summary: "winning legacy summary",
			firstKeptEntryId: replacementFirstKeptEntryId,
			details: { replacement: 2 },
			fromExtension: true,
		});
		expect(compactBoundaries).toHaveLength(1);
		expect(sanitizedBoundary(compactBoundaries[0])).toMatchObject({
			id: "<boundary id>",
			parentId: "<parent id>",
			timestamp: "<timestamp>",
			version: 1,
			kind: "text",
			tokensBefore: 100,
			text: {
				summary: "winning legacy summary",
				firstKeptEntryId: replacementFirstKeptEntryId,
				details: { replacement: 2 },
				fromExtension: true,
			},
			projections: [expect.objectContaining({
				type: "portable_compaction_projection",
				version: 1,
				customType: "pi-continuity/checkpoint/v1",
			})],
		});
		expect(JSON.stringify(compactBoundaries[0])).not.toContain(OPAQUE);
		expect(checkpointId(publicBranch(harness.sessionManager))).toBe("joint-checkpoint");
	});

	it.each(["text", "native"] as const)("runs real pre-prompt threshold %s compaction before one pending inference", async (kind) => {
		const timeline: string[] = [];
		const statuses: Array<string | undefined> = [];
		const payloads: unknown[] = [];
		const compactBoundaries: CompactionBoundary[] = [];
		let manager: SessionManager | undefined;
		let streamCalls = 0;
		const local = kind === "native"
			? await localResponses({ onRequest: (record) => {
				if (record.path.endsWith("/responses/compact")) timeline.push("primary");
				if (record.path.endsWith("/responses")) {
					expect(manager && boundaries(manager)).toHaveLength(1);
					expect(timeline).toContain("session_compact");
					expect(timeline).toContain("compaction_end");
				}
			} })
			: undefined;
		if (local) servers.push(local);
		const harness = await createHarness({
			settings: { compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 100 } },
			extensionFactories: [continuityFactory(timeline, statuses), observer(timeline, payloads, compactBoundaries)],
		});
		harnesses.push(harness);
		manager = harness.sessionManager;
		const model = local
			? nativeModel(harness, local.baseUrl, undefined, "joint:realm", 200)
			: { ...harness.getModel(), contextWindow: 200 };
		seed(harness, model, 150);
		expect(persistedUserMessageContents(harness.sessionManager)).toEqual(["early user history"]);
		if (!local) {
			harness.session.agent.streamFunction = (activeModel) => {
				streamCalls += 1;
				if (streamCalls === 1) timeline.push("primary");
				else {
					timeline.push("inference");
					expect(manager && boundaries(manager)).toHaveLength(1);
					expect(timeline).toContain("session_compact");
					expect(timeline).toContain("compaction_end");
				}
				const stream = createAssistantMessageEventStream();
				queueMicrotask(() => stream.push({
					type: "done",
					reason: "stop",
					message: {
						...fauxAssistantMessage(streamCalls === 1 ? "threshold summary" : "inference answer"),
						api: activeModel.api,
						provider: activeModel.provider,
						model: activeModel.id,
						usage,
					},
				}));
				return stream;
			};
		}
		const unsubscribe = recordCompactionEnds(harness.session, timeline);

		await harness.session.prompt(`pending ${kind} threshold prompt`);
		unsubscribe();

		expect(timeline).toEqual(["before", "primary", "boundary", "session_compact", "compaction_end", "inference"]);
		expect(statuses).toEqual([undefined]);
		expect(boundaries(harness.sessionManager)).toHaveLength(1);
		expect(compactBoundaries).toHaveLength(1);
		expect(checkpointId(publicBranch(harness.sessionManager))).toBe("joint-checkpoint");
		expect(persistedUserMessageContents(harness.sessionManager)).toEqual([
			"early user history",
			[{ type: "text", text: `pending ${kind} threshold prompt` }],
		]);
		expect(JSON.stringify(payloads)).not.toContain(OPAQUE);
		if (local) {
			expect(payloads).toHaveLength(1);
			expect(local.requests.map((record) => record.path)).toEqual(["/v1/responses/compact", "/v1/responses"]);
			expect(inferenceRequestCount(local.requests)).toBe(1);
		} else {
			expect(streamCalls).toBe(2);
		}
	});

	it("commits an overflow boundary before session_compact and exactly one retry", async () => {
		const timeline: string[] = [];
		const statuses: Array<string | undefined> = [];
		let harness: Harness | undefined;
		const local = await localResponses({
			overflowFirst: true,
			onRequest: (record) => {
				if (record.path.endsWith("/responses/compact")) timeline.push("primary");
				if (record.path.endsWith("/responses") && inferenceRequestCount(local.requests) === 2) {
					timeline.push("retry");
					expect(harness && boundaries(harness.sessionManager)).toHaveLength(1);
					expect(timeline).toContain("session_compact");
				}
			},
		});
		servers.push(local);
		harness = await createHarness({
			settings: { compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 0 } },
			extensionFactories: [continuityFactory(timeline, statuses), observer(timeline, [])],
		});
		harnesses.push(harness);
		seed(harness, nativeModel(harness, local.baseUrl));
		const unsubscribe = recordCompactionEnds(harness.session, timeline);
		await harness.session.prompt("authorized overflow prompt");
		unsubscribe();
		expect(local.requests.map((record) => record.path)).toEqual(["/v1/responses", "/v1/responses/compact", "/v1/responses"]);
		expect(timeline).toEqual(["inference", "before", "primary", "boundary", "session_compact", "compaction_end", "inference", "retry"]);
		expect(statuses).toEqual([undefined]);
	});

	it("rejects a delayed overflow boundary after a real append without retrying inference", async () => {
		const setup = await localResponses();
		servers.push(setup);
		const timeline: string[] = [];
		const statuses: Array<string | undefined> = [];
		const harness = await createHarness({
			settings: { compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 0 } },
			extensionFactories: [continuityFactory(timeline, statuses), observer(timeline, [])],
		});
		harnesses.push(harness);
		seed(harness, nativeModel(harness, setup.baseUrl));
		await harness.session.prompt("/continuity task Locked task");
		await harness.session.compact();
		const priorBoundary = structuredClone(boundaries(harness.sessionManager)[0]);
		const priorCheckpoint = checkpointId(publicBranch(harness.sessionManager));
		const priorControl = controlTask(publicBranch(harness.sessionManager));

		const delayed = await localResponses({
			overflowFirst: true,
			delayCompact: true,
			onRequest: (record) => {
				if (record.path.endsWith("/responses/compact")) timeline.push("delayed-primary");
			},
		});
		servers.push(delayed);
		await harness.session.setModel(nativeModel(harness, delayed.baseUrl));
		timeline.length = 0;
		statuses.length = 0;
		const successfulEndsBefore = harness.eventsOfType("compaction_end").filter((event) => event.result !== undefined).length;
		const pending = harness.session.prompt("overflow stale-boundary prompt");
		await Promise.race([
			delayed.waitForCompact(),
			pending.then(() => Promise.reject(new Error("Overflow recovery completed before compact transport was reached"))),
		]);
		const beforeMutation = harness.sessionManager.captureCompactionBoundaryAppendState();
		const appendedId = harness.sessionManager.appendCustomEntry("joint.expected-state-mutation", {
			reason: "intervening public append",
		});
		const changed = harness.sessionManager.captureCompactionBoundaryAppendState();
		expect(changed).toMatchObject({
			sessionId: beforeMutation.sessionId,
			generation: beforeMutation.generation,
			version: beforeMutation.version + 1,
			branch: appendedId,
		});
		expect(beforeMutation.branch).not.toBe(changed.branch);
		delayed.releaseCompact();
		await pending;

		expect(delayed.requests.map((record) => record.path)).toEqual(["/v1/responses", "/v1/responses/compact"]);
		expect(inferenceRequestCount(delayed.requests)).toBe(1);
		expect(timeline).toEqual(["inference", "before", "delayed-primary"]);
		expect(statuses).toEqual(["joint-checkpoint"]);
		const failedEnd = harness.eventsOfType("compaction_end").at(-1);
		expect(failedEnd).toMatchObject({
			reason: "overflow",
			result: undefined,
			aborted: false,
			willRetry: false,
		});
		expect(failedEnd?.errorMessage).toContain("Compaction boundary version changed before append");
		expect(harness.eventsOfType("compaction_end").filter((event) => event.result !== undefined)).toHaveLength(successfulEndsBefore);
		expect(boundaries(harness.sessionManager)).toEqual([priorBoundary]);
		expect(checkpointId(publicBranch(harness.sessionManager))).toBe(priorCheckpoint);
		expect(controlTask(publicBranch(harness.sessionManager))).toBe(priorControl);
	});

	it.each([false, true])("preserves prior state when one primary attempt fails (overflow=%s)", async (overflow) => {
		const setup = await localResponses();
		servers.push(setup);
		const timeline: string[] = [];
		const statuses: Array<string | undefined> = [];
		const harness = await createHarness({
			settings: { compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 0 } },
			extensionFactories: [continuityFactory(timeline, statuses), observer(timeline, [])],
		});
		harnesses.push(harness);
		seed(harness, nativeModel(harness, setup.baseUrl));
		await harness.session.prompt("/continuity task Locked task");
		await harness.session.compact();
		const priorBoundary = boundaries(harness.sessionManager)[0];
		const failed = await localResponses({ failCompact: true, overflowFirst: overflow, onRequest: (record) => {
			if (record.path.endsWith("/responses/compact")) timeline.push("failed-primary");
		} });
		servers.push(failed);
		await harness.session.setModel(nativeModel(harness, failed.baseUrl));
		timeline.length = 0;
		statuses.length = 0;
		if (overflow) {
			await harness.session.prompt("overflow failure prompt").catch(() => undefined);
		} else {
			await expect(harness.session.compact()).rejects.toThrow();
		}
		expect(failed.requests.filter((record) => record.path.endsWith("/responses/compact"))).toHaveLength(1);
		expect(inferenceRequestCount(failed.requests)).toBe(overflow ? 1 : 0);
		expect(timeline).toContain("before");
		expect(timeline).toContain("failed-primary");
		expect(timeline).not.toContain("session_compact");
		expect(timeline).not.toContain("retry");
		expect(harness.eventsOfType("compaction_end").at(-1)?.result).toBeUndefined();
		expect(boundaries(harness.sessionManager)).toEqual([priorBoundary]);
		expect(checkpointId(publicBranch(harness.sessionManager))).toBe("joint-checkpoint");
		expect(controlTask(publicBranch(harness.sessionManager))).toBe("Locked task");
	});

	it("rejects a delayed native result after a real same-manager append changes expected state", async () => {
		const setup = await localResponses();
		servers.push(setup);
		const timeline: string[] = [];
		const statuses: Array<string | undefined> = [];
		const harness = await createHarness({ extensionFactories: [continuityFactory(timeline, statuses), observer(timeline, [])] });
		harnesses.push(harness);
		seed(harness, nativeModel(harness, setup.baseUrl));
		await harness.session.prompt("/continuity task Locked task");
		await harness.session.compact();
		const priorBoundary = boundaries(harness.sessionManager)[0];
		const delayed = await localResponses({ delayCompact: true, onRequest: (record) => {
			if (record.path.endsWith("/responses/compact")) timeline.push("delayed-primary");
		} });
		servers.push(delayed);
		await harness.session.setModel(nativeModel(harness, delayed.baseUrl));
		await harness.session.prompt("first real post-boundary turn");
		await harness.session.prompt("second real post-boundary turn");
		expect(publicBranch(harness.sessionManager).slice(-4).map((entry) => entry.type)).toEqual(["message", "message", "message", "message"]);
		harness.settingsManager.applyOverrides({ compaction: { keepRecentTokens: 1 } });
		const inferenceBeforeDelayedCompaction = inferenceRequestCount(delayed.requests);
		timeline.length = 0;
		statuses.length = 0;
		const pending = harness.session.compact();
		await Promise.race([
			delayed.waitForCompact(),
			pending.then(
				() => Promise.reject(new Error("Delayed compaction completed before reaching transport")),
				(error: unknown) => Promise.reject(new Error(`Delayed compaction failed before transport: ${String(error)}; branch=${publicBranch(harness.sessionManager).map((entry) => entry.type).join(",")}`)),
			),
		]);
		harness.sessionManager.appendCustomEntry("joint.expected-state-mutation", { reason: "intervening public append" });
		delayed.releaseCompact();
		await expect(pending).rejects.toThrow(/version changed before append/);
		expect(delayed.requests.filter((record) => record.path.endsWith("/responses/compact"))).toHaveLength(1);
		expect(inferenceRequestCount(delayed.requests)).toBe(inferenceBeforeDelayedCompaction);
		expect(timeline).toEqual(["before", "delayed-primary"]);
		expect(harness.eventsOfType("compaction_end").at(-1)?.result).toBeUndefined();
		expect(statuses).toEqual(["joint-checkpoint"]);
		expect(boundaries(harness.sessionManager)).toEqual([priorBoundary]);
		expect(checkpointId(publicBranch(harness.sessionManager))).toBe("joint-checkpoint");
		expect(controlTask(publicBranch(harness.sessionManager))).toBe("Locked task");
	});

	it("keeps private checkpoint data internal and sends full portable history after a real model switch", async () => {
		const local = await localResponses();
		servers.push(local);
		const payloads: unknown[] = [];
		const timeline: string[] = [];
		const harness = await createHarness({
			models: [{ id: "compatible" }, { id: "portable" }],
			extensionFactories: [continuityFactory(timeline, []), observer(timeline, payloads)],
		});
		harnesses.push(harness);
		const compatible = nativeModel(harness, local.baseUrl, "compatible");
		seed(harness, compatible);
		await harness.session.compact();
		const boundary = boundaries(harness.sessionManager)[0];
		if (boundary.boundary.primary.kind !== "checkpoint") throw new Error("Expected checkpoint boundary");
		expect(boundary.boundary.primary.checkpoint.payload.output).toEqual(CHECKPOINT_OUTPUT);
		await harness.session.prompt("compatible request");
		const compatibleRequest = local.requests.at(-1)?.body;
		const compatibleInput = compatibleRequest?.input;
		if (!Array.isArray(compatibleInput)) throw new Error("Compatible request has no input array");
		expect(compatibleInput.slice(0, 2)).toEqual(CHECKPOINT_OUTPUT);
		expect(JSON.stringify(compatibleInput[2])).toContain("Verify joint lifecycle");
		for (const payload of payloads) expect(JSON.stringify(payload)).not.toContain(OPAQUE);
		const portableBase = harness.getModel("portable");
		if (!portableBase) throw new Error("Missing portable model");
		const incompatible: Model<"openai-responses"> = { ...portableBase, api: "openai-responses", baseUrl: local.baseUrl };
		await harness.session.setModel(incompatible);
		await harness.session.prompt("incompatible request");
		const incompatibleRequest = local.requests.at(-1)?.body;
		const incompatibleInput = incompatibleRequest?.input;
		if (!Array.isArray(incompatibleInput)) throw new Error("Incompatible request has no input array");
		expect(JSON.stringify(incompatibleInput)).not.toContain(OPAQUE);
		expect(normalizedResponsesInput(incompatibleInput)).toEqual([
			{ role: "system", content: "<system prompt>" },
			{ role: "user", content: [{ type: "input_text", text: "early user history" }] },
			{
				type: "message",
				role: "assistant",
				content: [{ type: "output_text", text: "early assistant history", annotations: [] }],
				status: "completed",
				id: "<message id>",
			},
			{
				role: "user",
				content: [{ type: "input_text", text: EXPECTED_PROJECTED_CONTINUITY_CONTEXT }],
			},
			{ role: "user", content: [{ type: "input_text", text: "compatible request" }] },
			{
				type: "message",
				role: "assistant",
				content: [{ type: "output_text", text: "ok", annotations: [] }],
				status: "completed",
				id: "<message id>",
			},
			{ role: "user", content: [{ type: "input_text", text: "incompatible request" }] },
		]);
		for (const payload of payloads) expect(JSON.stringify(payload)).not.toContain(OPAQUE);
	});

	it("persists hook boundaries and controls across reopen, tree branches, clearing, and real forks", async () => {
		const directory = mkdtempSync(join(tmpdir(), "pi-continuity-joint-"));
		let contribute = true;
		let nextCheckpoint = 0;
		const timeline: string[] = [];
		const statuses: Array<string | undefined> = [];
		try {
			const lifecycle = await createPersistedLifecycle(directory, [
				continuityFactory(timeline, statuses, {
					contribute: () => contribute,
					checkpointIds: () => `persisted-${++nextCheckpoint}`,
				}),
			]);
			persistent.push(lifecycle);
			const rootId = lifecycle.manager.appendMessage({ role: "user", content: "persisted root", timestamp: 1 });
			lifecycle.manager.appendMessage({
				...fauxAssistantMessage("persisted assistant"),
				api: lifecycle.model.api,
				provider: lifecycle.model.provider,
				model: lifecycle.model.id,
				timestamp: 2,
			});
			lifecycle.session.agent.state.messages = lifecycle.manager.buildSessionContext().messages;
			await lifecycle.session.prompt("/continuity task Locked persisted task");
			textSummary(lifecycle.session, timeline, "first primary");
			await lifecycle.session.compact();
			expect(checkpointId(publicBranch(lifecycle.manager))).toBe("persisted-1");
			expect(controlTask(publicBranch(lifecycle.manager))).toBe("Locked persisted task");
			contribute = false;
			lifecycle.manager.appendMessage({ role: "user", content: "second window", timestamp: 3 });
			lifecycle.manager.appendMessage({
				...fauxAssistantMessage("second answer"),
				api: lifecycle.model.api,
				provider: lifecycle.model.provider,
				model: lifecycle.model.id,
				timestamp: 4,
			});
			lifecycle.session.agent.state.messages = lifecycle.manager.buildSessionContext().messages;
			textSummary(lifecycle.session, timeline, "second primary");
			await lifecycle.session.compact();
			const secondBoundaryId = lifecycle.manager.getLeafId();
			if (!secondBoundaryId) throw new Error("Second boundary did not become the leaf");
			expect(boundaries(lifecycle.manager)).toHaveLength(2);
			expect(checkpointId(publicBranch(lifecycle.manager))).toBeUndefined();
			expect(controlTask(publicBranch(lifecycle.manager))).toBe("Locked persisted task");
			const sessionFile = lifecycle.manager.getSessionFile();
			if (!sessionFile) throw new Error("Persisted lifecycle has no session file");
			expect(readFileSync(sessionFile, "utf8")).not.toContain(OPAQUE);
			const reopened = SessionManager.open(sessionFile);
			expect(boundaries(reopened)).toHaveLength(2);
			expect(checkpointId(publicBranch(reopened))).toBeUndefined();
			expect(controlTask(publicBranch(reopened))).toBe("Locked persisted task");
			expect(reopened.getTree()).toHaveLength(1);
			reopened.appendMessage({ role: "user", content: "ancestral fork marker", timestamp: 5 });
			const ancestralFork = SessionManager.forkFrom(sessionFile, directory, directory);
			const ancestralFile = ancestralFork.getSessionFile();
			if (!ancestralFile) throw new Error("Ancestral fork has no session file");
			const reopenedAncestral = SessionManager.open(ancestralFile);
			expect(boundaries(reopenedAncestral)).toHaveLength(2);
			expect(controlTask(publicBranch(reopenedAncestral))).toBe("Locked persisted task");
			reopened.branch(rootId);
			reopened.appendMessage({ role: "user", content: "non-ancestral fork", timestamp: 6 });
			const roots = reopened.getTree();
			expect(roots).toHaveLength(1);
			expect(roots[0]?.children.length).toBeGreaterThanOrEqual(2);
			const nonAncestralFork = SessionManager.forkFrom(sessionFile, directory, directory);
			const nonAncestralFile = nonAncestralFork.getSessionFile();
			if (!nonAncestralFile) throw new Error("Non-ancestral fork has no session file");
			const reopenedNonAncestral = SessionManager.open(nonAncestralFile);
			expect(boundariesFromPublic(publicBranch(reopenedNonAncestral))).toHaveLength(0);
			expect(controlTask(publicBranch(reopenedNonAncestral))).toBeUndefined();
			expect(reopenedNonAncestral.getBranch().some((entry) => entry.id === secondBoundaryId)).toBe(false);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
