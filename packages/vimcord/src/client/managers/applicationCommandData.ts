import type { RESTPostAPIApplicationCommandsJSONBody } from "discord.js";

export interface RemoteApplicationCommand {
    id: string;
    name: string;
    type?: number;
    description?: string;
    options?: unknown[];
    default_member_permissions?: string | null;
    dm_permission?: boolean;
    contexts?: number[] | null;
    integration_types?: number[] | null;
    nsfw?: boolean;
    name_localizations?: Record<string, string> | null;
    description_localizations?: Record<string, string> | null;
}

export type ApplicationCommandRegistrationScope = "global" | "guild";

const DEFAULT_GLOBAL_APPLICATION_COMMAND_CONTEXTS = [0, 1, 2];
const DEFAULT_GUILD_APPLICATION_COMMAND_CONTEXTS = [0];
const DEFAULT_APPLICATION_COMMAND_INTEGRATION_TYPES = [0];

function getDefaultApplicationCommandContexts(
    command: RESTPostAPIApplicationCommandsJSONBody | RemoteApplicationCommand
): number[] {
    return command.dm_permission === false
        ? DEFAULT_GUILD_APPLICATION_COMMAND_CONTEXTS
        : DEFAULT_GLOBAL_APPLICATION_COMMAND_CONTEXTS;
}

function normalizeRecord(record: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(record)
            .map(([key, value]) => [key, normalizeValue(value)] as const)
            .filter(([, value]) => value !== undefined)
    );
}

function normalizeValue(value: unknown): unknown {
    if (value === undefined || value === null) return undefined;

    if (Array.isArray(value)) {
        const values = value.map(normalizeValue).filter(item => item !== undefined);
        return values.length ? values : undefined;
    }

    if (typeof value === "object") {
        const record = normalizeRecord(value as Record<string, unknown>);
        if ("required" in record && record.required === false) delete record.required;
        if ("autocomplete" in record && record.autocomplete === false) delete record.autocomplete;

        return Object.keys(record).length ? record : undefined;
    }

    return value;
}

function isNumberSet(value: unknown, expected: number[]): boolean {
    if (!Array.isArray(value) || value.length !== expected.length) return false;

    const numbers = value.filter((item): item is number => typeof item === "number");
    if (numbers.length !== value.length) return false;

    const sortedValues = [...numbers].sort((a, b) => a - b);
    const sortedExpected = [...expected].sort((a, b) => a - b);
    return sortedValues.every((item, index) => item === sortedExpected[index]);
}

function normalizeNumberSet(value: unknown): unknown {
    if (!Array.isArray(value) || !value.every(item => typeof item === "number")) return value;

    return [...value].sort((a, b) => a - b);
}

function normalizeApplicationCommandData(
    command: RESTPostAPIApplicationCommandsJSONBody | RemoteApplicationCommand,
    scope: ApplicationCommandRegistrationScope
): Record<string, unknown> {
    const type = command.type ?? 1;
    const dmPermission = "dm_permission" in command ? command.dm_permission : undefined;
    const nsfw = "nsfw" in command ? command.nsfw : undefined;
    const contexts = "contexts" in command ? command.contexts : undefined;
    const integrationTypes = "integration_types" in command ? command.integration_types : undefined;

    // Discord exposes contexts and integration types only on global commands.
    return normalizeRecord({
        name: command.name,
        type,
        description: type === 1 && "description" in command ? command.description : undefined,
        options: type === 1 && "options" in command ? command.options : undefined,
        default_member_permissions: "default_member_permissions" in command ? command.default_member_permissions : undefined,
        dm_permission: scope === "global" && dmPermission !== true ? dmPermission : undefined,
        contexts:
            scope === "global" ? normalizeNumberSet(contexts ?? getDefaultApplicationCommandContexts(command)) : undefined,
        integration_types:
            scope === "global" && !isNumberSet(integrationTypes, DEFAULT_APPLICATION_COMMAND_INTEGRATION_TYPES)
                ? integrationTypes
                : undefined,
        nsfw: nsfw === false ? undefined : nsfw,
        name_localizations: "name_localizations" in command ? command.name_localizations : undefined,
        description_localizations: "description_localizations" in command ? command.description_localizations : undefined
    });
}

function sortValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortValue);
    if (!value || typeof value !== "object") return value;

    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, val]) => [key, sortValue(val)])
    );
}

function stableStringify(value: unknown): string {
    return JSON.stringify(sortValue(value));
}

export function createApplicationCommandKey(
    command: RESTPostAPIApplicationCommandsJSONBody | RemoteApplicationCommand
): string {
    return `${command.type ?? 1}:${command.name}`;
}

export function hasApplicationCommandChanged(
    local: RESTPostAPIApplicationCommandsJSONBody,
    remote: RemoteApplicationCommand,
    scope: ApplicationCommandRegistrationScope
): boolean {
    return (
        stableStringify(normalizeApplicationCommandData(local, scope)) !==
        stableStringify(normalizeApplicationCommandData(remote, scope))
    );
}

/** Adds explicit global contexts when a PATCH must restore Discord's default availability. */
export function createApplicationCommandUpdatePayload(
    command: RESTPostAPIApplicationCommandsJSONBody,
    scope: ApplicationCommandRegistrationScope
): RESTPostAPIApplicationCommandsJSONBody {
    if (scope === "guild" || command.contexts !== undefined) return command;

    return { ...command, contexts: getDefaultApplicationCommandContexts(command) };
}
