import { statSync } from "node:fs";
import { join } from "node:path";

/**
 * Vitest entry candidates for a Pi Git worktree, in deterministic preference
 * order: package-local install first, then the root-hoisted install.
 * @param {string} piRepo absolute Pi worktree path
 * @returns {string[]} candidate vitest.mjs paths
 */
export function piVitestCandidates(piRepo) {
	return [
		join(piRepo, "packages/coding-agent/node_modules/vitest/vitest.mjs"),
		join(piRepo, "node_modules/vitest/vitest.mjs"),
	];
}

/**
 * @param {string} piRepo absolute Pi worktree path
 * @returns {string | undefined} vitest.mjs path when it is a regular file
 */
function existingPiVitest(piRepo) {
	for (const candidate of piVitestCandidates(piRepo)) {
		try {
			if (statSync(candidate).isFile()) return candidate;
		} catch {
			// Candidate does not exist; try the next layout.
		}
	}
	return undefined;
}

/**
 * Resolve the Vitest entry inside a Pi worktree, preferring a package-local
 * install over the root-hoisted one. Only regular files qualify.
 * @param {string} piRepo absolute Pi worktree path
 * @returns {string} chosen vitest.mjs path
 * @throws {Error} when neither candidate exists, listing both candidates
 */
export function resolvePiVitest(piRepo) {
	const resolved = existingPiVitest(piRepo);
	if (resolved) return resolved;
	throw new Error(`no Pi Vitest found; tried: ${piVitestCandidates(piRepo).join(", ")}`);
}
