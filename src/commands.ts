import {
	ActionRowBuilder,
	ChatInputCommandInteraction,
	ComponentType,
	EmbedBuilder,
	MessageFlags,
	SlashCommandBuilder,
	StringSelectMenuBuilder,
	type Message,
} from 'discord.js';
import chalk from 'chalk';
import { getPlayDl } from './playdl.js';
import { getYtdl } from './ytdl.js';
import { BotClient } from './types.js';
import { buildFallbackVideoFromUrl, parseYouTubeUrl } from './youtube-utils.js';
import * as music from './music.js';
import {
	ensureBotPermissions,
	ensureSameVoiceChannel,
	getGuildContext,
	requireVoiceChannel,
	safeReply,
} from './interaction-utils.js';

export interface SlashCommand {
	data: SlashCommandBuilder;
	execute: (interaction: ChatInputCommandInteraction, client: BotClient) => Promise<void>;
}

const ensureVoiceContext = async (
	interaction: ChatInputCommandInteraction,
	client: BotClient,
) => {
	const context = await getGuildContext(interaction);
	if (!context) return null;

	const voiceChannel = await requireVoiceChannel(interaction, context.member);
	if (!voiceChannel) return null;

	const hasPermissions = await ensureBotPermissions(interaction, client, voiceChannel);
	if (!hasPermissions) return null;

	return context;
};

const searchCommand: SlashCommand = {
	data: new SlashCommandBuilder()
		.setName('buscar')
		.setDescription('Busca canciones en YouTube y muestra resultados para elegir.')
		.addStringOption(option =>
			option
				.setName('query')
				.setDescription('Cancion o artista a buscar')
				.setRequired(true)
		),
	execute: async (interaction, client) => {
		let deferred = false;

		try {
			const context = await ensureVoiceContext(interaction, client);
			if (!context) return;
			const query = interaction.options.getString('query', true);

			if (!client.musicQueues.has(context.guildId)) {
				client.musicQueues.set(context.guildId, {
					currentSearch: null,
					queue: [],
					playing: false,
					connection: null,
					player: null,
					searchMessage: null,
					queueLoaded: false
				});
			}

			const serverQueue = client.musicQueues.get(context.guildId)!;
			if (serverQueue.currentSearch && serverQueue.searchMessage) {
				await safeReply(interaction, {
					content: 'Ya tienes una busqueda activa. Por favor selecciona una cancion o espera a que expire.',
					flags: MessageFlags.Ephemeral
				});
				return;
			}

			await interaction.deferReply();
			deferred = true;

			const videos = await music.searchYouTube(query);
			if (!videos.length) {
				await interaction.editReply('No se encontraron resultados para tu busqueda.');
				return;
			}

			const embed = new EmbedBuilder()
				.setColor('#f1c40f')
				.setTitle(`🔍 Resultados de busqueda para "${query}"`)
				.setDescription('Selecciona la cancion que quieres reproducir en el menu.')
				.setFooter({ text: 'Tienes 30 segundos para elegir una cancion.' });

			videos.forEach((video, index) => {
				embed.addFields({
					name: `${index + 1}. ${video.title}`,
					value: `**Canal:** ${video.channelTitle} | **Duracion:** ${video.duration || 'Desconocida'}`
				});
			});

			const selectMenu = new StringSelectMenuBuilder()
				.setCustomId('search_select')
				.setPlaceholder('Selecciona una cancion')
				.addOptions(
					videos.map((video, index) => ({
						label: truncateText(`${index + 1}. ${video.title}`, 100),
						description: truncateText(`${video.channelTitle} · ${video.duration || 'Desconocida'}`, 100),
						value: index.toString()
					}))
				);

			const row = new ActionRowBuilder<StringSelectMenuBuilder>()
				.addComponents(selectMenu);

			const reply = await interaction.editReply({ embeds: [embed], components: [row] });
			serverQueue.currentSearch = videos;
			serverQueue.searchMessage = reply as Message;

			const collector = (reply as Message).createMessageComponentCollector({
				componentType: ComponentType.StringSelect,
				time: 30000
			});

			collector.on('collect', async (selectInteraction) => {
				if (selectInteraction.user.id !== interaction.user.id) {
					await selectInteraction.reply({
						content: 'Solo quien inicio la busqueda puede elegir una cancion.',
						flags: MessageFlags.Ephemeral
					});
					return;
				}

				const choice = parseInt(selectInteraction.values[0], 10);
				const selectedVideo = videos[choice];

				const confirmEmbed = new EmbedBuilder()
					.setColor('#2ecc71')
					.setTitle('✅ Cancion seleccionada')
					.setDescription(`**${selectedVideo.title}**`)
					.setThumbnail(selectedVideo.thumbnail);

				serverQueue.currentSearch = null;
				serverQueue.searchMessage = null;
				collector.stop('selected');

				await selectInteraction.update({ components: [] });
				await context.channel.send({ embeds: [confirmEmbed] });
				await music.play(context, selectedVideo, client);
			});

			collector.on('end', collected => {
				serverQueue.currentSearch = null;

				if (collected.size === 0 && serverQueue.searchMessage) {
					const timeoutEmbed = new EmbedBuilder()
						.setColor('#e74c3c')
						.setTitle('⏱️ Tiempo agotado')
						.setDescription('No seleccionaste ninguna cancion a tiempo. Usa `/buscar` de nuevo si quieres.')
						.setFooter(null);

					serverQueue.searchMessage.edit({ embeds: [timeoutEmbed], components: [] })
						.catch((err: unknown) => console.error(chalk.yellow('Failed to edit the expired search message:'), err));

					serverQueue.searchMessage = null;
				}
			});
		} catch (error) {
			console.error(chalk.red('Search command failed:'), error);
			if (deferred) {
				await interaction.editReply('Ocurrio un error al buscar en YouTube. Por favor intenta de nuevo mas tarde.');
			} else {
				await safeReply(interaction, {
					content: 'Ocurrio un error al buscar en YouTube. Por favor intenta de nuevo mas tarde.',
					flags: MessageFlags.Ephemeral
				});
			}
		}
	}
};

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
	execute: async (interaction, client) => {
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

const stopCommand: SlashCommand = {
	data: new SlashCommandBuilder()
		.setName('detener')
		.setDescription('Detiene la reproduccion y limpia la cola.'),
	execute: async (interaction, client) => {
		try {
			const context = await getGuildContext(interaction);
			if (!context) return;

			if (!await requireVoiceChannel(interaction, context.member)) return;

			const serverQueue = client.musicQueues.get(context.guildId);
			if (!serverQueue || !serverQueue.playing) {
				await safeReply(interaction, {
					content: 'No hay musica reproduciendose actualmente.',
					flags: MessageFlags.Ephemeral
				});
				return;
			}

			const sameChannel = await ensureSameVoiceChannel(interaction, context.member, serverQueue.voiceChannelId);
			if (!sameChannel) return;

			await music.stop(context, client);
			await safeReply(interaction, { content: 'Listo.', flags: MessageFlags.Ephemeral });
		} catch (error) {
			console.error(chalk.red('Stop command failed:'), error);
			await safeReply(interaction, {
				content: 'Ocurrio un error inesperado al intentar detener la musica.',
				flags: MessageFlags.Ephemeral
			});
		}
	}
};

const pauseCommand: SlashCommand = {
	data: new SlashCommandBuilder()
		.setName('pausar')
		.setDescription('Pausa la reproduccion actual.'),
	execute: async (interaction, client) => {
		try {
			const context = await getGuildContext(interaction);
			if (!context) return;

			if (!await requireVoiceChannel(interaction, context.member)) return;

			const serverQueue = client.musicQueues.get(context.guildId);
			if (!serverQueue || !serverQueue.playing) {
				await safeReply(interaction, {
					content: 'No hay musica reproduciendose actualmente.',
					flags: MessageFlags.Ephemeral
				});
				return;
			}

			const sameChannel = await ensureSameVoiceChannel(interaction, context.member, serverQueue.voiceChannelId);
			if (!sameChannel) return;

			if (serverQueue.player && serverQueue.player.state.status === 'paused') {
				await safeReply(interaction, {
					content: 'La musica ya esta pausada. Usa `/reanudar` para continuar.',
					flags: MessageFlags.Ephemeral
				});
				return;
			}

			music.pause(context, client);
			await safeReply(interaction, { content: 'Listo.', flags: MessageFlags.Ephemeral });
		} catch (error) {
			console.error(chalk.red('Pause command failed:'), error);
			await safeReply(interaction, {
				content: 'Ocurrio un error inesperado al intentar pausar la musica.',
				flags: MessageFlags.Ephemeral
			});
		}
	}
};

const resumeCommand: SlashCommand = {
	data: new SlashCommandBuilder()
		.setName('reanudar')
		.setDescription('Reanuda la reproduccion pausada.'),
	execute: async (interaction, client) => {
		try {
			const context = await getGuildContext(interaction);
			if (!context) return;

			if (!await requireVoiceChannel(interaction, context.member)) return;

			const serverQueue = client.musicQueues.get(context.guildId);
			if (!serverQueue || !serverQueue.player) {
				await safeReply(interaction, {
					content: 'No hay ninguna sesion de musica activa.',
					flags: MessageFlags.Ephemeral
				});
				return;
			}

			const sameChannel = await ensureSameVoiceChannel(interaction, context.member, serverQueue.voiceChannelId);
			if (!sameChannel) return;

			if (serverQueue.player.state.status !== 'paused') {
				await safeReply(interaction, {
					content: 'La musica no esta pausada actualmente.',
					flags: MessageFlags.Ephemeral
				});
				return;
			}

			music.resume(context, client);
			await safeReply(interaction, { content: 'Listo.', flags: MessageFlags.Ephemeral });
		} catch (error) {
			console.error(chalk.red('Resume command failed:'), error);
			await safeReply(interaction, {
				content: 'Ocurrio un error inesperado al intentar reanudar la musica.',
				flags: MessageFlags.Ephemeral
			});
		}
	}
};

const skipCommand: SlashCommand = {
	data: new SlashCommandBuilder()
		.setName('saltar')
		.setDescription('Salta a la siguiente cancion en la cola.'),
	execute: async (interaction, client) => {
		try {
			const context = await getGuildContext(interaction);
			if (!context) return;

			if (!await requireVoiceChannel(interaction, context.member)) return;

			const serverQueue = client.musicQueues.get(context.guildId);
			if (!serverQueue || !serverQueue.playing) {
				await safeReply(interaction, {
					content: 'No hay musica reproduciendose actualmente.',
					flags: MessageFlags.Ephemeral
				});
				return;
			}

			const sameChannel = await ensureSameVoiceChannel(interaction, context.member, serverQueue.voiceChannelId);
			if (!sameChannel) return;

			if (serverQueue.queue.length <= 1) {
				await safeReply(interaction, {
					content: 'Esta es la ultima cancion de la cola. Usa `/detener` si quieres finalizar.',
					flags: MessageFlags.Ephemeral
				});
				return;
			}

			music.skip(context, client);
			await safeReply(interaction, { content: 'Listo.', flags: MessageFlags.Ephemeral });
		} catch (error) {
			console.error(chalk.red('Skip command failed:'), error);
			await safeReply(interaction, {
				content: 'Ocurrio un error inesperado al intentar saltar la cancion.',
				flags: MessageFlags.Ephemeral
			});
		}
	}
};

const queueCommand: SlashCommand = {
	data: new SlashCommandBuilder()
		.setName('cola')
		.setDescription('Muestra la cola de reproduccion actual.'),
	execute: async (interaction, client) => {
		try {
			const context = await getGuildContext(interaction);
			if (!context) return;

			await music.showQueue(context, client);
			await safeReply(interaction, { content: 'Mostrando la cola de reproduccion.', flags: MessageFlags.Ephemeral });
		} catch (error) {
			console.error(chalk.red('Queue command failed:'), error);
			await safeReply(interaction, {
				content: 'Ocurrio un error inesperado al intentar mostrar la cola.',
				flags: MessageFlags.Ephemeral
			});
		}
	}
};

const helpCommand: SlashCommand = {
	data: new SlashCommandBuilder()
		.setName('ayuda')
		.setDescription('Muestra la ayuda del bot.'),
	execute: async (interaction) => {
		try {
			const embed = new EmbedBuilder()
				.setColor('#9b59b6')
				.setTitle('📚 Comandos del Bot de Musica')
				.addFields(
					{ name: '/buscar', value: 'Busca canciones en YouTube y muestra resultados para elegir', inline: false },
					{ name: '/reproducir', value: 'Reproduce la primera coincidencia o una URL de YouTube', inline: false },
					{ name: '/pausar', value: 'Pausa la reproduccion actual', inline: true },
					{ name: '/reanudar', value: 'Reanuda la reproduccion pausada', inline: true },
					{ name: '/saltar', value: 'Salta a la siguiente cancion en la cola', inline: true },
					{ name: '/cola', value: 'Muestra la cola de reproduccion actual', inline: true },
					{ name: '/detener', value: 'Detiene la reproduccion y limpia la cola', inline: true },
					{ name: '/ayuda', value: 'Muestra este mensaje de ayuda', inline: true }
				)
				.setFooter({ text: 'Bot de musica para Discord' });

			await interaction.reply({ embeds: [embed] });
		} catch (error) {
			console.error(chalk.red('Help command failed:'), error);
			await safeReply(interaction, {
				content: 'Ocurrio un error inesperado al mostrar la ayuda.',
				flags: MessageFlags.Ephemeral
			});
		}
	}
};

export const commandList: SlashCommand[] = [
	searchCommand,
	playCommand,
	pauseCommand,
	resumeCommand,
	skipCommand,
	queueCommand,
	stopCommand,
	helpCommand
];

export const commandMap = new Map(commandList.map(command => [command.data.name, command]));

export const commandData = commandList.map(command => command.data.toJSON());

function formatDuration(seconds: string | number): string {
	const secondsNum = typeof seconds === 'string' ? parseInt(seconds, 10) : seconds;
	const hours = Math.floor(secondsNum / 3600);
	const minutes = Math.floor((secondsNum - (hours * 3600)) / 60);
	const secs = secondsNum - (hours * 3600) - (minutes * 60);

	if (hours > 0) {
		return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
	}

	return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function truncateText(value: string, maxLength: number): string {
	if (value.length <= maxLength) return value;
	if (maxLength <= 3) return value.slice(0, maxLength);

	return `${value.slice(0, maxLength - 3)}...`;
}

function looksLikeUrl(value: string): boolean {
	try {
		const parsed = new URL(value);
		return parsed.protocol === 'http:' || parsed.protocol === 'https:';
	} catch {
		return false;
	}
}
