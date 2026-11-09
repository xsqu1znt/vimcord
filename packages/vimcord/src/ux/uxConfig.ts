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
    /** Whether the custom emoji is animated. @default false */
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
    /** Page-jump modal title. @default "Jump to Page" */
    title: string;
    /** Page input label. @default "Page number" */
    label: string;
    /** Input description supporting $CURRENT_PAGE and $MAX_PAGE. @default "Enter a page number between 1 and $MAX_PAGE." */
    description: string;
    /** Page input placeholder. @default "Page number" */
    placeholder: string;
    /** Milliseconds to wait for a page submission. @default 60_000 */
    timeout: number;
    /** Ephemeral rejection supporting $MAX_PAGE. @default "Enter a page number between 1 and $MAX_PAGE." */
    invalidPageMessage: string;
}

/** Global defaults shared by Vimcord UX helpers. */
export interface UxConfig {
    /** Selects development-mode embed colors. @default false */
    devMode: boolean;
    /** Production embed color or random color pool. @default null */
    embedColor: ColorResolvable | ColorResolvable[] | null;
    /** Development embed color or pool; null uses the production color. @default null */
    embedColorDev: ColorResolvable | ColorResolvable[] | null;
    /** Idle time in milliseconds when a collector, prompt, or paginator supplies no timing. @default 60_000 */
    defaultIdle: number;
    /** Collector behavior and access messages. */
    collector: {
        /** Rejection while a prior click is still running. @default "Please wait, your previous action is still processing." */
        clickLockMessage: string;
        /** Rejection for non-participants; null acknowledges silently. @default "You are not allowed to use this." */
        notAParticipantMessage: string | null;
    };
    /** Paginator navigation, timeout, and message defaults. */
    paginator: {
        /** Cleanup when a paginator ends. @default "disable" */
        onResolve: ResolveAction;
        /** Rejection for non-participants; null acknowledges silently. @default "You are not allowed to use this." */
        notAParticipantMessage: string | null;
        /** Page-jump modal defaults. */
        jumpModal: UxPaginatorJumpModalConfig;
        /** Optional paginator status responses. `null` acknowledges silently. */
        messages: {
            /** Response when loading a destination fails; null acknowledges silently. @default null */
            loadFailed: string | null;
            /** Response when a jump modal outlives the paginator; null acknowledges silently. @default null */
            expired: string | null;
            /** Response when the chapter changes while a jump modal is open; null acknowledges silently. @default null */
            chapterChanged: string | null;
        };
        /** Appearance defaults keyed by paginator button ID. */
        buttons: Record<UxPaginatorButtonId, UxPaginatorButtonConfig>;
    };
    /** Modal defaults. */
    modal: {
        /** Milliseconds to wait for a modal submission. @default 60_000 */
        timeout: number;
    };
    /** Confirmation prompt content and button defaults. */
    prompt: {
        /** Title for the default confirmation embed. @default "Confirmation Required" */
        defaultTitle: string;
        /** Body for the default confirmation embed. @default "Please confirm or reject this action." */
        defaultDescription: string;
        /** Highlights the chosen prompt button during disable cleanup. @default false */
        highlightSelectedButton: boolean;
        /** Default confirm and reject buttons. */
        buttons: {
            /** Default confirm button. @default green button labeled "Confirm" */
            confirm: ButtonBuilder;
            /** Default reject button. @default red button labeled "Reject" */
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

/** Returns the current global UX configuration. */
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
