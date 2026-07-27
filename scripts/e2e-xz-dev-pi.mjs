import { runPiContinuityHostE2E } from "./lib/run-pi-continuity-host-e2e.mjs";

await runPiContinuityHostE2E({
	source: "https://github.com/xz-dev/pi.git",
	label: "xz-dev/pi",
});
