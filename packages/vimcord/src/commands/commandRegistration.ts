import type { AppCommandRegistrationRules, ResolvedAppCommandRegistration } from "@/abstracts/index.js";

/** Applies registration defaults: global unless `guilds` is set, and an explicit `global` always wins. */
export function resolveRegistration(rules: AppCommandRegistrationRules = {}): ResolvedAppCommandRegistration {
    return { ...rules, global: rules.global ?? !rules.guilds?.length };
}
