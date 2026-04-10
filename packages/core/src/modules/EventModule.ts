import type { ClientEvents } from "discord.js";
import type { Vimcord } from "@/client/Vimcord.js";
import type { ModuleOptions } from "./abstracts/AbstractModule.js";

import { AbstractModule } from "./abstracts/AbstractModule.js";

export interface EventModuleOptions<T extends keyof ClientEvents = keyof ClientEvents> extends ModuleOptions<
    ClientEvents[T],
    void
> {
    /** The client event to trigger on. */
    event: T;
    /**
     * Whether this event should be executed only once then unregistered.
     * @default false
     */
    once?: boolean;
    /**
     * Priority for event execution order (higher = earlier).
     * @default 0
     */
    priority?: number;
}

export class EventModule<
    K extends keyof ClientEvents = keyof ClientEvents,
    Args extends ClientEvents[K] = ClientEvents[K]
> extends AbstractModule<Args, void> {
    readonly event: K;

    readonly once: boolean;
    readonly priority: number;

    constructor(client: Vimcord, options: EventModuleOptions<K>) {
        super(client, options);

        this.event = options.event;

        this.once = options.once ?? false;
        this.priority = Math.max(0, options.priority ?? 0);
    }

    override validate(): boolean {
        return true;
    }
}
