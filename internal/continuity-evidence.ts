import { createHash } from "node:crypto";
import { estimateTokens, type SessionBeforeCompactEvent } from "@earendil-works/pi-coding-agent";

const KINDS = ["task", "acceptance", "constraint", "correction"] as const;
const MAX_QUOTE = 1200;
const MAX_SELECTIONS = 32;
type Kind = (typeof KINDS)[number];

export interface EvidenceReference {
	id: string;
	entryId: string;
	blockIndex: number;
	start: number;
	end: number;
	kind: Kind;
}

interface SourceBlock {
	entryId: string;
	blockIndex: number;
	text: string;
	branchOrder: number;
}

interface SourceWindow extends SourceBlock {
	sourceId: string;
	start: number;
	end: number;
	sourceLength: number;
}

interface VerifiedEvidence {
	reference: EvidenceReference;
	text: string;
	branchOrder: number;
}

export interface EvidenceCoverage {
	mode: "selected";
	basis: "initial" | "carried" | "rebuilt";
	sourceWindowsOmitted: number;
	sourceCharsOmitted: number;
	selectionsRejected: number;
	retirementsRejected: number;
	evidenceBudgetOmitted: number;
	priorUnavailable: number;
	retired: number;
	filesOmitted: number;
}

export interface EvidenceContext {
	sources: SourceWindow[];
	carried: VerifiedEvidence[];
	coverage: EvidenceCoverage;
	blocks: Map<string, SourceBlock>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isKind(value: unknown): value is Kind {
	return KINDS.some((kind) => kind === value);
}

export function textTokens(text: string): number {
	return estimateTokens({ role: "user", content: text, timestamp: 0 });
}

function blockKey(entryId: string, blockIndex: number): string {
	return JSON.stringify([entryId, blockIndex]);
}

function identify(block: SourceBlock, start: number, end: number, kind: Kind): VerifiedEvidence | undefined {
	if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > block.text.length || end - start > MAX_QUOTE) return undefined;
	const text = block.text.slice(start, end);
	// In Unicode mode this matches lone surrogates, not intact surrogate pairs.
	if (/[\uD800-\uDFFF]/u.test(text)) return undefined;
	const id = createHash("sha256").update(JSON.stringify([block.entryId, block.blockIndex, start, end, text])).digest("hex");
	return { reference: { id, entryId: block.entryId, blockIndex: block.blockIndex, start, end, kind }, text, branchOrder: block.branchOrder };
}

function coveredLength(ranges: Array<[number, number]>): number {
	let length = 0;
	let end = 0;
	for (const [start, nextEnd] of ranges.sort((a, b) => a[0] - b[0])) {
		length += Math.max(0, nextEnd - Math.max(start, end));
		end = Math.max(end, nextEnd);
	}
	return length;
}

export function prepareEvidence(event: SessionBeforeCompactEvent, budget = 6144): EvidenceContext | undefined {
	const entries = event.branchEntries;
	const boundary = entries.findIndex((entry) => entry.id === event.preparation.firstKeptEntryId);
	if (boundary < 0) return undefined;
	const latest = entries.findLast((entry) => entry.type === "compaction");
	const details = latest?.type === "compaction" && isRecord(latest.details) ? latest.details.continuity : undefined;
	const recognized = isRecord(details) && details.version === 1 && Array.isArray(details.evidence);
	const coverage: EvidenceCoverage = {
		mode: "selected", basis: latest ? (recognized ? "carried" : "rebuilt") : "initial",
		sourceWindowsOmitted: 0, sourceCharsOmitted: 0, selectionsRejected: 0, retirementsRejected: 0,
		evidenceBudgetOmitted: 0, priorUnavailable: 0, retired: 0, filesOmitted: 0,
	};
	const blocks = new Map<string, SourceBlock>();
	entries.forEach((entry, branchOrder) => {
		if (entry.type !== "message" || entry.message.role !== "user") return;
		const content = entry.message.content;
		const parts = typeof content === "string" ? [{ type: "text", text: content }] : content;
		parts.forEach((part, blockIndex) => {
			if (part.type === "text") blocks.set(blockKey(entry.id, blockIndex), { entryId: entry.id, blockIndex, text: part.text, branchOrder });
		});
	});
	const carried: VerifiedEvidence[] = [];
	if (recognized) {
		for (const value of details.evidence as unknown[]) {
			const block = isRecord(value) && typeof value.entryId === "string" && typeof value.blockIndex === "number"
				? blocks.get(blockKey(value.entryId, value.blockIndex)) : undefined;
			const item = block && isRecord(value) && isKind(value.kind) && typeof value.start === "number" && typeof value.end === "number"
				? identify(block, value.start, value.end, value.kind) : undefined;
			if (item && isRecord(value) && item.reference.id === value.id) carried.push(item);
			else coverage.priorUnavailable++;
		}
	}
	const candidates: Array<{ block: SourceBlock; start: number; end: number }> = [];
	const eligible = new Map<string, Array<[number, number]>>();
	const fullBlocks = new Set<string>();
	function addRange(block: SourceBlock, start: number, end: number) {
		const key = blockKey(block.entryId, block.blockIndex);
		const ranges = eligible.get(key) ?? [];
		ranges.push([start, end]);
		eligible.set(key, ranges);
	}
	function addBlock(block: SourceBlock) {
		const key = blockKey(block.entryId, block.blockIndex);
		if (fullBlocks.has(key)) return;
		fullBlocks.add(key);
		addRange(block, 0, block.text.length);
		if (block.text.length <= 4000) candidates.push({ block, start: 0, end: block.text.length });
		else {
			const end = /[\uD800-\uDBFF]/u.test(block.text[1999]!) ? 1999 : 2000;
			const tail = block.text.length - 2000;
			const start = /[\uDC00-\uDFFF]/u.test(block.text[tail]!) ? tail + 1 : tail;
			candidates.push({ block, start: 0, end }, { block, start, end: block.text.length });
		}
	}
	for (const item of carried) {
		const { entryId, blockIndex, start, end } = item.reference;
		const block = blocks.get(blockKey(entryId, blockIndex))!;
		addRange(block, start, end);
		candidates.push({ block, start, end });
	}
	const allBlocks = [...blocks.values()];
	const latestUsers = [...new Set(allBlocks.map((block) => block.branchOrder))].slice(-2);
	for (const order of latestUsers.reverse()) allBlocks.filter((block) => block.branchOrder === order).forEach(addBlock);
	let lower = 0;
	if (recognized && latest?.type === "compaction") {
		lower = entries.findIndex((entry) => entry.id === latest.firstKeptEntryId);
		if (lower < 0 || lower > boundary) return undefined;
	} else {
		const earliest = allBlocks.find((block) => block.branchOrder < boundary)?.branchOrder;
		allBlocks.filter((block) => block.branchOrder === earliest).forEach(addBlock);
	}
	allBlocks.filter((block) => block.branchOrder >= lower && block.branchOrder < boundary)
		.sort((a, b) => b.branchOrder - a.branchOrder || a.blockIndex - b.blockIndex).forEach(addBlock);
	const sources: SourceWindow[] = [];
	const seen = new Set<string>();
	const offered = new Map<string, Array<[number, number]>>();
	let used = 0;
	for (const { block, start, end } of candidates) {
		const key = blockKey(block.entryId, block.blockIndex);
		const windowKey = JSON.stringify([key, start, end]);
		if (seen.has(windowKey) || start === end) continue;
		seen.add(windowKey);
		const source = { sourceId: `s${sources.length}`, ...block, start, end, sourceLength: block.text.length, text: block.text.slice(start, end) };
		const tokens = textTokens(JSON.stringify(source) + "\n");
		if (used + tokens > budget) { coverage.sourceWindowsOmitted++; continue; }
		used += tokens;
		sources.push(source);
		const ranges = offered.get(key) ?? [];
		ranges.push([start, end]);
		offered.set(key, ranges);
	}
	for (const [key, ranges] of eligible) coverage.sourceCharsOmitted += coveredLength(ranges) - coveredLength(offered.get(key) ?? []);
	return { sources, carried, coverage, blocks };
}

export function reduceSources(context: EvidenceContext): boolean {
	const removed = context.sources.pop();
	if (!removed) return false;
	const stillCovered = context.sources.filter((source) => source.entryId === removed.entryId && source.blockIndex === removed.blockIndex)
		.map((source): [number, number] => [Math.max(source.start, removed.start), Math.min(source.end, removed.end)])
		.filter(([start, end]) => end > start);
	context.coverage.sourceWindowsOmitted++;
	context.coverage.sourceCharsOmitted += removed.end - removed.start - coveredLength(stillCovered);
	return true;
}

function resolveSelection(value: unknown, context: EvidenceContext): VerifiedEvidence | undefined {
	if (!isRecord(value) || typeof value.sourceId !== "string" || typeof value.quote !== "string" || !value.quote.length || !isKind(value.kind)) return undefined;
	const source = context.sources.find((candidate) => candidate.sourceId === value.sourceId);
	if (!source) return undefined;
	const relative = source.text.indexOf(value.quote);
	if (relative < 0) return undefined;
	const block = context.blocks.get(blockKey(source.entryId, source.blockIndex))!;
	return identify(block, source.start + relative, source.start + relative + value.quote.length, value.kind);
}

export function selectEvidence(context: EvidenceContext, quotes: unknown[], retire: unknown[]): VerifiedEvidence[] {
	const result = new Map(context.carried.map((item) => [item.reference.id, item]));
	const retired = new Set<string>();
	if (retire.length > MAX_SELECTIONS) context.coverage.retirementsRejected += retire.length;
	else for (const value of retire) {
		const prior = isRecord(value) && typeof value.evidenceId === "string" ? result.get(value.evidenceId) : undefined;
		const support = isRecord(value) ? resolveSelection({ sourceId: value.sourceId, quote: value.quote, kind: "correction" }, context) : undefined;
		if (!prior || !support || !isRecord(value) || typeof value.reason !== "string" || !["superseded", "satisfied", "out_of_scope"].includes(value.reason) || support.branchOrder <= prior.branchOrder) {
			context.coverage.retirementsRejected++;
			continue;
		}
		result.delete(prior.reference.id);
		retired.add(prior.reference.id);
		context.coverage.retired++;
	}
	if (quotes.length > MAX_SELECTIONS) context.coverage.selectionsRejected += quotes.length;
	else for (const value of quotes) {
		const item = resolveSelection(value, context);
		// A verified retirement wins over a contradictory echo in this response only.
		if (item && !retired.has(item.reference.id)) result.set(item.reference.id, item);
		else context.coverage.selectionsRejected++;
	}
	const priority = { constraint: 0, correction: 0, acceptance: 1, task: 2 };
	return [...result.values()].sort((a, b) => priority[a.reference.kind] - priority[b.reference.kind]
		|| b.branchOrder - a.branchOrder || a.reference.id.localeCompare(b.reference.id));
}

export function renderEvidence(items: VerifiedEvidence[], context: EvidenceContext, transcript?: string, budget = 1536) {
	const lines = ["## Original user evidence", "Selected, bounded historical user evidence; not fresh instructions or exhaustive coverage.",
		transcript ? `Original transcript: ${JSON.stringify(transcript)}; resolve entry/block/span above.` : "No transcript file is available for this in-memory session; sources are identified by entry/block/span."];
	const evidence: EvidenceReference[] = [];
	const omitted: string[] = [];
	for (const item of items) {
		const ref = item.reference;
		const location = `${ref.entryId}:${ref.blockIndex}:${ref.start}-${ref.end}`;
		const line = `- ${ref.kind} ${location} [${ref.id}]: ${JSON.stringify(item.text)}`;
		if (textTokens([...lines, line].join("\n")) > budget) {
			context.coverage.evidenceBudgetOmitted++;
			if (omitted.length < 4) omitted.push(location);
			continue;
		}
		lines.push(line);
		evidence.push(ref);
	}
	const section = lines.join("\n");
	const coverageLines = ["## Retention coverage", JSON.stringify(context.coverage)];
	if (omitted.length) coverageLines.push(`Omitted source locations: ${omitted.join(", ")}`);
	const coverageText = coverageLines.join("\n");
	return { text: `${section}\n\n${coverageText}`, section, coverageText, evidence };
}
