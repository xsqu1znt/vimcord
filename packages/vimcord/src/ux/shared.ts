import type { GuildMember, MessageEditOptions, MessageMentionOptions, User } from "discord.js";
import type { InteractionBasedSendHandler, SendHandler } from "./dynaSend.js";

import { BaseInteraction, ComponentType, Message } from "discord.js";
import { getGlobalUxConfig } from "./uxConfig.js";

// --- Participants ---
export type Participant = GuildMember | User | string;
export function resolveParticipantId(participant: Participant): string {
    if (typeof participant === "string") return participant;
    return participant.id;
}

/** Who may use a paginator or prompt. `"anyone"` opts out of the default of only the invoker. */
export type ParticipantsOption = Participant[] | "anyone";

/**
 * Resolves who may use a paginator or prompt, defaulting to whoever invoked the send target.
 * Channel and user targets have no invoker, so they default to anyone.
 * @param participants The explicit option, if any
 * @param handler The send target
 */
export function resolveParticipants(participants: ParticipantsOption | undefined, handler: SendHandler): Participant[] {
    if (participants === "anyone") return [];
    if (participants) return participants;
    if (handler instanceof BaseInteraction) return [handler.user];
    // Editing the bot's own message leaves no invoker to infer; locking to the bot would lock everyone out.
    if (handler instanceof Message && handler.author.id !== handler.client.user?.id) return [handler.author];
    return [];
}

// --- Timing ---
/** Idle or absolute timeout, never both. With neither, the UX config's `defaultIdle` applies. */
export type TimingOptions = { idle?: number; timeout?: never } | { timeout?: number; idle?: never };

export interface ResolvedTiming {
    idle: number | null;
    timeout: number | null;
}

/** Resolves shared collector/prompt timing options, falling back to the global default idle. */
export function resolveTiming(options: TimingOptions): ResolvedTiming {
    if (options.idle !== undefined && options.timeout !== undefined) {
        throw new Error("Only one of idle or timeout can be provided");
    }
    if (options.timeout !== undefined) return { idle: null, timeout: options.timeout };
    return { idle: options.idle ?? getGlobalUxConfig().defaultIdle, timeout: null };
}

// --- Resolve Actions ---
/** What happens to the message once a paginator, prompt, or collector ends. */
export type ResolveAction = "disable" | "clear" | "delete" | "keep";

/** Message edit returned by a resolution callback; the action is applied to its components in the same edit. */
export interface ResolvePayload extends MessageEditOptions {
    action: ResolveAction;
}

export type ResolveResult = ResolveAction | ResolvePayload;
/** A fixed cleanup action or an awaited callback returning the final message payload. */
export type OnResolve<Context> = ResolveAction | ((context: Context) => ResolveResult | Promise<ResolveResult>);

const MESSAGE_GONE_REASONS = new Set(["messageDelete", "messageDeleteBulk", "channelDelete", "threadDelete", "guildDelete"]);

/** Whether a collector ended because its message no longer exists, so there's nothing left to edit. */
export function isMessageGone(reason: string): boolean {
    return MESSAGE_GONE_REASONS.has(reason);
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

/** Applies cleanup and returned content in one edit, returning Discord's updated message. Edit failures propagate. */
export async function handleResolveAction(
    message: Message | null | undefined,
    result: ResolveResult,
    allowedMentions?: MessageMentionOptions,
    interaction?: InteractionBasedSendHandler
): Promise<Message | null | undefined> {
    if (!message) return message;
    const { action, ...payload } = typeof result === "string" ? { action: result } : result;
    if (action === "delete") {
        if (interaction) await interaction.webhook.deleteMessage(message.id);
        else if (message.deletable) await message.delete();
        return message;
    }

    const hasPayload = Object.keys(payload).length > 0;
    if (!interaction && !message.editable) {
        if (hasPayload) throw new Error("[ResolveAction] Message is not editable");
        return message;
    }

    const current = message.components.map(c => c.toJSON());
    const source = payload.components?.map(c => ("toJSON" in c ? c.toJSON() : c)) ?? current;
    let components = source as ComponentLike[];
    if (action === "disable") components = components.map(disableComponent);
    if (action === "clear") {
        components = components.map(clearComponent).filter((c): c is ComponentLike => c !== null);
    }
    const changedComponents = JSON.stringify(components) !== JSON.stringify(current);
    if (!hasPayload && !changedComponents) return message;

    const data: MessageEditOptions = {
        allowedMentions,
        ...payload,
        ...(changedComponents || payload.components ? { components: components as never } : {})
    };
    return interaction ? interaction.webhook.editMessage(message.id, data) : message.edit(data);
}
