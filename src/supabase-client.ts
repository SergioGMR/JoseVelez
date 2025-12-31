import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import chalk from 'chalk';
import config from './config.js';

let supabaseClient: SupabaseClient | null = null;
let warnedMissingConfig = false;
let warnedLegacyKey = false;
let warnedMissingBotKey = false;

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

export const getSupabaseClient = (): SupabaseClient | null => {
	if (!config.supabase.enabled) {
		if (!warnedMissingConfig) {
			console.warn(chalk.yellow('Supabase is not configured; persistent storage is disabled.'));
			warnedMissingConfig = true;
		}
		return null;
	}

	if (!supabaseClient) {
		const key = config.supabase.key!;

		if (!warnedLegacyKey && isLegacyKey(key)) {
			console.warn(chalk.yellow('Supabase is using a legacy API key; consider SUPABASE_SECRET_KEY.'));
			warnedLegacyKey = true;
		}

		if (!warnedMissingBotKey && isNewKey(key) && !config.supabase.botKey) {
			console.warn(chalk.yellow('SUPABASE_PUBLISHABLE_KEY is set without SUPABASE_BOT_KEY; enable RLS and set a bot key to restrict access.'));
			warnedMissingBotKey = true;
		}

		const botHeader = config.supabase.botKey ? { 'x-bot-key': config.supabase.botKey } : undefined;

		supabaseClient = createClient(config.supabase.url!, key, {
			auth: { persistSession: false },
			global: {
				fetch: createSupabaseFetch(key),
				headers: botHeader,
			},
		});
	}

	return supabaseClient;
};
