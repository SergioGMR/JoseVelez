import { Client, GatewayIntentBits, Events, Collection, REST, Routes, MessageFlags } from 'discord.js';
import { BotClient, ServerQueue } from './types.js';
import config from './config.js';
import { commandData, commandMap } from './commands.js';
import chalk from 'chalk';
import { safeReply } from './interaction-utils.js';
import { clearQueue } from './queue-store.js';

// Evita warnings por timeouts negativos cuando hay drift en el scheduler de voz.
const originalSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    const safeTimeout = typeof timeout === 'number' && timeout < 0 ? 0 : timeout;
    return originalSetTimeout(handler, safeTimeout as number, ...args);
}) as typeof setTimeout;

// Crear cliente de Discord con los intents necesarios
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// Extender el cliente con la propiedad musicQueues
const botClient = client as BotClient;
botClient.musicQueues = new Collection<string, ServerQueue>();

const registerSlashCommands = async (): Promise<void> => {
    if (!config.registerCommands) {
        console.log(chalk.yellow('Registro automatico de comandos desactivado.'));
        console.log(chalk.yellow('Define DISCORD_REGISTER_COMMANDS=true para registrarlos.'));
        return;
    }

    const rest = new REST({ version: '10' }).setToken(config.token);

    try {
        console.log(chalk.cyan('Registrando comandos slash...'));

        if (config.guildId) {
            await rest.put(
                Routes.applicationGuildCommands(config.clientId, config.guildId),
                { body: commandData }
            );
            console.log(chalk.green(`Comandos registrados para el servidor ${config.guildId}.`));
        } else {
            await rest.put(
                Routes.applicationCommands(config.clientId),
                { body: commandData }
            );
            console.log(chalk.green('Comandos registrados globalmente.'));
        }
    } catch (error) {
        console.error(chalk.red('Error al registrar comandos slash:'), error);
    }
};

// Cuando el bot esté listo
client.once(Events.ClientReady, async () => {
    console.log(chalk.green(`Bot iniciado como ${client.user?.tag}`));
    console.log(chalk.cyan('Comandos disponibles:'));
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
        console.error(chalk.red('Error al ejecutar el comando:'), error);
        await safeReply(interaction, {
            content: 'Hubo un error al ejecutar ese comando.',
            flags: MessageFlags.Ephemeral
        });
    }
});

// Handler para cuando un usuario deja un canal de voz
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

    console.log(chalk.blue(`Canal de voz vacío en ${oldState.guild.name}. Programando desconexión en 5 minutos.`));

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
            console.log(chalk.blue(`Desconectando del canal de voz vacío en ${oldState.guild.name}`));

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

// Iniciar sesión con el token
client.login(config.token)
    .then(() => console.log(chalk.blue('Bot conectado a Discord')))
    .catch(err => console.error(chalk.red('Error al iniciar sesión:'), err));
