import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
	CONTROL_SCHEMA,
	CONTROL_TYPE,
	applyControl,
	applyOverrides,
	createCheckpoint,
	createContinuityExtension,
	foldBranch,
	parseCheckpoint,
	parseCommand,
	parseControl,
	parseModelExtractedState,
	renderSummary,
	type ContinuityCheckpointV1,
	type ContinuityControl,
	type Overrides,
} from "../internal/continuity-core.js";

const modelExtracted = {
	task: "Ship the standalone package",
	doneWhen: "All verification commands pass",
	forbid: ["Do not push"],
	status: "active" as const,
	established: ["Pi version is 0.82.0"],
	open: ["Install smoke"],
	next: ["Run tests"],
};

const metadata = {
	checkpointId: "checkpoint-1",
	createdAt: "2026-07-24T09:00:00.000Z",
	reason: "manual" as const,
	willRetry: false,
};

const canonicalCheckpoint = createCheckpoint(modelExtracted, {}, metadata);

const usage = {
	input: 1,
	output: 1,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 2,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function entry(type: string, fields: Record<string, unknown> = {}) {
	return { type, ...fields };
}

function setControl(field: "task" | "doneWhen" | "forbid" | "status", value: string | string[]) {
	return entry("custom", {
		customType: CONTROL_TYPE,
		data: { schema: CONTROL_SCHEMA, version: 1, operation: "set", field, value },
	});
}

function unlockControl(field: "task" | "doneWhen" | "forbid" | "status" | "all") {
	return entry("custom", {
		customType: CONTROL_TYPE,
		data: { schema: CONTROL_SCHEMA, version: 1, operation: "unlock", field },
	});
}

function context(branch: unknown[] = []) {
	return {
		model: { id: "test-model" },
		modelRegistry: { getApiKeyAndHeaders: vi.fn().mockResolvedValue({ ok: true, apiKey: undefined }) },
		sessionManager: { getBranch: () => branch },
		abort: () => {
			throw new Error("abort called");
		},
		compact: () => {
			throw new Error("compact called");
		},
	};
}

function beforeCompactEvent(branchEntries: unknown[] = [], signal = new AbortController().signal) {
	return {
		type: "session_before_compact",
		branchEntries,
		reason: "manual",
		willRetry: false,
		signal,
		preparation: {
			messagesToSummarize: [],
			turnPrefixMessages: [],
			previousSummary: undefined,
			firstKeptEntryId: "entry-1",
			tokensBefore: 123,
		},
	};
}

function createFakeExtension(
	complete = vi.fn(),
	appendEntry = vi.fn(),
	newCheckpointId: () => string = () => "checkpoint-test",
) {
	type TestHandler = (event: unknown, ctx: unknown) => Promise<unknown> | unknown;
	type CommandContext = {
		ui: { notify: (message: string, level: string) => void };
		appendEntry?: () => never;
	};
	const handlers = new Map<string, TestHandler[]>();
	let command: { handler: (args: string, ctx: CommandContext) => Promise<void> } | undefined;
	const forbidden = () => {
		throw new Error("scheduling operation called");
	};
	const pi = {
		on: vi.fn((name: string, handler: TestHandler) => {
			const registered = handlers.get(name) ?? [];
			registered.push(handler);
			handlers.set(name, registered);
		}),
		registerCommand: vi.fn((_name: string, value: typeof command) => {
			command = value;
		}),
		appendEntry,
		sendMessage: forbidden,
		sendUserMessage: forbidden,
	};

	createContinuityExtension({
		complete: complete as never,
		newCheckpointId,
		now: () => new Date("2026-07-24T09:00:00.000Z"),
	})(pi as unknown as ExtensionAPI);

	return { handlers, getCommand: () => command, appendEntry };
}

function successfulComplete(model = modelExtracted) {
	return vi.fn().mockResolvedValue({
		content: [{ type: "text", text: JSON.stringify(model) }],
		stopReason: "stop",
		usage,
	});
}

function expectedCheckpoint(overrides: Overrides = {}): ContinuityCheckpointV1 {
	return createCheckpoint(modelExtracted, overrides, {
		...metadata,
		checkpointId: "checkpoint-test",
	});
}

describe("strict schemas", () => {
	it("accepts only the exact bounded model shape", () => {
		expect(parseModelExtractedState(JSON.stringify(modelExtracted))).toEqual(modelExtracted);
		expect(parseModelExtractedState(JSON.stringify({ ...modelExtracted, extra: true }))).toBeUndefined();
		expect(parseModelExtractedState(JSON.stringify({ ...modelExtracted, task: "" }))).toBeUndefined();
		expect(parseModelExtractedState(JSON.stringify({ ...modelExtracted, forbid: ["same", "same"] }))).toBeUndefined();
		expect(parseModelExtractedState("not json")).toBeUndefined();
	});

	const serializedModel = JSON.stringify(modelExtracted);
	it.each([
		["model output", serializedModel.padEnd(16000, " "), serializedModel.padEnd(16001, " ")],
		[
			"scalar",
			JSON.stringify({ ...modelExtracted, task: "x".repeat(2000) }),
			JSON.stringify({ ...modelExtracted, task: "x".repeat(2001) }),
		],
		[
			"list item",
			JSON.stringify({ ...modelExtracted, forbid: ["x".repeat(1000)] }),
			JSON.stringify({ ...modelExtracted, forbid: ["x".repeat(1001)] }),
		],
		[
			"list count",
			JSON.stringify({ ...modelExtracted, established: Array.from({ length: 24 }, (_, index) => `fact-${index}`) }),
			JSON.stringify({ ...modelExtracted, established: Array.from({ length: 25 }, (_, index) => `fact-${index}`) }),
		],
	])("accepts the %s limit and rejects one over it", (_name, accepted, rejected) => {
		expect(parseModelExtractedState(accepted)).toBeDefined();
		expect(parseModelExtractedState(rejected)).toBeUndefined();
	});

	it.each([
		["C0", "\u0020", "\u001f"],
		["DEL", "\u007e", "\u007f"],
	])("accepts printable text at the %s boundary and rejects the control character", (_name, accepted, rejected) => {
		expect(parseModelExtractedState(JSON.stringify({ ...modelExtracted, task: `x${accepted}x` }))).toBeDefined();
		expect(parseModelExtractedState(JSON.stringify({ ...modelExtracted, task: `x${rejected}x` }))).toBeUndefined();
	});

	it("accepts only exact canonical checkpoints and ISO timestamps", () => {
		expect(parseCheckpoint(canonicalCheckpoint)).toEqual(canonicalCheckpoint);
		expect(parseCheckpoint({ ...canonicalCheckpoint, extra: true })).toBeUndefined();
		expect(
			parseCheckpoint({ ...canonicalCheckpoint, modelExtracted: { ...canonicalCheckpoint.modelExtracted, extra: true } }),
		).toBeUndefined();
		expect(parseCheckpoint({ ...canonicalCheckpoint, createdAt: "2026-07-24T09:00:00Z" })).toBeUndefined();
		expect(
			parseCheckpoint({ ...canonicalCheckpoint, authorization: { mayStartTurn: true } }),
		).toBeUndefined();
	});

	it("accepts only exact control schemas", () => {
		const control = {
			schema: CONTROL_SCHEMA,
			version: 1,
			operation: "set",
			field: "task",
			value: "User task",
		};
		expect(parseControl(control)).toEqual(control);
		expect(parseControl({ ...control, extra: true })).toBeUndefined();
		expect(parseControl({ schema: CONTROL_SCHEMA, version: 1, operation: "clear", extra: true })).toBeUndefined();
		expect(parseControl({ schema: CONTROL_SCHEMA, version: 1, operation: "unlock", field: "other" })).toBeUndefined();
	});
});

describe("checkpoint creation and controls", () => {
	it("preserves modelExtracted values separately from effective overrides", () => {
		const checkpoint = createCheckpoint(modelExtracted, { task: "User task", status: "blocked" }, metadata);

		expect(checkpoint.modelExtracted).toEqual(modelExtracted);
		expect(checkpoint.effective).toEqual({ ...modelExtracted, task: "User task", status: "blocked" });
		expect(checkpoint.authorization).toEqual({ mayStartTurn: false });
		expect(checkpoint.provenance).toEqual({ source: "continuity-model", reason: "manual", willRetry: false });
	});

	it("applies, unlocks, and clears controls without mutating the modelExtracted checkpoint", () => {
		const overrides: Overrides = {};
		const controls: ContinuityControl[] = [
			{ schema: CONTROL_SCHEMA, version: 1, operation: "set", field: "task", value: "Locked task" },
			{ schema: CONTROL_SCHEMA, version: 1, operation: "set", field: "forbid", value: ["No deploy"] },
		];
		for (const control of controls) applyControl(overrides, control);
		expect(applyOverrides(canonicalCheckpoint, overrides).effective).toMatchObject({
			task: "Locked task",
			forbid: ["No deploy"],
		});
		expect(canonicalCheckpoint.modelExtracted).toEqual(modelExtracted);

		applyControl(overrides, { schema: CONTROL_SCHEMA, version: 1, operation: "unlock", field: "task" });
		expect(applyOverrides(canonicalCheckpoint, overrides).effective.task).toBe(modelExtracted.task);
		applyControl(overrides, { schema: CONTROL_SCHEMA, version: 1, operation: "clear" });
		expect(overrides).toEqual({});
	});
});

describe("branch fold", () => {
	it("uses only supplied branch entries and the latest committed compaction", () => {
		const older = createCheckpoint({ ...modelExtracted, task: "Older" }, {}, metadata);
		const newer = createCheckpoint(
			{ ...modelExtracted, task: "Newer" },
			{},
			{ ...metadata, checkpointId: "checkpoint-2", createdAt: "2026-07-24T10:00:00.000Z" },
		);
		const branch = [
			setControl("task", "Locked task"),
			entry("compaction", { details: older }),
			entry("message"),
			entry("compaction", { details: newer }),
			setControl("status", "blocked"),
		];

		expect(foldBranch(branch)).toEqual({
			checkpoint: expect.objectContaining({
				checkpointId: "checkpoint-2",
				effective: expect.objectContaining({ task: "Locked task", status: "blocked" }),
			}),
			overrides: { task: "Locked task", status: "blocked" },
		});
		expect(foldBranch([setControl("task", "Other branch")])).toEqual({
			overrides: { task: "Other branch" },
		});
	});

	it.each([
		{ ...canonicalCheckpoint, extra: true },
		{ ...canonicalCheckpoint, modelExtracted: undefined },
		{ ...canonicalCheckpoint, effective: 1n },
		{ ...canonicalCheckpoint, modelExtracted: { ...modelExtracted, next: [1n] } },
	])("clears the prior checkpoint at malformed compaction details %# while preserving controls", (details) => {
		expect(
			foldBranch([
				entry("compaction", { details: canonicalCheckpoint }),
				setControl("task", "Keep this control"),
				entry("compaction", { details }),
				setControl("status", "blocked"),
			]),
		).toEqual({ overrides: { task: "Keep this control", status: "blocked" } });
	});

	it("clears the prior checkpoint at a checkpoint-free compaction", () => {
		expect(
			foldBranch([entry("compaction", { details: canonicalCheckpoint }), entry("compaction")]),
		).toEqual({ overrides: {} });
	});

	it("keeps controls independent across compaction and unlock entries", () => {
		const state = foldBranch([
			setControl("task", "User task"),
			entry("compaction", { details: canonicalCheckpoint }),
			setControl("status", "blocked"),
			unlockControl("task"),
		]);

		expect(state.overrides).toEqual({ status: "blocked" });
		expect(state.checkpoint?.effective).toMatchObject({ task: modelExtracted.task, status: "blocked" });
	});

	it("ignores unrelated and malformed custom entries", () => {
		expect(() =>
			foldBranch([
				entry("custom", { customType: "other", data: canonicalCheckpoint }),
				entry("custom", { customType: CONTROL_TYPE, data: { malformed: true } }),
			]),
		).not.toThrow();
		expect(foldBranch([entry("custom", { customType: CONTROL_TYPE, data: { malformed: true } })])).toEqual({
			overrides: {},
		});
	});
});

describe("deterministic summary and command parsing", () => {
	it("renders the effective checkpoint deterministically", () => {
		const expected = [
			"# Continuity checkpoint",
			"",
			"This checkpoint provides context for Pi’s next model request, whether that is an overflow retry or a later user turn.",
			"",
			'- Checkpoint ID: "checkpoint-1"',
			'- Created: "2026-07-24T09:00:00.000Z"',
			'- Status (descriptive only): "active"',
			"- Extension metadata: authorization.mayStartTurn=false",
			"",
			"## Task",
			'"Ship the standalone package"',
			"",
			"## Done when",
			'"All verification commands pass"',
			"",
			"## Forbid",
			'- "Do not push"',
			"",
			"## Established",
			'- "Pi version is 0.82.0"',
			"",
			"## Open",
			'- "Install smoke"',
			"",
			"## Next",
			'- "Run tests"',
		].join("\n");

		expect(renderSummary(canonicalCheckpoint)).toBe(expected);
		expect(renderSummary(canonicalCheckpoint)).toBe(expected);
	});

	it.each([
		["", "status"],
		["status", "status"],
		["task User task", { operation: "set", field: "task", value: "User task" }],
		["done-when Tests pass", { operation: "set", field: "doneWhen", value: "Tests pass" }],
		["forbid one, two", { operation: "set", field: "forbid", value: ["one", "two"] }],
		['forbid ["one", "two"]', { operation: "set", field: "forbid", value: ["one", "two"] }],
		["mark blocked", { operation: "set", field: "status", value: "blocked" }],
		["unlock done-when", { operation: "unlock", field: "doneWhen" }],
		["clear", { operation: "clear" }],
	] as const)("parses %j", (input, expected) => {
		const parsed = parseCommand(input);
		if (expected === "status") expect(parsed).toBe("status");
		else expect(parsed).toMatchObject(expected);
	});

	it.each(["task", "forbid", "mark invalid", "unlock other", "clear now", "other value"])(
		"rejects invalid command %j",
		(input) => expect(parseCommand(input)).toBeUndefined(),
	);
});

describe("extension contract and lifecycle", () => {
	it("registers only upstream lifecycle handlers and persists controls through ExtensionAPI", async () => {
		const fake = createFakeExtension();

		expect([...fake.handlers.keys()].sort()).toEqual([
			"session_before_compact",
			"session_compact",
			"session_start",
			"session_tree",
		]);
		expect(fake.handlers.get("session_before_compact")).toHaveLength(1);

		await fake.getCommand()?.handler("task User-authoritative task", {
			appendEntry: vi.fn(() => {
				throw new Error("command context persistence must not be used");
			}),
			ui: { notify: vi.fn() },
		});
		expect(fake.appendEntry).toHaveBeenCalledWith(CONTROL_TYPE, {
			schema: CONTROL_SCHEMA,
			version: 1,
			operation: "set",
			field: "task",
			value: "User-authoritative task",
		});
	});

	it("returns standard upstream { compaction } and exposes checkpoint state only after commit", async () => {
		const complete = successfulComplete();
		const fake = createFakeExtension(complete);
		const event = beforeCompactEvent();
		const before = fake.handlers.get("session_before_compact")?.[0];

		const result = await before?.(event, context());
		const checkpoint = expectedCheckpoint();
		expect(result).toEqual({
			compaction: {
				summary: renderSummary(checkpoint),
				firstKeptEntryId: "entry-1",
				tokensBefore: 123,
				usage,
				details: checkpoint,
			},
		});

		const notifyBefore = vi.fn();
		await fake.getCommand()?.handler("status", { ui: { notify: notifyBefore } });
		expect(notifyBefore).toHaveBeenCalledWith(expect.stringContaining("no valid checkpoint is present"), "info");

		await fake.handlers.get("session_compact")?.[0]?.(
			{ type: "session_compact" },
			context([entry("compaction", { details: checkpoint })]),
		);
		const notifyAfter = vi.fn();
		await fake.getCommand()?.handler("status", { ui: { notify: notifyAfter } });
		expect(notifyAfter).toHaveBeenCalledWith(expect.stringContaining('## Task\n"Ship the standalone package"'), "info");
		expect(complete).toHaveBeenCalledOnce();
		expect(complete.mock.calls[0]?.[2]).toMatchObject({ apiKey: undefined, signal: event.signal });
	});

	it("folds controls from the event branch into the returned committed checkpoint", async () => {
		const fake = createFakeExtension(successfulComplete());
		const branch = [setControl("task", "Locked branch task"), setControl("status", "blocked")];

		const result = (await fake.handlers.get("session_before_compact")?.[0]?.(
			beforeCompactEvent(branch),
			context(branch),
		)) as { compaction: { summary: string; details: ContinuityCheckpointV1 } };

		expect(result.compaction.details.modelExtracted).toEqual(modelExtracted);
		expect(result.compaction.details.effective).toMatchObject({ task: "Locked branch task", status: "blocked" });
		expect(result.compaction.summary).toBe(renderSummary(expectedCheckpoint({ task: "Locked branch task", status: "blocked" })));
	});

	it.each(["session_start", "session_tree", "session_compact"])(
		"rebuilds committed branch state on %s",
		async (lifecycle) => {
			const fake = createFakeExtension();
			const checkpoint = createCheckpoint(
				{ ...modelExtracted, task: `${lifecycle} task` },
				{},
				{ ...metadata, checkpointId: lifecycle },
			);
			await fake.handlers.get(lifecycle)?.[0]?.({ type: lifecycle }, context([entry("compaction", { details: checkpoint })]));
			const notify = vi.fn();
			await fake.getCommand()?.handler("status", { ui: { notify } });
			expect(notify).toHaveBeenCalledWith(expect.stringContaining(`## Task\n"${lifecycle} task"`), "info");
		},
	);

	it("returns undefined on missing model, authentication, abort, model failure, or invalid output", async () => {
		const cases = [
			{ fake: createFakeExtension(successfulComplete()), event: beforeCompactEvent(), ctx: { ...context(), model: undefined } },
			{
				fake: createFakeExtension(successfulComplete()),
				event: beforeCompactEvent(),
				ctx: { ...context(), modelRegistry: { getApiKeyAndHeaders: vi.fn().mockResolvedValue({ ok: false }) } },
			},
			{
				fake: createFakeExtension(successfulComplete()),
				event: beforeCompactEvent([], AbortSignal.abort()),
				ctx: context(),
			},
			{ fake: createFakeExtension(vi.fn().mockRejectedValue(new Error("failed"))), event: beforeCompactEvent(), ctx: context() },
			{
				fake: createFakeExtension(successfulComplete({ ...modelExtracted, extra: true } as typeof modelExtracted)),
				event: beforeCompactEvent(),
				ctx: context(),
			},
		];

		for (const testCase of cases) {
			await expect(
				testCase.fake.handlers.get("session_before_compact")?.[0]?.(testCase.event, testCase.ctx),
			).resolves.toBeUndefined();
		}
	});

	it("leaves scheduling, compaction invocation, abort, and retry ownership to Pi", async () => {
		const fake = createFakeExtension(successfulComplete());
		await expect(
			fake.handlers.get("session_before_compact")?.[0]?.(beforeCompactEvent(), context()),
		).resolves.toHaveProperty("compaction");
	});
});
