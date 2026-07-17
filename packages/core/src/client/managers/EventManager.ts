import type {
    AnyThreadChannel,
    ApplicationCommandPermissionsUpdateData,
    AuditLogEvent,
    AutoModerationActionExecution,
    AutoModerationRule,
    CacheType,
    Client,
    ClientEvents,
    CloseEvent,
    DMChannel,
    Entitlement,
    ForumChannel,
    Guild,
    GuildAuditLogsEntry,
    GuildBan,
    GuildEmoji,
    GuildMember,
    GuildMembersChunk,
    GuildScheduledEvent,
    GuildScheduledEventStatus,
    GuildSoundboardSound,
    GuildTextBasedChannel,
    Interaction,
    Invite,
    MediaChannel,
    Message,
    MessageReaction,
    MessageReactionEventDetails,
    NewsChannel,
    NonThreadGuildBasedChannel,
    OmitPartialGroupDMChannel,
    PartialGuildMember,
    PartialGuildScheduledEvent,
    PartialMessage,
    PartialMessageReaction,
    PartialPollAnswer,
    PartialSoundboardSound,
    PartialThreadMember,
    PartialUser,
    PollAnswer,
    Presence,
    ReadonlyCollection,
    Role,
    StageInstance,
    Sticker,
    Subscription,
    TextBasedChannel,
    TextChannel,
    ThreadMember,
    Typing,
    User,
    VoiceChannel,
    VoiceChannelEffect,
    VoiceState
} from "discord.js";
import type { EventModule } from "@/modules/index.js";
import type { Vimcord } from "../Vimcord.js";

import { AbstractModuleImporter } from "@/abstracts/AbstractModuleImporter.js";

type EventModuleIndexType = "event" | "name" | "category" | "tag";
type EventListener<K extends keyof ClientEvents> = (...args: ClientEvents[K]) => void;

export class EventManager extends AbstractModuleImporter<EventModule, EventModuleIndexType> {
    private readonly mountedListeners = new Map<keyof ClientEvents, EventListener<keyof ClientEvents>>();

    constructor(client: Vimcord) {
        super(client);

        this.indexes.set("event", { key: m => m.event, map: new Map(), isArray: true });
        this.indexes.set("name", { key: m => m.name, map: new Map() });
        this.indexes.set("category", { key: m => m.metadata.category, map: new Map(), isArray: true });
        this.indexes.set("tag", { key: m => m.metadata.tags, map: new Map(), isArray: true });
    }

    protected override createModuleKey(module: EventModule): string {
        return module.id;
    }

    override clear(): void {
        this.unmount();
        this.modules.clear();
        this.reindex();
    }

    override get(id: string): EventModule | undefined {
        return this.modules.get(id);
    }

    override getAll(): EventModule[] {
        return Array.from(this.modules.values());
    }

    getByEvent<K extends keyof ClientEvents>(event: K): EventModule<K>[] {
        return this.getIndex("event", event, true) as unknown as EventModule<K>[];
    }

    getByName(name: string): EventModule | undefined {
        return this.getIndex("name", name);
    }

    getByCategory(category: string): EventModule[] {
        return this.getIndex("category", category, true);
    }

    getByTag(tag: string): EventModule[] {
        return this.getIndex("tag", tag, true);
    }

    register(...events: EventModule[]): void {
        events.forEach(e => {
            if (this.modules.has(e.id)) return;

            e.inject(this.client);
            this.modules.set(e.id, e);
        });
        this.reindex();
        events.forEach(e =>
            this.client.logger.debug(`[EventManager] Registered '${e.name}' (${e.id}) for EventType '${e.event}'`)
        );
        new Set(events.map(e => e.event)).forEach(event => {
            this.unmount(event);
            this.mount(event);
        });
    }

    unregister(...ids: string[]): void {
        const events = ids.map(id => this.modules.get(id)).filter((e): e is EventModule => e !== undefined);
        if (!events.length) return;
        const mountedEvents = new Set(events.map(e => e.event).filter(event => this.mountedListeners.has(event)));

        events.forEach(e => this.modules.delete(e.id));
        this.reindex();
        events.forEach(e =>
            this.client.logger.debug(`[EventManager] Unregistered '${e.name}' (${e.id}) for EventType '${e.event}'`)
        );
        mountedEvents.forEach(event => {
            this.unmount(event);
            this.mount(event);
        });
    }

    mount(event?: keyof ClientEvents): void {
        const clientEvents = event ? [event] : Array.from(new Set(Array.from(this.modules.values()).map(m => m.event)));
        if (!clientEvents.length) return;

        for (const event of clientEvents) {
            if (this.mountedListeners.has(event)) continue;

            const size = this.getByEvent(event).length;
            if (!size) continue;

            const listener: EventListener<typeof event> = (...args) => void this.executeEvents(event, ...args);
            this.mountedListeners.set(event, listener);
            this.client.on(event, listener);
            this.client.logger.debug(
                `[EventManager] Mounted ${size} ${size === 1 ? "event" : "events"} for EventType '${event}'`
            );
        }
    }

    unmount(event?: keyof ClientEvents): void {
        const clientEvents = event ? [event] : Array.from(this.mountedListeners.keys());
        if (!clientEvents.length) return;

        for (const event of clientEvents) {
            const listener = this.mountedListeners.get(event);
            if (!listener) continue;

            const size = this.getByEvent(event).length;
            this.client.off(event, listener);
            this.mountedListeners.delete(event);
            this.client.logger.debug(
                `[EventManager] Unmounted ${size} ${size === 1 ? "event" : "events"} for EventType '${event}'`
            );
        }
    }

    async executeEvents<K extends keyof ClientEvents>(event: K, ...args: ClientEvents[K]): Promise<void> {
        const events = this.getByEvent(event) as unknown as EventModule[];
        if (!events.length) return;

        const sortedEvents = [...events].sort((a, b) => b.priority - a.priority);
        await Promise.allSettled(
            sortedEvents.map(async e => {
                try {
                    await e.run(...args);
                } catch (err) {
                    this.client.logger.error(
                        `[EventManager] Failed to execute '${e.name}' (${e.id}) for EventType '${e.event}'`,
                        err as Error
                    );
                } finally {
                    if (e.once) this.unregister(e.id);
                }
            })
        );
    }
}
