import { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState, StreamType } from '@discordjs/voice';
import { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { BotClient, ServerQueue, YouTubeVideo } from './types.js';
import { CommandContext } from './interaction-utils.js';
import config from './config.js';
import { Readable } from 'stream';
import { getPlayDl } from './playdl.js';
import { ensureYtDlpAvailable, spawnYtDlpStream } from './ytdlp.js';
import { getYtdl } from './ytdl.js';
import { addQueueItem, clearQueue, loadQueue, removeQueueItem } from './queue-store.js';
import { loadSearchCacheEntry, saveSearchCacheEntry } from './search-cache-store.js';
import { buildSearchCacheKey, hashSearchQuery, normalizeSearchQuery } from './search-cache-utils.js';
import { extractYouTubeId } from './youtube-utils.js';
import { buildSoundCloudQuery, isYouTubeLoginRequiredError } from './fallback-utils.js';
import { createSoundCloudStream, isSoundCloudUrl, searchSoundCloudTracks } from './soundcloud.js';
import { pickBestVideo } from './commands/play-utils.js';
import axios from 'axios';
import yts from 'yt-search';
import chalk from 'chalk';

const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const SEARCH_CACHE_MAX_ENTRIES = 100;
const SOUNDCLOUD_FALLBACK_LIMIT = 5;
const searchCache = new Map<string, { expiresAt: number; results: YouTubeVideo[] }>();

let youtubeApiKeyIndex = 0;
const queueLoadPromises = new Map<string, Promise<void>>();

const YTDLP_STREAM_ARGS = [
    '--no-playlist',
    '-f',
    'bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio',
    '--no-warnings',
    '--no-progress'
];

const resolveTrackSource = (track: YouTubeVideo): 'youtube' | 'soundcloud' => {
    if (track.source === 'soundcloud') return 'soundcloud';
    if (track.source === 'youtube') return 'youtube';
    return isSoundCloudUrl(track.url) ? 'soundcloud' : 'youtube';
};

const applyFallbackTrack = (target: YouTubeVideo, fallback: YouTubeVideo): void => {
    const { requestedBy, requestedById, queueItemId } = target;
    Object.assign(target, fallback, {
        requestedBy,
        requestedById,
        queueItemId,
        fallbackAttempted: true
    });
};

const resolveSoundCloudFallback = async (track: YouTubeVideo): Promise<YouTubeVideo | null> => {
    const query = buildSoundCloudQuery(track);
    if (!query) return null;

    const results = await searchSoundCloudTracks(query, SOUNDCLOUD_FALLBACK_LIMIT);
    if (results.length === 0) return null;

    return pickBestVideo(results, query) ?? results[0];
};

const getCachedSearch = (cacheKey: string): YouTubeVideo[] | null => {
    const cached = searchCache.get(cacheKey);
    if (!cached) return null;

    if (Date.now() > cached.expiresAt) {
        searchCache.delete(cacheKey);
        return null;
    }

    return cached.results;
};

const setCachedSearch = (cacheKey: string, results: YouTubeVideo[]): void => {
    searchCache.set(cacheKey, {
        expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
        results
    });

    if (searchCache.size > SEARCH_CACHE_MAX_ENTRIES) {
        const oldestKey = searchCache.keys().next().value;
        if (oldestKey) {
            searchCache.delete(oldestKey);
        }
    }
};

const getApiKeySequence = (): string[] => {
    const keys = config.youtubeApiKeys;
    if (keys.length === 0) return [];

    const startIndex = youtubeApiKeyIndex % keys.length;
    youtubeApiKeyIndex = (youtubeApiKeyIndex + 1) % keys.length;

    return keys.slice(startIndex).concat(keys.slice(0, startIndex));
};

const shouldRotateKey = (error: unknown): boolean => {
    if (!axios.isAxiosError(error)) return false;

    const status = error.response?.status;
    const reason = error.response?.data?.error?.errors?.[0]?.reason;
    const message = error.response?.data?.error?.message ?? '';

    if (status === 403) {
        return [
            'quotaExceeded',
            'dailyLimitExceeded',
            'userRateLimitExceeded',
            'rateLimitExceeded',
            'accessNotConfigured'
        ].includes(reason) || /quota|limit/i.test(message);
    }

    if (status === 400) {
        return reason === 'keyInvalid' || /key/i.test(message);
    }

    return false;
};

const logSearchError = (context: string, error: unknown): void => {
    if (!axios.isAxiosError(error)) {
        console.error(chalk.red(context), error);
        return;
    }

    const status = error.response?.status ?? 'unknown status';
    const reason = error.response?.data?.error?.errors?.[0]?.reason;
    const message = error.response?.data?.error?.message ?? error.message;

    console.error(chalk.red(`${context} (status ${status}${reason ? `, ${reason}` : ''}): ${message}`));
};

const searchYouTubeFallback = async (query: string, maxResults: number): Promise<YouTubeVideo[]> => {
    console.log(chalk.yellow('Using YouTube fallback search without the API.'));
    const result = await yts(query);

    return result.videos
        .slice(0, Math.min(maxResults, 10))
        .map(video => ({
            id: video.videoId,
            title: video.title || 'Sin titulo',
            url: video.url || `https://www.youtube.com/watch?v=${video.videoId}`,
            channelTitle: video.author?.name || 'Canal desconocido',
            thumbnail: video.thumbnail || video.image || '',
            description: video.description || '',
            duration: video.timestamp || video.duration?.timestamp || 'Desconocida',
            source: 'youtube' as const
        }))
        .filter(video => video.id && video.url);
};

const searchYouTubeWithApi = async (query: string, maxResults: number): Promise<YouTubeVideo[] | null> => {
    const apiKeys = getApiKeySequence();
    if (apiKeys.length === 0) return null;

    let lastError: unknown;

    for (let index = 0; index < apiKeys.length; index += 1) {
        const apiKey = apiKeys[index];

        try {
            const searchResponse = await axios.get('https://www.googleapis.com/youtube/v3/search', {
                params: {
                    part: 'snippet',
                    type: 'video',
                    maxResults: Math.min(maxResults, 10),
                    q: query,
                    key: apiKey
                },
                timeout: 10000
            });

            if (!searchResponse.data.items || searchResponse.data.items.length === 0) {
                return [];
            }

            const videoIds = searchResponse.data.items
                .map((item: any) => item.id.videoId)
                .filter(Boolean)
                .join(',');

            if (!videoIds) {
                return [];
            }

            const detailKeys = apiKeys.slice(index).concat(apiKeys.slice(0, index));
            const detailsMap = new Map();
            let detailsFetched = false;
            let detailError: unknown;

            for (const detailKey of detailKeys) {
                try {
                    const videoDetails = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
                        params: {
                            part: 'contentDetails,snippet',
                            id: videoIds,
                            key: detailKey
                        },
                        timeout: 10000
                    });

                    if (videoDetails.data.items) {
                        videoDetails.data.items.forEach((item: any) => {
                            if (item.id) {
                                detailsMap.set(item.id, item);
                            }
                        });
                    }

                    detailsFetched = true;
                    break;
                } catch (error) {
                    detailError = error;
                    if (!shouldRotateKey(error)) {
                        break;
                    }
                }
            }

            if (!detailsFetched) {
                lastError = detailError;
                if (detailError && shouldRotateKey(detailError)) {
                    continue;
                }
                break;
            }

            const results = searchResponse.data.items
                .map((item: any) => {
                    const videoId = item.id.videoId;
                    const details = detailsMap.get(videoId);

                    let duration = 'Desconocida';
                    if (details?.contentDetails?.duration) {
                        try {
                            duration = formatDuration(details.contentDetails.duration);
                        } catch (error) {
                            console.error(chalk.yellow('Failed to format duration:'), error);
                        }
                    }

                    return {
                        id: videoId,
                        title: item.snippet.title || 'Sin titulo',
                        url: `https://www.youtube.com/watch?v=${videoId}`,
                        channelTitle: item.snippet.channelTitle || 'Canal desconocido',
                        thumbnail: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url || '',
                        description: item.snippet.description || '',
                        duration,
                        source: 'youtube' as const
                    };
                })
                .filter((video: YouTubeVideo) => video.id && video.url);

            return results;
        } catch (error) {
            lastError = error;
            if (shouldRotateKey(error)) {
                continue;
            }
            break;
        }
    }

    if (lastError) {
        logSearchError('YouTube API search failed', lastError);
    }

    return null;
};

export const searchYouTube = async (query: string, maxResults = 5): Promise<YouTubeVideo[]> => {
    console.log(chalk.yellow(`Searching YouTube: ${query}`));

    const normalizedQuery = normalizeSearchQuery(query);
    if (!normalizedQuery) {
        throw new Error('Empty search query');
    }

    const sanitizedQuery = query.trim();
    const cacheKey = buildSearchCacheKey(normalizedQuery, maxResults);
    const cached = getCachedSearch(cacheKey);
    if (cached) {
        return cached;
    }

    const queryHash = hashSearchQuery(normalizedQuery);
    const persistedResults = await loadSearchCacheEntry(queryHash, maxResults);
    if (persistedResults && persistedResults.length > 0) {
        setCachedSearch(cacheKey, persistedResults);
        return persistedResults;
    }

    const apiResults = await searchYouTubeWithApi(sanitizedQuery, maxResults);
    if (apiResults !== null) {
        setCachedSearch(cacheKey, apiResults);
        void saveSearchCacheEntry(queryHash, maxResults, apiResults, 'api');
        return apiResults;
    }

    try {
        const fallbackResults = await searchYouTubeFallback(sanitizedQuery, maxResults);
        setCachedSearch(cacheKey, fallbackResults);
        void saveSearchCacheEntry(queryHash, maxResults, fallbackResults, 'fallback');
        return fallbackResults;
    } catch (error) {
        logSearchError('Fallback search failed', error);
        throw error;
    }
};

const createServerQueue = (): ServerQueue => ({
    queue: [],
    currentSearch: null,
    playing: false,
    connection: null,
    player: null,
    searchMessage: null,
    queueLoaded: false,
    handlingError: false
});

const getServerQueue = (guildId: string, client: BotClient): ServerQueue => {
    let serverQueue = client.musicQueues.get(guildId);
    if (!serverQueue) {
        serverQueue = createServerQueue();
        client.musicQueues.set(guildId, serverQueue);
    }

    return serverQueue;
};

const ensureQueueLoaded = async (guildId: string, serverQueue: ServerQueue): Promise<void> => {
    if (serverQueue.queueLoaded) return;

    let pending = queueLoadPromises.get(guildId);
    if (!pending) {
        pending = (async () => {
            const storedQueue = await loadQueue(guildId);
            if (storedQueue.length > 0 && serverQueue.queue.length === 0) {
                serverQueue.queue = storedQueue;
            }
            serverQueue.queueLoaded = true;
        })();
        queueLoadPromises.set(guildId, pending);
    }

    try {
        await pending;
    } finally {
        queueLoadPromises.delete(guildId);
    }
};

const appendQueueItem = async (guildId: string, item: YouTubeVideo): Promise<void> => {
    const queueItemId = await addQueueItem(guildId, item);
    if (queueItemId) {
        item.queueItemId = queueItemId;
    }
};

const shiftQueueItem = (guildId: string, serverQueue: ServerQueue): void => {
    const removed = serverQueue.queue.shift();
    if (removed?.queueItemId) {
        void removeQueueItem(guildId, removed.queueItemId);
    }
};

const createAudioStream = async (track: YouTubeVideo): Promise<{ stream: Readable; streamType: StreamType; source: string }> => {
    const resolvedSource = resolveTrackSource(track);
    if (resolvedSource === 'soundcloud') {
        return createSoundCloudStream(track.url);
    }

    const videoId = extractYouTubeId(track.url);
    const targetUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : track.url;

    try {
        const ytDlpAvailable = await ensureYtDlpAvailable();
        if (ytDlpAvailable) {
            const stream = await spawnYtDlpStream([...YTDLP_STREAM_ARGS, targetUrl]);
            return {
                stream: stream as Readable,
                streamType: StreamType.Arbitrary,
                source: 'yt-dlp'
            };
        }

        console.warn(chalk.yellow('yt-dlp is not available; install yt-dlp or set YTDLP_PATH.'));
    } catch (error) {
        console.warn(chalk.yellow('Failed to use yt-dlp, trying play-dl.'), error);
    }

    try {
        const playdl = await getPlayDl();
        const streamInfo = await playdl.stream(targetUrl, { discordPlayerCompatibility: true });
        return {
            stream: streamInfo.stream as unknown as Readable,
            streamType: streamInfo.type as unknown as StreamType,
            source: 'play-dl'
        };
    } catch (error) {
        console.warn(chalk.yellow('Failed to use play-dl, trying ytdl.'), error);
    }

    const ytdl = await getYtdl();
    const stream = ytdl(targetUrl, {
        filter: 'audioonly',
        quality: 'highestaudio',
        highWaterMark: 1 << 25
    });

    return {
        stream: stream as Readable,
        streamType: StreamType.Arbitrary,
        source: 'ytdl'
    };
};

export const play = async (context: CommandContext, video: YouTubeVideo, client: BotClient): Promise<void> => {
    try {
        const guildId = context.guildId;
        const channel = context.channel;
        const voiceChannel = context.member.voice.channel;
        if (!voiceChannel) {
            await channel.send('¡Necesitas estar en un canal de voz para reproducir música!');
            return;
        }

        const serverQueue = getServerQueue(guildId, client);
        await ensureQueueLoaded(guildId, serverQueue);

        serverQueue.textChannelId = channel.id;

        const requestedBy = context.member.displayName || context.member.user.username;
        const queuedSong = { ...video, requestedBy, requestedById: context.member.id };

        // Add the song to the queue.
        serverQueue.queue.push(queuedSong);
        await appendQueueItem(guildId, queuedSong);

        if (!serverQueue.playing) {
            try {
                if (!serverQueue.connection) {
                    const connection = joinVoiceChannel({
                        channelId: voiceChannel.id,
                        guildId: guildId,
                        adapterCreator: context.member.guild.voiceAdapterCreator,
                    });

                    serverQueue.connection = connection;
                    serverQueue.voiceChannelId = voiceChannel.id;

                    connection.on(VoiceConnectionStatus.Disconnected, async () => {
                        try {
                            await Promise.race([
                                entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                                entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                            ]);
                        } catch (error) {
                            connection.destroy();
                            serverQueue.connection = null;
                            serverQueue.playing = false;
                            serverQueue.queue = [];
                            serverQueue.voiceChannelId = undefined;
                            channel.send('Desconectado del canal de voz.');
                        }
                    });
                }

                if (!serverQueue.player) {
                    const player = createAudioPlayer();
                    serverQueue.player = player;
                    serverQueue.connection.subscribe(player);

                    player.on(AudioPlayerStatus.Idle, () => {
                        shiftQueueItem(guildId, serverQueue);
                        if (serverQueue.queue.length > 0) {
                            playNext(context, client);
                        } else {
                            serverQueue.playing = false;
                            channel.send({
                                embeds: [
                                    new EmbedBuilder()
                                        .setColor('#2f3136')
                                        .setDescription('🎵 La cola de reproducción ha terminado.')
                                ]
                            });
                        }
                    });

                    player.on('error', error => {
                        void handlePlaybackFailure(context, client, serverQueue, error);
                    });
                }

                await playNext(context, client);

            } catch (error) {
                console.error(chalk.red('Failed to play audio:'), error);
                channel.send('Ocurrió un error al reproducir la canción.');
                serverQueue.playing = false;
            }
        } else {
            const embed = new EmbedBuilder()
                .setColor('#3498db')
                .setTitle('🎵 Canción añadida a la cola')
                .setDescription(`**${video.title}**`)
                .setThumbnail(video.thumbnail)
                .addFields(
                    { name: 'Canal', value: video.channelTitle, inline: true },
                    { name: 'Duración', value: video.duration || 'Desconocida', inline: true }
                )
                .setTimestamp();

            channel.send({ embeds: [embed] });
        }
    } catch (error) {
        console.error(chalk.red('Error in play():'), error);
    }
};

// Utility helper for consistent error handling.
const handleError = (context: CommandContext, error: any, errorText: string): void => {
    console.error(chalk.red(errorText), error);
    context.channel.send({
        embeds: [
            new EmbedBuilder()
                .setColor('#e74c3c')
                .setTitle('❌ Error')
                .setDescription(`${errorText}. Por favor intenta de nuevo más tarde.`)
                .setTimestamp()
        ]
    }).catch((err: unknown) => console.error('Failed to send error message:', err));
};

const handlePlaybackFailure = async (
    context: CommandContext,
    client: BotClient,
    serverQueue: ServerQueue,
    error: unknown
): Promise<void> => {
    if (serverQueue.handlingError) return;
    serverQueue.handlingError = true;

    const channel = context.channel;
    const guildId = context.guildId;

    try {
        console.error(chalk.red('Audio player error:'), error);

        const currentSong = serverQueue.queue[0];
        if (currentSong) {
            const resolvedSource = resolveTrackSource(currentSong);
            const shouldFallback = resolvedSource === 'youtube'
                && !currentSong.fallbackAttempted
                && isYouTubeLoginRequiredError(error);

            if (shouldFallback) {
                currentSong.fallbackAttempted = true;
                const fallbackTrack = await resolveSoundCloudFallback(currentSong);
                if (fallbackTrack) {
                    applyFallbackTrack(currentSong, fallbackTrack);
                    void channel.send(`YouTube bloqueo este audio. Usando SoundCloud: **${fallbackTrack.title}**`);
                    serverQueue.player?.stop(true);
                    await playNext(context, client);
                    return;
                }
            }
        }

        channel.send('Ocurrió un error durante la reproducción.');
        shiftQueueItem(guildId, serverQueue);
        if (serverQueue.queue.length > 0) {
            await playNext(context, client);
        } else {
            serverQueue.playing = false;
        }
    } finally {
        serverQueue.handlingError = false;
    }
};

export const playNext = async (context: CommandContext, client: BotClient): Promise<void> => {
    const guildId = context.guildId;
    const channel = context.channel;

    const serverQueue = client.musicQueues.get(guildId);
    if (!serverQueue || serverQueue.queue.length === 0) {
        if (serverQueue) serverQueue.playing = false;
        return;
    }

    const currentSong = serverQueue.queue[0];
    serverQueue.playing = true;

    try {
        // Validate the URL before attempting playback.
        if (!currentSong.url) {
            throw new Error('Invalid track URL');
        }

        const resolvedSource = resolveTrackSource(currentSong);
        if (resolvedSource === 'youtube' && !extractYouTubeId(currentSong.url)) {
            throw new Error('Invalid YouTube URL');
        }

        const { stream, streamType } = await createAudioStream(currentSong);

        const resource = createAudioResource(stream, { inputType: streamType });
        serverQueue.player?.play(resource);

        const embed = new EmbedBuilder()
            .setColor('#2ecc71')
            .setTitle('🎶 Reproduciendo ahora')
            .setDescription(`**${currentSong.title}**`)
            .setURL(currentSong.url)
            .setThumbnail(currentSong.thumbnail)
            .addFields(
                { name: 'Canal', value: currentSong.channelTitle, inline: true },
                { name: 'Duración', value: currentSong.duration || 'Desconocida', inline: true }
            )
            .setFooter({ text: `Pedida por: ${currentSong.requestedBy || context.member.displayName || context.member.user.username}` });

        const row = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('pause_resume')
                    .setLabel('⏯️ Pausar/Reanudar')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('skip')
                    .setLabel('⏭️ Saltar')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('stop')
                    .setLabel('⏹️ Detener')
                    .setStyle(ButtonStyle.Danger)
            );

        channel.send({ embeds: [embed], components: [row] })
            .then(msg => {
                const collector = msg.createMessageComponentCollector({
                    componentType: ComponentType.Button,
                    time: 600000
                });

                collector.on('collect', async (interaction) => {
                    if (!interaction.isButton() || !interaction.inCachedGuild()) return;

                    const member = interaction.member;
                    const botMember = interaction.guild.members.me;
                    if (!botMember) return;

                    const permissions = interaction.channel?.permissionsFor(botMember);
                    if (!permissions?.has(PermissionFlagsBits.SendMessages)) return;

                    const botVoiceChannelId = interaction.guild.members.me?.voice.channelId;
                    if (botVoiceChannelId) {
                        serverQueue.voiceChannelId = botVoiceChannelId;
                    }

                    const targetVoiceChannelId = botVoiceChannelId ?? serverQueue.voiceChannelId;
                    if (targetVoiceChannelId && member.voice.channelId !== targetVoiceChannelId) {
                        await interaction.reply({
                            content: 'Debes estar en el mismo canal de voz que el bot para usar estos controles.',
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    switch (interaction.customId) {
                        case 'pause_resume':
                            if (serverQueue.player?.state.status === AudioPlayerStatus.Playing) {
                                serverQueue.player.pause();
                                await interaction.reply({ content: '⏸️ Reproducción pausada.', flags: MessageFlags.Ephemeral });
                            } else if (serverQueue.player?.state.status === AudioPlayerStatus.Paused) {
                                serverQueue.player.unpause();
                                await interaction.reply({ content: '▶️ Reproducción reanudada.', flags: MessageFlags.Ephemeral });
                            }
                            break;
                        case 'skip':
                            serverQueue.player?.stop();
                            await interaction.reply({ content: '⏭️ Saltando a la siguiente canción...', flags: MessageFlags.Ephemeral });
                            break;
                        case 'stop':
                            serverQueue.queue = [];
                            serverQueue.player?.stop();
                            serverQueue.playing = false;
                            await interaction.reply({ content: '⏹️ Reproducción detenida y cola limpiada.', flags: MessageFlags.Ephemeral });
                            break;
                    }
                });
            });
    } catch (error) {
        handleError(context, error, 'Error al reproducir la siguiente canción');
        shiftQueueItem(guildId, serverQueue);
        if (serverQueue.queue.length > 0) {
            playNext(context, client);
        } else {
            serverQueue.playing = false;
        }
    }
};

export const stop = async (context: CommandContext, client: BotClient): Promise<void> => {
    const guildId = context.guildId;
    const channel = context.channel;

    const serverQueue = getServerQueue(guildId, client);
    await ensureQueueLoaded(guildId, serverQueue);
    const hasQueuedItems = serverQueue.queue.length > 0;
    if (!serverQueue.playing && !hasQueuedItems) {
        channel.send('No hay música reproduciéndose.');
        return;
    }

    serverQueue.queue = [];
    serverQueue.player?.stop();
    serverQueue.playing = false;
    void clearQueue(guildId);

    const embed = new EmbedBuilder()
        .setColor('#e74c3c')
        .setDescription('⏹️ Reproducción detenida y cola limpiada.')
        .setTimestamp();

    channel.send({ embeds: [embed] });
    serverQueue.connection?.destroy();
    serverQueue.connection = null;
    serverQueue.voiceChannelId = undefined;
};

export const pause = (context: CommandContext, client: BotClient): void => {
    const guildId = context.guildId;
    const channel = context.channel;

    const serverQueue = client.musicQueues.get(guildId);
    if (!serverQueue || !serverQueue.playing || !serverQueue.player) {
        channel.send('No hay música reproduciéndose.');
        return;
    }

    serverQueue.player.pause();

    const embed = new EmbedBuilder()
        .setColor('#e67e22')
        .setDescription('⏸️ Reproducción pausada.')
        .setTimestamp();

    channel.send({ embeds: [embed] });
};

export const resume = (context: CommandContext, client: BotClient): void => {
    const guildId = context.guildId;
    const channel = context.channel;

    const serverQueue = client.musicQueues.get(guildId);
    if (!serverQueue || !serverQueue.player) {
        channel.send('No hay música pausada.');
        return;
    }

    serverQueue.player.unpause();

    const embed = new EmbedBuilder()
        .setColor('#27ae60')
        .setDescription('▶️ Reproducción reanudada.')
        .setTimestamp();

    channel.send({ embeds: [embed] });
};

export const skip = (context: CommandContext, client: BotClient): void => {
    const guildId = context.guildId;
    const channel = context.channel;

    const serverQueue = client.musicQueues.get(guildId);
    if (!serverQueue || !serverQueue.playing || !serverQueue.player) {
        channel.send('No hay música reproduciéndose.');
        return;
    }

    serverQueue.player.stop();

    const embed = new EmbedBuilder()
        .setColor('#9b59b6')
        .setDescription('⏭️ Saltando a la siguiente canción...')
        .setTimestamp();

    channel.send({ embeds: [embed] });
};

export const showQueue = async (context: CommandContext, client: BotClient): Promise<void> => {
    const guildId = context.guildId;
    const channel = context.channel;

    const serverQueue = getServerQueue(guildId, client);
    await ensureQueueLoaded(guildId, serverQueue);
    if (!serverQueue || serverQueue.queue.length === 0) {
        channel.send('No hay canciones en la cola.');
        return;
    }

    const currentSong = serverQueue.queue[0];
    const upcoming = serverQueue.queue.slice(1);

    const embed = new EmbedBuilder()
        .setColor('#3498db')
        .setTitle('📋 Cola de reproducción')
        .setThumbnail(currentSong.thumbnail);

    embed.addFields({
        name: '🔊 Reproduciendo ahora',
        value: `[${currentSong.title}](${currentSong.url}) | ${currentSong.duration || 'Duración desconocida'}`
    });

    if (upcoming.length > 0) {
        // Limit to 10 entries to avoid overly long messages.
        const displayLimit = Math.min(upcoming.length, 10);
        const queueList = upcoming.slice(0, displayLimit).map((song: YouTubeVideo, index: number) =>
            `**${index + 1}.** [${song.title}](${song.url}) | ${song.duration || 'Duración desconocida'}`
        ).join('\n');

        let queueText = queueList;
        if (upcoming.length > displayLimit) {
            queueText += `\n\n*...y ${upcoming.length - displayLimit} canciones más en cola*`;
        }

        embed.addFields({
            name: '🎵 Próximas canciones',
            value: queueText
        });
    }

    // Compute total duration with basic parsing and fallbacks.
    let totalDurationSeconds = 0;
    let hasUnknownDurations = false;

    serverQueue.queue.forEach((song: YouTubeVideo) => {
        if (song.duration) {
            try {
                totalDurationSeconds += durationToSeconds(song.duration);
            } catch {
                hasUnknownDurations = true;
            }
        } else {
            hasUnknownDurations = true;
        }
    });

    let durationText = formatTotalDuration(totalDurationSeconds);
    if (hasUnknownDurations) {
        durationText += ' (algunas duraciones desconocidas)';
    }

    embed.setFooter({ text: `${serverQueue.queue.length} canciones en cola | ${durationText}` });

    channel.send({ embeds: [embed] });
};

// Format total seconds into a readable format (hh:mm:ss).
function formatTotalDuration(seconds: number): string {
    if (seconds === 0) return 'Duración desconocida';

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;

    if (hours > 0) {
        return `${hours}h ${minutes}m ${remainingSeconds}s`;
    } else if (minutes > 0) {
        return `${minutes}m ${remainingSeconds}s`;
    } else {
        return `${remainingSeconds}s`;
    }
}

function formatDuration(isoDuration: string): string {
    const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 'Desconocida';

    const hours = match[1] ? parseInt(match[1]) : 0;
    const minutes = match[2] ? parseInt(match[2]) : 0;
    const seconds = match[3] ? parseInt(match[3]) : 0;

    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    } else {
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
}

function durationToSeconds(duration: string): number {
    const parts = duration.split(':');
    let seconds = 0;

    if (parts.length === 3) {
        seconds += parseInt(parts[0]) * 3600;
        seconds += parseInt(parts[1]) * 60;
        seconds += parseInt(parts[2]);
    } else if (parts.length === 2) {
        seconds += parseInt(parts[0]) * 60;
        seconds += parseInt(parts[1]);
    }

    return seconds;
}
