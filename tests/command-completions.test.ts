import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";
import { createContinuityExtension } from "../internal/continuity-core.js";

it("completes /continuity continue without compacting or starting a model request", async () => {
	type Command = Parameters<ExtensionAPI["registerCommand"]>[1];
	let command: Command | undefined;
	const stream = vi.fn();
	const sendMessage = vi.fn();
	createContinuityExtension({ stream: stream as never })({
		on: () => {},
		registerCommand: (name: string, value: Command) => {
			expect(name).toBe("continuity");
			command = value;
		},
		sendMessage,
	} as unknown as ExtensionAPI);
	const complete = command?.getArgumentCompletions;
	expect(complete).toBeTypeOf("function");
	for (const prefix of ["", "c", "cont", "continue", "  con", "\t"]) {
		expect(await complete!(prefix)).toEqual([{ value: "continue", label: "continue" }]);
	}
	for (const prefix of ["unknown", "continue ", "continue later", "continue\tmore"]) {
		expect(await complete!(prefix)).toBeNull();
	}
	expect(stream).not.toHaveBeenCalled();
	expect(sendMessage).not.toHaveBeenCalled();
});
