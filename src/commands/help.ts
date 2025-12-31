import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import chalk from 'chalk';
import { safeReply } from '../interaction-utils.js';
import type { BotClient } from '../types.js';
import type { SlashCommand } from './types.js';

const helpCommand: SlashCommand = {
	data: new SlashCommandBuilder()
		.setName('ayuda')
		.setDescription('Muestra la ayuda del bot.'),
	execute: async (interaction, _client: BotClient) => {
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

export default helpCommand;
