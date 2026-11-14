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
    /** Default command replies, sent when no `onBlocked` or `onError` hook takes the invocation. `null` stays silent. */
    command: {
        /** Reply when the user has no access grant. @default "You don't have permission to use this command." */
        noAccess: string | null;
        /** Reply when the bot lacks `botPermissions`. @default "I'm missing permissions needed to run this command." */
        botMissingPermissions: string | null;
        /** Reply when a guild is required outside one. @default "This command can only be used in a server." */
        notInGuild: string | null;
        /** Reply for an unmatched subcommand, supporting $PATH. @default "Subcommand '$PATH' was not found." */
        unknownSubcommand: string | null;
        /** Reply when the module's `environment` excludes the client's mode. @default null */
        environment: string | null;
        /** Reply when `singleInvocation` skips an overlapping run. @default null */
        running: string | null;
        /** Reply when the handler or a gate throws. Errors are still logged. @default "Something went wrong while running this command." */
        error: string | null;
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
        command: {
            noAccess: "You don't have permission to use this command.",
            botMissingPermissions: "I'm missing permissions needed to run this command.",
            notInGuild: "This command can only be used in a server.",
            unknownSubcommand: "Subcommand '$PATH' was not found.",
            environment: null,
            running: null,
            error: "Something went wrong while running this command."
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

/** The live UX defaults every helper reads. Owned by the client: its `ux` option fills it and `destroy()` resets it. */
export const uxConfig = createDefaultUxConfig();

/** Deep-merges the client's `ux` option into the live config; arrays and builders are replaced whole. */
export function applyUxConfig(config: PartialDeep<UxConfig>): void {
    mergeConfig(uxConfig as unknown as Record<string, unknown>, config as Record<string, unknown>);
}

/** Restores the defaults in place, so a destroyed client's `ux` option doesn't carry into the next client. */
export function resetUxConfig(): void {
    Object.assign(uxConfig, createDefaultUxConfig());
}

/** Resolves a fixed UX color or randomly selects one from a color pool. */
export function resolveUxColor(color: ColorResolvable | ColorResolvable[] | null): ColorResolvable | null {
    if (!Array.isArray(color)) return color;
    if (!color.length) return null;
    return color[Math.floor(Math.random() * color.length)] ?? null;
}

/** Resolves the embed color for the configured UX environment. */
export function resolveEmbedColor(): ColorResolvable | null {
    return resolveUxColor(uxConfig.devMode ? (uxConfig.embedColorDev ?? uxConfig.embedColor) : uxConfig.embedColor);
}
