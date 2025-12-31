import crypto from 'crypto';

export const normalizeSearchQuery = (query: string): string =>
	query.trim().toLowerCase().replace(/\s+/g, ' ');

export const buildSearchCacheKey = (normalizedQuery: string, maxResults: number): string =>
	`${normalizedQuery}|${maxResults}`;

export const hashSearchQuery = (normalizedQuery: string): string =>
	crypto.createHash('sha256').update(normalizedQuery).digest('hex');

export const isCacheEntryExpired = (expiresAt?: string | null): boolean => {
	if (!expiresAt) return true;
	const timestamp = Date.parse(expiresAt);
	if (Number.isNaN(timestamp)) return true;
	return Date.now() >= timestamp;
};
