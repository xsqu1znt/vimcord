import type { ColorResolvable } from "discord.js";
import type { PartialDeep } from "@vimcord/internal";

import { ButtonBuilder, ButtonStyle } from "discord.js";

export type ToolCollectorMode = "sequential" | "parallel";
export type ToolPaginatorTimeoutAction = "DisableComponents" | "ClearComponents" | "DeleteMessage" | "DoNothing";
export type ToolEmojiConfig = string | { name: string; id?: string; animated?: boolean };

export interface ToolPaginatorButtonConfig {
    label: string;
    emoji: ToolEmojiConfig;
}

export interface ToolConfig {
    devMode: boolean;
    embedColor: ColorResolvable | ColorResolvable[] | null;
    embedColorDev: ColorResolvable | ColorResolvable[] | null;
    collector: {
        mode: ToolCollectorMode;
        userLockMessage: string;
        notAParticipantMessage: string | null;
    };
    paginator: {
        jumpSize: number;
        jumpableThreshold: number;
        longThreshold: number;
        onTimeout: ToolPaginatorTimeoutAction;
        notAParticipantMessage: string | null;
        buttons: Record<"first" | "back" | "jump" | "next" | "last", ToolPaginatorButtonConfig>;
    };
    prompt: {
        defaultTitle: string;
        defaultDescription: string;
        inputLabel: string;
        inputPlaceholder: string;
        highlightSelectedButton: boolean;
        buttons: {
            confirm: ButtonBuilder;
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

function createDefaultToolConfig(): ToolConfig {
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
            jumpSize: 5,
            jumpableThreshold: 5,
            longThreshold: 4,
            onTimeout: "ClearComponents",
            notAParticipantMessage: "You are not allowed to use this.",
            buttons: {
                first: { label: "<<", emoji: "⏮️" },
                back: { label: "<", emoji: "◀️" },
                jump: { label: "Jump", emoji: "📄" },
                next: { label: ">", emoji: "▶️" },
                last: { label: ">>", emoji: "⏭️" }
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

export const globalToolConfig = createDefaultToolConfig();

/**
 * Updates the global UX tool configuration.
 * @param config Partial config to merge into the current global config
 */
export function defineGlobalToolConfig(config: PartialDeep<ToolConfig>): ToolConfig {
    mergeConfig(globalToolConfig as unknown as Record<string, unknown>, config as Record<string, unknown>);
    return globalToolConfig;
}

/**
 * Returns the current global UX tool configuration.
 */
export function getGlobalToolConfig(): ToolConfig {
    return globalToolConfig;
}

export function resolveToolColor(color: ColorResolvable | ColorResolvable[] | null): ColorResolvable | null {
    if (!Array.isArray(color)) return color;
    if (!color.length) return null;
    return color[Math.floor(Math.random() * color.length)] ?? null;
}

export function resolveGlobalEmbedColor(): ColorResolvable | null {
    const config = getGlobalToolConfig();
    return resolveToolColor(config.devMode ? (config.embedColorDev ?? config.embedColor) : config.embedColor);
}
