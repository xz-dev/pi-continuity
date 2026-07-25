import type { Usage } from "@earendil-works/pi-ai";
import type {
	CompactionResult,
	ExtensionHandler,
	SessionBeforeCompactEvent,
} from "@earendil-works/pi-coding-agent";

declare module "@earendil-works/pi-coding-agent" {
	export interface PortableCompactionProjection<T = unknown> {
		type: "portable_compaction_projection";
		version: 1;
		customType: string;
		summary: string;
		details?: T;
		usage?: Usage;
	}

	export interface PortableSessionBeforeCompactResult {
		cancel?: boolean;
		compaction?: CompactionResult;
		projection?: PortableCompactionProjection;
	}

	export interface ExtensionAPI {
		on(
			event: "session_before_compact",
			handler: ExtensionHandler<SessionBeforeCompactEvent, PortableSessionBeforeCompactResult>,
		): void;
	}
}
