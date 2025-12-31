import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import chalk from 'chalk';
import config from './config.js';
import type { YouTubeVideo } from './types.js';

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

let supabaseClient: SupabaseClient | null = null;
let warnedMissingConfig = false;
let warnedLegacyKey = false;
let warnedMissingBotKey = false;

const getClient = (): SupabaseClient | null => {
	if (!config.supabase.enabled) {
		if (!warnedMissingConfig) {
			console.warn(chalk.yellow('Supabase no esta configurado; la cola persistente esta desactivada.'));
			warnedMissingConfig = true;
		}
		return null;
	}

	if (!supabaseClient) {
		const key = config.supabase.key!;

		if (!warnedLegacyKey && isLegacyKey(key)) {
			console.warn(chalk.yellow('Supabase usa una API key legacy; considera SUPABASE_SECRET_KEY.'));
			warnedLegacyKey = true;
		}

		if (!warnedMissingBotKey && isNewKey(key) && !config.supabase.botKey) {
			console.warn(chalk.yellow('Usas SUPABASE_PUBLISHABLE_KEY sin SUPABASE_BOT_KEY; habilita RLS y el bot key si quieres restringir acceso.'));
			warnedMissingBotKey = true;
		}

		const botHeader = config.supabase.botKey ? { 'x-bot-key': config.supabase.botKey } : undefined;

		supabaseClient = createClient(config.supabase.url!, key, {
			auth: { persistSession: false },
			global: {
				fetch: createSupabaseFetch(key),
				headers: botHeader
			}
		});
	}

	return supabaseClient;
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

const isLegacyKey = (key: string): boolean => key.startsWith('eyJ');

const isNewKey = (key: string): boolean =>
	key.startsWith('sb_publishable_') || key.startsWith('sb_secret_');

const createSupabaseFetch = (key: string): typeof fetch | undefined => {
	if (!isNewKey(key)) return undefined;

	const bearerValue = `Bearer ${key}`;

	return async (input, init) => {
		const headers = new Headers(init?.headers);
		if (headers.get('Authorization') === bearerValue) {
			headers.delete('Authorization');
		}

		return fetch(input, { ...init, headers });
	};
};

export const loadQueue = async (guildId: string): Promise<YouTubeVideo[]> => {
	const client = getClient();
	if (!client) return [];

	try {
		const { data, error } = await client
			.from(TABLE_NAME)
			.select('id, guild_id, video_id, url, title, channel_title, thumbnail, duration, description, requested_by, requested_by_id, created_at')
			.eq('guild_id', guildId)
			.order('created_at', { ascending: true })
			.order('id', { ascending: true });

		if (error) {
			logStoreError('No se pudo cargar la cola desde Supabase.', error);
			return [];
		}

		return (data ?? []).map(mapRowToVideo);
	} catch (error) {
		logStoreError('Fallo al consultar Supabase para cargar la cola.', error);
		return [];
	}
};

export const addQueueItem = async (guildId: string, item: YouTubeVideo): Promise<string | null> => {
	const client = getClient();
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
			logStoreError('No se pudo guardar la cola en Supabase.', error);
			return null;
		}

		return data?.id ?? null;
	} catch (error) {
		logStoreError('Fallo al guardar en Supabase.', error);
		return null;
	}
};

export const removeQueueItem = async (guildId: string, queueItemId: string): Promise<void> => {
	const client = getClient();
	if (!client) return;

	try {
		const { error } = await client
			.from(TABLE_NAME)
			.delete()
			.eq('id', queueItemId)
			.eq('guild_id', guildId);

		if (error) {
			logStoreError('No se pudo eliminar un item de la cola en Supabase.', error);
		}
	} catch (error) {
		logStoreError('Fallo al eliminar un item en Supabase.', error);
	}
};

export const clearQueue = async (guildId: string): Promise<void> => {
	const client = getClient();
	if (!client) return;

	try {
		const { error } = await client
			.from(TABLE_NAME)
			.delete()
			.eq('guild_id', guildId);

		if (error) {
			logStoreError('No se pudo limpiar la cola en Supabase.', error);
		}
	} catch (error) {
		logStoreError('Fallo al limpiar la cola en Supabase.', error);
	}
};
