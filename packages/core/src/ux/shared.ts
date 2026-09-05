import type { GuildMember, Message, User } from "discord.js";

import { ComponentType } from "discord.js";

// --- Participants ---
export type Participant = GuildMember | User | string;
export function resolveParticipantId(participant: Participant): string {
    if (typeof participant === "string") return participant;
    return participant.id;
}

// --- Timing ---
/** Absolute timeout, idle timeout, or both. When both are given, idle overrides timeout. */
export type TimingOptions = { timeout: number; idle?: number } | { timeout?: number; idle: number };

export interface ResolvedTiming {
    idle: number | null;
    timeout: number | null;
}

/** Resolves shared collector/prompt timing options. Idle, when provided, overrides timeout. */
export function resolveTiming(options: TimingOptions): ResolvedTiming {
    if (options.idle === undefined && options.timeout === undefined) {
        throw new Error("Either idle or timeout must be provided");
    }

    return {
        idle: options.idle ?? null,
        timeout: options.idle === undefined ? (options.timeout ?? null) : null
    };
}

// --- Resolve Actions ---
export enum ResolveAction {
    DisableComponents = "DisableComponents",
    ClearComponents = "ClearComponents",
    DeleteMessage = "DeleteMessage",
    DoNothing = "DoNothing"
}

interface ComponentLike {
    type: ComponentType;
    [key: string]: unknown;
}

const INTERACTIVE_COMPONENT_TYPES = new Set<ComponentType>([
    ComponentType.Button,
    ComponentType.StringSelect,
    ComponentType.UserSelect,
    ComponentType.RoleSelect,
    ComponentType.MentionableSelect,
    ComponentType.ChannelSelect
]);

/** Disables interactive components anywhere in the tree: action rows, nested containers, and section button accessories. */
function disableComponent(component: ComponentLike): ComponentLike {
    if (component.type === ComponentType.ActionRow) {
        return { ...component, components: (component.components as ComponentLike[]).map(disableComponent) };
    }

    if (INTERACTIVE_COMPONENT_TYPES.has(component.type)) {
        return { ...component, disabled: true };
    }

    if (component.type === ComponentType.Container) {
        return { ...component, components: (component.components as ComponentLike[]).map(disableComponent) };
    }

    if (component.type === ComponentType.Section) {
        return { ...component, accessory: disableComponent(component.accessory as ComponentLike) };
    }

    // Text display, media gallery, file, separator, thumbnail: nothing interactive to disable.
    return component;
}

/**
 * Removes interactive components anywhere in the tree while preserving noninteractive content.
 * A section's accessory is required by Discord's API and cannot be deleted outright, so a button
 * accessory is disabled instead of removed to keep the section valid.
 */
function clearComponent(component: ComponentLike): ComponentLike | null {
    if (component.type === ComponentType.ActionRow || INTERACTIVE_COMPONENT_TYPES.has(component.type)) {
        return null;
    }

    if (component.type === ComponentType.Container) {
        const children = (component.components as ComponentLike[])
            .map(clearComponent)
            .filter((c): c is ComponentLike => c !== null);
        return { ...component, components: children };
    }

    if (component.type === ComponentType.Section) {
        const accessory = component.accessory as ComponentLike;
        const clearedAccessory = accessory.type === ComponentType.Button ? { ...accessory, disabled: true } : accessory;
        return { ...component, accessory: clearedAccessory };
    }

    return component;
}

async function resolveAction_disableComponents(message: Message | null | undefined): Promise<void> {
    if (!message?.editable || !message.components.length) return;

    try {
        const updatedRows = message.components.map(row => disableComponent(row.toJSON() as ComponentLike));
        const currentRows = message.components.map(row => row.toJSON());
        if (JSON.stringify(updatedRows) === JSON.stringify(currentRows)) return;
        await message.edit({ components: updatedRows as never });
    } catch (err) {
        if (err instanceof Error && !err.message.includes("Unknown Message")) {
            console.error("[ResolveAction] Failed to disable components:", err);
        }
    }
}

async function resolveAction_clearComponents(message: Message | null | undefined): Promise<void> {
    if (!message?.editable || !message.components.length) return;

    try {
        const updatedRows = message.components
            .map(row => clearComponent(row.toJSON() as ComponentLike))
            .filter((c): c is ComponentLike => c !== null);
        const currentRows = message.components.map(row => row.toJSON());
        if (JSON.stringify(updatedRows) === JSON.stringify(currentRows)) return;
        await message.edit({ components: updatedRows as never });
    } catch (err) {
        if (err instanceof Error && !err.message.includes("Unknown Message")) {
            console.error("[ResolveAction] Failed to clear components:", err);
        }
    }
}

async function resolveAction_deleteMessage(message: Message | null | undefined): Promise<void> {
    if (!message?.deletable) return;

    try {
        await message.delete();
    } catch (err) {
        if (err instanceof Error && !err.message.includes("Unknown Message")) {
            console.error("[ResolveAction] Failed to delete message:", err);
        }
    }
}

export async function handleResolveAction(message: Message | null | undefined, action: ResolveAction): Promise<void> {
    switch (action) {
        case ResolveAction.DisableComponents:
            return resolveAction_disableComponents(message);
        case ResolveAction.ClearComponents:
            return resolveAction_clearComponents(message);
        case ResolveAction.DeleteMessage:
            return resolveAction_deleteMessage(message);
        case ResolveAction.DoNothing:
        default:
            break;
    }
}
