import type { ContextMenuCommandBuilder } from "discord.js";
import type {
    AppCommandRegistrationRules,
    ResolvedAppCommandRegistration,
    SlashCommandBuilderResolvable
} from "@/abstracts/index.js";

import { InteractionContextType } from "discord.js";

/** Applies registration defaults: global unless `guilds` is set, and an explicit `global` always wins. */
export function resolveRegistration(rules: AppCommandRegistrationRules = {}): ResolvedAppCommandRegistration {
    return { ...rules, global: rules.global ?? !rules.guilds?.length };
}

/** Limits a `guildOnly` command's builder to the guild context, so Discord hides it in DMs. Contexts the builder already sets win. */
export function applyGuildOnlyContexts(
    builder: SlashCommandBuilderResolvable | ContextMenuCommandBuilder,
    guildOnly: boolean | undefined
): void {
    if (guildOnly && !builder.contexts) builder.setContexts(InteractionContextType.Guild);
}
