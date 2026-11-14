import type { ClientEvents } from "discord.js";
import type { Vimcord } from "@/client/index.js";
import type { ModuleContext, ModuleHookContext, ModuleOptions } from "../abstracts/AbstractModule.js";

import { AbstractModule } from "../abstracts/AbstractModule.js";

/** Overrides the `clientReady` event so there's no double client args. */
export type VimcordClientEvents = Omit<ClientEvents, "clientReady"> & { clientReady: [] };

type EventModuleContext<Args extends unknown[]> = ModuleContext<boolean> & {
    args: Args;
};

type EventModuleHookContext<Args extends unknown[]> = ModuleHookContext<Args, boolean> & EventModuleContext<Args>;

/** Event identity, invocation rules, hooks, and event handler. */
export interface EventModuleOptions<
    Event extends keyof VimcordClientEvents = keyof VimcordClientEvents,
    Args extends VimcordClientEvents[Event] = VimcordClientEvents[Event]
> extends Omit<ModuleOptions<Args, EventModuleContext<Args>, EventModuleHookContext<Args>>, "name"> {
    /** Name shown in logs and used by `getByName`. Names need not be unique. @default the event name */
    name?: string;
    /** Waits for readiness before handling this event. @default false */
    requiresReady?: boolean;
    /** The client event to trigger on. */
    event: Event;
    /** Whether this event should be executed only once then unregistered. @default false */
    once?: boolean;
}

/** Runs a module handler for a Discord.js client event. */
export class EventModule<
    Event extends keyof VimcordClientEvents = keyof VimcordClientEvents,
    Args extends VimcordClientEvents[Event] = VimcordClientEvents[Event]
> extends AbstractModule<Args, EventModuleContext<Args>, EventModuleHookContext<Args>> {
    /** Module kind displayed in logs. */
    override moduleType: string = "Event";
    /** Discord.js event that triggers the module. */
    readonly event: Event;
    /** Registers a listener removed after its first event. */
    readonly once: boolean;

    constructor(options: EventModuleOptions<Event, Args>) {
        super({ requiresReady: false, ...options, name: options.name ?? options.event });

        this.event = options.event;
        this.once = options.once ?? false;
    }

    protected override createModuleCTX(args: Args): EventModuleContext<Args> {
        return { client: this.client as Vimcord, args };
    }
}
