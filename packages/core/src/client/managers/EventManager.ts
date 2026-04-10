import type { ClientEvents } from "discord.js";
import type { EventModule } from "@/modules/index.js";
import type { ModuleIndex } from "../abstracts/AbstractModuleImporter.js";
import type { Vimcord } from "../Vimcord.js";

import { AbstractModuleImporter } from "../abstracts/AbstractModuleImporter.js";

type EventModuleIndex = "name" | "event" | "category" | "tag";

export class EventManager extends AbstractModuleImporter<EventModule> {
    override modules = new Map<string, EventModule>();
    override indexes = new Map<EventModuleIndex, ModuleIndex<EventModule>>();
    override fileSuffix = ".event";

    constructor(client: Vimcord) {
        super(client);

        this.indexes.set("name", { key: m => m.name, map: new Map() });
        this.indexes.set("event", { key: m => m.event, map: new Map(), isArray: true });
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

    getByEvent(event: string): EventModule[] {
        return this.getIndexed<EventModuleIndex>("event", event, true);
    }

    getByName(name: string): EventModule[] {
        return this.getIndexed<EventModuleIndex>("name", name, true);
    }

    getByCategory(category: string): EventModule[] {
        return this.getIndexed<EventModuleIndex>("category", category, true);
    }

    getByTag(tag: string): EventModule[] {
        return this.getIndexed<EventModuleIndex>("tag", tag, true);
    }

    register(...events: EventModule[]): void {
        events.forEach(e => this.modules.set(e.id, e));
        this.reindex();
        events.forEach(e =>
            this.client.logger.debugVerbose(`[EventManager] Registered '${e.name}' (${e.id}) for EventType '${e.event}'`)
        );
    }

    unregister(...events: EventModule[]): void {
        events.forEach(e => this.modules.delete(e.id));
        this.reindex();
        events.forEach(e =>
            this.client.logger.debugVerbose(`[EventManager] Unregistered '${e.name}' (${e.id}) for EventType '${e.event}'`)
        );
    }

    async executeEvents<T extends keyof ClientEvents>(event: T, ...args: ClientEvents[T]): Promise<void> {
        const events = this.getByEvent(event);
        if (!events.length) return;

        const sortedEvents = events.sort((a, b) => b.priority - a.priority);
        await Promise.allSettled(
            sortedEvents.map(async e => {
                try {
                    // TODO: Implement base execute into AbstractModule or EventModule
                    // await e.execute(this.client as Vimcord<true>, ...args);
                } catch (err) {
                    this.client.logger.error(
                        `[EventManager] Failed to execute '${e.name}' (${e.id}) for EventType '${e.event}'`,
                        err as Error
                    );
                } finally {
                    if (e.once) this.unregister(e);
                }
            })
        );
    }
}
