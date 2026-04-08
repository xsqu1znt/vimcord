import type {
    CollectedMessageInteraction,
    InteractionDeferReplyOptions,
    Message,
    MessageComponentInteraction,
    MessageComponentType
} from "discord.js";
import type { Participant } from "./shared.js";

import { handleTimeoutAction, resolveParticipantId, TimeoutAction } from "./shared.js";

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

export enum CollectorMode {
    Sequential = "sequential",
    Parallel = "parallel"
}

export interface ListenerOptions {
    /** Only allow interactions from these users. */
    participants?: Participant[];
    /** Defer the interaction. */
    defer?: boolean | { update?: boolean; flags?: InteractionDeferReplyOptions["flags"] };
    /** Runs after the listener's function is executed. */
    finally?: (interaction: MessageComponentInteraction) => void;
}

export interface BetterCollectorOptions<ComponentType extends MessageComponentType> {
    type?: ComponentType | null;
    participants?: Participant[];
    idle?: number;
    timeout?: number;
    mode?: CollectorMode;
    userLock?: boolean;
    userLockMessage?: string;
    max?: number | null;
    maxComponents?: number | null;
    maxUsers?: number | null;
    onTimeout?: TimeoutAction;
    defer?: boolean | { update?: boolean; flags?: InteractionDeferReplyOptions["flags"] };
}

// TODO: Will eventually come from global config
export const DEFAULT_CONFIG = {
    timeout: 60_000,
    idle: 30_000,
    mode: CollectorMode.Parallel,
    userLockMessage: "Please wait, your previous action is still processing."
} as const;

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
            userLockMessage: options.userLockMessage ?? DEFAULT_CONFIG.userLockMessage,
            max: options.max ?? null,
            maxComponents: options.maxComponents ?? null,
            maxUsers: options.maxUsers ?? null,
            onTimeout: options.onTimeout ?? TimeoutAction.DoNothing,
            defer: options.defer ?? false
        };

        this.collector = this.createCollector();
        this.setupCollector();
    }

    private createCollector() {
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
        const collector = this.collector as {
            on(event: "collect", handler: (interaction: CollectedMessageInteraction) => unknown): void;
            on(event: "end", handler: (collected: CollectedMessageInteraction[]) => unknown): void;
            stop(reason?: string): void;
        };

        collector.on("collect", async interaction => {
            await this.handleCollect(interaction);
        });

        collector.on("end", async collected => {
            await this.handleEnd(collected as MessageComponentInteraction[], "ended");
        });
    }

    private async handleCollect(interaction: CollectedMessageInteraction): Promise<void> {
        if (this.options.userLock && this.activeUsers.has(interaction.user.id)) {
            await interaction
                .reply({
                    content: this.options.userLockMessage,
                    flags: "Ephemeral"
                })
                .catch(() => {});

            return;
        }

        if (this.options.userLock) {
            this.activeUsers.add(interaction.user.id);
        }

        const targetListeners = this.getMatchingListeners(interaction.customId);
        const validListeners = await this.filterByParticipants(interaction, targetListeners);

        if (validListeners.length === 0) {
            await interaction.deferUpdate().catch(() => {});
            return;
        }

        try {
            await this.maybeDefer(interaction, validListeners);

            if (this.options.mode === CollectorMode.Sequential) {
                await this.executeSequential(interaction, validListeners);
            } else {
                await this.executeParallel(interaction, validListeners);
            }
        } finally {
            if (this.options.userLock) {
                this.activeUsers.delete(interaction.user.id);
            }
        }
    }

    private getMatchingListeners(customId: string): Listener[] {
        const idListeners = this.listeners.byId.get(customId) ?? [];
        return [...this.listeners.global, ...idListeners];
    }

    private async filterByParticipants(
        interaction: CollectedMessageInteraction,
        listeners: Listener[]
    ): Promise<Listener[]> {
        if (!this.options.participants.length) {
            return listeners;
        }

        const valid: Listener[] = [];

        for (const listener of listeners) {
            const listenerParticipants = listener.options?.participants ?? this.options.participants;
            const isAllowed = listenerParticipants.some(p => resolveParticipantId(p) === interaction.user.id);

            if (isAllowed) {
                valid.push(listener);
            }
        }

        return valid;
    }

    private async maybeDefer(interaction: MessageComponentInteraction, listeners: Listener[]): Promise<void> {
        const deferOption = listeners.find(l => l.options?.defer)?.options?.defer ?? this.options.defer;

        if (!deferOption) {
            return;
        }

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
        for (const fn of this.endListeners) {
            try {
                await fn(collected, reason);
            } catch (err) {
                console.error("[BetterCollector] End listener error:", err);
            }
        }

        await handleTimeoutAction(this.message, this.options.onTimeout);
    }

    on(customId: string, fn: ListenerFn, options?: ListenerOptions): this;

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

    onEnd(fn: (collected: MessageComponentInteraction[], reason: string) => unknown): this {
        this.endListeners.push(fn);
        return this;
    }

    stop(reason: string = "manual"): void {
        this.collector.stop(reason);
    }
}
