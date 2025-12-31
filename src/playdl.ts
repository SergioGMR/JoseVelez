type PlayDlModule = typeof import('play-dl');

let playDlPromise: Promise<PlayDlModule> | null = null;

export const getPlayDl = async (): Promise<PlayDlModule> => {
	if (!playDlPromise) {
		playDlPromise = import('play-dl').then(mod => (mod.default ?? mod) as PlayDlModule);
	}

	return playDlPromise;
};
