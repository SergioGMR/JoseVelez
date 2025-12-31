import type { ChatInputCommandInteraction } from 'discord.js';
import type { BotClient } from '../types.js';
import type { CommandContext } from '../interaction-utils.js';
import {
	ensureBotPermissions,
	getGuildContext,
	requireVoiceChannel,
} from '../interaction-utils.js';

export const ensureVoiceContext = async (
	interaction: ChatInputCommandInteraction,
	client: BotClient,
): Promise<CommandContext | null> => {
	const context = await getGuildContext(interaction);
	if (!context) return null;

	const voiceChannel = await requireVoiceChannel(interaction, context.member);
	if (!voiceChannel) return null;

	const hasPermissions = await ensureBotPermissions(interaction, client, voiceChannel);
	if (!hasPermissions) return null;

	return context;
};
