import type { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import type { BotClient } from '../types.js';

export interface SlashCommand {
	data: SlashCommandBuilder;
	execute: (interaction: ChatInputCommandInteraction, client: BotClient) => Promise<void>;
}
