import { Client, GatewayIntentBits, Events, Collection, REST, Routes, MessageFlags } from 'discord.js';
import { BotClient, ServerQueue } from './types.js';
import config from './config.js';
import { commandData, commandMap } from './commands.js';
import chalk from 'chalk';
import { safeReply } from './interaction-utils.js';
import { clearQueue } from './queue-store.js';

// Avoid warnings when scheduler drift produces negative timeouts.
const originalSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    const safeTimeout = typeof timeout === 'number' && timeout < 0 ? 0 : timeout;
    return originalSetTimeout(handler, safeTimeout as number, ...args);
}) as typeof setTimeout;

// Create the Discord client with the required intents.
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// Extend the client with a musicQueues property.
const botClient = client as BotClient;
botClient.musicQueues = new Collection<string, ServerQueue>();

const registerSlashCommands = async (): Promise<void> => {
    if (!config.registerCommands) {
        console.log(chalk.yellow('Automatic command registration is disabled.'));
        console.log(chalk.yellow('Set DISCORD_REGISTER_COMMANDS=true to enable it.'));
        return;
    }

    const rest = new REST({ version: '10' }).setToken(config.token);

    try {
        console.log(chalk.cyan('Registering slash commands...'));

        if (config.guildId) {
            await rest.put(
                Routes.applicationGuildCommands(config.clientId, config.guildId),
                { body: commandData }
            );
            console.log(chalk.green(`Commands registered for guild ${config.guildId}.`));
        } else {
            await rest.put(
                Routes.applicationCommands(config.clientId),
                { body: commandData }
            );
            console.log(chalk.green('Commands registered globally.'));
        }
    } catch (error) {
        console.error(chalk.red('Failed to register slash commands:'), error);
    }
};

// When the bot is ready.
client.once(Events.ClientReady, async () => {
    console.log(chalk.green(`Bot started as ${client.user?.tag}`));
    console.log(chalk.cyan('Available commands:'));
    commandMap.forEach((_, name) => {
        console.log(chalk.yellow(`/${name}`));
    });

    await registerSlashCommands();
});

client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = commandMap.get(interaction.commandName);
    if (!command) return;

    try {
        await command.execute(interaction, botClient);
    } catch (error) {
        console.error(chalk.red('Error while executing command:'), error);
        await safeReply(interaction, {
            content: 'Hubo un error al ejecutar ese comando.',
            flags: MessageFlags.Ephemeral
        });
    }
});

// Handle voice channel departures.
client.on(Events.VoiceStateUpdate, (oldState) => {
    const guildId = oldState.guild.id;
    const serverQueue = botClient.musicQueues.get(guildId);

    if (!serverQueue?.voiceChannelId) return;

    const voiceChannel = oldState.guild.channels.cache.get(serverQueue.voiceChannelId);
    if (!voiceChannel || !voiceChannel.isVoiceBased()) return;

    const members = voiceChannel.members.filter(member => !member.user.bot);

    if (members.size > 0) {
        if (serverQueue.leaveTimeout) {
            clearTimeout(serverQueue.leaveTimeout);
            serverQueue.leaveTimeout = undefined;
        }
        return;
    }

    if (serverQueue.leaveTimeout) return;

    console.log(chalk.blue(`Voice channel empty in ${oldState.guild.name}. Scheduling disconnect in 5 minutes.`));

    const targetChannelId = serverQueue.voiceChannelId;
    const targetTextChannelId = serverQueue.textChannelId;

    serverQueue.leaveTimeout = setTimeout(() => {
        const updatedServerQueue = botClient.musicQueues.get(guildId);
        const updatedChannel = targetChannelId
            ? oldState.guild.channels.cache.get(targetChannelId)
            : null;
        const updatedMembers = updatedChannel?.isVoiceBased()
            ? updatedChannel.members.filter(member => !member.user.bot)
            : null;

        if (updatedServerQueue &&
            updatedServerQueue.voiceChannelId === targetChannelId &&
            (!updatedMembers || updatedMembers.size === 0)) {
            console.log(chalk.blue(`Disconnecting from empty voice channel in ${oldState.guild.name}`));

            updatedServerQueue.queue = [];
            updatedServerQueue.player?.stop();
            updatedServerQueue.connection?.destroy();
            updatedServerQueue.playing = false;
            updatedServerQueue.player = null;
            updatedServerQueue.connection = null;
            updatedServerQueue.voiceChannelId = undefined;
            void clearQueue(guildId);

            const textChannel = targetTextChannelId
                ? oldState.guild.channels.cache.get(targetTextChannelId)
                : null;

            const fallbackChannel = oldState.guild.channels.cache.find(
                channel => channel.isTextBased() && channel.name.includes('general')
            );

            const notifyChannel = (textChannel && textChannel.isTextBased())
                ? textChannel
                : fallbackChannel;

            if (notifyChannel && notifyChannel.isTextBased()) {
                notifyChannel.send('Me he desconectado del canal de voz porque no había nadie escuchando.');
            }
        }

        if (updatedServerQueue) {
            updatedServerQueue.leaveTimeout = undefined;
        }
    }, 5 * 60 * 1000);
});

// Log in with the bot token.
client.login(config.token)
    .then(() => console.log(chalk.blue('Bot connected to Discord')))
    .catch(err => console.error(chalk.red('Failed to log in:'), err));
