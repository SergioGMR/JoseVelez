import {
	ChannelType,
	ChatInputCommandInteraction,
	GuildMember,
	MessageFlags,
	PermissionFlagsBits,
	type GuildTextBasedChannel,
	type VoiceBasedChannel,
} from 'discord.js';
import type { BotClient } from './types.js';

export interface CommandContext {
	channel: GuildTextBasedChannel;
	guildId: string;
	member: GuildMember;
}

const normalizeReplyOptions = (
	options: Parameters<ChatInputCommandInteraction['reply']>[0],
) => {
	if (typeof options === 'string') return options;

	const optionsWithEphemeral = options as { ephemeral?: boolean };
	if (!optionsWithEphemeral.ephemeral) return options;

	const { ephemeral, ...rest } = optionsWithEphemeral;
	return {
		...rest,
		flags: MessageFlags.Ephemeral,
	};
};

export const safeReply = async (
	interaction: ChatInputCommandInteraction,
	options: Parameters<ChatInputCommandInteraction['reply']>[0],
) => {
	const normalizedOptions = normalizeReplyOptions(options);

	if (interaction.deferred && !interaction.replied) {
		if (typeof normalizedOptions === 'string') {
			return interaction.editReply(normalizedOptions);
		}

		const { flags, ...rest } = normalizedOptions as Record<string, unknown>;
		return interaction.editReply(rest);
	}

	if (interaction.replied) {
		return interaction.followUp(normalizedOptions);
	}

	return interaction.reply(normalizedOptions);
};

export const getGuildContext = async (
	interaction: ChatInputCommandInteraction,
): Promise<CommandContext | null> => {
	if (!interaction.inCachedGuild()) {
		await safeReply(interaction, {
			content: 'Este comando solo funciona en servidores.',
			flags: MessageFlags.Ephemeral,
		});
		return null;
	}

	const channel = interaction.channel;
	if (!channel || !channel.isTextBased() || channel.type === ChannelType.DM) {
		await safeReply(interaction, {
			content: 'Este comando solo funciona en canales de texto de servidores.',
			flags: MessageFlags.Ephemeral,
		});
		return null;
	}

	return {
		channel: channel as GuildTextBasedChannel,
		guildId: interaction.guildId,
		member: interaction.member,
	};
};

export const requireVoiceChannel = async (
	interaction: ChatInputCommandInteraction,
	member: GuildMember,
): Promise<VoiceBasedChannel | null> => {
	const voiceChannel = member.voice?.channel;
	if (!voiceChannel) {
		await safeReply(interaction, {
			content: 'Debes estar en un canal de voz para usar este comando.',
			flags: MessageFlags.Ephemeral,
		});
		return null;
	}

	return voiceChannel;
};

export const ensureBotPermissions = async (
	interaction: ChatInputCommandInteraction,
	client: BotClient,
	voiceChannel: VoiceBasedChannel,
): Promise<boolean> => {
	const permissions = voiceChannel.permissionsFor(client.user!);
	if (!permissions?.has(PermissionFlagsBits.Connect) || !permissions?.has(PermissionFlagsBits.Speak)) {
		await safeReply(interaction, {
			content: 'Necesito permisos para unirme y hablar en tu canal de voz.',
			flags: MessageFlags.Ephemeral,
		});
		return false;
	}

	return true;
};

export const ensureSameVoiceChannel = async (
	interaction: ChatInputCommandInteraction,
	member: GuildMember,
	voiceChannelId?: string,
): Promise<boolean> => {
	if (!voiceChannelId) return true;

	if (member.voice.channelId !== voiceChannelId) {
		await safeReply(interaction, {
			content: 'Debes estar en el mismo canal de voz que el bot.',
			flags: MessageFlags.Ephemeral,
		});
		return false;
	}

	return true;
};
