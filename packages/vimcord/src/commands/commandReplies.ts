import type { CommandBlock, CommandModuleHookContext, CommandModuleType } from "@/abstracts/index.js";

import { MessageFlags } from "discord.js";
import { uxConfig } from "@/ux/uxConfig.js";
import { MissingPermissionReason } from "./commandPermissions.js";

/** Picks the configured default reply for a block no `onBlocked` hook took, or `null` to stay silent. Callers skip bot invokers. */
export function resolveBlockReply(block: CommandBlock): string | null {
    const messages = uxConfig.command;
    switch (block.kind) {
        case "environment":
            return messages.environment;
        case "running":
            return messages.running;
        case "unknownRoute":
            return messages.unknownSubcommand?.replaceAll("$PATH", block.path) ?? null;
        case "permission":
            if (block.reason === MissingPermissionReason.Client) return messages.botMissingPermissions;
            if (block.reason === MissingPermissionReason.NotInGuild) return messages.notInGuild;
            return messages.noAccess;
    }
}

/**
 * Sends a default command reply: ephemeral for interactions (completing a pending deferral, or following up an answered one) and a ping-free reply for messages.
 * @param ctx The invocation to answer
 * @param content The reply text
 */
export async function sendCommandReply<K extends CommandModuleType>(
    ctx: CommandModuleHookContext<K>,
    content: string
): Promise<void> {
    if ("message" in ctx) {
        await ctx.message.reply({ content, allowedMentions: { parse: [], repliedUser: false } });
        return;
    }

    const { interaction } = ctx;
    if (interaction.replied) await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
    else if (interaction.deferred) await interaction.editReply({ content });
    else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}
