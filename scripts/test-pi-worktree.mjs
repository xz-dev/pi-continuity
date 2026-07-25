#!/usr/bin/env node
import { existsSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const baseline = "8a4bac2faf646c77206fb03d465afe914a0db96d";
const transparentHead = "29b293a05459289d12a1e335e6717b2c3f2b445a";
const defaultRepo = "/home/xz/Code/ai/pi-worktrees/patch-tmp-6492";
const piRepo = process.env.PI_REPO ?? defaultRepo;

function fail(message) {
	console.error(`test:pi-worktree: ${message}`);
	process.exit(2);
}
function git(args) {
	return spawnSync("git", ["-C", piRepo, ...args], { encoding: "utf8" });
}

if (!isAbsolute(piRepo)) fail(`PI_REPO must be absolute, got ${JSON.stringify(piRepo)}`);
if (!existsSync(piRepo) || !statSync(piRepo).isDirectory()) fail(`PI_REPO is not a directory: ${piRepo}`);
if (git(["rev-parse", "--is-inside-work-tree"]).stdout.trim() !== "true") fail(`PI_REPO is not a Git worktree: ${piRepo}`);

const required = [
	"packages/ai/src/index.ts",
	"packages/agent/src/index.ts",
	"packages/coding-agent/src/index.ts",
	"packages/tui/src/index.ts",
	"packages/coding-agent/test/suite/harness.ts",
	"packages/coding-agent/node_modules/vitest/vitest.mjs",
];
for (const relative of required) {
	if (!existsSync(resolve(piRepo, relative))) fail(`required Pi source/harness/runtime is missing: ${relative}`);
}

const baselineCheck = git(["merge-base", "--is-ancestor", baseline, "HEAD"]);
if (baselineCheck.status !== 0) fail(`Pi HEAD must descend from baseline ${baseline}; found ${git(["rev-parse", "HEAD"]).stdout.trim()}`);
const head = git(["rev-parse", "HEAD"]).stdout.trim();
const transparentCheck = git(["merge-base", "--is-ancestor", transparentHead, "HEAD"]);
if (transparentCheck.status !== 0) {
	console.error(`test:pi-worktree: warning: ${piRepo} at ${head} does not contain transparent-compaction head ${transparentHead}; lifecycle tests may fail until Tasks 1-6 are integrated`);
}

const child = spawn(process.execPath, [
	resolve(piRepo, "packages/coding-agent/node_modules/vitest/vitest.mjs"),
	"--config",
	resolve("tests/pi-worktree.vitest.config.ts"),
	"--run",
	resolve("tests/pi-worktree-integration.test.ts"),
], {
	stdio: "inherit",
	env: { ...process.env, PI_REPO: piRepo },
});
child.on("error", (error) => fail(`failed to start Pi Vitest: ${error.message}`));
child.on("exit", (code, signal) => {
	if (signal) process.kill(process.pid, signal);
	process.exit(code ?? 1);
});
