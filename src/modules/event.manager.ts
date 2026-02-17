import { EventBuilder } from "@builders/event.builder";
import { importModulesFromDir } from "@utils/dir";
import { ClientEvents, Events } from "discord.js";
import { type Vimcord } from "@/client/client";
import { Logger } from "@/tools/Logger";

export class EventManager {
    client: Vimcord;
    events: Map<string, EventBuilder<any>> = new Map();
    logger: Logger;

    constructor(client: Vimcord) {
        this.client = client;

        // Define custom logger instance
        this.logger = new Logger({ prefixEmoji: "📋", prefix: `EventManager (i${this.client.clientId})` });

        for (const event of Object.values(Events)) {
            client.on(event.toString(), async (...args) =>
                this.executeEvents.apply(this, [event as keyof ClientEvents, ...(args as ClientEvents[keyof ClientEvents])])
            );
        }
    }

    register<T extends keyof ClientEvents>(...events: EventBuilder<T>[]): void {
        for (const event of events) {
            this.events.set(event.name, event);

            if (this.client.config.app.verbose) {
                this.logger.debug(`'${event.name}' registered for EventType '${event.event}'`);
            }
        }
    }

    unregister(...names: string[]): void {
        for (const name of names) {
            const event = this.events.get(name);
            if (!event) continue;

            this.events.delete(name);

            if (this.client.config.app.verbose) {
                this.logger.debug(`'${event.name}' unregistered for EventType '${event.event}'`);
            }
        }
    }

    clear() {
        this.events.forEach(e => this.unregister(e.name));
        this.events.clear();
    }

    get(name: string): EventBuilder | undefined {
        return this.events.get(name);
    }

    getByTag(tag: string): EventBuilder[] {
        return Array.from(this.events.values()).filter(event => event.metadata?.tags?.includes(tag));
    }

    getByCategory(category: string): EventBuilder[] {
        return Array.from(this.events.values()).filter(event => event.metadata?.category?.includes(category));
    }

    getByEvent<T extends keyof ClientEvents>(eventType: T): EventBuilder<T>[] {
        return Array.from(this.events.values()).filter(event => event.event === eventType);
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

    /** Import event modules that end with `.event` */
    async importFrom(dir: string | string[], replaceAll?: boolean) {
        dir = Array.isArray(dir) ? dir : [dir];

        const eventModules = await Promise.all(
            dir.map(dir => importModulesFromDir<{ default: EventBuilder<any> }>(dir, "event"))
        );

        // Clear current registered events
        if (replaceAll) {
            this.clear();
        }

        let importedEvents = 0;
        let ignoredEvents = 0;

        // Register the imported event modules
        for (const event of eventModules.flat()) {
            if (!event.module.default.enabled) {
                ignoredEvents++;
            } else {
                importedEvents++;
            }

            this.register(event.module.default);
        }

        this.client.logger.moduleLoaded("Event Handlers", importedEvents, ignoredEvents);
        return this.events;
    }
}
