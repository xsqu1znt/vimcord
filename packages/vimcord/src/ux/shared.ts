import type { GuildMember, MessageEditOptions, MessageMentionOptions, User } from "discord.js";
import type {
    DynaSendOptions,
    InteractionBasedSendHandler,
    SendHandler,
    SendMethod,
    TriggeredSendHandler
} from "./dynaSend.js";

import { ChannelType, ComponentType, Message } from "discord.js";
import { getGlobalUxConfig } from "./uxConfig.js";

// --- Participants ---
export type Participant = GuildMember | User | string;

/** Who may click. An empty list lets nobody click. `"anyone"` is the only way to open a message to everyone. */
export type ParticipantsOption = Participant[] | "anyone";

/** Send options for a target whose `participants` are left to be inferred. Editing a message rules that out, because it might be the bot's own message, which says nothing about who triggered it. */
export type InferredSendOptions<T> = [Extract<T, Message>] extends [never]
    ? DynaSendOptions
    : DynaSendOptions & { method?: Exclude<SendMethod, "edit"> };

/** The trailing arguments of a send that starts a collector. `Explicit` always works, while `Inferred`, which leaves out `participants`, only works when the target has a trigger. The `[T]` wrapper stops a union from distributing, so a union containing a guild channel needs `Explicit` too. */
export type ParticipantSendArgs<T, Inferred extends unknown[], Explicit extends unknown[]> = [T] extends [
    TriggeredSendHandler
]
    ? Inferred | Explicit
    : Explicit;

/**
 * The one rule for who may click a collector, paginator, or prompt: the explicit option, otherwise whoever triggered the bot's message. Throws when nothing says who that is, rather than silently opening the buttons. Resolves to user IDs so each click is a cheap lookup. An empty list resolves to an empty set, so nobody can click. `null` means clicks aren't filtered: `"anyone"`, or a DM with no trigger, where only the recipient can click.
 * @param participants The explicit option, if any
 * @param message The bot's message
 * @param interaction The interaction that sent the message, if known
 */
export function resolveParticipantIds(
    participants: ParticipantsOption | undefined,
    message: Message,
    interaction?: InteractionBasedSendHandler
): ReadonlySet<string> | null {
    if (participants === "anyone") return null;
    if (participants) return new Set(participants.map(p => (typeof p === "string" ? p : p.id)));

    // Bots can't click, so a reply to any bot's message, including this bot's own, doesn't count as a trigger.
    const replied = message.mentions.repliedUser;
    const trigger = interaction?.user ?? message.interactionMetadata?.user ?? (replied?.bot ? null : replied);
    if (trigger) return new Set([trigger.id]);

    // Only the recipient can click in a DM. An uncached channel isn't assumed to be one.
    if (message.channel?.type === ChannelType.DM) return null;
    throw new Error(
        '[Participants] This message has no trigger to read. Pass `participants`, or `"anyone"` to leave it open'
    );
}

/**
 * Fails a paginator or prompt before it sends anything, when its reply to a bot's message would have no trigger and post buttons nobody can use. Bots can't click. A DM stays open to the recipient, so it's let through.
 * @param target The send target
 * @param participants The explicit option, if any
 * @param method The send's explicit method, if any
 */
export function assertTargetHasTrigger(
    target: SendHandler,
    participants: ParticipantsOption | undefined,
    method: SendMethod | undefined
): void {
    if (!(target instanceof Message) || !target.author.bot || participants || method === "edit") return;
    if (target.channel?.type === ChannelType.DM) return;
    throw new Error("[Participants] This is a bot's message, so pass `participants`");
}

// --- Timing ---
/** Idle or absolute timeout, never both. With neither, the UX config's `defaultIdle` applies. */
export type TimingOptions =
    | {
          /** Milliseconds without an accepted click before ending. @default UX config's defaultIdle */
          idle?: number;
          /** Not accepted when idle timing is configured. */
          timeout?: never;
      }
    | {
          /** Absolute duration in milliseconds before ending. */
          timeout?: number;
          /** Not accepted when an absolute timeout is configured. */
          idle?: never;
      };

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
    /** Cleanup action applied to the message components. */
    action: ResolveAction;
}

/** Cleanup action or final message payload returned by a resolution callback. */
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

/** Removes interactive components anywhere in the tree while preserving noninteractive content. A section's accessory is required by Discord's API and cannot be deleted outright, so a button accessory is disabled instead of removed to keep the section valid. */
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
