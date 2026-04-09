import type { ClientEvents } from "discord.js";

import { AbstractBuilder } from "./abstracts/AbstractBuilder.js";

export interface EventBuilderOptions {
    customId?: string;
    name: string;
    event: keyof ClientEvents;

    metadata?: EventBuilderMetadata;

    once?: boolean;
    priority?: number;
}

export interface EventBuilderMetadata {
    category?: string;
    tags?: string[];
}

export class EventBuilder<Event extends keyof ClientEvents = keyof ClientEvents> extends AbstractBuilder {
    readonly event: keyof ClientEvents;
    readonly metadata: EventBuilderMetadata;

    readonly once: boolean;
    readonly priority: number;

    constructor(options: EventBuilderOptions) {
        super({ customId: options.customId, name: options.name });

        this.event = options.event;
        this.metadata = options.metadata ?? {};

        this.once = options.once ?? false;
        this.priority = options.priority ?? 0;
    }
}
