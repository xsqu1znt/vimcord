import type { CollectedMessageInteraction, InteractionCollector, Message, MessageComponentInteraction } from "discord.js";
import type { InteractionBasedSendHandler, TriggeredMessage } from "./dynaSend.js";
import type { OnResolve, ParticipantsOption, TimingOptions } from "./shared.js";

import { createRoutedMessageCollector } from "./interactionRouter.js";
import { handleResolveAction, isMessageGone, resolveParticipantIds, resolveTiming } from "./shared.js";
import { getGlobalUxConfig } from "./uxConfig.js";

type ClickListener = (interaction: MessageComponentInteraction) => unknown;

/** Collector completion passed to onResolve. */
export interface CollectorResolveContext {
    message: Message;
    reason: string;
}

export type CollectorTimingOptions = TimingOptions;

/** Options for configuring the BetterCollector behavior. */
interface BetterCollectorBaseOptions {
    /** Users allowed to click. Defaults to whoever triggered the message. An empty list lets nobody click; `"anyone"` leaves it open. */
    participants?: ParticipantsOption;
    /** Rejects a user's clicks while their previous click is still being handled. */
    clickLock?: boolean;
    /** Ends the collector after this many accepted clicks. */
    max?: number;
    /** Interaction used to send the message, required for ephemeral cleanup. Its user is who triggered the message. */
    interaction?: InteractionBasedSendHandler;
    /** Cleanup action or awaited final payload, applied once after the collector ends. @default "disable" */
    onResolve?: OnResolve<CollectorResolveContext>;
    /** Shown to users who aren't participants. `null` acknowledges silently; omitted uses the UX config's message. */
    notAParticipantMessage?: string | null;
}

export type BetterCollectorOptions = BetterCollectorBaseOptions & TimingOptions;

/**
 * Runs one handler per click, on top of participant filtering, a per-user click lock, and cleanup once it ends.
 * Each click runs the handler for its custom ID, otherwise the wildcard, otherwise an automatic `deferUpdate()`.
 */
export class BetterCollector {
    private readonly message: Message;
    private readonly options: BetterCollectorOptions;
    private readonly collector: InteractionCollector<CollectedMessageInteraction>;
    private readonly participantIds: ReadonlySet<string> | null;
    private readonly notAParticipantMessage: string | null;

    private readonly handlers = new Map<string, ClickListener>();
    private wildcard: ClickListener | null = null;
    private readonly collectListeners: ClickListener[] = [];
    private readonly endListeners: ((reason: string) => unknown)[] = [];
    private readonly activeUsers = new Set<string>();

    /**
     * A message from Vimcord's own sends knows its trigger, so `participants` can be inferred. A raw
     * `channel.send()` or `message.reply()` result has the same type as any other message, so it has to say.
     * @throws When `participants` is omitted and the message has no trigger, outside of a DM
     */
    constructor(message: TriggeredMessage, options?: BetterCollectorOptions);
    constructor(
        message: Message,
        options: BetterCollectorOptions &
            ({ participants: ParticipantsOption } | { interaction: InteractionBasedSendHandler })
    );
    constructor(message: Message, options: BetterCollectorOptions = {}) {
        this.message = message;
        this.options = options;
        this.participantIds = resolveParticipantIds(options.participants, message, options.interaction);
        this.notAParticipantMessage =
            options.notAParticipantMessage === undefined
                ? getGlobalUxConfig().collector.notAParticipantMessage
                : options.notAParticipantMessage;
        const timing = resolveTiming(options);

        this.collector = createRoutedMessageCollector(message, {
            idle: timing.idle ?? undefined,
            time: timing.timeout ?? undefined,
            max: options.max,
            filter: interaction => this.filterClick(interaction)
        });

        // Discord.js counts `max` with `total`, so history is unused. Dropping it keeps interactions out of memory.
        this.collector.collected.set = () => this.collector.collected;
        this.collector.users.set = () => this.collector.users;

        this.collector.on("collect", interaction => this.handleCollect(interaction));
        this.collector.on("end", (_collected, reason) => {
            this.handleEnd(reason).catch(err => console.error("[BetterCollector] Resolution error:", err));
        });
    }

    /**
     * Discord.js-level filter. Rejecting here keeps a click from being collected,
     * so it doesn't count toward `max` or reset the idle timer.
     */
    private filterClick(interaction: CollectedMessageInteraction): boolean | Promise<boolean> {
        const userId = interaction.user.id;
        if (this.participantIds && !this.participantIds.has(userId)) {
            return this.rejectClick(interaction, this.notAParticipantMessage);
        }
        if (!this.options.clickLock) return true;

        if (this.activeUsers.has(userId)) {
            return this.rejectClick(interaction, getGlobalUxConfig().collector.clickLockMessage);
        }
        this.activeUsers.add(userId);
        return true;
    }

    private async rejectClick(interaction: CollectedMessageInteraction, content: string | null): Promise<false> {
        const acknowledge = () => interaction.deferUpdate().catch(() => {});
        if (content) await interaction.reply({ content, flags: "Ephemeral" }).catch(acknowledge);
        else await acknowledge();
        return false;
    }

    private async handleCollect(interaction: CollectedMessageInteraction): Promise<void> {
        try {
            for (const fn of this.collectListeners) await this.runListener(fn, interaction);

            const handler = this.handlers.get(interaction.customId) ?? this.wildcard;
            if (handler) await this.runListener(handler, interaction);
            else await interaction.deferUpdate().catch(() => {});
        } finally {
            if (this.options.clickLock) this.activeUsers.delete(interaction.user.id);
        }
    }

    private async runListener(fn: ClickListener, interaction: MessageComponentInteraction): Promise<void> {
        try {
            await fn(interaction);
        } catch (err) {
            console.error("[BetterCollector] Listener error:", err);
        }
    }

    private async handleEnd(reason: string): Promise<void> {
        for (const fn of this.endListeners) {
            try {
                await fn(reason);
            } catch (err) {
                console.error("[BetterCollector] End listener error:", err);
            }
        }

        const onResolve = this.options.onResolve ?? "disable";
        const result = typeof onResolve === "function" ? await onResolve({ message: this.message, reason }) : onResolve;
        if (isMessageGone(reason)) return;
        await handleResolveAction(this.message, result, undefined, this.options.interaction);
    }

    /**
     * Registers the one handler for a custom ID. A second handler for the same ID throws.
     * @param customId The customId of the component to handle
     * @param fn The function to run when the component is clicked
     */
    on(customId: string, fn: ClickListener): this;

    /**
     * Registers the one wildcard handler, for custom IDs with no handler of their own. A second wildcard throws.
     * @param fn The function to run when a component with no handler is clicked
     */
    on(fn: ClickListener): this;

    on(customIdOrFn: string | ClickListener, fn?: ClickListener): this {
        if (typeof customIdOrFn === "function") {
            if (this.wildcard) throw new Error("[BetterCollector] A wildcard handler is already registered");
            this.wildcard = customIdOrFn;
            return this;
        }

        if (this.handlers.has(customIdOrFn)) {
            throw new Error(`[BetterCollector] A handler for customId "${customIdOrFn}" is already registered`);
        }
        this.handlers.set(customIdOrFn, fn!);
        return this;
    }

    /**
     * Observes every accepted click, awaited in registration order before the click's handler.
     * It can't block the handler: its return value is ignored and errors are only logged.
     * @param fn The function to run on each accepted click
     */
    onCollect(fn: ClickListener): this {
        this.collectListeners.push(fn);
        return this;
    }

    /**
     * Registers a callback for when the collector ends, which runs before `onResolve`.
     * @param fn Function called with the end reason
     */
    onEnd(fn: (reason: string) => unknown): this {
        this.endListeners.push(fn);
        return this;
    }

    /** Restarts the configured idle or timeout window after work outside component collection, such as a modal. */
    resetTimer(): this {
        this.collector.resetTimer();
        return this;
    }

    /**
     * Stop the collector manually.
     * @param reason - Reason for stopping the collector
     */
    stop(reason: string = "manual"): void {
        this.collector.stop(reason);
    }
}
