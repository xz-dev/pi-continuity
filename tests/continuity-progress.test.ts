import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProgress, type ProgressUi } from "../internal/continuity-progress.js";

function fakeUi() {
	const calls: (string[] | undefined)[] = [];
	const ui: ProgressUi = {
		setWidget: vi.fn((_key: string, lines: string[] | undefined) => { calls.push(lines); }),
	};
	return { ui, calls };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("continuity progress FSM", () => {
	it("walks preparing -> awaiting -> receiving -> rendering -> end with phase, size and elapsed text", () => {
		const { ui, calls } = fakeUi();
		const progress = createProgress(ui);
		expect(calls.at(-1)).toEqual([expect.stringContaining("preparing")]);

		vi.advanceTimersByTime(2000);
		progress.prepared(123400);
		expect(calls.at(-1)![0]).toMatch(/waiting for model · prompt ~123\.4k tokens · 2s/);

		progress.delta(100);
		expect(progress.state).toBe("awaiting"); // deltas never transition
		progress.receiving();
		progress.delta(7200);
		vi.advanceTimersByTime(1000);
		expect(calls.at(-1)![0]).toMatch(/receiving summary · ~1\.8k tokens · 3s/);

		progress.rendering();
		expect(calls.at(-1)![0]).toMatch(/validating summary/);
		progress.leave();
		expect(calls.at(-1)).toBeUndefined();
		expect(progress.state).toBe("end");
	});

	it.each(["preparing", "awaiting", "receiving", "rendering"] as const)("clears the widget and stops the clock when leaving %s", (phase) => {
		const { ui, calls } = fakeUi();
		const progress = createProgress(ui);
		if (phase !== "preparing") progress.prepared(1000);
		if (phase === "receiving" || phase === "rendering") progress.receiving();
		if (phase === "rendering") progress.rendering();
		const before = calls.length;
		progress.leave();
		expect(calls.length).toBe(before + 1);
		expect(calls.at(-1)).toBeUndefined();
		vi.advanceTimersByTime(5000);
		expect(calls.length).toBe(before + 1); // interval stopped: no ghost updates
	});

	it("makes leave() idempotent and END terminal for every later event", () => {
		const { ui, calls } = fakeUi();
		const progress = createProgress(ui);
		progress.prepared(1000);
		progress.receiving();
		progress.leave();
		progress.leave();
		progress.prepared(5000);
		progress.receiving();
		progress.delta(100);
		progress.rendering();
		vi.advanceTimersByTime(5000);
		expect(progress.state).toBe("end");
		expect(calls.filter((lines) => lines === undefined)).toHaveLength(1);
		expect(calls.at(-1)).toBeUndefined();
	});

	it("rejects out-of-order transitions without touching the widget", () => {
		const { ui, calls } = fakeUi();
		const progress = createProgress(ui);
		progress.receiving(); // awaiting only
		progress.rendering(); // awaiting|receiving only
		expect(progress.state).toBe("preparing");
		progress.prepared(10);
		progress.prepared(20); // already awaited: keep the first measurement
		progress.rendering(); // from awaiting is legal
		progress.receiving(); // no way back
		expect(calls.at(-1)![0]).toMatch(/validating summary · prompt|validating summary/);
		progress.leave();
	});

	it("counts only positive finite delta characters", () => {
		const { ui, calls } = fakeUi();
		const progress = createProgress(ui);
		progress.prepared(100);
		progress.receiving();
		progress.delta(NaN);
		progress.delta(-5);
		progress.delta(0);
		vi.advanceTimersByTime(1000);
		expect(calls.at(-1)![0]).toMatch(/receiving summary · ~0 tokens/);
		progress.leave();
	});

	it("swallows UI failures so extraction is never broken by progress", () => {
		const ui: ProgressUi = { setWidget: vi.fn(() => { throw new Error("tui exploded"); }) };
		const progress = createProgress(ui);
		expect(() => {
			progress.prepared(1);
			progress.receiving();
			vi.advanceTimersByTime(2000);
			progress.rendering();
			progress.leave();
		}).not.toThrow();
		expect(progress.state).toBe("end");
	});
});
