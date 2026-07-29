import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { createContinuityExtension, parseSummary, renderSummary, type ContinuitySummary } from "../internal/continuity-core.js";

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
		branchEntries: [],
		preparation: {
			messagesToSummarize: [],
			turnPrefixMessages: [],
			previousSummary: undefined,
			firstKeptEntryId: "entry-1",
			tokensBefore: 123,
			fileOps: { read: new Set(["read-only.ts", "shared.ts"]), written: new Set(["written.ts", "shared.ts"]), edited: new Set(["edited.ts", "shared.ts"]) },
		},
	};
}

function context(compact = vi.fn()) {
	return {
		model: { id: "test-model" },
		modelRegistry: { getApiKeyAndHeaders: vi.fn().mockResolvedValue({ ok: true, apiKey: undefined }) },
		compact,
	};
}

function compactCallbacks(ctx: ReturnType<typeof context>) {
	return ctx.compact.mock.calls[0]?.[0] as { onComplete?: () => void; onError?: (error: Error) => void } | undefined;
}

function successfulComplete(model: unknown = summary) {
	return vi.fn().mockResolvedValue({
		content: [{ type: "text", text: JSON.stringify(model) }],
		stopReason: "stop",
		usage,
	});
}

function createFakeExtension(complete = successfulComplete()) {
	const handlers = new Map<string, Handler[]>();
	let command: { handler: (args: string, ctx: any) => Promise<void> } | undefined;
	const pi = {
		on: vi.fn((name: string, handler: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler])),
		registerCommand: vi.fn((_name: string, value: typeof command) => (command = value)),
		sendMessage: vi.fn(),
	};
	createContinuityExtension({ complete: complete as never })(pi as unknown as ExtensionAPI);
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

describe("manual /continuity", () => {
	it("calls compact immediately then sends one hidden custom continuation after commit", async () => {
		const fake = createFakeExtension();
		const ctx = context();
		await requestContinuity(fake, ctx);
		expect(ctx.compact).toHaveBeenCalledOnce();

		const result = await before(fake)?.(compactEvent(), ctx);
		expect(result).toEqual({ compaction: expect.objectContaining({ summary: renderSummary(summary), details: { readFiles: ["read-only.ts"], modifiedFiles: ["edited.ts", "shared.ts", "written.ts"] } }) });
		expect(fake.sendMessage).not.toHaveBeenCalled();
		compactCallbacks(ctx)?.onComplete?.();
		expect(fake.sendMessage).toHaveBeenCalledExactlyOnceWith(
			{ customType: "pi-continuity/continue", content: "Continue the work represented by the just-committed continuity summary.", display: false },
			{ triggerTurn: true },
		);
	});

	it("does not start or continue a duplicate pending request", async () => {
		const fake = createFakeExtension();
		const ctx = context();
		await requestContinuity(fake, ctx);
		await requestContinuity(fake, ctx);
		expect(ctx.compact).toHaveBeenCalledOnce();
		compactCallbacks(ctx)?.onComplete?.();
		expect(fake.sendMessage).toHaveBeenCalledOnce();
	});

	it("keeps a cancelled request guarded until compaction terminates", async () => {
		const fake = createFakeExtension();
		const ctx = context();
		await requestContinuity(fake, ctx);
		await before(fake)?.(compactEvent("manual", AbortSignal.abort()), ctx);
		await requestContinuity(fake, ctx);
		expect(ctx.compact).toHaveBeenCalledOnce();
		compactCallbacks(ctx)?.onError?.(new Error("cancelled"));
		await requestContinuity(fake, ctx);
		expect(ctx.compact).toHaveBeenCalledTimes(2);
	});

	it("clears a cancelled request and allows a later request", async () => {
		const fake = createFakeExtension();
		const ctx = context();
		await requestContinuity(fake, ctx);
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
		await requestContinuity(fake, ctx);
		compactCallbacks(ctx)?.onError?.(new Error("cancelled"));
		await requestContinuity(fake, ctx);
		expect(compact).toHaveBeenCalledTimes(2);
		expect(fake.sendMessage).not.toHaveBeenCalled();
	});

	it("fails open to native manual compaction while the successful callback continues once", async () => {
		const fake = createFakeExtension(successfulComplete({ ...summary, extra: true }));
		const ctx = context();
		await requestContinuity(fake, ctx);
		expect(await before(fake)?.(compactEvent(), ctx)).toBeUndefined();
		compactCallbacks(ctx)?.onComplete?.();
		expect(fake.sendMessage).toHaveBeenCalledOnce();
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
		expect(result).toEqual({ compaction: expect.objectContaining({ summary: renderSummary(summary) }) });
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

describe("public surface", () => {
	it("registers one command and no legacy controls or lifecycle state handlers", async () => {
		const fake = createFakeExtension();
		expect([...fake.handlers.keys()].sort()).toEqual(["session_before_compact"]);
		const notify = vi.fn();
		await fake.getCommand()?.handler("status", { ...context(), ui: { notify } });
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("Usage: /continuity"), "warning");
	});
});
