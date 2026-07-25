import { resolve } from "node:path";

const piRepo = process.env.PI_REPO;
if (!piRepo) throw new Error("PI_REPO is required (use scripts/test-pi-worktree.mjs)");

const fromPi = (...parts: string[]) => resolve(piRepo, ...parts);

export default {
	resolve: {
		preserveSymlinks: false,
		alias: [
			{ find: /^@earendil-works\/pi-ai\/compat$/, replacement: fromPi("packages/ai/src/compat.ts") },
			{ find: /^@earendil-works\/pi-ai\/(.*)$/, replacement: `${fromPi("packages/ai/src")}/$1.ts` },
			{ find: "@earendil-works/pi-ai", replacement: fromPi("packages/ai/src/index.ts") },
			{ find: /^@earendil-works\/pi-coding-agent\/(.*)$/, replacement: `${fromPi("packages/coding-agent/src")}/$1.ts` },
			{ find: "@earendil-works/pi-coding-agent", replacement: fromPi("packages/coding-agent/src/index.ts") },
			{ find: /^@earendil-works\/pi-agent-core\/(.*)$/, replacement: `${fromPi("packages/agent/src")}/$1.ts` },
			{ find: "@earendil-works/pi-agent-core", replacement: fromPi("packages/agent/src/index.ts") },
			{ find: "@earendil-works/pi-tui", replacement: fromPi("packages/tui/src/index.ts") },
			{ find: "pi-test-harness", replacement: fromPi("packages/coding-agent/test/suite/harness.ts") },
			{ find: "pi-test-utilities", replacement: fromPi("packages/coding-agent/test/utilities.ts") },
			{ find: "pi-model-runtime-test-utils", replacement: fromPi("packages/coding-agent/test/model-runtime-test-utils.ts") },
		],
	},
	test: {
		environment: "node",
		include: [resolve(import.meta.dirname, "pi-worktree-integration.test.ts")],
		testTimeout: 15_000,
		hookTimeout: 15_000,
		pool: "forks",
		maxWorkers: 1,
	},
};
