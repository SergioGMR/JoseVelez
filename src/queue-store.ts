import chalk from 'chalk';
import type { YouTubeVideo } from './types.js';
import { getSupabaseClient } from './supabase-client.js';

const TABLE_NAME = 'queue_items';

type QueueRow = {
	id: string;
	guild_id: string;
	video_id: string | null;
	url: string;
	title: string | null;
	channel_title: string | null;
	thumbnail: string | null;
	duration: string | null;
	description: string | null;
	requested_by: string | null;
	requested_by_id: string | null;
	created_at: string;
};

const logStoreError = (message: string, error: unknown): void => {
	console.warn(chalk.yellow(message), error);
};

const mapRowToVideo = (row: QueueRow): YouTubeVideo => ({
	id: row.video_id ?? row.url,
	title: row.title ?? 'Sin titulo',
	url: row.url,
	channelTitle: row.channel_title ?? 'Canal desconocido',
	thumbnail: row.thumbnail ?? '',
	description: row.description ?? '',
	duration: row.duration ?? 'Desconocida',
	requestedBy: row.requested_by ?? undefined,
	requestedById: row.requested_by_id ?? undefined,
	queueItemId: row.id
});

export const loadQueue = async (guildId: string): Promise<YouTubeVideo[]> => {
	const client = getSupabaseClient();
	if (!client) return [];

	try {
		const { data, error } = await client
			.from(TABLE_NAME)
			.select('id, guild_id, video_id, url, title, channel_title, thumbnail, duration, description, requested_by, requested_by_id, created_at')
			.eq('guild_id', guildId)
			.order('created_at', { ascending: true })
			.order('id', { ascending: true });

		if (error) {
			logStoreError('Failed to load the queue from Supabase.', error);
			return [];
		}

		return (data ?? []).map(mapRowToVideo);
	} catch (error) {
		logStoreError('Supabase query failed while loading the queue.', error);
		return [];
	}
};

export const addQueueItem = async (guildId: string, item: YouTubeVideo): Promise<string | null> => {
	const client = getSupabaseClient();
	if (!client) return null;

	try {
		const { data, error } = await client
			.from(TABLE_NAME)
			.insert({
				guild_id: guildId,
				video_id: item.id,
				url: item.url,
				title: item.title,
				channel_title: item.channelTitle,
				thumbnail: item.thumbnail,
				duration: item.duration ?? null,
				description: item.description ?? null,
				requested_by: item.requestedBy ?? null,
				requested_by_id: item.requestedById ?? null
			})
			.select('id')
			.single();

		if (error) {
			logStoreError('Failed to persist the queue in Supabase.', error);
			return null;
		}

		return data?.id ?? null;
	} catch (error) {
		logStoreError('Supabase insert failed while saving the queue.', error);
		return null;
	}
};

export const removeQueueItem = async (guildId: string, queueItemId: string): Promise<void> => {
	const client = getSupabaseClient();
	if (!client) return;

	try {
		const { error } = await client
			.from(TABLE_NAME)
			.delete()
			.eq('id', queueItemId)
			.eq('guild_id', guildId);

		if (error) {
			logStoreError('Failed to delete a queue item in Supabase.', error);
		}
	} catch (error) {
		logStoreError('Supabase delete failed while removing a queue item.', error);
	}
};

export const clearQueue = async (guildId: string): Promise<void> => {
	const client = getSupabaseClient();
	if (!client) return;

	try {
		const { error } = await client
			.from(TABLE_NAME)
			.delete()
			.eq('guild_id', guildId);

		if (error) {
			logStoreError('Failed to clear the queue in Supabase.', error);
		}
	} catch (error) {
		logStoreError('Supabase delete failed while clearing the queue.', error);
	}
};
