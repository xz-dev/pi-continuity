import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { prepareHost } from "../scripts/lib/run-pi-continuity-host-e2e.mjs";

const execFileAsync = promisify(execFile);
const fixtures: string[] = [];
const buildCounterRoot = join(tmpdir(), "pi-continuity-host-cache-counters");

async function run(command: string, args: string[], cwd?: string) {
	return execFileAsync(command, args, { cwd, env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" } });
}

async function createHostFixture() {
	const root = await mkdtemp(join(tmpdir(), "pi-continuity-host-cache-"));
	const counters = await mkdtemp(`${buildCounterRoot}-`);
	fixtures.push(root, counters);
	const source = join(root, "source");
	await mkdir(join(source, "scripts"), { recursive: true });
	await writeFile(
		join(source, "package.json"),
		JSON.stringify({
			name: "fake-pi-host",
			version: "1.0.0",
			scripts: { "hydrate:model-data": "node scripts/output.mjs hydrate" },
		}),
	);
	await writeFile(join(source, "package-lock.json"), JSON.stringify({ name: "fake-pi-host", version: "1.0.0", lockfileVersion: 3, packages: { "": { name: "fake-pi-host", version: "1.0.0" } } }));
	await writeFile(
		join(source, "scripts/output.mjs"),
		`import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
const command = process.argv[2];
const outputs = {
  hydrate: ["hydrate-count", []],
  tui: ["tui-build-count", ["packages/tui/dist/index.js"]],
  ai: ["ai-build-count", ["packages/ai/dist/index.js", "packages/ai/dist/compat.js"]],
  agent: ["agent-build-count", ["packages/agent/dist/index.js", "packages/agent/dist/node.js"]],
  coding: ["coding-build-count", ["packages/coding-agent/dist/index.js"]],
};
const [counter, files] = outputs[command];
await appendFile(resolve(process.env.E2E_FIXTURE_COUNTER_ROOT, counter), "1\\n");
for (const file of files) { await mkdir(resolve(root, file, ".."), { recursive: true }); await writeFile(resolve(root, file), "export {};\\n"); }
`,
	);
	for (const [name, command] of [
		["tui", "tui"],
		["ai", "ai"],
		["agent", "agent"],
		["coding-agent", "coding"],
	] as const) {
		await mkdir(join(source, "packages", name), { recursive: true });
		await writeFile(
			join(source, "packages", name, "package.json"),
			JSON.stringify({ name, version: "1.0.0", scripts: { build: `node ../../scripts/output.mjs ${command}`, "build:offline": `node ../../scripts/output.mjs ${command}` } }),
		);
	}
	await run("git", ["init", "-b", "main"], source);
	await run("git", ["config", "user.name", "Cache Test"], source);
	await run("git", ["config", "user.email", "cache@example.test"], source);
	await run("git", ["add", "."], source);
	await run("git", ["commit", "-m", "fixture"], source);
	const { stdout } = await run("git", ["rev-parse", "HEAD"], source);
	return { root, counters, source, sha: stdout.trim(), cacheRoot: join(root, "cache") };
}

async function countBuilds(root: string) {
	try {
		return (await readFile(join(root, "coding-build-count"), "utf8")).trim().split("\n").length;
	} catch {
		return 0;
	}
}

afterEach(async () => {
	await Promise.all(fixtures.splice(0).map((fixture) => rm(fixture, { recursive: true, force: true })));
});

describe("host E2E build cache", () => {
	it("rejects matching markers with a wrong HEAD or missing output and self-heals offline", async () => {
		const fixture = await createHostFixture();
		const originalCounterRoot = process.env.E2E_FIXTURE_COUNTER_ROOT;
		process.env.E2E_FIXTURE_COUNTER_ROOT = fixture.counters;
		try {
			const options = { source: fixture.source, label: "fixture/pi", sha: fixture.sha, cacheRoot: fixture.cacheRoot };
			const hostRoot = await prepareHost(options);
			expect(await countBuilds(fixture.counters)).toBe(1);

			const manifestPath = join(hostRoot, ".pi-continuity-host-e2e-build-v1.json");
			const matchingManifest = await readFile(manifestPath, "utf8");
			await run(
				"git",
				[
					"-c", "user.name=Cache Test",
					"-c", "user.email=cache@example.test",
					"commit", "--allow-empty", "-m", "wrong head",
				],
				hostRoot,
			);
			const wrongHead = (await run("git", ["rev-parse", "HEAD"], hostRoot)).stdout.trim();
			assert.notEqual(wrongHead, fixture.sha);
			const repairedHead = await prepareHost(options);
			expect((await run("git", ["rev-parse", "HEAD"], repairedHead)).stdout.trim()).toBe(fixture.sha);
			expect(await readFile(join(repairedHead, ".pi-continuity-host-e2e-build-v1.json"), "utf8")).toBe(matchingManifest);
			expect(await countBuilds(fixture.counters)).toBe(2);

			await rm(join(repairedHead, "packages/ai/dist/compat.js"));
			const repairedOutput = await prepareHost(options);
			expect(await readFile(join(repairedOutput, "packages/ai/dist/compat.js"), "utf8")).toContain("export");
			expect(await countBuilds(fixture.counters)).toBe(3);
		} finally {
			if (originalCounterRoot === undefined) delete process.env.E2E_FIXTURE_COUNTER_ROOT;
			else process.env.E2E_FIXTURE_COUNTER_ROOT = originalCounterRoot;
		}
	}, 20_000);

	it("accepts one validated winner when concurrent builders publish the same entry", async () => {
		const fixture = await createHostFixture();
		const originalCounterRoot = process.env.E2E_FIXTURE_COUNTER_ROOT;
		process.env.E2E_FIXTURE_COUNTER_ROOT = fixture.counters;
		try {
			const options = { source: fixture.source, label: "fixture/pi", sha: fixture.sha, cacheRoot: fixture.cacheRoot };
			const [first, second] = await Promise.all([prepareHost(options), prepareHost(options)]);
			expect(second).toBe(first);
			expect((await run("git", ["rev-parse", "HEAD"], first)).stdout.trim()).toBe(fixture.sha);
			expect(await readFile(join(first, "packages/coding-agent/dist/index.js"), "utf8")).toContain("export");
			expect(await countBuilds(fixture.counters)).toBe(2);
		} finally {
			if (originalCounterRoot === undefined) delete process.env.E2E_FIXTURE_COUNTER_ROOT;
			else process.env.E2E_FIXTURE_COUNTER_ROOT = originalCounterRoot;
		}
	});
});
