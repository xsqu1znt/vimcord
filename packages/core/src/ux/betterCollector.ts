import type {
    CollectedMessageInteraction,
    InteractionDeferReplyOptions,
    Message,
    MessageComponentInteraction,
    MessageComponentType
} from "discord.js";
import type { Participant, TimingOptions } from "./shared.js";

import { handleResolveAction, ResolveAction, resolveParticipantId, resolveTiming } from "./shared.js";
import { getGlobalUxConfig } from "./uxConfig.js";

type ListenerFn = (interaction: MessageComponentInteraction) => unknown;
type CollectorEventHandler<K extends keyof CollectorEventMap> = (...args: CollectorEventMap[K]) => unknown;

interface Listener {
    fn: ListenerFn;
    customId?: string;
    options?: ListenerOptions;
}

interface CollectorEventMap {
    collect: [MessageComponentInteraction];
    end: [MessageComponentInteraction[], string];
}

export type CollectorTimingOptions = TimingOptions;

/**
 * Options for configuring individual listener behavior.
 */
export interface ListenerOptions {
    /** Only allow interactions from these users. Falls back to the collector's global participants when omitted. */
    participants?: Participant[];
    /** Defer the interaction. */
    defer?: boolean | { update?: boolean; flags?: InteractionDeferReplyOptions["flags"] };
}

/**
 * Options for configuring the BetterCollector behavior.
 */
interface BetterCollectorBaseOptions<ComponentType extends MessageComponentType> {
    type?: ComponentType | null;
    participants?: Participant[];
    userLock?: boolean;
    userLockMessage?: string;
    max?: number | null;
    maxComponents?: number | null;
    maxUsers?: number | null;
    onResolve?: ResolveAction;
    notAParticipantMessage?: string | null;
    defer?: boolean | { update?: boolean; flags?: InteractionDeferReplyOptions["flags"] };
}

export type BetterCollectorOptions<ComponentType extends MessageComponentType> = BetterCollectorBaseOptions<ComponentType> &
    TimingOptions;

interface ResolvedBetterCollectorOptions<ComponentType extends MessageComponentType> extends Required<
    BetterCollectorBaseOptions<ComponentType>
> {
    idle: number | null;
    timeout: number | null;
}

/**
 * Enhanced message component collector with advanced features:
 * - Participant filtering
 * - User locking to prevent concurrent interactions
 * - In-order listener execution
 * - Built-in deferral handling
 * - Custom resolution actions (edit/delete after collection)
 */
export class BetterCollector<C extends MessageComponentType = MessageComponentType> {
    private readonly message: Message;
    private readonly options: ResolvedBetterCollectorOptions<C>;
    private readonly collector: {
        on(event: "collect", handler: CollectorEventHandler<"collect">): void;
        on(event: "end", handler: CollectorEventHandler<"end">): void;
        stop(reason?: string): void;
    };

    private readonly listeners: Listener[] = [];

    private readonly endListeners: ((collected: MessageComponentInteraction[], reason: string) => unknown)[] = [];
    private readonly activeUsers = new Set<string>();

    constructor(message: Message | null | undefined, options: BetterCollectorOptions<C>) {
        if (!message) throw new Error("Message is null or undefined");

        this.message = message;
        const config = getGlobalUxConfig().collector;
        const timing = resolveTiming(options);

        this.options = {
            type: options.type ?? null,
            participants: options.participants ?? [],
            idle: timing.idle,
            timeout: timing.timeout,
            userLock: options.userLock ?? false,
            userLockMessage: options.userLockMessage ?? config.userLockMessage,
            max: options.max ?? null,
            maxComponents: options.maxComponents ?? null,
            maxUsers: options.maxUsers ?? null,
            onResolve: options.onResolve ?? ResolveAction.DoNothing,
            notAParticipantMessage: options.notAParticipantMessage ?? config.notAParticipantMessage,
            defer: options.defer ?? false
        };

        this.collector = this.createCollector();
        this.setupCollector();
    }

    private createCollector() {
        // Creates the underlying Discord.js message component collector
        return this.message.createMessageComponentCollector({
            idle: this.options.idle ?? undefined,
            time: this.options.timeout ?? undefined,
            componentType: this.options.type ?? undefined,
            filter: interaction => this.filterInteraction(interaction),
            max: this.options.max ?? undefined,
            maxComponents: this.options.maxComponents ?? undefined,
            maxUsers: this.options.maxUsers ?? undefined
        });
    }

    /**
     * Discord.js-level filter. Rejecting here (participant or user-lock) keeps the interaction from
     * ever being "collected", so it does not count toward `max`/`maxUsers` or reset idle time.
     */
    private async filterInteraction(interaction: CollectedMessageInteraction): Promise<boolean> {
        const matching = this.getMatchingListeners(interaction.customId);
        if (matching.length && !this.filterByParticipants(interaction, matching).length) {
            await this.replyNotAParticipant(interaction);
            return false;
        }

        if (!this.options.userLock) return true;

        // Acquire the lock before Discord.js records the interaction so rejected clicks do not affect limits or idle time.
        if (!this.activeUsers.has(interaction.user.id)) {
            this.activeUsers.add(interaction.user.id);
            return true;
        }

        await interaction
            .reply({
                content: this.options.userLockMessage,
                flags: "Ephemeral"
            })
            .catch(async () => {
                await interaction.deferUpdate().catch(() => {});
            });

        return false;
    }

    private setupCollector(): void {
        // Set up event handlers for the underlying collector
        const collector = this.collector as {
            on(event: "collect", handler: (interaction: CollectedMessageInteraction) => unknown): void;
            on(
                event: "end",
                handler: (collected: { values(): IterableIterator<CollectedMessageInteraction> }, reason: string) => unknown
            ): void;
            stop(reason?: string): void;
        };

        // Handle incoming component interactions
        collector.on("collect", async interaction => {
            await this.handleCollect(interaction);
        });

        // Handle when collector stops
        collector.on("end", async (collected, reason) => {
            await this.handleEnd(Array.from(collected.values()) as MessageComponentInteraction[], reason);
        });
    }

    private async handleCollect(interaction: CollectedMessageInteraction): Promise<void> {
        try {
            // Find listeners matching this component's customId
            const targetListeners = this.getMatchingListeners(interaction.customId);
            if (!targetListeners.length) {
                await interaction.deferUpdate().catch(() => {});
                return;
            }

            // `filterInteraction` already guaranteed at least one participant-allowed listener exists.
            const validListeners = this.filterByParticipants(interaction, targetListeners);

            // Optionally defer the interaction before executing listeners
            await this.maybeDefer(interaction, validListeners);

            // Run matching listeners in order
            await this.executeListeners(interaction, validListeners);
        } finally {
            // Release user lock
            if (this.options.userLock) {
                this.activeUsers.delete(interaction.user.id);
            }
        }
    }

    private getMatchingListeners(customId: string): Listener[] {
        return this.listeners.filter(listener => listener.customId === undefined || listener.customId === customId);
    }

    private async replyNotAParticipant(interaction: CollectedMessageInteraction): Promise<void> {
        const message = this.options.notAParticipantMessage;
        if (!message) {
            await interaction.deferUpdate().catch(() => {});
            return;
        }

        await interaction
            .reply({
                content: message,
                flags: "Ephemeral"
            })
            .catch(async () => {
                await interaction.deferUpdate().catch(() => {});
            });
    }

    private filterByParticipants(interaction: CollectedMessageInteraction, listeners: Listener[]): Listener[] {
        return listeners.filter(listener => {
            // Per-listener participants fall back to the collector's global participants.
            // A listener with no restriction at either level allows every participant.
            const listenerParticipants = listener.options?.participants ?? this.options.participants;
            return (
                !listenerParticipants.length ||
                listenerParticipants.some(p => resolveParticipantId(p) === interaction.user.id)
            );
        });
    }

    private async maybeDefer(interaction: MessageComponentInteraction, listeners: Listener[]): Promise<void> {
        // Check if any listener or the global options specify deferral
        const deferOption = listeners.find(l => l.options?.defer)?.options?.defer ?? this.options.defer;

        if (!deferOption) {
            return;
        }

        // Handle different deferral options
        if (typeof deferOption === "object") {
            if (deferOption.update) {
                await interaction.deferUpdate().catch(Boolean);
            } else {
                await interaction.deferReply({ flags: deferOption.flags }).catch(Boolean);
            }
        } else {
            await interaction.deferReply().catch(Boolean);
        }
    }

    private async executeListeners(interaction: MessageComponentInteraction, listeners: Listener[]): Promise<void> {
        // Execute each listener one at a time, in registration order
        for (const listener of listeners) {
            try {
                await listener.fn(interaction);
            } catch (err) {
                console.error("[BetterCollector] Listener error:", err);
            }
        }
    }

    private async handleEnd(collected: MessageComponentInteraction[], reason: string): Promise<void> {
        // Notify all registered end listeners
        for (const fn of this.endListeners) {
            try {
                await fn(collected, reason);
            } catch (err) {
                console.error("[BetterCollector] End listener error:", err);
            }
        }

        // Handle post-collection resolution (edit/delete message)
        await handleResolveAction(this.message, this.options.onResolve);
    }

    /**
     * Register a listener for component interactions.
     * @param customId - The customId of the component to listen for, or a global listener if omitted
     * @param fn - The function to run when the component is interacted with
     * @param options - Listener configuration (participants, defer)
     */
    on(customId: string, fn: ListenerFn, options?: ListenerOptions): this;

    /**
     * Register a global listener for all component interactions.
     * @param fn - The function to run when any component is interacted with
     * @param options - Listener configuration (participants, defer)
     */
    on(fn: ListenerFn, options?: ListenerOptions): this;

    on(customIdOrFn: string | ListenerFn, fnOrOptions?: ListenerFn | ListenerOptions, options?: ListenerOptions): this {
        if (typeof customIdOrFn === "function") {
            this.listeners.push({
                fn: customIdOrFn,
                options: fnOrOptions as ListenerOptions | undefined
            });
        } else {
            if (typeof fnOrOptions !== "function") {
                throw new Error("[BetterCollector] Second argument must be a function when customId is provided");
            }

            this.listeners.push({
                customId: customIdOrFn,
                fn: fnOrOptions,
                options
            });
        }

        return this;
    }

    /**
     * Register a callback for when the collector ends.
     * @param fn - Function called with collected interactions and the end reason
     */
    onEnd(fn: (collected: MessageComponentInteraction[], reason: string) => unknown): this {
        this.endListeners.push(fn);
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
