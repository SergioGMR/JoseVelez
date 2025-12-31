import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import chalk from 'chalk';
import type { BotClient } from '../types.js';
import * as music from '../music.js';
import {
	ensureSameVoiceChannel,
	getGuildContext,
	requireVoiceChannel,
	safeReply,
} from '../interaction-utils.js';
import type { SlashCommand } from './types.js';

const skipCommand: SlashCommand = {
	data: new SlashCommandBuilder()
		.setName('saltar')
		.setDescription('Salta a la siguiente cancion en la cola.'),
	execute: async (interaction, client: BotClient) => {
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

export default skipCommand;
