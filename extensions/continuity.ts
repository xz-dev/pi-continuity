import { complete } from "@earendil-works/pi-ai/compat";
import { createContinuityExtension } from "../internal/continuity-core.js";

export default createContinuityExtension({
	complete,
});
