import { convertToLlm } from "@earendil-works/pi-coding-agent";

/** Source admission only: never adopt provider-rewritten IDs or synthetic results. */
export function isReplayEligible(original: Parameters<typeof convertToLlm>[0][number]): boolean {
	return convertToLlm([original]).some((message) => {
		if (message.role === "toolResult") return true;
		if (message.role === "assistant" && (message.stopReason === "error" || message.stopReason === "aborted")) return false;
		const content = message.content ?? [];
		if (typeof content === "string") return content.trim().length > 0;
		// Keep malformed/unknown material for the existing uninspected-content disclosure.
		if (!Array.isArray(content)) return true;
		return content.some((part) => {
			if (!part || typeof part !== "object") return true;
			if (part.type === "text") return (message.role === "assistant" && !!part.textSignature) || typeof part.text !== "string" || part.text.trim().length > 0;
			if (message.role === "assistant" && part.type === "thinking") return !!part.thinkingSignature || typeof part.thinking !== "string" || part.thinking.trim().length > 0;
			return true;
		});
	});
}
