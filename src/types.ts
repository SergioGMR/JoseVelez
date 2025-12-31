import { Message, Client, ClientUser, Collection } from 'discord.js';
import { AudioPlayer, VoiceConnection } from '@discordjs/voice';

export interface YouTubeVideo {
    id: string;
    title: string;
    url: string;
    channelTitle: string;
    thumbnail: string;
    description?: string;
    duration?: string;
    requestedBy?: string;
    requestedById?: string;
    queueItemId?: string;
}

export interface ServerQueue {
    currentSearch: YouTubeVideo[] | null;
    searchMessage: Message | null;
    queue: YouTubeVideo[];
    playing: boolean;
    connection: VoiceConnection | null;
    player: AudioPlayer | null;
    voiceChannelId?: string;
    leaveTimeout?: NodeJS.Timeout;
    textChannelId?: string;
    queueLoaded?: boolean;
}

export interface BotClient extends Client {
    user: ClientUser | null;
    musicQueues: Collection<string, ServerQueue>;
}
