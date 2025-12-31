import { describe, expect, it, mock } from 'bun:test';
import { hashSearchQuery, normalizeSearchQuery } from '../src/search-cache-utils.js';
import type { YouTubeVideo } from '../src/types.js';

type YtSearchVideo = {
	videoId: string;
	title?: string;
	url?: string;
	author?: { name?: string };
	thumbnail?: string;
	image?: string;
	description?: string;
	timestamp?: string;
	duration?: { timestamp?: string };
};

type SearchMocks = {
	youtubeApiKeys: string[];
	loadCacheResult: YouTubeVideo[] | null;
	axiosGet?: (url: string, config?: { params?: Record<string, string> }) => Promise<unknown>;
	fallbackVideos?: YtSearchVideo[];
};

const buildVideo = (id: string): YouTubeVideo => ({
	id,
	title: `Song ${id}`,
	url: `https://www.youtube.com/watch?v=${id}`,
	channelTitle: 'Channel',
	thumbnail: 'https://img.test/thumb.jpg',
	description: 'desc',
	duration: '3:12',
});

const createSearch = async (overrides: SearchMocks) => {
	const loadCalls: Array<[string, number]> = [];
	const saveCalls: Array<[string, number, YouTubeVideo[], 'api' | 'fallback']> = [];
	let fallbackCalled = false;
	let apiCalled = false;

	const axiosGet = async (url: string, config?: { params?: Record<string, string> }) => {
		apiCalled = true;
		if (overrides.axiosGet) {
			return overrides.axiosGet(url, config);
		}
		return { data: { items: [] } };
	};

	const axiosMock = {
		get: axiosGet,
		isAxiosError: () => false,
	};

	const fallbackVideos = overrides.fallbackVideos ?? [];

	mock.module('../src/config.js', () => ({
		default: {
			youtubeApiKeys: overrides.youtubeApiKeys,
		},
	}));

	mock.module('../src/search-cache-store.js', () => ({
		loadSearchCacheEntry: async (queryHash: string, maxResults: number) => {
			loadCalls.push([queryHash, maxResults]);
			return overrides.loadCacheResult;
		},
		saveSearchCacheEntry: async (
			queryHash: string,
			maxResults: number,
			results: YouTubeVideo[],
			source: 'api' | 'fallback',
		) => {
			saveCalls.push([queryHash, maxResults, results, source]);
		},
	}));

	mock.module('axios', () => ({
		default: axiosMock,
	}));

	mock.module('yt-search', () => ({
		default: async () => {
			fallbackCalled = true;
			return { videos: fallbackVideos };
		},
	}));

	const musicModule = await import(`../src/music.ts?test=${Date.now()}_${Math.random()}`);

	return {
		searchYouTube: musicModule.searchYouTube as (query: string, maxResults?: number) => Promise<YouTubeVideo[]>,
		loadCalls,
		saveCalls,
		getFallbackCalled: () => fallbackCalled,
		getApiCalled: () => apiCalled,
	};
};

describe('searchYouTube flow', () => {
	it('prefers persisted cache over the API when available', async () => {
		const cached = [buildVideo('cached1')];
		const { searchYouTube, loadCalls, saveCalls, getFallbackCalled, getApiCalled } = await createSearch({
			youtubeApiKeys: ['api-key'],
			loadCacheResult: cached,
		});

		const query = 'LoFi   Beats';
		const results = await searchYouTube(query, 2);

		expect(results).toEqual(cached);
		expect(getFallbackCalled()).toBe(false);
		expect(getApiCalled()).toBe(false);
		expect(saveCalls.length).toBe(0);

		const expectedHash = hashSearchQuery(normalizeSearchQuery(query));
		expect(loadCalls).toEqual([[expectedHash, 2]]);
	});

	it('saves API results to the persistent cache', async () => {
		const apiVideoId = 'api12345678a';
		const { searchYouTube, saveCalls, getFallbackCalled } = await createSearch({
			youtubeApiKeys: ['api-key'],
			loadCacheResult: null,
			axiosGet: async (url, config) => {
				if (url.includes('/search')) {
					return {
						data: {
							items: [
								{
									id: { videoId: apiVideoId },
									snippet: {
										title: 'API song',
										channelTitle: 'API Channel',
										thumbnails: { high: { url: 'https://img.test/high.jpg' } },
										description: 'desc',
									},
								},
							],
						},
					};
				}

				return {
					data: {
						items: [
							{
								id: apiVideoId,
								contentDetails: { duration: 'PT3M12S' },
							},
						],
					},
				};
			},
		});

		const results = await searchYouTube('Chill vibes', 1);
		expect(results.length).toBe(1);
		expect(results[0]?.id).toBe(apiVideoId);
		expect(getFallbackCalled()).toBe(false);

		expect(saveCalls.length).toBe(1);
		const [, , savedResults, source] = saveCalls[0];
		expect(source).toBe('api');
		expect(savedResults[0]?.id).toBe(apiVideoId);
	});

	it('falls back to yt-search and persists the results when API fails', async () => {
		const originalConsoleError = console.error;
		console.error = () => {};

		const fallbackResult = buildVideo('fallback12345');
		try {
			const { searchYouTube, saveCalls, getFallbackCalled } = await createSearch({
				youtubeApiKeys: ['api-key'],
				loadCacheResult: null,
				axiosGet: async () => {
					throw new Error('API down');
				},
				fallbackVideos: [
					{
						videoId: fallbackResult.id,
						title: fallbackResult.title,
						url: fallbackResult.url,
						author: { name: fallbackResult.channelTitle },
						thumbnail: fallbackResult.thumbnail,
						description: fallbackResult.description,
						timestamp: fallbackResult.duration,
					},
				],
			});

			const results = await searchYouTube('fallback query', 1);
			expect(results.length).toBe(1);
			expect(results[0]?.id).toBe(fallbackResult.id);
			expect(getFallbackCalled()).toBe(true);

			expect(saveCalls.length).toBe(1);
			const [, , savedResults, source] = saveCalls[0];
			expect(source).toBe('fallback');
			expect(savedResults[0]?.id).toBe(fallbackResult.id);
		} finally {
			console.error = originalConsoleError;
		}
	});
});
