import type { YouTubeVideo } from '../types.js';

const OFFICIAL_MARKERS = ['official', 'oficial', 'vevo'];
const OFFICIAL_TITLE_BONUS = 6;
const OFFICIAL_CHANNEL_BONUS = 4;

const normalizeText = (value: string): string =>
	value
		.toLowerCase()
		.replace(/[_\-]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

export const splitQueryInput = (input: string, maxItems: number): string[] => {
	if (!input) return [];

	const parts = input
		.split(/[;,]/)
		.map(part => part.trim())
		.filter(Boolean);

	return parts.slice(0, Math.max(0, maxItems));
};

export const scoreVideoForQuery = (video: YouTubeVideo, query: string): number => {
	if (!query) return 0;

	const normalizedQuery = normalizeText(query);
	const normalizedTitle = normalizeText(video.title ?? '');
	const normalizedChannel = normalizeText(video.channelTitle ?? '');

	let score = 0;

	if (normalizedTitle === normalizedQuery) score += 5;
	if (normalizedTitle.includes(normalizedQuery)) score += 3;
	if (normalizedChannel.includes(normalizedQuery)) score += 2;

	const officialPattern = new RegExp(`\\b(${OFFICIAL_MARKERS.join('|')})\\b`, 'i');
	if (officialPattern.test(normalizedTitle)) score += OFFICIAL_TITLE_BONUS;
	if (officialPattern.test(normalizedChannel)) score += OFFICIAL_CHANNEL_BONUS;

	if (/\btopic\b/i.test(normalizedChannel)) score += 1;

	return score;
};

export const pickBestVideo = (videos: YouTubeVideo[], query: string): YouTubeVideo | null => {
	if (videos.length === 0) return null;

	let bestVideo = videos[0];
	let bestScore = scoreVideoForQuery(bestVideo, query);

	for (let index = 1; index < videos.length; index += 1) {
		const candidate = videos[index];
		const score = scoreVideoForQuery(candidate, query);
		if (score > bestScore) {
			bestVideo = candidate;
			bestScore = score;
		}
	}

	return bestVideo;
};
