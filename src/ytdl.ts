import { Agent } from 'undici';

type YtdlModule = typeof import('@distube/ytdl-core');

let ytdlPromise: Promise<YtdlModule> | null = null;

const ensureUndiciCompose = (): void => {
	const agentProto = Agent.prototype as Agent & { compose?: (...args: unknown[]) => unknown };
	if (typeof agentProto.compose !== 'function') {
		agentProto.compose = function () {
			return this;
		};
	}
};

export const getYtdl = async (): Promise<YtdlModule> => {
	if (!ytdlPromise) {
		ensureUndiciCompose();
		ytdlPromise = import('@distube/ytdl-core').then(mod => (mod.default ?? mod) as YtdlModule);
	}

	return ytdlPromise;
};
