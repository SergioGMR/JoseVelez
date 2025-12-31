import { describe, expect, it } from 'bun:test';
import crypto from 'crypto';
import {
	buildSearchCacheKey,
	hashSearchQuery,
	isCacheEntryExpired,
	normalizeSearchQuery,
} from '../src/search-cache-utils.js';

describe('normalizeSearchQuery', () => {
	it('trims, lowercases, and collapses whitespace', () => {
		expect(normalizeSearchQuery('  Foo   BAR  ')).toBe('foo bar');
	});
});

describe('buildSearchCacheKey', () => {
	it('builds a stable key using the normalized query', () => {
		const normalized = normalizeSearchQuery('lofi   beats');
		expect(buildSearchCacheKey(normalized, 5)).toBe('lofi beats|5');
	});
});

describe('hashSearchQuery', () => {
	it('hashes the normalized query with sha256', () => {
		const normalized = normalizeSearchQuery('Vapor   Wave');
		const expected = crypto.createHash('sha256').update(normalized).digest('hex');
		expect(hashSearchQuery(normalized)).toBe(expected);
	});
});

describe('isCacheEntryExpired', () => {
	it('treats missing timestamps as expired', () => {
		expect(isCacheEntryExpired()).toBe(true);
		expect(isCacheEntryExpired(null)).toBe(true);
	});

	it('detects expired timestamps', () => {
		const past = new Date(Date.now() - 60_000).toISOString();
		expect(isCacheEntryExpired(past)).toBe(true);
	});

	it('keeps future timestamps as valid', () => {
		const future = new Date(Date.now() + 60_000).toISOString();
		expect(isCacheEntryExpired(future)).toBe(false);
	});
});
