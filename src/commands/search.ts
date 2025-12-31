import {
	ActionRowBuilder,
	ComponentType,
	EmbedBuilder,
	MessageFlags,
	SlashCommandBuilder,
	StringSelectMenuBuilder,
	type Message,
} from 'discord.js';
import chalk from 'chalk';
import type { BotClient } from '../types.js';
import * as music from '../music.js';
import { safeReply } from '../interaction-utils.js';
import { ensureVoiceContext } from './helpers.js';
import type { SlashCommand } from './types.js';

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
	execute: async (interaction, client: BotClient) => {
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

const truncateText = (value: string, maxLength: number): string => {
	if (value.length <= maxLength) return value;
	if (maxLength <= 3) return value.slice(0, maxLength);

	return `${value.slice(0, maxLength - 3)}...`;
};

export default searchCommand;
