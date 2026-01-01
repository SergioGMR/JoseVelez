# Discord Music Bot

[![Tests](https://github.com/SergioGMR/JoseVelez/actions/workflows/tests.yml/badge.svg)](https://github.com/SergioGMR/JoseVelez/actions/workflows/tests.yml)

A Discord music bot that searches and plays YouTube audio. Built to be stable, predictable, and mildly amused by your playlist choices.

## Features

- Slash commands to search, play, and control playback.
- Per-guild queue with control buttons (pause, skip, stop).
- YouTube Data API search with a non-API fallback when quota runs out.
- SoundCloud fallback for playback when YouTube blocks streaming.
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
YTDLP_COOKIES_PATH=/path/to/cookies.txt_optional
YTDLP_PO_TOKEN=your_po_token_optional
YTDLP_PLAYER_CLIENT=default,mweb_optional

# SoundCloud (optional)
SOUNDCLOUD_CLIENT_ID=your_client_id_optional

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
- If you want to avoid Python, use the standalone `yt-dlp` binary and set `YTDLP_PATH`.
- `YTDLP_COOKIES_PATH` lets you pass a cookies file for age-restricted or bot-checked videos.
- `YTDLP_PO_TOKEN` can be used to pass YouTube PO Tokens (see the section below).
- `YTDLP_PLAYER_CLIENT` defaults to `default,mweb` when `YTDLP_PO_TOKEN` is set.
- If you set `SOUNDCLOUD_CLIENT_ID`, it overrides the auto-discovered client id.
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
4) If you update the Dockerfile, rebuild without cache to make sure the image refreshes.  

Optional: Mount a volume for `~/.cache/discord-music-bot` if you want to persist the `yt-dlp` download.
The Dockerfile downloads the standalone `yt-dlp` binary, so no Python is required.
If you provide `YTDLP_COOKIES_PATH`, mount that file into the container too.

## Commands

- `/buscar query:` Search YouTube and select a result.
- `/buscar query:` For multiple queries separated by `;` or `,`, it auto-queues the best match per query.
- `/reproducir query:` Play a YouTube URL or the first search result. You can pass multiple queries separated by `;` or `,`.
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
- If you use `YTDLP_COOKIES_PATH`, treat the cookies file like a session token.

## Troubleshooting

### "yt-dlp is not available; install yt-dlp or set YTDLP_PATH"

- Make sure you rebuilt the Docker image after the Dockerfile update.
- Confirm `YTDLP_PATH=/usr/local/bin/yt-dlp` is set in your container env.
- Check the file is executable: `ls -l /usr/local/bin/yt-dlp`.
- Verify the binary runs: `/usr/local/bin/yt-dlp --version`.

### "Sign in to confirm you're not a bot"

- This means YouTube blocked `play-dl`/`ytdl`. Use `yt-dlp` with cookies.
- Mount a `cookies.txt` file (Netscape format) and set `YTDLP_COOKIES_PATH`.
- You can also provide a PO Token for the `mweb` client (see below), but it typically still requires cookies.

### "YouTube blocked but SoundCloud fallback did not play"

- The fallback runs a SoundCloud search using the track title and channel.
- If it still fails, try a more specific query or provide cookies for YouTube.

## YouTube PO Token (advanced)

PO Tokens (Proof of Origin) are required by YouTube for some clients. They are tied to your session and expire.
If you want to use them with `yt-dlp`, set `YTDLP_PO_TOKEN` and optionally `YTDLP_PLAYER_CLIENT`.

Quick manual extraction (for `mweb` GVS token):
1) Open https://music.youtube.com in your browser.
2) Open DevTools, go to Network, filter by `v1/player`.
3) Play a track and open the latest `player` request.
4) In the JSON payload, copy `serviceIntegrityDimensions.poToken`.
5) Export YouTube cookies to a `cookies.txt` (Netscape format).
6) Set:
   - `YTDLP_PO_TOKEN=<token>`
   - `YTDLP_PLAYER_CLIENT=default,mweb`
   - `YTDLP_COOKIES_PATH=/path/to/cookies.txt`

Helper script (optional):
1) In DevTools, "Copy request payload" and save it to `payload.json`.
2) Run:
   - `bun scripts/extract-po-token.ts payload.json`
3) Use the printed env values.

Notes:
- If your token already includes a prefix like `mweb.gvs+`, you can paste it as-is.
- Tokens are short-lived; you will need to refresh them periodically.

### "Could not find the table 'public.search_cache'"

- Create the Supabase tables in the sections above, or remove Supabase env vars if you do not want persistence.

## Command registration notes

Commands are registered only if `DISCORD_REGISTER_COMMANDS` is enabled. If you update commands and do not see changes:
- Use `DISCORD_GUILD_ID` for instant updates.
- For global commands, wait for Discord propagation.
