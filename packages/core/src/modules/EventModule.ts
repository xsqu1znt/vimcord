import type { ClientEvents } from "discord.js";
import type { Vimcord } from "@/client/Vimcord.js";
import type { ModuleOptions } from "./abstracts/AbstractModule.js";

import { AbstractModule } from "./abstracts/AbstractModule.js";

export interface EventModuleOptions<T extends keyof ClientEvents = keyof ClientEvents> extends ModuleOptions {
    /** The client event to trigger on. */
    event: T;

    /**
     * Whether this event is enabled.
     * @default true
     */
    enabled?: boolean;
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

export class EventModule<T extends keyof ClientEvents = keyof ClientEvents> extends AbstractModule {
    readonly event: T;

    readonly enabled: boolean;
    readonly once: boolean;
    readonly priority: number;

    constructor(client: Vimcord, options: EventModuleOptions<T>) {
        super(client, options);

        this.event = options.event;

        this.enabled = options.enabled ?? true;
        this.once = options.once ?? false;
        this.priority = options.priority ?? 0;
    }
}
