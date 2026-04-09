import type { ClientEvents } from "discord.js";
import type { EventBuilder } from "@/builders/index.js";
import type { ModuleIndex } from "../abstracts/AbstractModuleImporter.js";
import type { Vimcord } from "../Vimcord.js";

import { AbstractModuleImporter } from "../abstracts/AbstractModuleImporter.js";

type EventModuleIndex = "event" | "name" | "category" | "tag";

export class EventManager extends AbstractModuleImporter<EventBuilder> {
    override modules = new Map<string, EventBuilder>();
    override indexes = new Map<EventModuleIndex, ModuleIndex<EventBuilder>>();
    override fileSuffix = ".event";

    constructor(client: Vimcord) {
        super(client);

        this.indexes.set("event", { key: m => m.event, map: new Map(), isArray: true });
        this.indexes.set("name", { key: m => m.name, map: new Map() });
        this.indexes.set("category", { key: m => m.metadata.category, map: new Map(), isArray: true });
        this.indexes.set("tag", { key: m => m.metadata.tags, map: new Map(), isArray: true });
    }

    protected override createModuleKey(module: EventBuilder): string {
        return module.id;
    }

    override clear(): void {
        this.modules.clear();
        this.reindex();
    }

    override get(id: string): EventBuilder | undefined {
        return this.modules.get(id);
    }

    getByEvent(event: string): EventBuilder[] {
        return this.getIndexed<EventModuleIndex>("event", event, true);
    }

    getByName(name: string): EventBuilder[] {
        return this.getIndexed<EventModuleIndex>("name", name, true);
    }

    getByCategory(category: string): EventBuilder[] {
        return this.getIndexed<EventModuleIndex>("category", category, true);
    }

    getByTag(tag: string): EventBuilder[] {
        return this.getIndexed<EventModuleIndex>("tag", tag, true);
    }

    register(...events: EventBuilder[]): void {
        events.forEach(e => this.modules.set(e.id, e));
        this.reindex();
        events.forEach(e => this.client.logger.debugVerbose(`Registered '${e.name}' for EventType '${e.event}'`));
    }

    unregister(...events: EventBuilder[]): void {
        events.forEach(e => this.modules.delete(e.id));
        this.reindex();
        events.forEach(e => this.client.logger.debugVerbose(`Unregistered '${e.name}' for EventType '${e.event}'`));
    }

    async executeEvents<T extends keyof ClientEvents>(event: T, ...args: ClientEvents[T]): Promise<void> {
        const events = this.getByEvent(event);
        if (!events.length) return;

        const sortedEvents = events.sort((a, b) => b.priority - a.priority);
        await Promise.allSettled(
            sortedEvents.map(async e => {
                try {
                    // TODO: Implement base execute into AbstractBuilder or EventBuilder
                    // await e.execute(this.client as Vimcord<true>, ...args);
                } catch (err) {
                    this.client.logger.error(`Failed to execute '${e.name}' for EventType '${e.event}'`, err as Error);
                } finally {
                    if (e.once) this.unregister(e);
                }
            })
        );
    }
}
