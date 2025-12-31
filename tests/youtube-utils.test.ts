import { describe, expect, it } from 'bun:test';
import { buildFallbackVideoFromUrl, extractYouTubeId, parseYouTubeUrl } from '../src/youtube-utils.js';

const VIDEO_ID = 'dQw4w9WgXcQ';

describe('parseYouTubeUrl', () => {
	it('normaliza URLs de watch', () => {
		const result = parseYouTubeUrl(`https://www.youtube.com/watch?v=${VIDEO_ID}&t=42`);
		expect(result?.id).toBe(VIDEO_ID);
		expect(result?.url).toBe(`https://www.youtube.com/watch?v=${VIDEO_ID}`);
	});

	it('acepta URLs cortas', () => {
		const result = parseYouTubeUrl(`https://youtu.be/${VIDEO_ID}?si=abc`);
		expect(result?.id).toBe(VIDEO_ID);
	});

	it('acepta shorts y embeds', () => {
		const shorts = parseYouTubeUrl(`https://www.youtube.com/shorts/${VIDEO_ID}`);
		const embed = parseYouTubeUrl(`https://www.youtube.com/embed/${VIDEO_ID}`);
		expect(shorts?.id).toBe(VIDEO_ID);
		expect(embed?.id).toBe(VIDEO_ID);
	});

	it('rechaza hosts no oficiales aunque contengan "youtube.com"', () => {
		const result = parseYouTubeUrl(`https://evil.example/?q=https://www.youtube.com/watch?v=${VIDEO_ID}`);
		expect(result).toBeNull();
	});
});

describe('extractYouTubeId', () => {
	it('extrae el ID desde una URL valida', () => {
		expect(extractYouTubeId(`https://music.youtube.com/watch?v=${VIDEO_ID}`)).toBe(VIDEO_ID);
	});

	it('acepta un ID directo', () => {
		expect(extractYouTubeId(VIDEO_ID)).toBe(VIDEO_ID);
	});
});

describe('buildFallbackVideoFromUrl', () => {
	it('genera URL canonica y thumbnail', () => {
		const video = buildFallbackVideoFromUrl(`https://youtu.be/${VIDEO_ID}`);
		expect(video.url).toBe(`https://www.youtube.com/watch?v=${VIDEO_ID}`);
		expect(video.thumbnail).toBe(`https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`);
	});
});
