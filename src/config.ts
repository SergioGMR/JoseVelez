import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from .env.
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Ensure required variables are present.
if (!process.env.DISCORD_TOKEN) {
    throw new Error('DISCORD_TOKEN must be set in the .env file');
}

if (!process.env.DISCORD_CLIENT_ID) {
    throw new Error('DISCORD_CLIENT_ID must be set in the .env file');
}

const extraYouTubeKeys = Object.entries(process.env)
    .filter(([key, value]) => key.startsWith('YOUTUBE_API_KEY_') && value)
    .flatMap(([, value]) => value ? value.split(',') : []);

const youtubeApiKeys = [
    ...(process.env.YOUTUBE_API_KEYS ? process.env.YOUTUBE_API_KEYS.split(',') : []),
    ...(process.env.YOUTUBE_API_KEY ? process.env.YOUTUBE_API_KEY.split(',') : []),
    ...extraYouTubeKeys,
]
    .map(key => key.trim())
    .filter(Boolean);

if (youtubeApiKeys.length === 0) {
    console.warn('No YouTube API keys found; falling back to the non-API search.');
}

const supabaseUrl = process.env.SUPABASE_URL || null;
const supabaseKey =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    null;
const supabaseBotKey = process.env.SUPABASE_BOT_KEY || process.env.SUPABASE_QUEUE_KEY || null;

const registerCommandsEnv = process.env.DISCORD_REGISTER_COMMANDS;
const registerCommands = registerCommandsEnv
    ? registerCommandsEnv.toLowerCase() === 'true'
    : Boolean(process.env.DISCORD_GUILD_ID);

export default {
    token: process.env.DISCORD_TOKEN,
    youtubeApiKeys,
    clientId: process.env.DISCORD_CLIENT_ID,
    guildId: process.env.DISCORD_GUILD_ID || null,
    registerCommands,
    supabase: {
        url: supabaseUrl,
        key: supabaseKey,
        botKey: supabaseBotKey,
        enabled: Boolean(supabaseUrl && supabaseKey)
    }
};
