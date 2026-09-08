import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { arch, homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const requiredNode = [22, 19, 0];
const hostBuildRecipeVersion = "4";
const buildMarker = ".pi-continuity-host-e2e-built-v1";
const buildManifest = ".pi-continuity-host-e2e-build-v1.json";
const requiredOutputs = [
	"packages/chord/dist/index.js",
	"packages/chord/dist/context/index.js",
	"packages/session-backends/sqlite-node/dist/index.js",
	"packages/protocol/dist/index.js",
	"packages/client/dist/index.js",
	"packages/server/dist/index.js",
	"packages/telemetry/dist/index.js",
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
		await run("npm", ["--prefix", staging, "run", "build:offline"], { env });
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
	for (const [name, value] of Object.entries({ fauxAssistantMessage, registerFauxProvider, createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager })) {
		assert(value, `${label} does not export required public API ${name}`);
	}
	const hostVersion = JSON.parse(await readFile(join(hostRoot, "packages/coding-agent/package.json"), "utf8")).version;
	const project = join(workRoot, "project");
	const agentDir = join(workRoot, "agent");
	const sessionDir = join(workRoot, "sessions");
	await mkdir(join(project, ".pi"), { recursive: true });
	await mkdir(agentDir, { recursive: true });
	await writeFile(join(project, ".pi/settings.json"), JSON.stringify({
		packages: [pluginRoot],
		compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 16384 },
		// Keep failure scenarios bounded; this does not change the user's host settings.
		retry: { enabled: false, provider: { maxRetries: 0 } },
	}));
	const settingsManager = SettingsManager.create(project, agentDir);
	const faux = registerFauxProvider({ models: [{ id: "continuity-e2e", contextWindow: 128000, maxTokens: 16384 }] });
	const notifications = [];
	const requests = [];
	const callbackFailures = [];
	const rootConstraint = '只分析，不修改文件。\n  Keep "quoted" user text exactly.';
	const oldPort = "Use port 8080.";
	const newPort = "Use port 8081 instead of port 8080.";
	const original = `${rootConstraint}\n${oldPort}`;
	const fixturePath = "src/host-fixture.ts";
	let phase = "";
	let selected = [];
	let retiredId;
	let session;
	let manager;
	let phaseStart = 0;
	let duplicateRelease;
	let overflowIssued = false;
	const usage = { input: 42, output: 21, cacheRead: 0, cacheWrite: 0, totalTokens: 63, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
	function textOf(context) {
		return context.messages.flatMap((message) => typeof message.content === "string" ? [message.content]
			: message.content.filter((part) => part.type === "text").map((part) => part.text)).join("\n");
	}
	function branchCompaction() { return manager.getBranch().findLast((entry) => entry.type === "compaction"); }
	function continuationCount() { return manager.getEntries().filter((entry) => entry.type === "custom_message" && entry.customType === "pi-continuity/continue").length; }
	function seedUser(text) {
		const id = manager.appendMessage({ role: "user", content: text, timestamp: Date.now() });
		session.agent.state.messages = manager.buildSessionContext().messages;
		return id;
	}
	async function respond(context, options, _state, model) {
		try {
			const system = JSON.stringify(context.systemPrompt ?? "");
			const text = textOf(context);
			const kind = system.includes("exactly summary, quotes, retire") ? "plugin"
				: system.includes("context summarization assistant") ? "native" : "assistant";
			requests.push({ phase, kind, maxTokens: options?.maxTokens ?? null, modelMaxTokens: model.maxTokens, stop: "stop" });
			assert(requests.length - phaseStart <= 8, `${phase}: unexpected request loop`);
			if (kind === "plugin") {
				assert.equal(options?.apiKey, "host-e2e-faux-key", "compaction must reuse the runtime model auth");
				if (phase === "cancel") {
					session.abortCompaction();
					requests.at(-1).stop = "aborted";
					return fauxAssistantMessage([], { stopReason: "aborted" });
				}
				if (phase === "duplicate") await new Promise((release) => { duplicateRelease = release; });
				if (phase === "invalid-json" || phase === "native-failure") return fauxAssistantMessage("invalid fixture JSON");
				if (phase === "empty") return fauxAssistantMessage("");
				if (phase === "truncated") {
					requests.at(-1).stop = "length";
					return fauxAssistantMessage('{"summary":', { stopReason: "length" });
				}
				if (phase === "provider-error") {
					requests.at(-1).stop = "error";
					return fauxAssistantMessage([], { stopReason: "error", errorMessage: "HTTP 400 synthetic permanent extraction failure" });
				}
				const sources = text.split("\n").filter((line) => line.startsWith('{"sourceId":')).map((line) => JSON.parse(line));
				const quotes = selected.map((quote) => {
					const source = sources.find((source) => source.text.includes(quote));
					assert(source, `${phase}: expected raw user source was not offered`);
					return { sourceId: source.sourceId, quote, kind: quote === newPort ? "correction" : "constraint" };
				});
				const retire = phase === "correction" ? [{ evidenceId: retiredId, reason: "superseded", sourceId: quotes[0].sourceId, quote: newPort }] : [];
				const message = fauxAssistantMessage(JSON.stringify({
					summary: { task: "Verify bounded continuity on both Pi hosts", doneWhen: "Source and lifecycle assertions pass", constraints: ["No real model or file tools", "Latest user decisions govern"], established: ["Synthetic host fixture only"], open: [], next: ["Report mechanical verification, not semantic fidelity"] },
					quotes, retire,
				}));
				return message;
			}
			if (kind === "native") {
				if (phase === "native-failure") {
					requests.at(-1).stop = "error";
					return fauxAssistantMessage([], { stopReason: "error", errorMessage: "HTTP 400 synthetic permanent native failure" });
				}
				return fauxAssistantMessage("Native fixture summary; source-verified continuity is not guaranteed.");
			}
			if (phase === "threshold") {
				// Lower the window only after the pre-prompt check, to exercise one
				// post-turn threshold event rather than both host check points.
				await session.setModel({ ...faux.getModel(), contextWindow: 16000, maxTokens: 512 });
				return fauxAssistantMessage("Synthetic threshold source response.");
			}
			if (phase === "overflow" && !overflowIssued) {
				overflowIssued = true;
				requests.at(-1).stop = "error";
				return fauxAssistantMessage([], { stopReason: "error", errorMessage: "maximum context length exceeded" });
			}
			if (phase !== "overflow") {
				const branch = manager.getBranch();
				const compact = branchCompaction();
				const continuation = branch.findLast((entry) => entry.type === "custom_message" && entry.customType === "pi-continuity/continue");
				assert(compact && continuation, `${phase}: assistant request preceded the commit/continuation`);
				assert(branch.indexOf(compact) < branch.indexOf(continuation), "commit must precede the continuation");
				assert.equal(continuation.display, false);
				const persisted = (await readFile(manager.getSessionFile(), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
				assert(persisted.some((entry) => entry.id === compact.id), "compaction must be on disk before the continuation request");
				for (const ref of compact.details?.continuity?.evidence ?? []) {
					const source = branch.find((entry) => entry.id === ref.entryId);
					assert.equal(source?.type, "message");
					assert.equal(source.message.role, "user");
					const block = typeof source.message.content === "string" ? source.message.content : source.message.content[ref.blockIndex].text;
					const originalText = block.slice(ref.start, ref.end);
					assert.equal(ref.id, createHash("sha256").update(JSON.stringify([ref.entryId, ref.blockIndex, ref.start, ref.end, originalText])).digest("hex"));
					assert(text.includes(JSON.stringify(originalText)), "continuing model must actually receive the exact quoted text");
					assert(text.includes(ref.id), "continuing model must receive the verified identity");
				}
				for (const path of [...(compact.details?.readFiles ?? []), ...(compact.details?.modifiedFiles ?? [])]) assert(text.includes(JSON.stringify(path)), "available fixture file must be in continuing model input");
			}
			return fauxAssistantMessage("Synthetic continuation settled; no semantic behavior claim.");
		} catch (error) {
			callbackFailures.push(error.message);
			throw error;
		}
	}
	function start(name, quotes = []) {
		phase = name;
		selected = quotes;
		phaseStart = requests.length;
		// A bounded dispatcher accommodates the host's separate split-turn native summary.
		faux.setResponses(Array.from({ length: 12 }, () => respond));
	}
	function calls(kind) { return requests.slice(phaseStart).filter((request) => request.kind === kind).length; }
	async function settle() {
		const deadline = Date.now() + 10000;
		do {
			await new Promise((resolveTurn) => setTimeout(resolveTurn, 5));
			if (!session.isCompacting) await session.waitForIdle();
			assert(Date.now() < deadline, `${phase}: host did not settle`);
		} while (session.isCompacting || session.isStreaming);
		assert.deepEqual(callbackFailures, [], "faux provider assertions failed");
		assert.equal(requests.length, faux.state.callCount, "every model call must reach the scripted provider boundary");
	}
	let modelRuntime;
	async function open(managerToOpen) {
		session?.dispose();
		manager = managerToOpen;
		const resourceLoader = new DefaultResourceLoader({ cwd: project, agentDir, settingsManager, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
		await resourceLoader.reload();
		const loaded = resourceLoader.getExtensions();
		assert.deepEqual(loaded.errors, [], `${label}: packed extension loading failed`);
		assert.equal(loaded.extensions.length, 1);
		assert.equal(resolve(loaded.extensions[0].resolvedPath), resolve(pluginRoot, "extensions/continuity.ts"));
		({ session } = await createAgentSession({ cwd: project, agentDir, model: faux.getModel(), modelRuntime, resourceLoader, sessionManager: manager, settingsManager, noTools: "all" }));
		await session.bindExtensions({ uiContext: createNotifier(notifications) });
	}
	async function manual(name, quotes = []) {
		seedUser(`Continue synthetic analysis (${name}); do not use real tools.`);
		const before = continuationCount();
		start(name, quotes);
		await session.prompt("/continuity");
		await settle();
		assert.equal(calls("plugin"), 1, `${name}: exactly one plugin extraction`);
		assert.equal(calls("native"), 0, `${name}: must not silently pass via native fallback`);
		assert.equal(calls("assistant"), 1, `${name}: exactly one continuation`);
		assert.equal(continuationCount(), before + 1);
		assert.equal(branchCompaction().fromHook, true);
		const reported = branchCompaction().usage;
		assert(reported.input > 0 && reported.output > 0, "persist the faux provider's normalized usage, not the factory placeholder");
		assert.equal(reported.totalTokens, reported.input + reported.output + reported.cacheRead + reported.cacheWrite);
		return branchCompaction();
	}
	try {
		modelRuntime = await ModelRuntime.create({ modelsPath: null, allowModelNetwork: false });
		modelRuntime.registerProvider(faux.getModel().provider, { name: "Faux", api: faux.api, apiKey: "HOST_E2E_FAUX_KEY", baseUrl: faux.getModel().baseUrl, models: faux.models });
		await modelRuntime.setRuntimeApiKey(faux.getModel().provider, "host-e2e-faux-key", { allowNetwork: false });
		await open(SessionManager.create(project, sessionDir));
		seedUser(original);
		const assistant = fauxAssistantMessage([{ type: "text", text: "Synthetic preparation. ".repeat(100) }, { type: "toolCall", id: "fixture-write", name: "write", arguments: { path: fixturePath, content: "synthetic history, not an executed tool" } }]);
		assistant.usage = usage;
		manager.appendMessage(assistant);
		manager.appendMessage({ role: "toolResult", toolCallId: "fixture-write", toolName: "write", content: [{ type: "text", text: "Synthetic write observation." }], isError: false, timestamp: Date.now() });
		session.agent.state.messages = manager.buildSessionContext().messages;
		const first = await manual("initial", [rootConstraint, oldPort]);
		assert.equal(first.details.continuity.evidence.length, 2);
		assert(first.details.modifiedFiles.includes(fixturePath));
		const expected = first.details.continuity.evidence;
		retiredId = expected.find((ref) => original.slice(ref.start, ref.end) === oldPort).id;
		const file = manager.getSessionFile();
		for (const name of ["omitted-round-2", "omitted-round-3"]) {
			await open(SessionManager.open(file));
			const compact = await manual(name);
			assert.deepEqual(compact.details.continuity.evidence, expected);
			assert.equal(compact.details.continuity.coverage.basis, "carried");
			assert(compact.details.modifiedFiles.includes(fixturePath));
		}
		await open(SessionManager.open(file));
		seedUser(newPort);
		const corrected = await manual("correction", [newPort]);
		assert.equal(corrected.details.continuity.coverage.retired, 1);
		assert(!corrected.details.continuity.evidence.some((ref) => ref.id === retiredId));
		assert.equal(corrected.details.continuity.evidence.length, 2);

		const forkPoint = manager.getLeafId();
		seedUser("Sibling-only constraint.");
		const sibling = await manual("sibling", ["Sibling-only constraint."]);
		const siblingId = sibling.details.continuity.evidence.find((ref) => !corrected.details.continuity.evidence.some((old) => old.id === ref.id)).id;
		manager.branch(forkPoint);
		seedUser("Independent branch after the fork.");
		await open(SessionManager.open(file));
		const isolated = await manual("isolated");
		assert(!isolated.details.continuity.evidence.some((ref) => ref.id === siblingId));
		assert(!isolated.summary.includes("Sibling-only constraint."));

		seedUser("Native compact fixture boundary.");
		const beforePlain = continuationCount();
		start("plain-compact");
		await session.compact();
		await settle();
		assert.equal(calls("plugin"), 0, "ordinary compact must remain native");
		assert(calls("native") >= 1);
		assert.equal(calls("assistant"), 0);
		assert.equal(continuationCount(), beforePlain);
		const rebuilt = await manual("rebuilt", [rootConstraint]);
		assert.equal(rebuilt.details.continuity.coverage.basis, "rebuilt");

		for (const name of ["invalid-json", "empty", "truncated", "provider-error"]) {
			seedUser(`Native fallback fixture ${name}.`);
			const before = continuationCount();
			start(name);
			await session.prompt("/continuity");
			await settle();
			assert.equal(calls("plugin"), 1);
			assert(calls("native") >= 1 && calls("native") <= 2, "native fallback may summarize both history and split-turn prefix");
			assert.equal(calls("assistant"), 1);
			assert.notEqual(branchCompaction().fromHook, true);
			assert.equal(continuationCount(), before + 1);
		}
		for (const name of ["native-failure", "cancel"]) {
			seedUser(`Failure fixture ${name}.`);
			const previous = branchCompaction().id;
			const before = continuationCount();
			start(name);
			await session.prompt("/continuity");
			await settle();
			assert.equal(calls("plugin"), 1);
			assert.equal(calls("assistant"), 0);
			assert.equal(continuationCount(), before);
			assert.equal(branchCompaction().id, previous);
			if (name === "cancel") assert.equal(calls("native"), 0);
			else assert(calls("native") >= 1);
		}
		seedUser("Duplicate pending command fixture.");
		const beforeDuplicate = continuationCount();
		start("duplicate");
		await session.prompt("/continuity");
		const deadline = Date.now() + 10000;
		while (!duplicateRelease) {
			assert(Date.now() < deadline, "duplicate fixture did not reach extraction");
			await new Promise((resolveTurn) => setTimeout(resolveTurn, 5));
		}
		await session.prompt("/continuity");
		duplicateRelease();
		await settle();
		assert.equal(calls("plugin"), 1);
		assert.equal(calls("assistant"), 1);
		assert.equal(continuationCount(), beforeDuplicate + 1);
		assert(notifications.some((notice) => notice.message.includes("already pending")));

		for (const name of ["threshold", "overflow"]) {
			await session.setModel(faux.getModel());
			const before = continuationCount();
			const previous = branchCompaction().id;
			start(name);
			await session.prompt(`Exercise host-owned ${name} recovery.`);
			await settle();
			assert.equal(calls("plugin"), 1, `${name}: Pi must schedule exactly one compaction`);
			assert.equal(calls("native"), 0);
			assert.equal(calls("assistant"), name === "threshold" ? 1 : 2);
			assert.equal(continuationCount(), before, "automatic paths must not add a plugin continuation");
			assert.notEqual(branchCompaction().id, previous);
			assert.equal(branchCompaction().fromHook, true);
		}
		console.log(`[${label}] provider-boundary receipt ${JSON.stringify({ hostVersion, sha, boundary: "faux response factory after SDK normalization; not HTTP wire", requests })}`);
		console.log(`[${label}] PASS at ${sha} (${hostVersion}): packed discovery; commit-before-continue; three rounds and JSONL reload; correction; branch isolation; native gap/fallback success and failure; cancellation/duplicate; threshold/overflow; auth/usage. Faux only; behavioral fidelity unverified.`);
	} finally {
		duplicateRelease?.();
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
