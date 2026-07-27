import { uuidv7 } from "@earendil-works/pi-ai";
import { complete } from "@earendil-works/pi-ai/compat";
import { createContinuityExtension } from "../internal/continuity-core.js";

export default createContinuityExtension({
	complete,
	newCheckpointId: uuidv7,
	now: () => new Date(),
});
