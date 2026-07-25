/**
 * Pi worktree Vitest entry candidates in deterministic preference order.
 * @param piRepo absolute Pi worktree path
 */
export declare function piVitestCandidates(piRepo: string): string[];

/**
 * Resolve the Vitest entry inside a Pi worktree, preferring the package-local
 * install over the root-hoisted one. Only regular files qualify.
 * @param piRepo absolute Pi worktree path
 * @throws {Error} when neither candidate exists, listing both candidates
 */
export declare function resolvePiVitest(piRepo: string): string;
