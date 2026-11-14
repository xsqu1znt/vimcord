import type { ChatInputCommandInteraction, ContextMenuCommandInteraction } from "discord.js";
import type { CommandDeferReply } from "@/abstracts/commands/CommandModuleTypeKit.js";

/** A subcommand's explicit setting wins when present; otherwise falls back to the command's setting. */
export function resolveDeferReply(
    subcommandValue: CommandDeferReply | undefined,
    commandValue: CommandDeferReply | undefined
): CommandDeferReply | undefined {
    return subcommandValue !== undefined ? subcommandValue : commandValue;
}

/** Defers the interaction per `deferReply`, unless it's already been replied to or deferred. */
export async function applyDeferReply(
    interaction: ChatInputCommandInteraction | ContextMenuCommandInteraction,
    deferReply: CommandDeferReply | undefined
): Promise<void> {
    if (!deferReply || interaction.replied || interaction.deferred) return;
    await interaction.deferReply(deferReply === "ephemeral" ? { flags: "Ephemeral" } : undefined);
}
