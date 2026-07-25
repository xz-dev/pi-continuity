#!/usr/bin/env node
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

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

const integrationTest = resolve("tests/pi-worktree-integration.test.ts");
const temporaryDirectory = mkdtempSync(join(tmpdir(), "pi-continuity-typecheck-"));
let typecheckFailure;
try {
	const typecheckConfig = join(temporaryDirectory, "tsconfig.json");
	const ambientTypes = join(temporaryDirectory, "ambient.d.ts");
	writeFileSync(ambientTypes, 'declare module "highlight.js/lib/index.js";\n');
	const piConfig = JSON.parse(readFileSync(resolve(piRepo, "tsconfig.json"), "utf8"));
	const piPaths = piConfig.compilerOptions?.paths ?? {};
	const paths = Object.fromEntries(Object.entries(piPaths).map(([name, targets]) => [
		name,
		Array.isArray(targets)
			? targets.map((target) => resolve(piRepo, target.includes("/src/*") ? target.replace(/\*$/, "*.ts") : target))
			: targets,
	]));
	paths["pi-test-harness"] = [resolve(piRepo, "packages/coding-agent/test/suite/harness.ts")];
	paths["pi-test-utilities"] = [resolve(piRepo, "packages/coding-agent/test/utilities.ts")];
	writeFileSync(typecheckConfig, JSON.stringify({
		extends: resolve(piRepo, "tsconfig.json"),
		compilerOptions: {
			target: "ES2024",
			noEmit: true,
			strict: true,
			noImplicitAny: true,
			baseUrl: process.cwd(),
			typeRoots: [resolve("node_modules/@types"), resolve(piRepo, "node_modules/@types")],
			paths,
		},
		files: [ambientTypes, integrationTest],
		include: [],
		exclude: [],
	}, null, 2));
	const typecheck = spawnSync(process.execPath, [resolve("node_modules/typescript/bin/tsc"), "-p", typecheckConfig], {
		stdio: "inherit",
	});
	if (typecheck.error) typecheckFailure = `failed to start integration typecheck: ${typecheck.error.message}`;
	else if (typecheck.signal) typecheckFailure = `integration typecheck terminated by ${typecheck.signal}`;
	else if (typecheck.status !== 0) typecheckFailure = `integration typecheck exited with status ${typecheck.status ?? 1}`;
} catch (error) {
	typecheckFailure = `integration typecheck setup failed: ${error instanceof Error ? error.message : String(error)}`;
} finally {
	rmSync(temporaryDirectory, { recursive: true, force: true });
}
if (typecheckFailure) fail(typecheckFailure);

const vitest = spawnSync(process.execPath, [
	resolve(piRepo, "packages/coding-agent/node_modules/vitest/vitest.mjs"),
	"--config",
	resolve("tests/pi-worktree.vitest.config.ts"),
	"--run",
	integrationTest,
], {
	stdio: "inherit",
	env: { ...process.env, PI_REPO: piRepo },
});
if (vitest.error) fail(`failed to start Pi Vitest: ${vitest.error.message}`);
if (vitest.signal) process.kill(process.pid, vitest.signal);
process.exit(vitest.status ?? 1);
