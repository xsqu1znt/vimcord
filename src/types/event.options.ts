import { EventParameters } from "@ctypes/event.helpers";
import { ClientEvents } from "discord.js";

export interface EventMetadata {
    /** Event category */
    category?: string;
    /** Tags for categorizing events */
    tags?: string[];
}

export interface EventDeployment {
    /** Deployment environments */
    environments?: ("development" | "production")[];
}

export interface EventRateLimitOptions<T extends keyof ClientEvents> {
    /** Max executions per interval */
    max: number;
    /** Interval in milliseconds */
    interval: number;
    /** What to do when rate limited */
    onRateLimit?: (...args: EventParameters<T>) => any;
}
