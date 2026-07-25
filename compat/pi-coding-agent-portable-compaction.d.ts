import type { Usage } from "@earendil-works/pi-ai";
import type {
	ExtensionContext,
	SessionBeforeCompactEvent,
	SessionBeforeCompactResult,
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

	export interface ExtensionAPI {
		on(
			event: "session_before_compact",
			handler: (
				event: SessionBeforeCompactEvent,
				ctx: ExtensionContext,
			) =>
				| Promise<(SessionBeforeCompactResult & { projection?: PortableCompactionProjection }) | void>
				| (SessionBeforeCompactResult & { projection?: PortableCompactionProjection })
				| void,
		): void;
	}
}
