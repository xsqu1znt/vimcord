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

export interface EventModuleOptions<
    Event extends keyof VimcordClientEvents = keyof VimcordClientEvents,
    Args extends VimcordClientEvents[Event] = VimcordClientEvents[Event]
> extends ModuleOptions<Args, EventModuleContext<Args>, EventModuleHookContext<Args>> {
    /** The client event to trigger on. */
    event: Event;
    /**
     * Whether this event should be executed only once then unregistered.
     * @default false
     */
    once?: boolean;
}

export class EventModule<
    Event extends keyof VimcordClientEvents = keyof VimcordClientEvents,
    Args extends VimcordClientEvents[Event] = VimcordClientEvents[Event]
> extends AbstractModule<Args, EventModuleContext<Args>, EventModuleHookContext<Args>> {
    override moduleType: string = "Event";
    readonly event: Event;
    readonly once: boolean;

    constructor(options: EventModuleOptions<Event, Args>) {
        super({ requiresReady: false, ...options });

        this.event = options.event;
        this.once = options.once ?? false;
    }

    protected override validate(): boolean {
        return true;
    }

    protected override createModuleCTX(args: Args): EventModuleContext<Args> {
        return { client: this.client as Vimcord, args };
    }

    protected override createHookCTX(moduleCTX: EventModuleContext<Args>): EventModuleHookContext<Args> {
        return { ...moduleCTX, module: this as unknown as ModuleHookContext<Args>["module"] };
    }
}
