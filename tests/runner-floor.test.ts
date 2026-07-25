import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const FLOOR = "0f979e9eef5a160fcae3c07cd14591d8ab15f70c";
const temporaryDirectories: string[] = [];

afterEach(() => {
	while (temporaryDirectories.length > 0) rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
});

describe("Pi worktree compatibility runner", () => {
	it("fails closed before typecheck or Vitest when Pi predates the implementation floor", () => {
		const olderRepo = mkdtempSync(join(tmpdir(), "pi-continuity-older-pi-"));
		temporaryDirectories.push(olderRepo);
		execFileSync("git", ["init", "--quiet", olderRepo]);
		writeFileSync(join(olderRepo, "README.md"), "older Pi fixture\n");
		execFileSync("git", ["-C", olderRepo, "add", "README.md"]);
		execFileSync("git", [
			"-C",
			olderRepo,
			"-c",
			"user.name=Pi Continuity Test",
			"-c",
			"user.email=pi-continuity@example.invalid",
			"commit",
			"--quiet",
			"--no-gpg-sign",
			"-m",
			"older fixture",
		]);

		const result = spawnSync(process.execPath, [resolve("scripts/test-pi-worktree.mjs")], {
			cwd: resolve("."),
			encoding: "utf8",
			env: { ...process.env, PI_REPO: olderRepo, NODE_DEBUG: "child_process" },
		});
		const output = `${result.stdout}${result.stderr}`;

		expect(result.status).not.toBe(0);
		expect(output).toContain(
			`Pi HEAD must contain implementation commit ${FLOOR} or a descendant/downstream patch`,
		);
		expect(output).not.toMatch(/node_modules\/typescript\/bin\/tsc|pi-worktree\.vitest\.config|vitest\.mjs/u);
	});
});
