import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { piVitestCandidates, resolvePiVitest } from "../scripts/pi-worktree-paths.mjs";

const PACKAGE_LOCAL = join("packages", "coding-agent", "node_modules", "vitest", "vitest.mjs");
const ROOT_HOISTED = join("node_modules", "vitest", "vitest.mjs");
const temporaryDirectories: string[] = [];

afterEach(() => {
	while (temporaryDirectories.length > 0) rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
});

function fakePiRepo(): string {
	const directory = mkdtempSync(join(tmpdir(), "pi-continuity-vitest-layout-"));
	temporaryDirectories.push(directory);
	return directory;
}

function placeVitest(piRepo: string, relative: string): string {
	const target = join(piRepo, relative);
	mkdirSync(join(target, ".."), { recursive: true });
	writeFileSync(target, "// fake Pi Vitest entry\n");
	return target;
}

describe("Pi worktree Vitest resolution", () => {
	it("lists the package-local install before the root-hoisted install", () => {
		const piRepo = fakePiRepo();
		expect(piVitestCandidates(piRepo)).toEqual([join(piRepo, PACKAGE_LOCAL), join(piRepo, ROOT_HOISTED)]);
	});

	it("prefers the package-local install when both layouts exist", () => {
		const piRepo = fakePiRepo();
		placeVitest(piRepo, PACKAGE_LOCAL);
		placeVitest(piRepo, ROOT_HOISTED);
		expect(resolvePiVitest(piRepo)).toBe(join(piRepo, PACKAGE_LOCAL));
	});

	it("accepts a root-hoisted install without a package-local install", () => {
		const piRepo = fakePiRepo();
		placeVitest(piRepo, ROOT_HOISTED);
		expect(resolvePiVitest(piRepo)).toBe(join(piRepo, ROOT_HOISTED));
	});

	it("throws a precise error listing both candidates when neither layout exists", () => {
		const piRepo = fakePiRepo();
		expect(() => resolvePiVitest(piRepo)).toThrow(
			`no Pi Vitest found; tried: ${join(piRepo, PACKAGE_LOCAL)}, ${join(piRepo, ROOT_HOISTED)}`,
		);
	});

	it("ignores candidates that are not regular files", () => {
		const piRepo = fakePiRepo();
		mkdirSync(join(piRepo, PACKAGE_LOCAL), { recursive: true });
		placeVitest(piRepo, ROOT_HOISTED);
		expect(resolvePiVitest(piRepo)).toBe(join(piRepo, ROOT_HOISTED));
	});

	it("the runner resolves and spawns the chosen Vitest entry without a hardcoded layout", () => {
		const runner = resolve("scripts/test-pi-worktree.mjs");
		const source = readFileSync(runner, "utf8") as string;
		expect(source).toContain('from "./pi-worktree-paths.mjs"');
		expect(source).toContain("resolvePiVitest(piRepo)");
		expect(source).not.toContain('"packages/coding-agent/node_modules/vitest/vitest.mjs"');
	});
});
