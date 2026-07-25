import type {
	CompactionResult,
	ExtensionAPI,
	PortableCompactionProjection,
} from "@earendil-works/pi-coding-agent";

declare const pi: ExtensionAPI;
const projection: PortableCompactionProjection = {
	type: "portable_compaction_projection",
	version: 1,
	customType: "test/projection",
	summary: "Portable summary",
};
const compaction: CompactionResult = {
	summary: "Legacy summary",
	firstKeptEntryId: "entry-1",
	tokensBefore: 100,
};

pi.on("session_before_compact", () => ({ projection }));
pi.on("session_before_compact", async () => ({ projection }));
pi.on("session_before_compact", () => ({ compaction }));
pi.on("session_before_compact", async () => ({ compaction }));
pi.on("session_before_compact", () => ({ cancel: true }));
pi.on("session_before_compact", async () => ({ cancel: true }));
pi.on("session_before_compact", () => undefined);
pi.on("session_before_compact", async () => undefined);

// @ts-expect-error unrelated object results are not valid compaction results
pi.on("session_before_compact", () => ({ unrelated: true }));
// @ts-expect-error string results are not valid compaction results
pi.on("session_before_compact", () => "invalid");
