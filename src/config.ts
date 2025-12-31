import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Cargar variables de entorno desde .env
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Verificar que las variables requeridas estén definidas
if (!process.env.DISCORD_TOKEN) {
    throw new Error('DISCORD_TOKEN debe estar definido en el archivo .env');
}

if (!process.env.DISCORD_CLIENT_ID) {
    throw new Error('DISCORD_CLIENT_ID debe estar definido en el archivo .env');
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
    console.warn('No se encontraron API keys de YouTube; se usara el buscador sin API como fallback.');
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
