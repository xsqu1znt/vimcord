import type { ColorResolvable } from "discord.js";
import type { PartialDeep } from "../types/helpers.js";

import { ButtonBuilder, ButtonStyle } from "discord.js";

/** Determines whether collector listeners may overlap. */
export type UxCollectorMode = "sequential" | "parallel";
/** Supported paginator actions when collection times out. */
export type UxPaginatorTimeoutAction = "DisableComponents" | "ClearComponents" | "DeleteMessage" | "DoNothing";
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
export type UxPaginatorButtonId = "first" | "skipBack" | "back" | "jump" | "next" | "skipNext" | "last";

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
    /** Collector behavior and access messages. */
    collector: {
        /** Default listener execution mode. */
        mode: UxCollectorMode;
        /** Ephemeral message shown while a user's prior sequential action is running. */
        userLockMessage: string;
        /** Message shown to users who are not collector participants. */
        notAParticipantMessage: string | null;
    };
    /** Paginator navigation, timeout, and message defaults. */
    paginator: {
        /** Default number of pages moved by skip controls. */
        skipSize: number;
        /** Minimum page count that displays the page-jump control. */
        jumpableThreshold: number;
        /** Page count at which long navigation is preferred. */
        longThreshold: number;
        /** Default timeout resolution action. */
        onTimeout: UxPaginatorTimeoutAction;
        /** Message shown to users who are not paginator participants. */
        notAParticipantMessage: string | null;
        /** Page-jump modal defaults. */
        jumpModal: UxPaginatorJumpModalConfig;
        /** Appearance defaults keyed by paginator button ID. */
        buttons: Record<UxPaginatorButtonId, UxPaginatorButtonConfig>;
    };
    /** Confirmation prompt content and button defaults. */
    prompt: {
        /** Default prompt title. */
        defaultTitle: string;
        /** Default prompt description. */
        defaultDescription: string;
        /** Default modal input label. */
        inputLabel: string;
        /** Default modal input placeholder. */
        inputPlaceholder: string;
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
        collector: {
            mode: "parallel",
            userLockMessage: "Please wait, your previous action is still processing.",
            notAParticipantMessage: "You are not allowed to use this."
        },
        paginator: {
            skipSize: 5,
            jumpableThreshold: 5,
            longThreshold: 4,
            onTimeout: "ClearComponents",
            notAParticipantMessage: "You are not allowed to use this.",
            jumpModal: {
                title: "Jump to Page",
                label: "Page number",
                description: "Enter a page number between 1 and $MAX_PAGE.",
                placeholder: "Page number",
                timeout: 60_000,
                invalidPageMessage: "Enter a page number between 1 and $MAX_PAGE."
            },
            buttons: {
                first: { label: "<<" },
                skipBack: { label: "Skip Back" },
                back: { label: "<" },
                jump: { label: "Jump" },
                next: { label: ">" },
                skipNext: { label: "Skip Forward" },
                last: { label: ">>" }
            }
        },
        prompt: {
            defaultTitle: "Confirmation Required",
            defaultDescription: "Please confirm or reject this action.",
            inputLabel: "Your answer",
            inputPlaceholder: "Enter yes or no",
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
