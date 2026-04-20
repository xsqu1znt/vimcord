import { EventDeployment, EventMetadata, EventRateLimitOptions } from "@ctypes/event.options";
import { EventParameters } from "@ctypes/event.helpers";
import { ClientEvents } from "discord.js";

export interface EventConfig<T extends keyof ClientEvents> {
    /** Discord.js event name */
    event: T;
    /** Human-readable name for the event */
    name?: string;
    /** Whether this event will be executed or not @defaultValue `true` */
    enabled?: boolean;
    /** Whether this event will be executed only once or not */
    once?: boolean;
    /** Priority for event execution order (lower = earlier) @defaultValue `0` */
    priority?: number;
    /** Conditions that must be met for this event to execute */
    conditions?: Array<(...args: EventParameters<T>) => boolean>;
    /** Event metadata */
    metadata?: EventMetadata;
    /** Event deployment */
    deployment?: EventDeployment;
    /** Rate limiting options */
    rateLimit?: EventRateLimitOptions<T>;
    /** Before event execution */
    beforeExecute?: (...args: EventParameters<T>) => void | Promise<void>;
    /** The function that will be executed */
    execute?: (...args: EventParameters<T>) => void | Promise<void>;
    /** After successful execution */
    afterExecute?: (result: unknown, ...args: EventParameters<T>) => void | Promise<void>;
    /** Custom error handler */
    onError?: (error: Error, ...args: EventParameters<T>) => void | Promise<void>;
}
