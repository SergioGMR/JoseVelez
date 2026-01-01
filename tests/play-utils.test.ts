import { describe, expect, it } from 'bun:test';
import type { YouTubeVideo } from '../src/types.js';
import { pickBestVideo, scoreVideoForQuery, splitQueryInput } from '../src/commands/play-utils.js';

const createVideo = (overrides: Partial<YouTubeVideo>): YouTubeVideo => ({
	id: overrides.id ?? 'id',
	title: overrides.title ?? 'Title',
	url: overrides.url ?? 'https://www.youtube.com/watch?v=id',
	channelTitle: overrides.channelTitle ?? 'Channel',
	thumbnail: overrides.thumbnail ?? 'https://img.test/1.jpg',
	description: overrides.description ?? 'desc',
	duration: overrides.duration ?? '3:00',
});

describe('splitQueryInput', () => {
	it('splits by semicolon and comma, trims, and limits', () => {
		const input = 'uno; dos, tres ; ; cuatro, cinco';
		const result = splitQueryInput(input, 3);
		expect(result).toEqual(['uno', 'dos', 'tres']);
	});
});

describe('scoreVideoForQuery', () => {
	it('prefers official channels and titles', () => {
		const query = 'song';
		const official = createVideo({ title: 'Song (Official Video)', channelTitle: 'Artist' });
		const regular = createVideo({ title: 'Song', channelTitle: 'Somebody' });

		expect(scoreVideoForQuery(official, query)).toBeGreaterThan(scoreVideoForQuery(regular, query));
	});
});

describe('pickBestVideo', () => {
	it('selects the highest scoring video', () => {
		const query = 'my song';
		const videos = [
			createVideo({ title: 'My Song (Live)', channelTitle: 'Random' }),
			createVideo({ title: 'My Song', channelTitle: 'Artist Official' }),
			createVideo({ title: 'My Song (Cover)', channelTitle: 'Cover Channel' }),
		];

		const selected = pickBestVideo(videos, query);
		expect(selected?.channelTitle).toBe('Artist Official');
	});
});
