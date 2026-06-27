import type {
    CollectedMessageInteraction,
    InteractionDeferReplyOptions,
    Message,
    MessageComponentInteraction,
    MessageComponentType
} from "discord.js";
import type { Participant } from "./shared.js";

import { handleResolveAction, ResolveAction, resolveParticipantId } from "./shared.js";

type ListenerFn = (interaction: MessageComponentInteraction) => unknown;
type CollectorEventHandler<K extends keyof CollectorEventMap> = (...args: CollectorEventMap[K]) => unknown;

interface Listener {
    fn: ListenerFn;
    options?: ListenerOptions;
}

interface ListenerGroup {
    global: Listener[];
    byId: Map<string, Listener[]>;
}

interface CollectorEventMap {
    collect: [MessageComponentInteraction];
    end: [MessageComponentInteraction[], string];
}

/**
 * Execution mode for listeners.
 * - Sequential: Listeners run one after another in order
 * - Parallel: All listeners run concurrently
 */
export enum CollectorMode {
    Sequential = "sequential",
    Parallel = "parallel"
}

/**
 * Options for configuring individual listener behavior.
 */
export interface ListenerOptions {
    /** Only allow interactions from these users. */
    participants?: Participant[];
    /** Defer the interaction. */
    defer?: boolean | { update?: boolean; flags?: InteractionDeferReplyOptions["flags"] };
    /** Runs after the listener's function is executed. */
    finally?: (interaction: MessageComponentInteraction) => void;
}

/**
 * Options for configuring the BetterCollector behavior.
 */
export interface BetterCollectorOptions<ComponentType extends MessageComponentType> {
    type?: ComponentType | null;
    participants?: Participant[];
    idle?: number;
    timeout?: number;
    mode?: CollectorMode;
    userLock?: boolean;
    max?: number | null;
    maxComponents?: number | null;
    maxUsers?: number | null;
    onResolve?: ResolveAction;
    defer?: boolean | { update?: boolean; flags?: InteractionDeferReplyOptions["flags"] };
}

// TODO: Will eventually come from global config
export const DEFAULT_CONFIG = {
    timeout: 60_000,
    idle: 30_000,
    mode: CollectorMode.Parallel,
    userLockMessage: "Please wait, your previous action is still processing."
} as const;

/**
 * Enhanced message component collector with advanced features:
 * - Participant filtering
 * - User locking to prevent concurrent interactions
 * - Sequential or parallel listener execution
 * - Built-in deferral handling
 * - Custom resolution actions (edit/delete after collection)
 */
export class BetterCollector<C extends MessageComponentType = MessageComponentType> {
    private readonly message: Message;
    private readonly options: Required<BetterCollectorOptions<C>>;
    private readonly collector: {
        on(event: "collect", handler: CollectorEventHandler<"collect">): void;
        on(event: "end", handler: CollectorEventHandler<"end">): void;
        stop(reason?: string): void;
    };

    private readonly listeners: ListenerGroup = {
        global: [],
        byId: new Map()
    };

    private readonly endListeners: ((collected: MessageComponentInteraction[], reason: string) => unknown)[] = [];
    private readonly activeUsers = new Set<string>();

    constructor(message: Message | null | undefined, options: BetterCollectorOptions<C>) {
        if (!message) throw new Error("Message is null or undefined");
        this.message = message;

        this.options = {
            type: options.type ?? null,
            participants: options.participants ?? [],
            idle: options.idle ?? DEFAULT_CONFIG.idle,
            timeout: options.timeout ?? DEFAULT_CONFIG.timeout,
            mode: options.mode ?? DEFAULT_CONFIG.mode,
            userLock: options.userLock ?? false,
            max: options.max ?? null,
            maxComponents: options.maxComponents ?? null,
            maxUsers: options.maxUsers ?? null,
            onResolve: options.onResolve ?? ResolveAction.DoNothing,
            defer: options.defer ?? false
        };

        this.collector = this.createCollector();
        this.setupCollector();
    }

    private createCollector() {
        // Creates the underlying Discord.js message component collector
        return this.message.createMessageComponentCollector({
            idle: this.options.idle,
            time: this.options.timeout,
            componentType: this.options.type ?? undefined,
            max: this.options.max ?? undefined,
            maxComponents: this.options.maxComponents ?? undefined,
            maxUsers: this.options.maxUsers ?? undefined
        });
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
        // Check if user has a pending action (user lock)
        if (this.options.userLock && this.activeUsers.has(interaction.user.id)) {
            await interaction
                .reply({
                    content: DEFAULT_CONFIG.userLockMessage,
                    flags: "Ephemeral"
                })
                .catch(() => {});

            return;
        }

        // Track active user for lock
        if (this.options.userLock) {
            this.activeUsers.add(interaction.user.id);
        }

        // Find listeners matching this component's customId
        const targetListeners = this.getMatchingListeners(interaction.customId);
        const validListeners = await this.filterByParticipants(interaction, targetListeners);

        // No valid listeners - defer update and return
        if (validListeners.length === 0) {
            await interaction.deferUpdate().catch(() => {});
            return;
        }

        try {
            // Optionally defer the interaction before executing listeners
            await this.maybeDefer(interaction, validListeners);

            // Execute listeners based on mode (sequential or parallel)
            if (this.options.mode === CollectorMode.Sequential) {
                await this.executeSequential(interaction, validListeners);
            } else {
                await this.executeParallel(interaction, validListeners);
            }
        } finally {
            // Release user lock
            if (this.options.userLock) {
                this.activeUsers.delete(interaction.user.id);
            }
        }
    }

    private getMatchingListeners(customId: string): Listener[] {
        // Get listeners registered for this specific customId, plus global listeners
        const idListeners = this.listeners.byId.get(customId) ?? [];
        return [...this.listeners.global, ...idListeners];
    }

    private async filterByParticipants(
        interaction: CollectedMessageInteraction,
        listeners: Listener[]
    ): Promise<Listener[]> {
        // No participants configured - allow all listeners
        if (!this.options.participants.length) {
            return listeners;
        }

        const valid: Listener[] = [];

        // Filter listeners based on participant permissions
        for (const listener of listeners) {
            // Use listener-specific participants or fall back to global participants
            const listenerParticipants = listener.options?.participants ?? this.options.participants;
            const isAllowed = listenerParticipants.some(p => resolveParticipantId(p) === interaction.user.id);

            if (isAllowed) {
                valid.push(listener);
            }
        }

        return valid;
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

    private async executeSequential(interaction: MessageComponentInteraction, listeners: Listener[]): Promise<void> {
        // Execute each listener one at a time, in order
        for (const listener of listeners) {
            try {
                await listener.fn(interaction);
            } catch (err) {
                console.error("[BetterCollector] Listener error:", err);
            } finally {
                listener.options?.finally?.(interaction);
            }
        }
    }

    private async executeParallel(interaction: MessageComponentInteraction, listeners: Listener[]): Promise<void> {
        // Execute all listeners concurrently
        await Promise.allSettled(
            listeners.map(async listener => {
                try {
                    await listener.fn(interaction);
                } catch (err) {
                    console.error("[BetterCollector] Listener error:", err);
                } finally {
                    listener.options?.finally?.(interaction);
                }
            })
        );
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
     * @param options - Listener configuration (participants, defer, finally)
     */
    on(customId: string, fn: ListenerFn, options?: ListenerOptions): this;

    /**
     * Register a global listener for all component interactions.
     * @param fn - The function to run when any component is interacted with
     * @param options - Listener configuration (participants, defer, finally)
     */
    on(fn: ListenerFn, options?: ListenerOptions): this;

    on(customIdOrFn: string | ListenerFn, fnOrOptions?: ListenerFn | ListenerOptions, options?: ListenerOptions): this {
        if (typeof customIdOrFn === "function") {
            this.listeners.global.push({
                fn: customIdOrFn,
                options: fnOrOptions as ListenerOptions | undefined
            });
        } else {
            if (typeof fnOrOptions !== "function") {
                throw new Error("[BetterCollector] Second argument must be a function when customId is provided");
            }

            const existing = this.listeners.byId.get(customIdOrFn) ?? [];
            existing.push({
                fn: fnOrOptions,
                options
            });
            this.listeners.byId.set(customIdOrFn, existing);
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
