# Discord Music Bot

Bot de musica para Discord que busca y reproduce canciones desde YouTube. Pensado para ser estable, predecible y con una dosis moderada de buen humor (no garantizamos que el algoritmo de YouTube lo comparta).

## Caracteristicas

- Comandos slash para buscar, reproducir y controlar musica.
- Cola por servidor con botones de control (pausar, saltar, detener).
- Busqueda con YouTube Data API y fallback sin API cuando la cuota se agota.
- Persistencia opcional de la cola con Supabase.

## Requisitos

- Node.js 18+ o Bun.
- Un bot de Discord con permisos de voz.
- (Opcional) YouTube Data API v3 para mejores resultados.
- (Opcional) Supabase si quieres cola persistente.

## Instalacion

```bash
bun install
```

## Configuracion

Crea un archivo `.env` en la raiz del proyecto:

```bash
DISCORD_TOKEN=tu_token
DISCORD_CLIENT_ID=tu_client_id
DISCORD_GUILD_ID=tu_guild_id_opcional
DISCORD_REGISTER_COMMANDS=true_opcional

# YouTube (opcional, pero recomendado)
YOUTUBE_API_KEY=tu_api_key_1
YOUTUBE_API_KEY_2=tu_api_key_2_opcional
YOUTUBE_API_KEYS=tu_api_key_3,tu_api_key_4_opcional

# yt-dlp (opcional)
YTDLP_PATH=/ruta/a/yt-dlp_opcional
YTDLP_AUTO_DOWNLOAD=false_opcional

# Supabase (opcional)
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_SECRET_KEY=tu_secret_key
SUPABASE_PUBLISHABLE_KEY=tu_publishable_key_opcional
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key_legacy
SUPABASE_ANON_KEY=tu_anon_key_legacy
SUPABASE_BOT_KEY=tu_bot_key_opcional
SUPABASE_QUEUE_KEY=tu_bot_key_legacy
```

Notas rapidas:
- Si no defines claves de YouTube, el bot usa el buscador sin API (menos preciso, pero no se queja de cuotas).
- `DISCORD_GUILD_ID` registra comandos solo en ese servidor (actualizacion inmediata).
- Para registro global, define `DISCORD_REGISTER_COMMANDS=true` sin `DISCORD_GUILD_ID`.
- `YTDLP_AUTO_DOWNLOAD=false` desactiva la descarga automatica de `yt-dlp`.
- En Supabase, usa `SUPABASE_SECRET_KEY` en servidores de confianza. Si usas `SUPABASE_PUBLISHABLE_KEY`, habilita RLS y define `SUPABASE_BOT_KEY`.

## Uso

Desarrollo:

```bash
bun run dev
```

Build y ejecucion:

```bash
bun run build
bun run start
```

Si prefieres Node:

```bash
node dist/index.js
```

## Comandos

- `/buscar query:` Busca resultados en YouTube y permite elegir una cancion.
- `/reproducir query:` Reproduce un resultado o una URL de YouTube.
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

## Permisos e intents

Permisos recomendados para el bot:
- View Channels
- Send Messages
- Embed Links
- Connect
- Speak

En el portal de Discord, activa los intents:
- Guilds
- Guild Voice States

## Persistencia de cola (Supabase)

Si quieres que la cola se guarde en la base de datos, crea estas tablas en Supabase:

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

-- RLS recomendado si usas SUPABASE_PUBLISHABLE_KEY
create extension if not exists pgcrypto;

create table if not exists public.queue_access (
  id int primary key default 1,
  key_hash text not null
);

insert into public.queue_access (id, key_hash)
values (1, crypt('TU_BOT_KEY_SUPER_SECRETA', gen_salt('bf')))
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

## Notas de seguridad (sin asustar, pero con cafe)

- Nunca compartas `DISCORD_TOKEN` ni tus claves de Supabase. Son mas valiosas que el ultimo tema de tu playlist.
- Solo se aceptan enlaces directos de YouTube para evitar sorpresas.
- Si habilitas la descarga automatica de `yt-dlp`, asegurate de estar comodo con ese flujo.

## Notas de registro de comandos

Al iniciar el bot se registran los comandos slash solo si `DISCORD_REGISTER_COMMANDS` esta activado. Si cambias los comandos y no ves los cambios:
- Usa `DISCORD_GUILD_ID` para actualizar al instante.
- Si son globales, espera la propagacion de Discord.
