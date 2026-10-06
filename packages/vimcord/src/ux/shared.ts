import type { GuildMember, Message, MessageEditOptions, MessageMentionOptions, User } from "discord.js";

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

/** Message edit returned by a resolution callback; the action is applied to its components in the same edit. */
export interface ResolvePayload extends MessageEditOptions {
    action: ResolveAction;
}

export type ResolveResult = ResolveAction | ResolvePayload;
/** A fixed cleanup action or an awaited callback returning the final message payload. */
export type OnResolve<Context> = ResolveAction | ((context: Context) => ResolveResult | Promise<ResolveResult>);

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

/** Applies cleanup and returned content in one edit, returning Discord's updated message. Edit failures propagate. */
export async function handleResolveAction(
    message: Message | null | undefined,
    result: ResolveResult,
    allowedMentions?: MessageMentionOptions
): Promise<Message | null | undefined> {
    if (!message) return message;
    const { action, ...payload } = typeof result === "string" ? { action: result } : result;
    if (action === ResolveAction.DeleteMessage) {
        if (message.deletable) await message.delete();
        return message;
    }

    const hasPayload = Object.keys(payload).length > 0;
    if (!message.editable) {
        if (hasPayload) throw new Error("[ResolveAction] Message is not editable");
        return message;
    }

    const current = message.components.map(c => c.toJSON());
    const source = payload.components?.map(c => ("toJSON" in c ? c.toJSON() : c)) ?? current;
    let components = source as ComponentLike[];
    if (action === ResolveAction.DisableComponents) components = components.map(disableComponent);
    if (action === ResolveAction.ClearComponents) {
        components = components.map(clearComponent).filter((c): c is ComponentLike => c !== null);
    }
    const changedComponents = JSON.stringify(components) !== JSON.stringify(current);
    if (!hasPayload && !changedComponents) return message;

    return message.edit({
        allowedMentions,
        ...payload,
        ...(changedComponents || payload.components ? { components: components as never } : {})
    });
}
