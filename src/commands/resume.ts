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

const resumeCommand: SlashCommand = {
	data: new SlashCommandBuilder()
		.setName('reanudar')
		.setDescription('Reanuda la reproduccion pausada.'),
	execute: async (interaction, client: BotClient) => {
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

export default resumeCommand;
