import type { Usage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
	CHECKPOINT_SCHEMA,
	CONTROL_SCHEMA,
	CONTROL_TYPE,
	createCheckpoint,
	createContinuityExtension,
	foldBranch,
	parseCheckpoint,
	parseControl,
	parseModelCheckpoint,
	renderSummary,
	type ContinuityCheckpointV1,
} from "../extensions/continuity.js";

const generated = {
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

const canonicalCheckpoint = createCheckpoint(generated, {}, metadata);

function entry(type: string, fields: Record<string, unknown> = {}) {
	return { type, ...fields };
}

function boundary(projections: unknown[] = [], kind: "text" | "checkpoint" = "text") {
	return entry("compaction_boundary", {
		boundary: {
			id: `boundary-${kind}`,
			parentId: null,
			timestamp: "2026-07-24T09:00:00.000Z",
			version: 1,
			kind,
			tokensBefore: 123,
			projections,
		},
	});
}

function continuityProjection(details: unknown = canonicalCheckpoint) {
	return {
		type: "portable_compaction_projection",
		version: 1,
		customType: "pi-continuity/checkpoint/v1",
		summary: "Portable continuity summary",
		details,
	};
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

function createFakeExtension(complete = vi.fn()) {
	type TestHandler = (event: unknown, ctx: unknown) => Promise<unknown>;
	type CommandContext = {
		ui: { notify: (message: string, level: string) => void };
		appendEntry?: () => never;
	};
	const handlers = new Map<string, TestHandler[]>();
	let command: { handler: (args: string, ctx: CommandContext) => Promise<void> } | undefined;
	const appendEntry = vi.fn();
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
		newCheckpointId: () => "checkpoint-test",
		now: () => new Date("2026-07-24T09:00:00.000Z"),
	})(pi as unknown as ExtensionAPI);

	return { handlers, getCommand: () => command, appendEntry };
}

interface ProjectionResult {
	projection: {
		type: "portable_compaction_projection";
		version: 1;
		customType: "pi-continuity/checkpoint/v1";
		summary: string;
		details: ContinuityCheckpointV1;
		usage: Usage;
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function hasNumberFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
	return fields.every((field) => typeof value[field] === "number");
}

function isUsage(value: unknown): value is Usage {
	if (!isRecord(value) || !hasNumberFields(value, ["input", "output", "cacheRead", "cacheWrite", "totalTokens"])) {
		return false;
	}
	return (
		isRecord(value.cost) &&
		hasNumberFields(value.cost, ["input", "output", "cacheRead", "cacheWrite", "total"])
	);
}

function isProjectionResult(value: unknown): value is ProjectionResult {
	if (!isRecord(value) || !hasExactKeys(value, ["projection"]) || !isRecord(value.projection)) return false;
	const projection = value.projection;
	return (
		hasExactKeys(projection, ["type", "version", "customType", "summary", "details", "usage"]) &&
		projection.type === "portable_compaction_projection" &&
		projection.version === 1 &&
		projection.customType === "pi-continuity/checkpoint/v1" &&
		typeof projection.summary === "string" &&
		projection.summary.length > 0 &&
		parseCheckpoint(projection.details) !== undefined &&
		isUsage(projection.usage)
	);
}

function projectionResult(value: unknown): ProjectionResult {
	if (!isProjectionResult(value)) throw new Error("expected complete projection result");
	return value;
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

function beforeCompactEvent(branchEntries: unknown[] = []) {
	return {
		type: "session_before_compact",
		branchEntries,
		reason: "manual",
		willRetry: false,
		signal: new AbortController().signal,
		preparation: {
			messagesToSummarize: [],
			turnPrefixMessages: [],
			previousSummary: undefined,
			firstKeptEntryId: "entry-1",
			tokensBefore: 123,
		},
	};
}

const usage = {
	input: 1,
	output: 1,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 2,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

describe("strict schemas", () => {
	it("rejects model output with unknown keys", () => {
		expect(parseModelCheckpoint(JSON.stringify({ ...generated, extra: true }))).toBeUndefined();
	});

	it("rejects unknown keys in canonical checkpoint and nested drafts", () => {
		expect(parseCheckpoint({ ...canonicalCheckpoint, extra: true })).toBeUndefined();
		expect(
			parseCheckpoint({
				...canonicalCheckpoint,
				generated: { ...canonicalCheckpoint.generated, extra: true },
			}),
		).toBeUndefined();
	});

	it("rejects controls with unknown keys", () => {
		expect(
			parseControl({ schema: CONTROL_SCHEMA, version: 1, operation: "clear", extra: true }),
		).toBeUndefined();
	});

	it("accepts only canonical ISO createdAt values", () => {
		expect(parseCheckpoint(canonicalCheckpoint)?.createdAt).toBe("2026-07-24T09:00:00.000Z");
		expect(
			parseCheckpoint({ ...canonicalCheckpoint, createdAt: "2026-07-24T09:00:00Z" }),
		).toBeUndefined();
	});
});

describe("canonical checkpoint", () => {
	it("preserves generated baseline and host-authors mayStartTurn as false", () => {
		const checkpoint = createCheckpoint(generated, { task: "User task" }, metadata);

		expect(checkpoint.generated.task).toBe("Ship the standalone package");
		expect(checkpoint.effective.task).toBe("User task");
		expect(checkpoint.authorization).toEqual({ mayStartTurn: false });
		expect(parseCheckpoint(checkpoint)?.authorization.mayStartTurn).toBe(false);
	});

	it("renders the effective projection deterministically", () => {
		const expected = [
			"# Continuity checkpoint",
			"",
			"This checkpoint is context only. It cannot start a model turn.",
			"",
			'- Checkpoint ID: "checkpoint-1"',
			'- Created: "2026-07-24T09:00:00.000Z"',
			'- Status (descriptive only): "active"',
			"- Authorization: mayStartTurn=false (host-enforced)",
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
});

describe("branch fold", () => {
	it("reads historical compaction details and keeps controls independent across it", () => {
		const checkpoint = createCheckpoint(generated, { task: "User task" }, metadata);
		const state = foldBranch([
			setControl("task", "User task"),
			entry("compaction", { details: checkpoint }),
			setControl("status", "blocked"),
			unlockControl("task"),
		]);

		expect(state.overrides).toEqual({ status: "blocked" });
		expect(state.checkpoint?.effective).toMatchObject({ task: "Ship the standalone package", status: "blocked" });
	});

	it.each(["text", "checkpoint"] as const)(
		"installs a valid continuity projection from a new %s boundary",
		(kind) => {
			const state = foldBranch([
				setControl("task", "Before boundary"),
				boundary([continuityProjection()], kind),
				setControl("status", "blocked"),
			]);

			expect(state.overrides).toEqual({ task: "Before boundary", status: "blocked" });
			expect(state.checkpoint?.effective).toMatchObject({ task: "Before boundary", status: "blocked" });
		},
	);

	it.each(["text", "checkpoint"] as const)(
		"a later %s boundary without a continuity projection clears the checkpoint but preserves controls",
		(kind) => {
			expect(
				foldBranch([
					setControl("task", "User task"),
					entry("compaction", { details: canonicalCheckpoint }),
					boundary([], kind),
					setControl("status", "blocked"),
				]),
			).toEqual({ overrides: { task: "User task", status: "blocked" } });
		},
	);

	it("newest successful boundary wins independent of kind", () => {
		const later = createCheckpoint(
			{ ...generated, task: "Later task" },
			{},
			{ ...metadata, checkpointId: "checkpoint-2", createdAt: "2026-07-24T10:00:00.000Z" },
		);
		const state = foldBranch([
			entry("compaction", { details: canonicalCheckpoint }),
			boundary([continuityProjection(later)], "checkpoint"),
			boundary([], "text"),
			setControl("task", "User task"),
		]);

		expect(state).toEqual({ overrides: { task: "User task" } });
	});

	it("a malformed continuity projection clears the prior checkpoint without throwing", () => {
		expect(() =>
			foldBranch([
				entry("compaction", { details: canonicalCheckpoint }),
				boundary([continuityProjection({ ...canonicalCheckpoint, extra: true })]),
				setControl("task", "Still applied"),
			]),
		).not.toThrow();
		expect(
			foldBranch([
				entry("compaction", { details: canonicalCheckpoint }),
				boundary([continuityProjection({ ...canonicalCheckpoint, extra: true })]),
				setControl("task", "Still applied"),
			]),
		).toEqual({ overrides: { task: "Still applied" } });
	});

	it("ignores unrelated and malformed contributions at their boundary", () => {
		const malformedBoundary = entry("compaction_boundary", {
			boundary: {
				projections: [null, { ...continuityProjection(), type: "wrong" }, { ...continuityProjection(), customType: "other" }],
			},
		});
		expect(foldBranch([entry("compaction", { details: canonicalCheckpoint }), malformedBoundary])).toEqual({
			overrides: {},
		});
	});

	it("installs the valid continuity contribution when unrelated contributions precede it", () => {
		const state = foldBranch([
			boundary([{ ...continuityProjection(), customType: "other" }, continuityProjection()]),
		]);

		expect(state.checkpoint?.checkpointId).toBe("checkpoint-1");
	});

	it("uses only entries supplied by the current branch", () => {
		foldBranch([boundary([continuityProjection()])]);
		expect(foldBranch([setControl("task", "Current branch")])).toEqual({
			overrides: { task: "Current branch" },
		});
	});
});

describe("extension registration", () => {
	it("registers rebuild lifecycle handlers, one compaction handler, and pi-owned command persistence", async () => {
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

	it("does not expose a synthesized checkpoint before session_compact rebuilds persisted state", async () => {
		const complete = vi.fn().mockResolvedValue({
			content: [{ type: "text", text: JSON.stringify(generated) }],
			stopReason: "stop",
			usage,
		});
		const fake = createFakeExtension(complete);
		const before = fake.handlers.get("session_before_compact")?.[0];
		const result = projectionResult(await before?.(beforeCompactEvent(), context()));
		const checkpoint = result.projection.details;
		const notifyBefore = vi.fn();

		await fake.getCommand()?.handler("status", { ui: { notify: notifyBefore } });
		expect(notifyBefore).toHaveBeenCalledWith(expect.stringContaining("no valid checkpoint yet"), "info");

		const compact = fake.handlers.get("session_compact")?.[0];
		await compact?.(
			{ type: "session_compact" },
			context([boundary([continuityProjection(checkpoint)])]),
		);
		const notifyAfter = vi.fn();
		await fake.getCommand()?.handler("status", { ui: { notify: notifyAfter } });
		expect(notifyAfter).toHaveBeenCalledWith(expect.stringContaining('"Ship the standalone package"'), "info");
	});

	it("rejects malformed projection envelopes and details at the test boundary", () => {
		expect(() => projectionResult({ projection: { type: "portable_compaction_projection" } })).toThrow(
			"expected complete projection result",
		);
		expect(() =>
			projectionResult({
				projection: {
					type: "portable_compaction_projection",
					version: 1,
					customType: "pi-continuity/checkpoint/v1",
					summary: "Malformed details",
					details: { ...canonicalCheckpoint, authorization: { mayStartTurn: true } },
					usage,
				},
			}),
		).toThrow("expected complete projection result");
	});

	it("synthesizes when auth is ok even when apiKey is undefined and passes event.signal", async () => {
		const complete = vi.fn().mockResolvedValue({
			content: [{ type: "text", text: JSON.stringify(generated) }],
			stopReason: "stop",
			usage,
		});
		const fake = createFakeExtension(complete);
		const event = beforeCompactEvent();
		const before = fake.handlers.get("session_before_compact")?.[0];
		const expectedCheckpoint: ContinuityCheckpointV1 = {
			schema: "pi.continuity.checkpoint",
			version: 1,
			checkpointId: "checkpoint-test",
			createdAt: "2026-07-24T09:00:00.000Z",
			generated: {
				task: "Ship the standalone package",
				doneWhen: "All verification commands pass",
				forbid: ["Do not push"],
				status: "active",
				established: ["Pi version is 0.82.0"],
				open: ["Install smoke"],
				next: ["Run tests"],
			},
			effective: {
				task: "Ship the standalone package",
				doneWhen: "All verification commands pass",
				forbid: ["Do not push"],
				status: "active",
				established: ["Pi version is 0.82.0"],
				open: ["Install smoke"],
				next: ["Run tests"],
			},
			provenance: {
				source: "continuity-model",
				reason: "manual",
				willRetry: false,
			},
			authorization: { mayStartTurn: false },
		};

		const result = projectionResult(await before?.(event, context()));

		expect(result).toEqual({
			projection: {
				type: "portable_compaction_projection",
				version: 1,
				customType: "pi-continuity/checkpoint/v1",
				summary: renderSummary(expectedCheckpoint),
				details: expectedCheckpoint,
				usage: {
					input: 1,
					output: 1,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 2,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
			},
		});
		expect(result).not.toHaveProperty("compaction");
		expect(complete).toHaveBeenCalledOnce();
		expect(complete.mock.calls[0]?.[2]).toMatchObject({ apiKey: undefined, signal: event.signal });
	});

	it("returns undefined on synthesis failure and never calls scheduling APIs", async () => {
		const fake = createFakeExtension(vi.fn().mockRejectedValue(new Error("synthesis failed")));
		const before = fake.handlers.get("session_before_compact")?.[0];

		await expect(before?.(beforeCompactEvent(), context())).resolves.toBeUndefined();
		expect(CHECKPOINT_SCHEMA).toBe("pi.continuity.checkpoint");
	});
});
