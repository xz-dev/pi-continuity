import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { arch, homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const requiredNode = [22, 19, 0];
const hostBuildRecipeVersion = "2";
const buildMarker = ".pi-continuity-host-e2e-built-v1";
const buildManifest = ".pi-continuity-host-e2e-build-v1.json";
const requiredOutputs = [
	"packages/tui/dist/index.js",
	"packages/ai/dist/index.js",
	"packages/ai/dist/compat.js",
	"packages/agent/dist/index.js",
	"packages/agent/dist/node.js",
	"packages/coding-agent/dist/index.js",
];
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function assertSupportedNode() {
	const actual = process.versions.node.split(".").map(Number);
	const firstDifference = actual.findIndex((part, index) => part !== requiredNode[index]);
	const supported = firstDifference === -1 || actual[firstDifference] > requiredNode[firstDifference];
	assert(supported, `Node >=${requiredNode.join(".")} is required; found ${process.versions.node}`);
}

async function run(command, args, options = {}) {
	const startedAt = performance.now();
	console.log(`$ ${command} ${args.join(" ")}`);
	const result = await execFileAsync(command, args, {
		...options,
		maxBuffer: 16 * 1024 * 1024,
	});
	if (result.stdout?.trim()) console.log(result.stdout.trim());
	if (result.stderr?.trim()) console.error(result.stderr.trim());
	console.log(`  completed in ${((performance.now() - startedAt) / 1000).toFixed(1)}s`);
	return result.stdout;
}

async function resolveMain(source) {
	const output = await run("git", ["ls-remote", "--refs", source, "refs/heads/main"]);
	const matches = output.trim().split(/\s+/);
	assert.match(matches[0] ?? "", /^[0-9a-f]{40}$/, `Could not resolve refs/heads/main from ${source}`);
	return matches[0];
}

async function canonicalSource(source) {
	let candidate = source.trim().replace(/^git\+/, "").replace(/\/$/, "");
	const scp = candidate.match(/^(?:[^@/]+@)?([^:/]+):(.+)$/);
	if (scp && !candidate.includes("://")) candidate = `ssh://${scp[1]}/${scp[2]}`;

	try {
		const url = new URL(candidate);
		if (url.protocol === "file:") return `file://${await realpath(fileURLToPath(url))}`;
		const pathname = url.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
		return `${url.hostname.toLowerCase()}${url.port ? `:${url.port}` : ""}/${pathname}`;
	} catch {
		return `file://${await realpath(resolve(candidate))}`;
	}
}

async function capture(command, args) {
	const { stdout } = await execFileAsync(command, args, { maxBuffer: 1024 * 1024 });
	return stdout.trim();
}

function expectedManifest(source, sha) {
	return {
		schemaVersion: 1,
		recipeVersion: hostBuildRecipeVersion,
		source,
		sha,
		nodeMajor: Number(process.versions.node.split(".")[0]),
		platform: platform(),
		arch: arch(),
		requiredOutputs,
	};
}

async function inspectHostCache(hostRoot, expected) {
	try {
		const root = await stat(hostRoot);
		if (!root.isDirectory()) return { exists: true, valid: false, reason: "cache entry is not a directory" };
	} catch (error) {
		if (error?.code === "ENOENT") return { exists: false, valid: false, reason: "cache entry is absent" };
		return { exists: true, valid: false, reason: `cannot inspect cache entry: ${error.message}` };
	}

	try {
		assert.equal((await readFile(join(hostRoot, buildMarker), "utf8")).trim(), expected.sha, "build marker SHA differs");
		const manifest = JSON.parse(await readFile(join(hostRoot, buildManifest), "utf8"));
		assert.deepEqual(manifest, expected, "build manifest differs from the current recipe");
		assert.equal(await capture("git", ["-C", hostRoot, "rev-parse", "HEAD"]), expected.sha, "repository HEAD differs");
		const origin = await canonicalSource(await capture("git", ["-C", hostRoot, "remote", "get-url", "origin"]));
		assert.equal(origin, expected.source, "repository origin differs");
		assert.equal(
			await capture("git", ["-C", hostRoot, "status", "--porcelain=v1", "--untracked-files=no", "--ignore-submodules=none"]),
			"",
			"tracked repository tree is dirty",
		);
		for (const output of requiredOutputs) {
			assert((await stat(join(hostRoot, output))).isFile(), `required build output is not a file: ${output}`);
		}
		return { exists: true, valid: true };
	} catch (error) {
		return { exists: true, valid: false, reason: error.message };
	}
}

async function quarantineInvalidCache(hostRoot, label, reason) {
	const quarantine = `${hostRoot}.invalid-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
	try {
		await rename(hostRoot, quarantine);
	} catch (error) {
		if (error?.code === "ENOENT") return false;
		if (["EEXIST", "ENOTEMPTY"].includes(error?.code)) return false;
		throw error;
	}
	console.warn(`[${label}] quarantined invalid host cache (${reason})`);
	await rm(quarantine, { recursive: true, force: true });
	return true;
}

async function publishHost(staging, hostRoot, expected, label) {
	while (true) {
		const winner = await inspectHostCache(hostRoot, expected);
		if (winner.valid) {
			console.log(`[${label}] another process published the host cache first`);
			await rm(staging, { recursive: true, force: true });
			return hostRoot;
		}
		if (winner.exists) {
			const quarantined = await quarantineInvalidCache(hostRoot, label, winner.reason);
			if (!quarantined) await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
			continue;
		}

		try {
			// POSIX rename cannot replace an unknown non-empty directory. If a concurrent
			// publisher creates the target, validate that winner on the next iteration.
			await rename(staging, hostRoot);
			return hostRoot;
		} catch (error) {
			if (["EEXIST", "ENOTEMPTY", "EISDIR", "ENOTDIR"].includes(error?.code)) continue;
			throw error;
		}
	}
}

/** @internal Test coverage imports this one seam to exercise the real cache lifecycle. */
export async function prepareHost({ source, label, sha, cacheRoot }) {
	assert.match(sha, /^[0-9a-f]{40}$/, `${label} host SHA must be exact`);
	const sourceIdentity = await canonicalSource(source);
	const expected = expectedManifest(sourceIdentity, sha);
	const hostKey = label.replaceAll("/", "--");
	const environmentKey = `recipe-${hostBuildRecipeVersion}-node-${expected.nodeMajor}-${expected.platform}-${expected.arch}`;
	const hostRoot = join(cacheRoot, "hosts", hostKey, environmentKey, sha);
	const cached = await inspectHostCache(hostRoot, expected);
	if (cached.valid) {
		console.log(`[${label}] reusing validated host cache ${hostRoot}`);
		return hostRoot;
	}
	if (cached.exists) await quarantineInvalidCache(hostRoot, label, cached.reason);

	await mkdir(dirname(hostRoot), { recursive: true });
	const staging = await mkdtemp(join(dirname(hostRoot), `.${sha}.building-`));
	try {
		await run("git", ["init", staging]);
		await run("git", ["-C", staging, "remote", "add", "origin", source]);
		await run("git", ["-C", staging, "fetch", "--depth=1", "origin", sha]);
		await run("git", ["-C", staging, "checkout", "--detach", "FETCH_HEAD"]);
		const checkedOutSha = (await run("git", ["-C", staging, "rev-parse", "HEAD"])).trim();
		assert.equal(checkedOutSha, sha, `${label} checkout moved from the initially resolved SHA`);

		const env = { ...process.env, PI_OFFLINE: "1" };
		await run("npm", ["--prefix", staging, "ci", "--ignore-scripts"], { env });
		// Generated model data is gitignored. Hydrate it explicitly, then use the host's
		// offline AI build so compilation itself cannot refresh provider catalogs.
		await run("npm", ["--prefix", staging, "run", "hydrate:model-data"], { env });
		await run("npm", ["--prefix", join(staging, "packages/tui"), "run", "build"], { env });
		await run("npm", ["--prefix", join(staging, "packages/ai"), "run", "build:offline"], { env });
		await run("npm", ["--prefix", join(staging, "packages/agent"), "run", "build"], { env });
		await run("npm", ["--prefix", join(staging, "packages/coding-agent"), "run", "build"], { env });
		await writeFile(join(staging, buildMarker), `${sha}\n`);
		await writeFile(join(staging, buildManifest), `${JSON.stringify(expected, null, 2)}\n`);
		const built = await inspectHostCache(staging, expected);
		assert(built.valid, `${label} produced an invalid host cache: ${built.reason}`);
		return await publishHost(staging, hostRoot, expected, label);
	} catch (error) {
		await rm(staging, { recursive: true, force: true });
		throw error;
	}
}

async function packContinuity(workRoot) {
	const packDir = join(workRoot, "pack");
	await mkdir(packDir, { recursive: true });
	const output = await run("npm", ["pack", "--json", "--pack-destination", packDir], { cwd: packageRoot });
	const packed = JSON.parse(output);
	assert.equal(packed.length, 1, "npm pack must produce exactly one artifact");
	const tarball = join(packDir, packed[0].filename);
	const extractedRoot = join(workRoot, "plugin");
	await mkdir(extractedRoot, { recursive: true });
	await run("tar", ["-xzf", tarball, "-C", extractedRoot]);
	return join(extractedRoot, "package");
}

async function linkHostPeers(pluginRoot, hostRoot) {
	const scope = join(pluginRoot, "node_modules", "@earendil-works");
	await mkdir(scope, { recursive: true });
	await symlink(join(hostRoot, "packages/ai"), join(scope, "pi-ai"), "dir");
	await symlink(join(hostRoot, "packages/coding-agent"), join(scope, "pi-coding-agent"), "dir");
}

function createNotifier(notifications) {
	return new Proxy(
		{
			notify(message, type = "info") {
				notifications.push({ message, type });
			},
		},
		{
			get(target, property) {
				if (property in target) return target[property];
				return () => {
					throw new Error(`Unexpected ExtensionUIContext call: ${String(property)}`);
				};
			},
		},
	);
}

async function exerciseLifecycle({ hostRoot, pluginRoot, workRoot, label, sha }) {
	const ai = await import(pathToFileURL(join(hostRoot, "packages/ai/dist/compat.js")));
	const codingAgent = await import(pathToFileURL(join(hostRoot, "packages/coding-agent/dist/index.js")));
	const { fauxAssistantMessage, registerFauxProvider } = ai;
	const { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } = codingAgent;

	for (const [name, value] of Object.entries({
		fauxAssistantMessage,
		registerFauxProvider,
		createAgentSession,
		DefaultResourceLoader,
		ModelRuntime,
		SessionManager,
		SettingsManager,
	})) {
		assert(value, `${label} does not export required public API ${name}`);
	}

	const project = join(workRoot, "project");
	const agentDir = join(workRoot, "agent");
	const sessionDir = join(workRoot, "sessions");
	await mkdir(join(project, ".pi"), { recursive: true });
	await mkdir(agentDir, { recursive: true });
	await writeFile(
		join(project, ".pi/settings.json"),
		JSON.stringify(
			{
				packages: [pluginRoot],
				compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 0 },
			},
			null,
			2,
		),
	);

	const settingsManager = SettingsManager.create(project, agentDir);
	const resourceLoader = new DefaultResourceLoader({
		cwd: project,
		agentDir,
		settingsManager,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await resourceLoader.reload();
	const loaded = resourceLoader.getExtensions();
	assert.deepEqual(loaded.errors, [], `${label} failed to load the packed extension`);
	assert.equal(loaded.extensions.length, 1, `${label} must discover exactly one extension`);
	assert.equal(
		resolve(loaded.extensions[0].resolvedPath),
		resolve(pluginRoot, "extensions/continuity.ts"),
		`${label} must discover continuity.ts through package.json pi.extensions`,
	);

	const faux = registerFauxProvider();
	let session;
	try {
		faux.setResponses([
			fauxAssistantMessage(
				JSON.stringify({
					task: "Verify pi-continuity on both current Pi hosts",
					doneWhen: "The committed checkpoint is visible through /continuity status",
					forbid: ["Do not call a paid or network model provider"],
					status: "active",
					established: ["The package manifest loaded the continuity extension"],
					open: [],
					next: ["Report the exact tested host SHA"],
				}),
			),
		]);

		const modelRuntime = await ModelRuntime.create({ modelsPath: null, allowModelNetwork: false });
		await modelRuntime.setRuntimeApiKey(faux.getModel().provider, "host-e2e-faux-key", { allowNetwork: false });
		const sessionManager = SessionManager.create(project, sessionDir);
		({ session } = await createAgentSession({
			cwd: project,
			agentDir,
			model: faux.getModel(),
			modelRuntime,
			resourceLoader,
			sessionManager,
			settingsManager,
			noTools: "all",
		}));

		const notifications = [];
		await session.bindExtensions({ uiContext: createNotifier(notifications) });
		await session.prompt("/continuity status");
		assert(
			notifications.some(({ message }) => message.includes("Continuity: no valid checkpoint is present")),
			`${label} must report no checkpoint before compaction`,
		);
		assert.equal(faux.state.callCount, 0, "status before compaction must not call the provider");

		const now = Date.now();
		sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "Implement and verify explicit host compatibility E2E coverage." }],
			timestamp: now - 1000,
		});
		const assistant = fauxAssistantMessage("The host-neutral implementation is ready for lifecycle verification.", {
			timestamp: now - 500,
		});
		assistant.usage = {
			input: 100,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 100,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		};
		sessionManager.appendMessage(assistant);
		session.agent.state.messages = sessionManager.buildSessionContext().messages;

		const compaction = await session.compact();
		assert.equal(faux.state.callCount, 1, "real compaction must make exactly one faux provider call");
		assert.equal(faux.getPendingResponseCount(), 0, "the deterministic faux response must be consumed");
		assert(compaction.summary.includes("Verify pi-continuity on both current Pi hosts"));

		const sessionFile = sessionManager.getSessionFile();
		assert(sessionFile, "persistent SessionManager must expose its JSONL file");
		const entries = (await readFile(sessionFile, "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		const compactions = entries.filter((entry) => entry.type === "compaction");
		assert.equal(compactions.length, 1, "JSONL must persist exactly one standard compaction entry");
		assert.equal(compactions[0].details?.schema, "pi.continuity.checkpoint");
		assert.equal(compactions[0].details?.effective?.task, "Verify pi-continuity on both current Pi hosts");
		assert.equal("projection" in compactions[0], false, "host E2E must not restore retired projection behavior");

		await session.prompt("/continuity status");
		assert(
			notifications.some(({ message }) => message.includes("## Task") && message.includes("Verify pi-continuity on both current Pi hosts")),
			`${label} must rebuild status from the committed session_compact lifecycle`,
		);
		assert.equal(faux.state.callCount, 1, "status after compaction must not call the provider");
		console.log(`[${label}] PASS at ${sha}: package discovery, persisted compaction, committed status, faux-only provider`);
	} finally {
		session?.dispose();
		faux.unregister();
	}
}

export async function runPiContinuityHostE2E({ source, label }) {
	assertSupportedNode();
	const startedAt = performance.now();
	const cacheRoot = join(homedir(), ".cache", "pi-continuity-e2e");
	await mkdir(cacheRoot, { recursive: true });
	const workRoot = await mkdtemp(join(cacheRoot, "run-"));
	try {
		const configuredRecipe = process.env.E2E_HOST_CACHE_RECIPE;
		assert(
			!configuredRecipe || configuredRecipe === hostBuildRecipeVersion,
			`E2E_HOST_CACHE_RECIPE must be ${hostBuildRecipeVersion}; found ${configuredRecipe}`,
		);
		const providedSha = process.env.E2E_HOST_SHA?.trim();
		if (providedSha) assert.match(providedSha, /^[0-9a-f]{40}$/, "E2E_HOST_SHA must be an exact 40-character SHA");
		const sha = providedSha || (await resolveMain(source));
		console.log(
			providedSha ? `[${label}] using pre-resolved host SHA ${sha}` : `[${label}] resolved refs/heads/main to ${sha}`,
		);
		const hostRoot = await prepareHost({ source, label, sha, cacheRoot });
		const pluginRoot = await packContinuity(workRoot);
		await linkHostPeers(pluginRoot, hostRoot);
		await exerciseLifecycle({ hostRoot, pluginRoot, workRoot, label, sha });
		console.log(`[${label}] total duration ${((performance.now() - startedAt) / 1000).toFixed(1)}s`);
		return sha;
	} finally {
		await rm(workRoot, { recursive: true, force: true });
	}
}
