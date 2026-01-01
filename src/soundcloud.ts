import { StreamType } from '@discordjs/voice';
import type { Readable } from 'stream';
import type { SoundCloudTrack } from 'play-dl';
import chalk from 'chalk';
import type { YouTubeVideo } from './types.js';
import { ensureSoundCloudToken, getPlayDl } from './playdl.js';

const MAX_SEARCH_RESULTS = 10;

const formatDuration = (seconds: number): string => {
	const total = Math.max(0, Math.floor(seconds));
	const minutes = Math.floor(total / 60);
	const secs = total - minutes * 60;

	return `${minutes}:${secs.toString().padStart(2, '0')}`;
};

const mapTrackToVideo = (track: SoundCloudTrack): YouTubeVideo => ({
	id: `sc:${track.id}`,
	title: track.name || 'Sin titulo',
	url: track.permalink || track.url,
	channelTitle: track.user?.name || 'SoundCloud',
	thumbnail: track.thumbnail || '',
	description: '',
	duration: Number.isFinite(track.durationInSec) ? formatDuration(track.durationInSec) : 'Desconocida',
	source: 'soundcloud'
});

export const isSoundCloudUrl = (value: string): boolean => {
	try {
		const parsed = new URL(value);
		return parsed.hostname.toLowerCase().endsWith('soundcloud.com');
	} catch {
		return false;
	}
};

export const searchSoundCloudTracks = async (query: string, maxResults = 5): Promise<YouTubeVideo[]> => {
	const trimmed = query.trim();
	if (!trimmed) return [];

	try {
		const playDl = await getPlayDl();
		await ensureSoundCloudToken();

		const results = await playDl.search(trimmed, {
			source: { soundcloud: 'tracks' },
			limit: Math.min(maxResults, MAX_SEARCH_RESULTS)
		});

		return results.map(mapTrackToVideo).filter(track => Boolean(track.url));
	} catch (error) {
		console.warn(chalk.yellow('SoundCloud search failed:'), error);
		return [];
	}
};

export const createSoundCloudStream = async (url: string): Promise<{ stream: Readable; streamType: StreamType; source: string }> => {
	const playDl = await getPlayDl();
	await ensureSoundCloudToken();

	const streamInfo = await playDl.stream(url);

	return {
		stream: streamInfo.stream as Readable,
		streamType: streamInfo.type as StreamType,
		source: 'soundcloud'
	};
};
