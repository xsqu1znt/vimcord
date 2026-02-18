import { createToolsConfig, globalToolsConfig, ToolsConfig } from "@/configs/tools.config";
import {
    CollectedMessageInteraction,
    InteractionCollector,
    MappedInteractionTypes,
    Message,
    MessageComponentType,
    UserResolvable
} from "discord.js";
import { PartialDeep } from "@/utils/types.utils";

type Func = (...args: any[]) => any;
type Listener = { fn: Func; options?: ListenerOptions };

export interface BetterCollectorOptions<T extends MessageComponentType> {
    type?: T;
    participants?: UserResolvable[];
    idle?: number;
    timeout?: number;
    /** Run listeners in sequence, awaiting each other */
    sequential?: boolean;
    /** Prevent a user from triggering another interaction until their previous one is resolved */
    userLock?: boolean;
    max?: number;
    maxComponents?: number;
    maxUsers?: number;
    onTimeout?: CollectorTimeoutType;
    config?: PartialDeep<ToolsConfig>;
}

export interface ListenerOptions<
    ComponentType extends MessageComponentType = MessageComponentType,
    InGuild extends boolean = boolean
> {
    participants?: UserResolvable[];
    defer?: boolean | { update?: boolean; ephemeral?: boolean };
    finally?: (arg: MappedInteractionTypes<InGuild>[ComponentType]) => any;
}

export enum CollectorTimeoutType {
    DisableComponents = 0,
    DeleteMessage = 1,
    DoNothing = 2
}

export class BetterCollector<ComponentType extends MessageComponentType, InGuild extends boolean = boolean> {
    message?: Message;
    collector?: InteractionCollector<MappedInteractionTypes<InGuild>[ComponentType]>;
    options?: BetterCollectorOptions<ComponentType>;

    private activeUsers = new Set<string>();
    private participantWarningCooldowns = new Map<string, number>();
    private config: ToolsConfig;

    private events: { collectId: Map<string, Listener[]>; collect: Listener[]; end: Listener[]; timeout: Listener[] } = {
        collectId: new Map(),
        collect: [],
        end: [],
        timeout: []
    };

    static create<T extends MessageComponentType>(message: Message | undefined | null, options: BetterCollectorOptions<T>) {
        return new BetterCollector<T, boolean>(message, options);
    }

    private async validateParticipant(interaction: CollectedMessageInteraction, participants?: UserResolvable[]) {
        const allowedParticipants = participants || this.options?.participants || [];
        if (!allowedParticipants.length) return true;

        const isAllowed = allowedParticipants.some(user => {
            if (typeof user === "string") return user === interaction.user.id;
            if (typeof user === "object" && "id" in user) return user.id === interaction.user.id;
            return false;
        });

        if (!isAllowed) {
            const now = Date.now();
            const lastWarned = this.participantWarningCooldowns.get(interaction.user.id) || 0;

            if (now - lastWarned > this.config.collector.notAParticipantWarningCooldown) {
                this.participantWarningCooldowns.set(interaction.user.id, now);

                if (this.config.collector.notAParticipantMessage) {
                    await interaction
                        .reply({
                            content: this.config.collector.notAParticipantMessage,
                            flags: "Ephemeral"
                        })
                        .catch(() => {});
                } else {
                    await interaction.deferUpdate().catch(() => {});
                }
            } else {
                // NOTE: They are spamming, acknowledge silently
                await interaction.deferUpdate().catch(() => {});
            }
        }

        return isAllowed;
    }

    private build() {
        if (!this.message) return;
        if (this.collector) return;

        // Build and configure the collector
        this.collector = this.message.createMessageComponentCollector({
            idle: this.options?.idle ?? this.config.timeouts.collectorIdle,
            time: this.options?.timeout ?? this.config.timeouts.collectorTimeout,
            componentType: this.options?.type,
            max: this.options?.max,
            maxComponents: this.options?.maxComponents,
            maxUsers: this.options?.maxUsers
        });

        this.setupListeners();
    }

    private setupListeners() {
        if (!this.collector) return;

        this.collector.on("collect", async interaction => {
            // Check if user is locked
            if (this.options?.userLock && this.activeUsers.has(interaction.user.id)) {
                return interaction
                    .reply({ content: this.config.collector.userLockMessage, flags: "Ephemeral" })
                    .catch(() => {});
            }

            if (this.options?.userLock) {
                this.activeUsers.add(interaction.user.id);
            }

            const globalListeners = this.events.collect;
            const idListeners = this.events.collectId.get(interaction.customId) || [];
            const allListeners = [...globalListeners, ...idListeners];

            const shouldBeDeferred = allListeners.find(l => l.options?.defer)?.options?.defer;

            /* Identify who is allowed to run */
            const validListeners = [];
            for (const listener of allListeners) {
                const isAllowed = await this.validateParticipant(interaction, listener.options?.participants);
                if (isAllowed) validListeners.push(listener);
            }

            // Nobody is allowed to run this interaction
            if (validListeners.length === 0) return;

            try {
                if (shouldBeDeferred) {
                    if (typeof shouldBeDeferred === "object") {
                        if (shouldBeDeferred.update) {
                            await interaction.deferUpdate().catch(Boolean);
                        } else {
                            await interaction
                                .deferReply({ flags: shouldBeDeferred.ephemeral ? "Ephemeral" : undefined })
                                .catch(Boolean);
                        }
                    } else {
                        await interaction.deferReply().catch(Boolean);
                    }
                }

                // Sequential Execution
                if (this.options?.sequential) {
                    for (const listener of allListeners) {
                        try {
                            const isAllowed = await this.validateParticipant(interaction, listener.options?.participants);
                            if (!isAllowed) return;
                            await listener.fn(interaction).finally(() => listener.options?.finally?.(interaction));
                        } catch (err) {
                            this.handleListenerError(err);
                        }
                    }
                }
                // Parallel Execution
                else {
                    Promise.all(
                        allListeners.map(l => {
                            const isAllowed = this.validateParticipant(interaction, l.options?.participants);
                            if (!isAllowed) return;
                            return l
                                .fn(interaction)
                                .catch(this.handleListenerError)
                                .finally(() => l.options?.finally?.(interaction));
                        })
                    );
                }
            } finally {
                if (this.options?.userLock) {
                    this.activeUsers.delete(interaction.user.id);
                }
            }
        });

        this.collector.on("end", async (collected, reason) => {
            // Sequential Execution
            if (this.options?.sequential) {
                for (const listener of this.events.end) {
                    try {
                        await listener.fn(collected, reason);
                    } catch (err) {
                        this.handleListenerError(err);
                    }
                }
            }
            // Parallel Execution
            else {
                Promise.all(this.events.end.map(l => l.fn(collected, reason).catch(this.handleListenerError)));
            }

            switch (this.options?.onTimeout) {
                case CollectorTimeoutType.DisableComponents:
                    if (!this.message?.editable) break;

                    try {
                        // Map through rows and components to set disabled: true
                        const disabledRows = this.message.components.map(row => {
                            // We use toJSON() to get a plain object we can modify
                            const updatedRow = row.toJSON();
                            if ("components" in updatedRow) {
                                updatedRow.components = updatedRow.components.map(component => ({
                                    ...component,
                                    disabled: true
                                })) as any;
                            }
                            return updatedRow;
                        });

                        await this.message.edit({ components: disabledRows });
                    } catch (err) {
                        // Fail silently if the message was deleted
                        if (!(err instanceof Error && err.message.includes("Unknown Message"))) {
                            this.handleListenerError(err);
                        }
                    }
                    break;

                case CollectorTimeoutType.DeleteMessage:
                    if (!this.message?.deletable) break;
                    await this.message.delete().catch(Boolean);
                    break;

                case CollectorTimeoutType.DoNothing:
                default:
                    break;
            }
        });
    }

    private handleListenerError(err: unknown) {
        console.error("[BetterCollector] Listener Error:", err);
    }

    constructor(message: Message | undefined | null, options: BetterCollectorOptions<ComponentType> = {}) {
        this.config = options.config ? createToolsConfig(options.config) : globalToolsConfig;
        this.message = message || undefined;
        this.options = options;
        this.build();
    }

    /** Triggers on any interaction */
    on(
        fn: (interaction: MappedInteractionTypes<InGuild>[ComponentType]) => any,
        options?: ListenerOptions<ComponentType, InGuild>
    ): this;
    /** Triggers when the interaction's customId matches */
    on(
        customId: string,
        fn: (interaction: MappedInteractionTypes<InGuild>[ComponentType]) => any,
        options?: ListenerOptions<ComponentType, InGuild>
    ): this;
    on(
        idOrFunc: string | Func,
        fnOrOptions?: Func | ListenerOptions<ComponentType, InGuild>,
        options?: ListenerOptions<ComponentType, InGuild>
    ): this {
        let finalFn: Func;
        let finalOptions: ListenerOptions<ComponentType, InGuild> | undefined;
        let customId: string | undefined;

        if (typeof idOrFunc === "function") {
            // Handles: on(fn, options)
            finalFn = idOrFunc;
            finalOptions = fnOrOptions as ListenerOptions;
        } else {
            // Handles: on(customId, fn, options)
            if (typeof fnOrOptions !== "function") {
                throw new Error("[BetterCollector] Second argument must be a function when a customId is provided.");
            }
            customId = idOrFunc;
            finalFn = fnOrOptions;
            finalOptions = options;
        }

        if (customId) {
            const listeners = this.events.collectId.get(customId) || [];
            listeners.push({ fn: finalFn, options: finalOptions as any });
            this.events.collectId.set(customId, listeners);
        } else {
            this.events.collect.push({ fn: finalFn, options: finalOptions as any });
        }

        return this;
    }

    onEnd(
        fn: (collected: MappedInteractionTypes<InGuild>[ComponentType][], reason: string) => any,
        options?: ListenerOptions
    ) {
        this.events.end.push({ fn, options });
        return this;
    }

    /** Manually stop the collector and trigger cleanup */
    stop(reason: string = "manual") {
        this.collector?.stop(reason);
    }
}
