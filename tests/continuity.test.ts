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
	const handlers = new Map<string, Array<(event: any, ctx: any) => any>>();
	let command: { handler: (args: string, ctx: any) => Promise<void> } | undefined;
	const appendEntry = vi.fn();
	const forbidden = () => {
		throw new Error("scheduling API called");
	};
	const pi = {
		on: vi.fn((name: string, handler: (event: any, ctx: any) => any) => {
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

function context(branch: unknown[] = []) {
	return {
		model: { provider: "test", id: "test-model" },
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
	it("unlock restores generated value for an override created before the checkpoint", () => {
		const checkpoint = createCheckpoint(generated, { task: "User task" }, metadata);
		const state = foldBranch([
			setControl("task", "User task"),
			entry("compaction", { details: checkpoint }),
			unlockControl("task"),
		]);

		expect(state.overrides).toEqual({});
		expect(state.checkpoint?.generated.task).toBe("Ship the standalone package");
		expect(state.checkpoint?.effective.task).toBe("Ship the standalone package");
	});

	it("unlock restores generated value for an override created after the checkpoint", () => {
		const state = foldBranch([
			entry("compaction", { details: canonicalCheckpoint }),
			setControl("task", "User task"),
			unlockControl("task"),
		]);

		expect(state.overrides).toEqual({});
		expect(state.checkpoint?.effective.task).toBe("Ship the standalone package");
	});

	it("controls override the latest checkpoint regardless of position", () => {
		const state = foldBranch([
			setControl("task", "User task"),
			entry("compaction", { details: canonicalCheckpoint }),
			setControl("status", "blocked"),
		]);

		expect(state.overrides).toEqual({ task: "User task", status: "blocked" });
		expect(state.checkpoint?.generated).toEqual(generated);
		expect(state.checkpoint?.effective).toMatchObject({ task: "User task", status: "blocked" });
	});

	it("uses only entries supplied by the active branch", () => {
		foldBranch([entry("compaction", { details: canonicalCheckpoint })]);
		expect(foldBranch([setControl("task", "Active branch")])).toEqual({
			overrides: { task: "Active branch" },
		});
	});

	it("a later native compaction clears the checkpoint but preserves controls", () => {
		const state = foldBranch([
			setControl("task", "User task"),
			entry("compaction", { details: canonicalCheckpoint }),
			entry("compaction", { details: { native: true } }),
		]);

		expect(state).toEqual({ overrides: { task: "User task" } });
	});

	it("a later valid continuity compaction becomes current", () => {
		const later = createCheckpoint(
			{ ...generated, task: "Later task" },
			{},
			{ ...metadata, checkpointId: "checkpoint-2", createdAt: "2026-07-24T10:00:00.000Z", reason: "threshold" },
		);
		const state = foldBranch([
			entry("compaction", { details: canonicalCheckpoint }),
			entry("compaction", { details: { native: true } }),
			entry("compaction", { details: later }),
		]);

		expect(state.checkpoint?.checkpointId).toBe("checkpoint-2");
		expect(state.checkpoint?.effective.task).toBe("Later task");
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
		const result = await before?.(beforeCompactEvent(), context());
		const checkpoint = result.compaction.details;
		const notifyBefore = vi.fn();

		await fake.getCommand()?.handler("status", { ui: { notify: notifyBefore } });
		expect(notifyBefore).toHaveBeenCalledWith(expect.stringContaining("no valid checkpoint yet"), "info");

		const compact = fake.handlers.get("session_compact")?.[0];
		await compact?.(
			{ type: "session_compact" },
			context([entry("compaction", { details: checkpoint })]),
		);
		const notifyAfter = vi.fn();
		await fake.getCommand()?.handler("status", { ui: { notify: notifyAfter } });
		expect(notifyAfter).toHaveBeenCalledWith(expect.stringContaining('"Ship the standalone package"'), "info");
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

		const result = await before?.(event, context());

		expect(result.compaction.details.generated).toEqual(generated);
		expect(complete).toHaveBeenCalledOnce();
		expect(complete.mock.calls[0]?.[2]).toMatchObject({ apiKey: undefined, signal: event.signal });
	});

	it("returns undefined on synthesis failure and never calls scheduling APIs", async () => {
		const fake = createFakeExtension(vi.fn().mockRejectedValue(new Error("provider failed")));
		const before = fake.handlers.get("session_before_compact")?.[0];

		await expect(before?.(beforeCompactEvent(), context())).resolves.toBeUndefined();
		expect(CHECKPOINT_SCHEMA).toBe("pi.continuity.checkpoint");
	});
});
