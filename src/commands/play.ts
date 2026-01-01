import {
	MessageFlags,
	SlashCommandBuilder,
} from 'discord.js';
import chalk from 'chalk';
import { getPlayDl } from '../playdl.js';
import { getYtdl } from '../ytdl.js';
import type { BotClient } from '../types.js';
import { buildFallbackVideoFromUrl, parseYouTubeUrl } from '../youtube-utils.js';
import * as music from '../music.js';
import { safeReply } from '../interaction-utils.js';
import { ensureVoiceContext } from './helpers.js';
import type { SlashCommand } from './types.js';
import { pickBestVideo, splitQueryInput } from './play-utils.js';

const MAX_MULTI_QUERIES = 10;
const SEARCH_RESULTS_PER_QUERY = 5;

const playCommand: SlashCommand = {
	data: new SlashCommandBuilder()
		.setName('reproducir')
		.setDescription('Reproduce musica desde YouTube.')
		.addStringOption(option =>
			option
				.setName('query')
				.setDescription('URL de YouTube o termino de busqueda')
				.setRequired(true)
		),
	execute: async (interaction, client: BotClient) => {
		let deferred = false;

		try {
			const context = await ensureVoiceContext(interaction, client);
			if (!context) return;
			const query = interaction.options.getString('query', true);
			const queries = splitQueryInput(query, MAX_MULTI_QUERIES);
			const isMultiQuery = queries.length > 1;

			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			deferred = true;

			const targets = queries.length ? queries : [query];
			const result = await enqueueQueries(targets, context, client);

			if (!result.added) {
				await interaction.editReply(buildSummaryMessage(result, targets.length));
				return;
			}

			if (isMultiQuery) {
				await interaction.editReply(buildSummaryMessage(result, targets.length));
			} else {
				const response = result.failed.length
					? buildSummaryMessage(result, targets.length)
					: 'Listo. Reproduciendo tu seleccion.';
				await interaction.editReply(response);
			}
		} catch (error) {
			console.error(chalk.red('Play command failed:'), error);
			if (deferred) {
				await interaction.editReply('Ocurrio un error al reproducir la cancion.');
			} else {
				await safeReply(interaction, {
					content: 'Ocurrio un error al reproducir la cancion.',
					flags: MessageFlags.Ephemeral
				});
			}
		}
	}
};

type MultiQueueResult = {
	added: number;
	failed: string[];
};

const enqueueQueries = async (
	queries: string[],
	context: Parameters<typeof music.play>[0],
	client: BotClient,
): Promise<MultiQueueResult> => {
	const result: MultiQueueResult = { added: 0, failed: [] };

	for (const rawQuery of queries) {
		const query = rawQuery.trim();
		if (!query) continue;

		const outcome = await enqueueSingleQuery(query, context, client);
		if (outcome.ok) {
			result.added += 1;
		} else if (outcome.reason) {
			result.failed.push(`• "${query}": ${outcome.reason}`);
		}
	}

	return result;
};

const enqueueSingleQuery = async (
	query: string,
	context: Parameters<typeof music.play>[0],
	client: BotClient,
): Promise<{ ok: boolean; reason?: string }> => {
	const parsedYouTubeUrl = parseYouTubeUrl(query);
	if (parsedYouTubeUrl) {
		const canonicalUrl = parsedYouTubeUrl.url;
		try {
			const playdl = await getPlayDl();
			const info = await playdl.video_basic_info(canonicalUrl);
			const details = info.video_details;
			const thumbnail = details.thumbnails?.[details.thumbnails.length - 1]?.url || '';
			const duration = details.durationRaw || (details.durationInSec ? formatDuration(details.durationInSec) : 'Desconocida');

			const video = {
				id: details.id || playdl.extractID(canonicalUrl) || parsedYouTubeUrl.id,
				title: details.title || 'Sin titulo',
				url: details.url || canonicalUrl,
				channelTitle: details.channel?.name || 'Canal desconocido',
				thumbnail,
				duration,
				description: details.description || ''
			};

			await music.play(context, video, client);
			return { ok: true };
		} catch (error) {
			console.error(chalk.red('Failed to process URL with play-dl:'), error);

			try {
				const ytdl = await getYtdl();
				const videoInfo = await ytdl.getInfo(canonicalUrl);
				const video = {
					id: videoInfo.videoDetails.videoId,
					title: videoInfo.videoDetails.title,
					url: videoInfo.videoDetails.video_url,
					channelTitle: videoInfo.videoDetails.author.name,
					thumbnail: videoInfo.videoDetails.thumbnails[0]?.url || '',
					duration: formatDuration(videoInfo.videoDetails.lengthSeconds)
				};

				await music.play(context, video, client);
				return { ok: true };
			} catch (fallbackError) {
				console.error(chalk.red('Failed to process URL with ytdl:'), fallbackError);
				const fallbackVideo = buildFallbackVideoFromUrl(canonicalUrl);
				await music.play(context, fallbackVideo, client);
				return { ok: true };
			}
		}
	}

	if (looksLikeUrl(query)) {
		return { ok: false, reason: 'solo se admiten enlaces directos de YouTube' };
	}

	try {
		const videos = await music.searchYouTube(query, SEARCH_RESULTS_PER_QUERY);
		if (!videos.length) {
			return { ok: false, reason: 'sin resultados' };
		}

		const selectedVideo = pickBestVideo(videos, query) ?? videos[0];
		await music.play(context, selectedVideo, client);
		return { ok: true };
	} catch (error) {
		console.error(chalk.red('Search failed for query:'), query, error);
		return { ok: false, reason: 'error al buscar' };
	}
};

const buildSummaryMessage = (result: MultiQueueResult, total: number): string => {
	const lines = [`Listo. Añadidas ${result.added}/${total}.`];

	if (result.failed.length) {
		const visibleFailures = result.failed.slice(0, 5);
		lines.push('Fallos:');
		lines.push(...visibleFailures);

		if (result.failed.length > visibleFailures.length) {
			lines.push(`...y ${result.failed.length - visibleFailures.length} mas.`);
		}
	}

	return lines.join('\n');
};

const formatDuration = (seconds: string | number): string => {
	const secondsNum = typeof seconds === 'string' ? parseInt(seconds, 10) : seconds;
	const hours = Math.floor(secondsNum / 3600);
	const minutes = Math.floor((secondsNum - (hours * 3600)) / 60);
	const secs = secondsNum - (hours * 3600) - (minutes * 60);

	if (hours > 0) {
		return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
	}

	return `${minutes}:${secs.toString().padStart(2, '0')}`;
};

const looksLikeUrl = (value: string): boolean => {
	try {
		const parsed = new URL(value);
		return parsed.protocol === 'http:' || parsed.protocol === 'https:';
	} catch {
		return false;
	}
};

export default playCommand;
