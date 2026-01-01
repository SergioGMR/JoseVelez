import type { YouTubeVideo } from './types.js';

const LOGIN_REQUIRED_MARKERS = [
	'sign in to confirm',
	'login_required',
	'not a bot',
	'confirm youre not a bot',
	'confirm you are not a bot'
];

const normalizeErrorMessage = (value: string): string =>
	value.toLowerCase().replace(/[’']/g, "'");

export const isYouTubeLoginRequiredError = (error: unknown): boolean => {
	if (!error) return false;

	const message = error instanceof Error ? error.message : String(error);
	const normalized = normalizeErrorMessage(message);

	return LOGIN_REQUIRED_MARKERS.some(marker => normalized.includes(marker));
};

const TITLE_CLEANUP_PATTERNS: RegExp[] = [
	/\((official video|official audio|video oficial|audio oficial|lyrics?|lyric video|mv|hd|4k)\)/gi,
	/\b(official video|official audio|video oficial|audio oficial|lyrics?|lyric video|mv|hd|4k)\b/gi
];

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const cleanQueryText = (value: string): string => {
	let cleaned = value;
	for (const pattern of TITLE_CLEANUP_PATTERNS) {
		cleaned = cleaned.replace(pattern, ' ');
	}
	return normalizeWhitespace(cleaned);
};

const cleanChannelText = (value: string): string => {
	const withoutTopic = value.replace(/\s*-\s*topic$/i, ' ');
	return cleanQueryText(withoutTopic);
};

export const buildSoundCloudQuery = (track: YouTubeVideo): string => {
	const title = cleanQueryText(track.title ?? '');
	const channel = cleanChannelText(track.channelTitle ?? '');
	const parts = [title, channel].filter(Boolean);
	return normalizeWhitespace(parts.join(' '));
};
