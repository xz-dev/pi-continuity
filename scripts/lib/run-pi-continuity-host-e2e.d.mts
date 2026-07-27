export interface PrepareHostOptions {
	source: string;
	label: string;
	sha: string;
	cacheRoot: string;
}

export function prepareHost(options: PrepareHostOptions): Promise<string>;

export function runPiContinuityHostE2E(options: { source: string; label: string }): Promise<string>;
