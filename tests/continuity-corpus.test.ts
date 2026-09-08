import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSummary, type ContinuitySummary } from "../internal/continuity-core.js";

interface SourceQuote { message: number; quote: string }
interface CorpusCase {
	id: string;
	messages: { role: string; text: string }[];
	expected: {
		summary: ContinuitySummary;
		quotes: (SourceQuote & { kind: string })[];
		obsoleteUserQuotes: SourceQuote[];
		nextAction: { kind: string; description: string };
		forbiddenActions: string[];
	};
}
const corpus: {
	version: number;
	evaluation: { minimumCompactions: number; reloadRequired: boolean; baselineRevision: string; hermesRevision: string; requiredReceiptFields: string[] };
	cases: CorpusCase[];
} = JSON.parse(readFileSync(new URL("./fixtures/continuity-corpus.json", import.meta.url), "utf8"));

// These are annotation/schema checks, not a model evaluation or a replay of the cases.
// Tool rows describe synthetic observations; no command in this corpus is executed.
describe("synthetic continuity corpus structure (not semantic behavior)", () => {
	it("defines a three-round/reload comparison with auditable receipts", () => {
		expect(corpus.version).toBe(1);
		expect(corpus.evaluation.minimumCompactions).toBeGreaterThanOrEqual(3);
		expect(corpus.evaluation.reloadRequired).toBe(true);
		expect(corpus.evaluation.baselineRevision).toMatch(/^[a-f0-9]{40}$/);
		expect(corpus.evaluation.hermesRevision).toMatch(/^[a-f0-9]{40}$/);
		expect(corpus.evaluation.requiredReceiptFields).toEqual(expect.arrayContaining([
			"candidateRevisionOrDigest", "referenceRevisions", "modelRevisions", "retainedContextPolicy", "targets",
			"actualStopsAndLimits", "pluginAndNativeRequests", "semanticFailures", "nextActionFailures", "usageAndCost",
		]));
		expect(new Set(corpus.cases.map((fixture) => fixture.id)).size).toBe(corpus.cases.length);
		expect(corpus.cases.map((fixture) => fixture.id)).toEqual([
			"positive-and-negative-constraints", "port-correction", "code-written-tests-failed", "pending-approval",
			"unanswered-discussion", "stop-and-reversal", "tool-attempt-without-result",
			"failure-later-repaired-exact-identifiers", "fully-resolved",
		]);
	});

	it.each(corpus.cases)("$id has valid state and exact user-source annotations", (fixture) => {
		expect(parseSummary(JSON.stringify(fixture.expected.summary))).toEqual(fixture.expected.summary);
		for (const message of fixture.messages) {
			expect(["user", "assistant", "tool_call", "tool_result"]).toContain(message.role);
			expect(message.text.length).toBeGreaterThan(0);
		}
		for (const selected of [...fixture.expected.quotes, ...fixture.expected.obsoleteUserQuotes]) {
			expect(Number.isInteger(selected.message)).toBe(true);
			const source = fixture.messages[selected.message]!;
			expect(source.role).toBe("user");
			expect(source.text).toContain(selected.quote);
			expect(selected.quote.length).toBeGreaterThan(0);
			expect(selected.quote.length).toBeLessThanOrEqual(1200);
		}
		for (const selected of fixture.expected.quotes) {
			expect(["task", "acceptance", "constraint", "correction"]).toContain(selected.kind);
		}
		for (const obsolete of fixture.expected.obsoleteUserQuotes) {
			expect(fixture.expected.quotes.some((selected) => selected.message > obsolete.message)).toBe(true);
		}
		expect(["implement", "repair", "request-approval", "answer", "inspect", "none"]).toContain(fixture.expected.nextAction.kind);
		expect(fixture.expected.nextAction.description.length).toBeGreaterThan(0);
		expect(fixture.expected.forbiddenActions.length).toBeGreaterThan(0);
		if (fixture.expected.nextAction.kind === "none") expect(fixture.expected.summary.next).toEqual([]);
	});
});
