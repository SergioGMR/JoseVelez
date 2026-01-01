import { describe, expect, it } from 'bun:test';
import type { YouTubeVideo } from '../src/types.js';
import { buildSoundCloudQuery, isYouTubeLoginRequiredError } from '../src/fallback-utils.js';

const createTrack = (overrides: Partial<YouTubeVideo>): YouTubeVideo => ({
	id: overrides.id ?? 'id',
	title: overrides.title ?? 'Song (Official Video)',
	url: overrides.url ?? 'https://www.youtube.com/watch?v=id',
	channelTitle: overrides.channelTitle ?? 'Artist - Topic',
	thumbnail: overrides.thumbnail ?? '',
	description: overrides.description ?? '',
	duration: overrides.duration ?? '3:00',
});

describe('buildSoundCloudQuery', () => {
	it('removes YouTube-specific markers and topic suffixes', () => {
		const track = createTrack({});
		expect(buildSoundCloudQuery(track)).toBe('Song Artist');
	});
});

describe('isYouTubeLoginRequiredError', () => {
	it('detects login-required errors', () => {
		const error = new Error("Sign in to confirm you're not a bot");
		expect(isYouTubeLoginRequiredError(error)).toBe(true);
		expect(isYouTubeLoginRequiredError('LOGIN_REQUIRED')).toBe(true);
	});

	it('returns false for unrelated errors', () => {
		expect(isYouTubeLoginRequiredError(new Error('network timeout'))).toBe(false);
	});
});
