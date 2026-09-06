import type { ChatInputCommandInteraction, ContextMenuCommandInteraction } from "discord.js";

type DeferReplyOption = boolean | { flags?: "Ephemeral" } | undefined;

/** A route's explicit setting wins when present; otherwise falls back to the command's setting. */
export function resolveDeferReply(routeValue: DeferReplyOption, commandValue: DeferReplyOption): DeferReplyOption {
    return routeValue !== undefined ? routeValue : commandValue;
}

/** Defers the interaction per `deferReply`, unless it's already been replied to or deferred. */
export async function applyDeferReply(
    interaction: ChatInputCommandInteraction | ContextMenuCommandInteraction,
    deferReply: DeferReplyOption
): Promise<void> {
    if (!deferReply || interaction.replied || interaction.deferred) return;
    await interaction.deferReply(typeof deferReply === "boolean" ? undefined : deferReply);
}
