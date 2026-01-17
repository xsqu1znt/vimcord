import {
    CommandInteraction,
    DMChannel,
    EmbedBuilder,
    GuildMember,
    Message,
    NewsChannel,
    RepliableInteraction,
    TextBasedChannel,
    TextChannel,
    ThreadChannel,
    User
} from "discord.js";
import { BetterEmbed } from "./BetterEmbed";

export enum SendMethod {
    Reply = 0,
    EditReply = 1,
    FollowUp = 2,
    Channel = 3,
    MessageReply = 4,
    MessageEdit = 5,
    User = 6
}

export type SendHandler = CommandInteraction | RepliableInteraction | TextBasedChannel | Message | GuildMember | User;
export type InteractionBasedSendHandler = CommandInteraction | RepliableInteraction;

export type EmbedResolvable = EmbedBuilder | BetterEmbed;
export type InteractionResolveable = CommandInteraction | RepliableInteraction;
export type UserResolvable = GuildMember | User | string;

export type SendableTextChannel = DMChannel | TextChannel | NewsChannel | ThreadChannel;
