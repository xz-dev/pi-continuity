/**
 * Transient compaction-extraction progress for the interactive TUI.
 *
 * Finite state machine per extraction: PREPARING -> AWAITING -> RECEIVING ->
 * RENDERING, and every path (success, failure, cancel, host failure) ends in
 * the single terminal state END, which releases everything (interval stopped,
 * widget cleared) and has no outgoing transitions. The instance is discarded
 * after END; a new extraction constructs a new machine. Nothing is persisted.
 */

const WIDGET_KEY = "pi-continuity";
const TICK_MS = 1000;

export type ProgressPhase = "preparing" | "awaiting" | "receiving" | "rendering";
export type ProgressState = ProgressPhase | "end";

export interface ProgressUi {
	setWidget(key: string, lines: string[] | undefined, options?: { placement?: "aboveEditor" | "belowEditor" }): void;
}

export interface ContinuityProgress {
	readonly state: ProgressState;
	/** PREPARING -> AWAITING, recording the estimated prompt size. */
	prepared(promptTokens: number): void;
	/** AWAITING -> RECEIVING on the first provider stream event. */
	receiving(): void;
	/** Count streamed characters; never transitions. */
	delta(chars: number): void;
	/** RECEIVING|AWAITING -> RENDERING once the final message is available. */
	rendering(): void;
	/** Any state -> END (terminal, idempotent): stop the clock and clear the widget. */
	leave(): void;
}

function formatTokens(tokens: number): string {
	return tokens >= 1000 ? `~${(tokens / 1000).toFixed(1)}k` : `~${tokens}`;
}

/** Rough display-only estimate; received text is counted in characters to avoid buffering it. */
function estimateReceived(chars: number): number {
	return Math.round(chars / 4);
}

export function createProgress(ui: ProgressUi, now: () => number = Date.now): ContinuityProgress {
	let state: ProgressState = "preparing";
	let promptTokens = 0;
	let receivedChars = 0;
	const startedAt = now();

	function line(): string {
		const elapsed = Math.max(0, Math.round((now() - startedAt) / 1000));
		switch (state) {
			case "preparing": return `continuity: preparing evidence · ${elapsed}s`;
			case "awaiting": return `continuity: waiting for model · prompt ${formatTokens(promptTokens)} tokens · ${elapsed}s`;
			case "receiving": return `continuity: receiving summary · ${formatTokens(estimateReceived(receivedChars))} tokens · ${elapsed}s`;
			case "rendering": return `continuity: validating summary · ${elapsed}s`;
			default: return "";
		}
	}

	function paint() {
		if (state === "end") return;
		try { ui.setWidget(WIDGET_KEY, [line()]); } catch { /* progress must never break extraction */ }
	}

	const tick = setInterval(paint, TICK_MS);
	tick.unref?.();
	paint();

	function transition(next: ProgressPhase) {
		if (state === "end" || state === next) return;
		state = next;
		paint();
	}

	return {
		get state() { return state; },
		prepared(tokens: number) {
			if (state !== "preparing") return;
			promptTokens = tokens;
			transition("awaiting");
		},
		receiving() {
			if (state !== "awaiting") return;
			transition("receiving");
		},
		delta(chars: number) {
			if (state === "end" || !Number.isFinite(chars) || chars <= 0) return;
			receivedChars += chars;
		},
		rendering() {
			if (state !== "receiving" && state !== "awaiting") return;
			transition("rendering");
		},
		leave() {
			if (state === "end") return;
			state = "end";
			clearInterval(tick);
			try { ui.setWidget(WIDGET_KEY, undefined); } catch { /* progress must never break extraction */ }
		},
	};
}
