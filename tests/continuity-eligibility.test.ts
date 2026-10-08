import { readFileSync } from "node:fs";
import type { Model } from "@earendil-works/pi-ai";
import { transformMessages } from "@earendil-works/pi-ai/api/transform-messages";
import { convertToLlm } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { isReplayEligible } from "../internal/continuity-eligibility.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/replay-eligibility.json", import.meta.url), "utf8"));
const cases: Array<{ name: string; eligible: boolean; empty?: boolean; message: Parameters<typeof convertToLlm>[0][number] }> = fixture.cases.map((item: any, index: number) => ({
	...item, message: { ...(item.message.role === "assistant" ? fixture.assistant : {}), ...item.message, timestamp: index + 1 },
}));
const model = { id: "eligibility", provider: "test", api: "openai-completions", input: ["text"] } as Model<"openai-completions">;
const versions = ["pi-ai", "pi-coding-agent"].map((name) => `${name}=${JSON.parse(readFileSync(new URL(`../node_modules/@earendil-works/${name}/package.json`, import.meta.url), "utf8")).version}`).join(", ");

describe(`source eligibility vs native replay (${versions})`, () => {
	it("preserves original survivors, with only the approved cross-version empty-message difference", () => {
		const originals = cases.map((item) => item.message);
		const snapshot = structuredClone(originals);
		const replay = transformMessages(convertToLlm(originals), model);
		const nativeDropsEmpty = !replay.some((message) => message.timestamp === cases.find((item) => item.name === "empty user")!.message.timestamp);
		for (const item of cases) {
			const survives = (messages: typeof replay) => messages.some((message) => message.timestamp === item.message.timestamp);
			expect(survives(replay), item.name).toBe(item.empty ? !nativeDropsEmpty : item.eligible);
			expect(survives(transformMessages(convertToLlm([item.message]), model)), item.name).toBe(survives(replay));
			expect(isReplayEligible(item.message), item.name).toBe(item.eligible);
		}
		expect(originals).toEqual(snapshot);
		const selected = originals.filter(isReplayEligible);
		expect(selected.every((message) => originals.includes(message))).toBe(true);
		expect(replay.some((message) => message.role === "toolResult" && message.toolCallId === "missing")).toBe(true);
		expect(selected.some((message) => message.role === "toolResult" && message.toolCallId === "missing")).toBe(false);
	});
});
