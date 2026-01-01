import type { YouTubeVideo } from './types.js';

const YOUTUBE_HOSTS = new Set([
	'youtube.com',
	'www.youtube.com',
	'm.youtube.com',
	'music.youtube.com',
	'youtu.be',
]);

const YOUTUBE_ID_PATTERN = /[0-9A-Za-z_-]{11}/;

const cleanYouTubeId = (value: string | null): string | null => {
	if (!value) return null;

	const match = value.match(YOUTUBE_ID_PATTERN);
	return match ? match[0] : null;
};

const extractIdFromPath = (pathname: string): string | null => {
	const normalizedPath = pathname.replace(/\/+$/, '');
	const pathMatch = normalizedPath.match(/\/(shorts|embed|v)\/([0-9A-Za-z_-]{11})$/);
	if (pathMatch) return pathMatch[2];

	const segments = normalizedPath.split('/').filter(Boolean);
	if (segments.length === 1) {
		return cleanYouTubeId(segments[0]);
	}

	return null;
};

export const parseYouTubeUrl = (input: string): { id: string; url: string } | null => {
	let parsedUrl: URL;
	try {
		parsedUrl = new URL(input);
	} catch {
		return null;
	}

	const protocol = parsedUrl.protocol.toLowerCase();
	if (protocol !== 'http:' && protocol !== 'https:') return null;

	const host = parsedUrl.hostname.toLowerCase();
	if (!YOUTUBE_HOSTS.has(host)) return null;

	let videoId: string | null = null;
	if (host === 'youtu.be') {
		videoId = extractIdFromPath(parsedUrl.pathname);
	} else {
		videoId = cleanYouTubeId(parsedUrl.searchParams.get('v'));
		if (!videoId) {
			videoId = extractIdFromPath(parsedUrl.pathname);
		}
	}

	if (!videoId) return null;

	return {
		id: videoId,
		url: `https://www.youtube.com/watch?v=${videoId}`,
	};
};

export const extractYouTubeId = (input: string): string | null => {
	const directMatch = cleanYouTubeId(input);
	if (directMatch === input && directMatch) return directMatch;

	const parsed = parseYouTubeUrl(input);
	return parsed ? parsed.id : null;
};

export const buildFallbackVideoFromUrl = (input: string): YouTubeVideo => {
	const parsed = parseYouTubeUrl(input);
	const videoId = parsed?.id ?? extractYouTubeId(input);
	const canonicalUrl = parsed?.url ?? (videoId ? `https://www.youtube.com/watch?v=${videoId}` : input);

	return {
		id: videoId ?? input,
		title: 'Video de YouTube',
		url: canonicalUrl,
		channelTitle: 'Canal desconocido',
		thumbnail: videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '',
		description: '',
		duration: 'Desconocida',
		source: 'youtube',
	};
};
