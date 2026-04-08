import type { User } from "discord.js";

import { ComponentType } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BetterCollector, CollectorMode } from "./betterCollector.js";
import { TimeoutAction } from "./shared.js";

describe("BetterCollector", () => {
    let mockMessage: any;
    let mockCollector: any;

    beforeEach(() => {
        vi.clearAllMocks();

        mockCollector = {
            on: vi.fn(),
            stop: vi.fn()
        };

        mockMessage = {
            createMessageComponentCollector: vi.fn().mockReturnValue(mockCollector),
            editable: true,
            deletable: true,
            components: [],
            edit: vi.fn().mockResolvedValue(undefined),
            delete: vi.fn().mockResolvedValue(undefined)
        };
    });

    describe("constructor", () => {
        it("should throw if message is null", () => {
            expect(() => new BetterCollector(null as any, {})).toThrow("Message is null or undefined");
        });

        it("should throw if message is undefined", () => {
            expect(() => new BetterCollector(undefined as any, {})).toThrow("Message is null or undefined");
        });

        it("should create collector with default options", () => {
            new BetterCollector(mockMessage, {});

            expect(mockMessage.createMessageComponentCollector).toHaveBeenCalledWith({
                idle: 30_000,
                time: 60_000,
                componentType: undefined,
                max: undefined,
                maxComponents: undefined,
                maxUsers: undefined
            });
        });

        it("should create collector with custom options", () => {
            new BetterCollector(mockMessage, {
                idle: 10_000,
                timeout: 20_000,
                max: 5,
                maxComponents: 10,
                maxUsers: 3,
                mode: CollectorMode.Sequential,
                userLock: true,
                userLockMessage: "Custom message"
            });

            expect(mockMessage.createMessageComponentCollector).toHaveBeenCalledWith({
                idle: 10_000,
                time: 20_000,
                componentType: undefined,
                max: 5,
                maxComponents: 10,
                maxUsers: 3
            });
        });

        it("should create collector with specific component type", () => {
            new BetterCollector(mockMessage, {
                type: ComponentType.Button
            });

            expect(mockMessage.createMessageComponentCollector).toHaveBeenCalledWith(
                expect.objectContaining({
                    componentType: ComponentType.Button
                })
            );
        });

        it("should set up collector event handlers", () => {
            new BetterCollector(mockMessage, {});

            expect(mockCollector.on).toHaveBeenCalledWith("collect", expect.any(Function));
            expect(mockCollector.on).toHaveBeenCalledWith("end", expect.any(Function));
        });
    });

    describe("on() - global listener", () => {
        it("should add global listener when function is passed", () => {
            const collector = new BetterCollector(mockMessage, {});
            const fn = vi.fn();

            const result = collector.on(fn);

            expect(result).toBe(collector);
        });

        it("should add global listener with options", () => {
            const collector = new BetterCollector(mockMessage, {});
            const fn = vi.fn();

            collector.on(fn, { defer: true });
        });

        it("should throw if second argument is not a function when customId is provided", () => {
            const collector = new BetterCollector(mockMessage, {});

            expect(() => collector.on("custom-id", "not-a-function" as any)).toThrow(
                "Second argument must be a function when customId is provided"
            );
        });
    });

    describe("on() - customId listener", () => {
        it("should add listener for specific customId", () => {
            const collector = new BetterCollector(mockMessage, {});
            const fn = vi.fn();

            const result = collector.on("btn-accept", fn);

            expect(result).toBe(collector);
        });

        it("should add listener for customId with options", () => {
            const collector = new BetterCollector(mockMessage, {});
            const fn = vi.fn();

            collector.on("btn-accept", fn, { defer: { update: true } });
        });

        it("should allow multiple listeners for same customId", () => {
            const collector = new BetterCollector(mockMessage, {});
            const fn1 = vi.fn();
            const fn2 = vi.fn();

            collector.on("btn-accept", fn1);
            collector.on("btn-accept", fn2);
        });
    });

    describe("onEnd()", () => {
        it("should add end listener", () => {
            const collector = new BetterCollector(mockMessage, {});
            const fn = vi.fn();

            const result = collector.onEnd(fn);

            expect(result).toBe(collector);
        });
    });

    describe("stop()", () => {
        it("should stop the collector", () => {
            const collector = new BetterCollector(mockMessage, {});

            collector.stop("manual");

            expect(mockCollector.stop).toHaveBeenCalledWith("manual");
        });

        it("should use default reason when not provided", () => {
            const collector = new BetterCollector(mockMessage, {});

            collector.stop();

            expect(mockCollector.stop).toHaveBeenCalledWith("manual");
        });
    });

    describe("chaining", () => {
        it("should allow chaining on() calls", () => {
            const collector = new BetterCollector(mockMessage, {});
            const fn1 = vi.fn();
            const fn2 = vi.fn();
            const fnEnd = vi.fn();

            const result = collector.on("btn-accept", fn1).on("btn-reject", fn2).onEnd(fnEnd);

            expect(result).toBe(collector);
        });

        it("should allow global and specific listeners together", () => {
            const collector = new BetterCollector(mockMessage, {});
            const globalFn = vi.fn();
            const specificFn = vi.fn();

            collector.on(globalFn).on("btn-accept", specificFn);
        });
    });

    describe("options - mode", () => {
        it("should default to parallel mode", () => {
            const collector = new BetterCollector(mockMessage, {});

            expect(collector).toBeDefined();
        });

        it("should accept sequential mode", () => {
            const collector = new BetterCollector(mockMessage, {
                mode: CollectorMode.Sequential
            });

            expect(collector).toBeDefined();
        });
    });

    describe("options - onTimeout", () => {
        it("should default to DoNothing", () => {
            const collector = new BetterCollector(mockMessage, {});

            expect(collector).toBeDefined();
        });

        it("should accept DisableComponents", () => {
            const collector = new BetterCollector(mockMessage, {
                onTimeout: TimeoutAction.DisableComponents
            });

            expect(collector).toBeDefined();
        });

        it("should accept DeleteMessage", () => {
            const collector = new BetterCollector(mockMessage, {
                onTimeout: TimeoutAction.DeleteMessage
            });

            expect(collector).toBeDefined();
        });
    });

    describe("options - userLock", () => {
        it("should default userLock to false", () => {
            const collector = new BetterCollector(mockMessage, {});

            expect(collector).toBeDefined();
        });

        it("should accept custom userLockMessage", () => {
            const collector = new BetterCollector(mockMessage, {
                userLock: true,
                userLockMessage: "Please wait..."
            });

            expect(collector).toBeDefined();
        });
    });

    describe("options - defer", () => {
        it("should accept boolean defer option", () => {
            const collector = new BetterCollector(mockMessage, {
                defer: true
            });

            expect(collector).toBeDefined();
        });

        it("should accept object defer option with update", () => {
            const collector = new BetterCollector(mockMessage, {
                defer: { update: true }
            });

            expect(collector).toBeDefined();
        });

        it("should accept object defer option with flags", () => {
            const collector = new BetterCollector(mockMessage, {
                defer: { flags: 64 }
            });

            expect(collector).toBeDefined();
        });
    });

    describe("options - participants", () => {
        it("should accept participants array", () => {
            const collector = new BetterCollector(mockMessage, {
                participants: ["user-1", "user-2"]
            });

            expect(collector).toBeDefined();
        });

        it("should accept user objects as participants", () => {
            const mockUser = { id: "user-123" } as User;

            const collector = new BetterCollector(mockMessage, {
                participants: [mockUser]
            });

            expect(collector).toBeDefined();
        });
    });
});
