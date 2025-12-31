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

			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			deferred = true;

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
					await interaction.editReply('Listo. Reproduciendo tu seleccion.');
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
						await interaction.editReply('Listo. Reproduciendo tu seleccion.');
					} catch (fallbackError) {
						console.error(chalk.red('Failed to process URL with ytdl:'), fallbackError);
						const fallbackVideo = buildFallbackVideoFromUrl(canonicalUrl);
						await music.play(context, fallbackVideo, client);
						await interaction.editReply('No pude leer los metadatos del enlace, pero intentare reproducirlo.');
					}
				}
				return;
			}

			if (looksLikeUrl(query)) {
				await interaction.editReply('Solo se admiten enlaces directos de YouTube.');
				return;
			}

			const videos = await music.searchYouTube(query, 1);
			if (!videos.length) {
				await interaction.editReply('No se encontraron resultados para tu busqueda.');
				return;
			}

			await music.play(context, videos[0], client);
			await interaction.editReply('Listo. Reproduciendo tu seleccion.');
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
