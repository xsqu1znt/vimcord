import { type Vimcord } from "@/client";
import { Logger } from "@/tools/Logger";
import { EventBuilder } from "@builders/event.builder";
import { ClientEvents, Events } from "discord.js";
import { ModuleImporter } from "./importers/baseModule.importer";

export class EventManager extends ModuleImporter<EventBuilder<any>> {
    readonly items: Map<string, EventBuilder<any>> = new Map();
    readonly itemSuffix = "event";
    readonly itemName = "Event Handlers";
    logger: Logger;

    constructor(client: Vimcord) {
        super(client);

        this.logger = new Logger({ prefixEmoji: "📋", prefix: `EventManager (i${this.client.clientId})` });

        for (const event of Object.values(Events)) {
            client.on(event.toString(), async (...args) =>
                this.executeEvents.apply(this, [event as keyof ClientEvents, ...(args as ClientEvents[keyof ClientEvents])])
            );
        }
    }

    protected getName(module: EventBuilder<any>): string {
        return module.name;
    }

    register<T extends keyof ClientEvents>(...events: EventBuilder<T>[]): void {
        for (const event of events) {
            this.items.set(event.name, event);

            if (this.client.config.app.verbose) {
                this.logger.debug(`'${event.name}' registered for EventType '${event.event}'`);
            }
        }
    }

    unregister(...names: string[]): void {
        for (const name of names) {
            const event = this.items.get(name);
            if (!event) continue;

            this.items.delete(name);

            if (this.client.config.app.verbose) {
                this.logger.debug(`'${event.name}' unregistered for EventType '${event.event}'`);
            }
        }
    }

    clear() {
        this.items.forEach(e => this.unregister(e.name));
        this.items.clear();
    }

    get(name: string): EventBuilder | undefined {
        return this.items.get(name);
    }

    getByTag(tag: string): EventBuilder[] {
        return Array.from(this.items.values()).filter(event => event.metadata?.tags?.includes(tag));
    }

    getByCategory(category: string): EventBuilder[] {
        return Array.from(this.items.values()).filter(event => event.metadata?.category?.includes(category));
    }

    getByEvent<T extends keyof ClientEvents>(eventType: T): EventBuilder<T>[] {
        return Array.from(this.items.values()).filter(event => event.event === eventType);
    }

    async executeEvents<T extends keyof ClientEvents>(eventType: T, ...args: ClientEvents[T]): Promise<void> {
        const events = this.getByEvent(eventType);
        if (!events.length) return;

        const sortedEvents = events.sort((a, b) => b.priority - a.priority);

        await Promise.all(
            sortedEvents.map(async event => {
                try {
                    await event.execute?.(this.client as Vimcord<true>, ...args);
                    if (event.once) {
                        this.unregister(event.name);
                    }
                } catch (err) {
                    this.logger.error(`'${event.name}' failed to execute`, err as Error);
                }
            })
        );
    }
}
