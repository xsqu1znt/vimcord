import { EventDeployment, EventMetadata, EventRateLimitOptions } from "@ctypes/event.options";
import { EventParameters } from "@ctypes/event.helpers";
import { EventConfig } from "@ctypes/event.base";
import { ClientEvents } from "discord.js";
import { randomUUID } from "node:crypto";
import _ from "lodash";
import { logger } from "@/tools/Logger";

export class EventBuilder<T extends keyof ClientEvents = keyof ClientEvents> implements EventConfig<T> {
    readonly uuid: string = randomUUID();

    event: T;
    name: string = this.uuid;
    enabled;
    once;
    priority;
    conditions;
    metadata;
    deployment;
    rateLimit;
    beforeExecute;
    execute;
    afterExecute;
    onError;

    private rateLimitData: { executions: number; timestamp: number } = { executions: 0, timestamp: 0 };

    static create<T extends keyof ClientEvents>(event: T, name?: string): EventBuilder<T> {
        return new EventBuilder<T>({ event, name });
    }

    constructor(config: EventConfig<T>) {
        this.event = config.event;
        this.name = config.name || this.name;
        this.enabled = config.enabled ?? true;
        this.once = config.once ?? false;
        this.priority = config.priority ?? 0;
        this.conditions = config.conditions;
        this.metadata = config.metadata;
        this.deployment = config.deployment;
        this.rateLimit = config.rateLimit;
        this.beforeExecute = config.beforeExecute;
        this.execute = config.execute;
        this.afterExecute = config.afterExecute;
        this.onError = config.onError;

        this.validate();
    }

    validate() {
        // Validate event name
        if (!this.event) {
            throw new Error("Event name is required");
        }

        // Validate priority
        if (this.priority !== undefined && this.priority < 0) {
            throw new Error("Priority must be non-negative");
        }

        // Validate rateLimit
        if (this.rateLimit) {
            if (this.rateLimit.max <= 0) {
                throw new Error("Rate limit max must be greater than 0");
            }
            if (this.rateLimit.interval <= 0) {
                throw new Error("Rate limit interval must be greater than 0");
            }
        }

        // Validate that at least execute is provided
        if (!this.execute) {
            throw new Error("Execute function is required");
        }
    }

    clone(): EventBuilder<T> {
        return new EventBuilder<T>(this.toConfig());
    }

    toConfig(): EventConfig<T> {
        return {
            event: this.event,
            name: this.name,
            enabled: this.enabled,
            once: this.once,
            priority: this.priority,
            conditions: this.conditions,
            metadata: this.metadata,
            deployment: this.deployment,
            rateLimit: this.rateLimit,
            beforeExecute: this.beforeExecute,
            execute: this.execute,
            afterExecute: this.afterExecute,
            onError: this.onError
        };
    }

    setEvent(event: T): this {
        this.event = event;
        return this;
    }

    setName(name: string): this {
        this.name = name;
        return this;
    }

    setEnabled(enabled: boolean): this {
        this.enabled = enabled;
        return this;
    }

    enable(): this {
        return this.setEnabled(true);
    }

    disable(): this {
        return this.setEnabled(false);
    }

    setOnce(once: boolean = true): this {
        this.once = once;
        return this;
    }

    setPriority(priority: number): this {
        this.priority = priority;
        return this;
    }

    addCondition(condition: (...args: EventParameters<T>) => boolean): this {
        if (!this.conditions) this.conditions = [];
        this.conditions.push(condition);
        return this;
    }

    setConditions(conditions: Array<(...args: EventParameters<T>) => boolean>): this {
        this.conditions = conditions;
        return this;
    }

    setMetadata(metadata: EventMetadata): this {
        this.metadata = _.merge(this.metadata, metadata);
        return this;
    }

    setDeployment(deployment: EventDeployment): this {
        this.deployment = _.merge(this.deployment, deployment);
        return this;
    }

    setRateLimit(options: EventRateLimitOptions<T>): this {
        this.rateLimit = options;
        return this;
    }

    setBeforeExecute(beforeExecute: (...args: EventParameters<T>) => Promise<any> | any): this {
        this.beforeExecute = beforeExecute;
        return this;
    }

    setExecute(execute: (...args: EventParameters<T>) => Promise<any> | any): this {
        this.execute = execute;
        return this;
    }

    setAfterExecute(afterExecute: (result: any, ...args: EventParameters<T>) => Promise<any> | any): this {
        this.afterExecute = afterExecute;
        return this;
    }

    setOnError(onError: (error: Error, ...args: EventParameters<T>) => Promise<any> | any): this {
        this.onError = onError;
        return this;
    }

    getRateLimitInfo(): { executions: number; timestamp: number; isLimited: boolean } | null {
        if (!this.rateLimit) return null;
        return { ...this.rateLimitData, isLimited: this.isRateLimited(false) };
    }

    resetRateLimit(): this {
        this.rateLimitData = { executions: 0, timestamp: 0 };
        return this;
    }

    isRateLimited(updateExecutions: boolean = true): boolean {
        if (!this.rateLimit) return false;

        const now = Date.now();

        // Reset if interval has passed
        if (now - this.rateLimitData.timestamp >= this.rateLimit.interval) {
            this.rateLimitData.executions = 0;
            this.rateLimitData.timestamp = now;
        }

        if (updateExecutions) {
            this.rateLimitData.executions++;
        }

        return this.rateLimitData.executions >= this.rateLimit.max;
    }

    async checkConditions(...args: EventParameters<T>): Promise<boolean> {
        if (!this.conditions?.length) return true;

        const results = await Promise.all(this.conditions.map(condition => condition(...args)));
        return results.every(Boolean);
    }

    async executeEvent(...args: EventParameters<T>): Promise<any> {
        try {
            // Check if event is enabled
            if (!this.enabled) {
                return;
            }

            // Check rate limits
            if (this.isRateLimited()) {
                logger.warn(`Event '${this.name}' (${this.event}) is rate limited`);
                if (this.rateLimit?.onRateLimit) {
                    return await this.rateLimit.onRateLimit(...args);
                }
                return;
            }

            // Check conditions
            if (!(await this.checkConditions(...args))) {
                return;
            }

            // Execute beforeExecute hook
            if (this.beforeExecute) {
                await this.beforeExecute(...args);
            }

            // Execute main event
            const result = await this.execute?.(...args);

            // Execute afterExecute hook
            if (this.afterExecute) {
                await this.afterExecute(result, ...args);
            }

            return result;
        } catch (err) {
            if (this.onError) {
                return await this.onError(err as Error, ...args);
            }

            // Log error if no custom handler
            logger.error(`Event execution error '${this.name}' (${this.event}):`, err as Error)
            throw err;
        }
    }
}
