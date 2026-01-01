import type { YouTubeVideo } from '../types.js';

const stripDiacritics = (value: string): string =>
	value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const normalizeText = (value: string): string =>
	stripDiacritics(value.toLowerCase())
		.replace(/[_\-./()[\]{}'"`]+/g, ' ')
		.replace(/[^\p{L}\p{N}\s]+/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim();

const STOP_TOKENS = new Set([
	'official',
	'oficial',
	'video',
	'audio',
	'lyrics',
	'lyric',
	'mv',
	'feat',
	'ft',
	'featuring',
	'x',
	'y',
	'and',
	'the',
	'a',
	'an',
	'de',
	'del',
	'la',
	'el',
	'los',
	'las'
]);

const tokenize = (value: string): string[] =>
	normalizeText(value)
		.split(' ')
		.filter(token => token && !STOP_TOKENS.has(token));

const hasPhrase = (text: string, phrase: string): boolean => {
	if (!text || !phrase) return false;
	const paddedText = ` ${text} `;
	return paddedText.includes(` ${phrase} `);
};

const uniqueTokens = (value: string): string[] => Array.from(new Set(tokenize(value)));

const buildTokenSet = (value: string): Set<string> => new Set(tokenize(value));

const countTokenMatches = (queryTokens: string[], targetTokens: Set<string>): number => {
	let count = 0;
	for (const token of queryTokens) {
		if (targetTokens.has(token)) count += 1;
	}
	return count;
};

const scoreTokenOverlap = (
	queryTokens: string[],
	targetTokens: Set<string>,
	perToken: number,
	maxScore: number,
	fullMatchBonus: number,
): number => {
	if (!queryTokens.length) return 0;
	const matched = countTokenMatches(queryTokens, targetTokens);
	let score = Math.min(matched * perToken, maxScore);
	if (matched === queryTokens.length) score += fullMatchBonus;
	return score;
};

const OFFICIAL_MARKERS = ['official', 'oficial', 'vevo'].map(normalizeText);
const OFFICIAL_PHRASES = [
	'official video',
	'official music video',
	'official audio',
	'video oficial',
	'audio oficial'
].map(normalizeText);

const NEGATIVE_TITLE_MARKERS = [
	{ phrase: 'cover', penalty: 6 },
	{ phrase: 'karaoke', penalty: 6 },
	{ phrase: 'nightcore', penalty: 6 },
	{ phrase: '8d', penalty: 6 },
	{ phrase: 'sped up', penalty: 6 },
	{ phrase: 'slowed', penalty: 6 },
	{ phrase: 'chipmunk', penalty: 6 },
	{ phrase: 'instrumental', penalty: 4 },
	{ phrase: 'remix', penalty: 4 },
	{ phrase: 'live', penalty: 3 },
	{ phrase: 'en vivo', penalty: 3 },
	{ phrase: 'acoustic', penalty: 3 },
	{ phrase: 'acustico', penalty: 3 },
	{ phrase: 'reverb', penalty: 3 },
	{ phrase: 'bass boosted', penalty: 3 },
	{ phrase: 'lyrics', penalty: 2 },
	{ phrase: 'lyric', penalty: 2 },
	{ phrase: 'edit', penalty: 2 },
	{ phrase: 'tiktok', penalty: 4 }
].map(marker => ({ ...marker, phrase: normalizeText(marker.phrase) }));

const OFFICIAL_TITLE_BONUS = 6;
const OFFICIAL_CHANNEL_BONUS = 4;
const OFFICIAL_PHRASE_BONUS = 8;
const TOPIC_BONUS = 2;
const EXACT_TITLE_BONUS = 10;
const PREFIX_TITLE_BONUS = 6;
const PARTIAL_TITLE_BONUS = 4;

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
	if (!normalizedQuery) return 0;
	const normalizedTitle = normalizeText(video.title ?? '');
	const normalizedChannel = normalizeText(video.channelTitle ?? '');

	let score = 0;

	if (normalizedTitle && normalizedQuery) {
		if (normalizedTitle === normalizedQuery) {
			score += EXACT_TITLE_BONUS;
		} else {
			if (normalizedTitle.startsWith(normalizedQuery)) score += PREFIX_TITLE_BONUS;
			if (normalizedTitle.includes(normalizedQuery)) score += PARTIAL_TITLE_BONUS;
		}
	}

	const queryTokens = uniqueTokens(query);
	const titleTokens = buildTokenSet(video.title ?? '');
	const channelTokens = buildTokenSet(video.channelTitle ?? '');

	score += scoreTokenOverlap(queryTokens, titleTokens, 2, 10, 4);
	score += scoreTokenOverlap(queryTokens, channelTokens, 1, 6, 2);

	if (normalizedChannel && normalizedChannel.includes(normalizedQuery)) score += 1;

	const hasOfficialTitle = OFFICIAL_MARKERS.some(marker => hasPhrase(normalizedTitle, marker));
	const hasOfficialChannel = OFFICIAL_MARKERS.some(marker => hasPhrase(normalizedChannel, marker));

	if (hasOfficialTitle) score += OFFICIAL_TITLE_BONUS;
	if (hasOfficialChannel) score += OFFICIAL_CHANNEL_BONUS;

	if (OFFICIAL_PHRASES.some(phrase => hasPhrase(normalizedTitle, phrase))) {
		score += OFFICIAL_PHRASE_BONUS;
	}

	if (hasPhrase(normalizedChannel, 'topic')) score += TOPIC_BONUS;

	for (const marker of NEGATIVE_TITLE_MARKERS) {
		if (hasPhrase(normalizedTitle, marker.phrase) && !hasPhrase(normalizedQuery, marker.phrase)) {
			score -= marker.penalty;
		}
	}

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
