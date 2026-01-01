type PlayDlModule = typeof import('play-dl');

let playDlPromise: Promise<PlayDlModule> | null = null;
let soundCloudTokenPromise: Promise<void> | null = null;

export const getPlayDl = async (): Promise<PlayDlModule> => {
	if (!playDlPromise) {
		playDlPromise = import('play-dl').then(mod => (mod.default ?? mod) as PlayDlModule);
	}

	return playDlPromise;
};

const getSoundCloudClientId = async (): Promise<string> => {
	const envClientId = process.env.SOUNDCLOUD_CLIENT_ID;
	if (envClientId) return envClientId;

	const playDl = await getPlayDl();
	return playDl.getFreeClientID();
};

export const ensureSoundCloudToken = async (): Promise<void> => {
	if (!soundCloudTokenPromise) {
		soundCloudTokenPromise = (async () => {
			const playDl = await getPlayDl();
			const clientId = await getSoundCloudClientId();
			await playDl.setToken({
				soundcloud: {
					client_id: clientId
				}
			});
		})();
	}

	return soundCloudTokenPromise;
};
