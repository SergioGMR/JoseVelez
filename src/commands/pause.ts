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

const pauseCommand: SlashCommand = {
	data: new SlashCommandBuilder()
		.setName('pausar')
		.setDescription('Pausa la reproduccion actual.'),
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

export default pauseCommand;
