import chalk from 'chalk';
import type { YouTubeVideo } from './types.js';
import { getSupabaseClient } from './supabase-client.js';
import { isCacheEntryExpired } from './search-cache-utils.js';

const TABLE_NAME = 'search_cache';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type SearchCacheSource = 'api' | 'fallback';

type SearchCacheRow = {
	results: YouTubeVideo[] | null;
	expires_at: string | null;
};

const logCacheError = (message: string, error: unknown): void => {
	console.warn(chalk.yellow(message), error);
};

const clampResults = (results: YouTubeVideo[], maxResults: number): YouTubeVideo[] =>
	results.slice(0, Math.max(0, maxResults));

export const loadSearchCacheEntry = async (
	queryHash: string,
	maxResults: number,
): Promise<YouTubeVideo[] | null> => {
	const client = getSupabaseClient();
	if (!client) return null;

	try {
		const { data, error } = await client
			.from(TABLE_NAME)
			.select('results, expires_at')
			.eq('query_hash', queryHash)
			.eq('max_results', maxResults)
			.maybeSingle<SearchCacheRow>();

		if (error) {
			logCacheError('Failed to load search cache entry.', error);
			return null;
		}

		if (!data || !Array.isArray(data.results) || data.results.length === 0) {
			return null;
		}

		if (isCacheEntryExpired(data.expires_at)) {
			return null;
		}

		void client
			.from(TABLE_NAME)
			.update({ last_hit_at: new Date().toISOString() })
			.eq('query_hash', queryHash)
			.eq('max_results', maxResults);

		return data.results;
	} catch (error) {
		logCacheError('Search cache query failed.', error);
		return null;
	}
};

export const saveSearchCacheEntry = async (
	queryHash: string,
	maxResults: number,
	results: YouTubeVideo[],
	source: SearchCacheSource,
): Promise<void> => {
	const client = getSupabaseClient();
	if (!client) return;

	const now = new Date();
	const expiresAt = new Date(now.getTime() + CACHE_TTL_MS).toISOString();

	const payload = {
		query_hash: queryHash,
		max_results: maxResults,
		results: clampResults(results, maxResults),
		source,
		updated_at: now.toISOString(),
		expires_at: expiresAt,
	};

	try {
		const { error } = await client
			.from(TABLE_NAME)
			.upsert(payload, { onConflict: 'query_hash,max_results' });

		if (error) {
			logCacheError('Failed to upsert search cache entry.', error);
		}
	} catch (error) {
		logCacheError('Search cache upsert failed.', error);
	}
};
