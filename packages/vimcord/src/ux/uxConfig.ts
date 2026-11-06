import type { ColorResolvable } from "discord.js";
import type { PartialDeep } from "../types/helpers.js";
import type { ResolveAction } from "./shared.js";

import { ButtonBuilder, ButtonStyle } from "discord.js";

/** A Discord custom emoji descriptor. */
export interface UxCustomEmojiConfig {
    /** Emoji name. */
    name: string;
    /** Discord emoji ID. */
    id?: string;
    /** Whether the custom emoji is animated. */
    animated?: boolean;
}

/** A Unicode emoji or Discord custom emoji descriptor. */
export type UxEmojiConfig = string | UxCustomEmojiConfig;
/** Configurable paginator navigation button IDs. */
export type UxPaginatorButtonId = "first" | "back" | "jump" | "next" | "last";

/** Global appearance for one paginator button. */
export interface UxPaginatorButtonConfig {
    /** Button label. */
    label?: string;
    /** Button emoji. */
    emoji?: UxEmojiConfig;
}

/** Global content and timing for the paginator page-jump modal. */
export interface UxPaginatorJumpModalConfig {
    /** Modal title. */
    title: string;
    /** Page input label. */
    label: string;
    /** Page input description. Supports `$CURRENT_PAGE` and `$MAX_PAGE`. */
    description: string;
    /** Page input placeholder. */
    placeholder: string;
    /** Time in milliseconds to wait for a page submission. */
    timeout: number;
    /** Ephemeral response shown when the submitted page is invalid. Supports `$MAX_PAGE`. */
    invalidPageMessage: string;
}

/** Global defaults shared by Vimcord UX helpers. */
export interface UxConfig {
    /** Selects development-mode embed colors. */
    devMode: boolean;
    /** Default production embed color or random color pool. */
    embedColor: ColorResolvable | ColorResolvable[] | null;
    /** Default development embed color or random color pool. */
    embedColorDev: ColorResolvable | ColorResolvable[] | null;
    /** Idle time in milliseconds for paginators, prompts, and collectors given no timing. */
    defaultIdle: number;
    /** Collector behavior and access messages. */
    collector: {
        /** Ephemeral message shown to a user who clicks during `clickLock` while their prior click is running. */
        clickLockMessage: string;
        /** Message shown to users who are not collector participants. */
        notAParticipantMessage: string | null;
    };
    /** Paginator navigation, timeout, and message defaults. */
    paginator: {
        /** Default timeout resolution action. */
        onResolve: ResolveAction;
        /** Message shown to users who are not paginator participants. */
        notAParticipantMessage: string | null;
        /** Page-jump modal defaults. */
        jumpModal: UxPaginatorJumpModalConfig;
        /** Optional paginator status responses. `null` acknowledges silently. */
        messages: {
            loadFailed: string | null;
            expired: string | null;
            chapterChanged: string | null;
        };
        /** Appearance defaults keyed by paginator button ID. */
        buttons: Record<UxPaginatorButtonId, UxPaginatorButtonConfig>;
    };
    /** Modal defaults. */
    modal: {
        /** Time in milliseconds to wait for a submission. */
        timeout: number;
    };
    /** Confirmation prompt content and button defaults. */
    prompt: {
        /** Default prompt title. */
        defaultTitle: string;
        /** Default prompt description. */
        defaultDescription: string;
        /** Whether the selected prompt button is visually highlighted. */
        highlightSelectedButton: boolean;
        /** Default confirm and reject buttons. */
        buttons: {
            /** Default confirmation button. */
            confirm: ButtonBuilder;
            /** Default rejection button. */
            reject: ButtonBuilder;
        };
    };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function mergeConfig(target: Record<string, unknown>, source: Record<string, unknown>): void {
    for (const [key, sourceValue] of Object.entries(source)) {
        const targetValue = target[key];

        if (isPlainObject(targetValue) && isPlainObject(sourceValue)) {
            mergeConfig(targetValue, sourceValue);
        } else if (sourceValue !== undefined) {
            target[key] = sourceValue;
        }
    }
}

function createDefaultUxConfig(): UxConfig {
    return {
        devMode: false,
        embedColor: null,
        embedColorDev: null,
        defaultIdle: 60_000,
        collector: {
            clickLockMessage: "Please wait, your previous action is still processing.",
            notAParticipantMessage: "You are not allowed to use this."
        },
        paginator: {
            onResolve: "disable",
            notAParticipantMessage: "You are not allowed to use this.",
            jumpModal: {
                title: "Jump to Page",
                label: "Page number",
                description: "Enter a page number between 1 and $MAX_PAGE.",
                placeholder: "Page number",
                timeout: 60_000,
                invalidPageMessage: "Enter a page number between 1 and $MAX_PAGE."
            },
            messages: {
                loadFailed: null,
                expired: null,
                chapterChanged: null
            },
            buttons: {
                first: { label: "<<" },
                back: { label: "<" },
                jump: { label: "Jump" },
                next: { label: ">" },
                last: { label: ">>" }
            }
        },
        modal: {
            timeout: 60_000
        },
        prompt: {
            defaultTitle: "Confirmation Required",
            defaultDescription: "Please confirm or reject this action.",
            highlightSelectedButton: false,
            buttons: {
                confirm: new ButtonBuilder({ label: "Confirm", style: ButtonStyle.Success }),
                reject: new ButtonBuilder({ label: "Reject", style: ButtonStyle.Danger })
            }
        }
    };
}

/** Mutable global UX defaults used by Vimcord helpers. */
export const globalUxConfig = createDefaultUxConfig();

/**
 * Updates the global UX configuration.
 * @param config Partial config to merge into the current global config
 */
export function defineGlobalUxConfig(config: PartialDeep<UxConfig>): UxConfig {
    mergeConfig(globalUxConfig as unknown as Record<string, unknown>, config as Record<string, unknown>);
    return globalUxConfig;
}

/**
 * Returns the current global UX configuration.
 */
export function getGlobalUxConfig(): UxConfig {
    return globalUxConfig;
}

/** Resolves a fixed UX color or randomly selects one from a color pool. */
export function resolveUxColor(color: ColorResolvable | ColorResolvable[] | null): ColorResolvable | null {
    if (!Array.isArray(color)) return color;
    if (!color.length) return null;
    return color[Math.floor(Math.random() * color.length)] ?? null;
}

/** Resolves the embed color for the configured UX environment. */
export function resolveGlobalEmbedColor(): ColorResolvable | null {
    const config = getGlobalUxConfig();
    return resolveUxColor(config.devMode ? (config.embedColorDev ?? config.embedColor) : config.embedColor);
}
