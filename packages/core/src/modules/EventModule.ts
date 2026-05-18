import type { ClientEvents } from "discord.js";
import type { ModuleOptions } from "../abstracts/AbstractModule.js";

import { AbstractModule } from "../abstracts/AbstractModule.js";

/** Overrides the `clientReady` event so there's no double client args. */
export type VimcordClientEvents = Omit<ClientEvents, "clientReady"> & { clientReady: [] };

export interface EventModuleOptions<
    Event extends keyof VimcordClientEvents = keyof VimcordClientEvents,
    Args extends VimcordClientEvents[Event] = VimcordClientEvents[Event]
> extends ModuleOptions<Args, void> {
    /** The client event to trigger on. */
    event: Event;
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
    K extends keyof VimcordClientEvents = keyof VimcordClientEvents,
    Args extends VimcordClientEvents[K] = VimcordClientEvents[K]
> extends AbstractModule<Args, void> {
    override moduleType: string = "Event";
    readonly event: K;
    readonly once: boolean;
    readonly priority: number;

    constructor(options: EventModuleOptions<K, Args>) {
        super({ requiresReady: false, ...options });

        this.event = options.event;
        this.once = options.once ?? false;
        this.priority = Math.max(0, options.priority ?? 0);
    }

    protected override validate(): boolean {
        return true;
    }
}
