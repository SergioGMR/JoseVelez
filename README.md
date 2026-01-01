# Discord Music Bot

[![Tests](https://github.com/SergioGMR/JoseVelez/actions/workflows/tests.yml/badge.svg)](https://github.com/SergioGMR/JoseVelez/actions/workflows/tests.yml)

A Discord music bot that searches and plays YouTube audio. Built to be stable, predictable, and mildly amused by your playlist choices.

## Features

- Slash commands to search, play, and control playback.
- Per-guild queue with control buttons (pause, skip, stop).
- YouTube Data API search with a non-API fallback when quota runs out.
- Optional Supabase persistence for queues.
- Persistent search cache with a 7-day TTL (Supabase).
- User-facing responses are in Spanish.

## Requirements

- Node.js 18+ or Bun.
- A Discord bot with voice permissions.
- (Optional) YouTube Data API v3 for better search results.
- (Optional) Supabase if you want persistent queues.

## Installation

```bash
bun install
```

## Configuration

Create a `.env` file in the project root:

```bash
DISCORD_TOKEN=your_token
DISCORD_CLIENT_ID=your_client_id
DISCORD_GUILD_ID=your_guild_id_optional
DISCORD_REGISTER_COMMANDS=true_optional

# YouTube (optional, but recommended)
YOUTUBE_API_KEY=your_api_key_1
YOUTUBE_API_KEY_2=your_api_key_2_optional
YOUTUBE_API_KEYS=your_api_key_3,your_api_key_4_optional

# yt-dlp (optional)
YTDLP_PATH=/path/to/yt-dlp_optional
YTDLP_AUTO_DOWNLOAD=false_optional

# Supabase (optional)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=your_secret_key
SUPABASE_PUBLISHABLE_KEY=your_publishable_key_optional
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_legacy
SUPABASE_ANON_KEY=your_anon_key_legacy
SUPABASE_BOT_KEY=your_bot_key_optional
SUPABASE_QUEUE_KEY=your_bot_key_legacy
```

Quick notes:
- If you skip YouTube API keys, the bot uses the non-API fallback search.
- `DISCORD_GUILD_ID` registers commands for a single guild (instant updates).
- For global registration, set `DISCORD_REGISTER_COMMANDS=true` without `DISCORD_GUILD_ID`.
- `YTDLP_AUTO_DOWNLOAD=false` disables auto-downloading `yt-dlp`.
- For Supabase, use `SUPABASE_SECRET_KEY` on trusted servers. If you use `SUPABASE_PUBLISHABLE_KEY`, enable RLS and set `SUPABASE_BOT_KEY`.

## Usage

Development:

```bash
bun run dev
```

Build and run:

```bash
bun run build
bun run start
```

With Node:

```bash
node dist/index.js
```

## Deployment (Dokploy)

This repo ships a Dockerfile for Bun. In Dokploy:

1) Create a new app from this GitHub repo.  
2) Build uses the included `Dockerfile`.  
3) Set environment variables: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, and any optional keys you need.  

Optional: Mount a volume for `~/.cache/discord-music-bot` if you want to persist the `yt-dlp` download.

## Commands

- `/buscar query:` Search YouTube and select a result.
- `/reproducir query:` Play a YouTube URL or the first search result.
- `/pausar`
- `/reanudar`
- `/saltar`
- `/cola`
- `/detener`
- `/ayuda`

## Testing

```bash
bun test
```

## Permissions and intents

Recommended bot permissions:
- View Channels
- Send Messages
- Embed Links
- Connect
- Speak

Enable these intents in the Discord portal:
- Guilds
- Guild Voice States

## Supabase queue persistence

If you want to persist the queue, create these tables in Supabase:

```sql
create table if not exists public.queue_items (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  video_id text,
  url text not null,
  title text,
  channel_title text,
  thumbnail text,
  duration text,
  description text,
  requested_by text,
  requested_by_id text,
  created_at timestamp with time zone default now()
);

create index if not exists queue_items_guild_id_created_at
  on public.queue_items (guild_id, created_at, id);

-- RLS recommended if you use SUPABASE_PUBLISHABLE_KEY
create extension if not exists pgcrypto;

create table if not exists public.queue_access (
  id int primary key default 1,
  key_hash text not null
);

insert into public.queue_access (id, key_hash)
values (1, crypt('YOUR_SUPER_SECRET_BOT_KEY', gen_salt('bf')))
on conflict (id) do update set key_hash = excluded.key_hash;

alter table public.queue_items enable row level security;

create policy "queue_items_bot_access"
on public.queue_items
for all
using (
  (current_setting('request.headers', true)::json ->> 'x-bot-key') is not null
  and (select crypt(current_setting('request.headers', true)::json ->> 'x-bot-key', key_hash) = key_hash
       from public.queue_access
       where id = 1)
)
with check (
  (current_setting('request.headers', true)::json ->> 'x-bot-key') is not null
  and (select crypt(current_setting('request.headers', true)::json ->> 'x-bot-key', key_hash) = key_hash
       from public.queue_access
       where id = 1)
);
```

## Supabase search cache

The search cache stores hashed queries only (no raw query text) and expires entries after 7 days.

```sql
create table if not exists public.search_cache (
  query_hash text not null,
  max_results int not null,
  results jsonb not null,
  source text not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  expires_at timestamp with time zone not null,
  last_hit_at timestamp with time zone
);

create unique index if not exists search_cache_query_hash_max_results
  on public.search_cache (query_hash, max_results);

alter table public.search_cache enable row level security;

create policy "search_cache_bot_access"
on public.search_cache
for all
using (
  (current_setting('request.headers', true)::json ->> 'x-bot-key') is not null
  and (select crypt(current_setting('request.headers', true)::json ->> 'x-bot-key', key_hash) = key_hash
       from public.queue_access
       where id = 1)
)
with check (
  (current_setting('request.headers', true)::json ->> 'x-bot-key') is not null
  and (select crypt(current_setting('request.headers', true)::json ->> 'x-bot-key', key_hash) = key_hash
       from public.queue_access
       where id = 1)
);
```

## Security notes

- Never share `DISCORD_TOKEN` or Supabase keys. Treat them like the last slice of pizza.
- Only direct YouTube URLs are accepted to reduce surprises.
- If you enable `yt-dlp` auto-download, make sure you are comfortable with that behavior.

## Command registration notes

Commands are registered only if `DISCORD_REGISTER_COMMANDS` is enabled. If you update commands and do not see changes:
- Use `DISCORD_GUILD_ID` for instant updates.
- For global commands, wait for Discord propagation.
