import type { ClientEvents } from "discord.js";
import type { EventModule } from "@/modules/index.js";
import type { Vimcord } from "../Vimcord.js";

import { AbstractModuleImporter } from "@/abstracts/AbstractModuleImporter.js";

type EventModuleIndexType = "event" | "name" | "category" | "tag";

export class EventManager extends AbstractModuleImporter<EventModule, EventModuleIndexType> {
    constructor(fileSuffix: string | string[] | undefined, client: Vimcord) {
        super(client, fileSuffix);

        this.indexes.set("event", { key: m => m.event, map: new Map(), isArray: true });
        this.indexes.set("name", { key: m => m.name, map: new Map() });
        this.indexes.set("category", { key: m => m.metadata.category, map: new Map(), isArray: true });
        this.indexes.set("tag", { key: m => m.metadata.tags, map: new Map(), isArray: true });
    }

    protected override createModuleKey(module: EventModule): string {
        return module.id;
    }

    override clear(): void {
        this.modules.clear();
        this.reindex();
    }

    override get(id: string): EventModule | undefined {
        return this.modules.get(id);
    }

    getByEvent<K extends keyof ClientEvents>(event: K): EventModule<K>[] {
        return this.getIndexed("event", event, true) as unknown as EventModule<K>[];
    }

    getByName(name: string): EventModule[] {
        return this.getIndexed("name", name, true);
    }

    getByCategory(category: string): EventModule[] {
        return this.getIndexed("category", category, true);
    }

    getByTag(tag: string): EventModule[] {
        return this.getIndexed("tag", tag, true);
    }

    register(...events: EventModule[]): void {
        events.forEach(e => this.modules.set(e.id, e));
        this.reindex();
        events.forEach(e =>
            this.client.logger.debugVerbose(`[EventManager] Registered '${e.name}' (${e.id}) for EventType '${e.event}'`)
        );
    }

    unregister(...ids: string[]): void {
        const events = ids.map(id => this.modules.get(id)).filter((e): e is EventModule => e !== undefined);
        if (!events.length) return;

        events.forEach(e => this.modules.delete(e.id));
        this.reindex();
        events.forEach(e =>
            this.client.logger.debugVerbose(`[EventManager] Unregistered '${e.name}' (${e.id}) for EventType '${e.event}'`)
        );
    }

    async executeEvents<K extends keyof ClientEvents>(event: K, ...args: ClientEvents[K]): Promise<void> {
        const events = this.getByEvent(event) as unknown as EventModule[];
        if (!events.length) return;

        const sortedEvents = events.sort((a, b) => b.priority - a.priority);
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
