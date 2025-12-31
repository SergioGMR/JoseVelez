import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import chalk from 'chalk';
import type { BotClient } from '../types.js';
import * as music from '../music.js';
import { getGuildContext, safeReply } from '../interaction-utils.js';
import type { SlashCommand } from './types.js';

const queueCommand: SlashCommand = {
	data: new SlashCommandBuilder()
		.setName('cola')
		.setDescription('Muestra la cola de reproduccion actual.'),
	execute: async (interaction, client: BotClient) => {
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

export default queueCommand;
