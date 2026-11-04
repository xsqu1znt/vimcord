import ansis from "ansis";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Logger, stripAnsi } from "./Logger.js";

class CapturedLogger extends Logger {
    readonly entries: unknown[][] = [];

    protected override write(stream: "log" | "warn" | "error", ...data: unknown[]): void {
        this.entries.push([stream, ...data]);
    }
}

afterEach(() => vi.useRealTimers());

describe("Logger display caching", () => {
    it("updates timestamps at the second boundary and after the clock moves backward", () => {
        vi.useFakeTimers();
        const logger = new CapturedLogger();
        vi.setSystemTime(new Date(2026, 10, 4, 12, 34, 56, 100));
        logger.log("first");
        vi.setSystemTime(new Date(2026, 10, 4, 12, 34, 56, 999));
        logger.info("same second");
        vi.setSystemTime(new Date(2026, 10, 4, 12, 34, 57));
        logger.warn("next second");
        vi.setSystemTime(new Date(2026, 10, 4, 12, 34, 55));
        logger.log("clock correction");
        expect(logger.entries.map(e => stripAnsi(String(e[1])))).toEqual([
            "[12:34:56]",
            "[12:34:56]",
            "[12:34:57]",
            "[12:34:55]"
        ]);
    });

    it("shares timestamp text without sharing logger colors or prefixes", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 10, 4, 12, 34, 56));
        const first = new CapturedLogger({ prefix: "First", colors: { muted: "#FF0000" } });
        const second = new CapturedLogger({ prefix: "Second", colors: { muted: "#00FF00" } });
        first.log("one");
        second.log("two");
        expect(first.entries[0]![1]).toBe(ansis.hex("#FF0000")("[12:34:56]"));
        expect(second.entries[0]![1]).toBe(ansis.hex("#00FF00")("[12:34:56]"));
        expect(stripAnsi(String(first.entries[0]![2]))).toBe("First");
        expect(stripAnsi(String(second.entries[0]![2]))).toBe("Second");
        first.options.colors.muted = "#0000FF";
        first.log("three");
        expect(first.entries[1]![1]).toBe(ansis.hex("#0000FF")("[12:34:56]"));
    });

    it("observes prefix and palette changes, including removing and restoring a prefix", () => {
        const logger = new CapturedLogger({ prefix: "Before", colors: { primary: "#FF0000" } });
        logger.log("one");
        logger.options.prefix = "After";
        logger.log("two");
        logger.options.colors.primary = "#00FF00";
        logger.log("three");
        logger.options.prefix = null;
        logger.log("four");
        logger.options.prefix = "After";
        logger.log("five");
        expect(logger.entries.map(e => e[2])).toEqual([
            ansis.bold.hex("#FF0000")("Before"),
            ansis.bold.hex("#FF0000")("After"),
            ansis.bold.hex("#00FF00")("After"),
            "",
            ansis.bold.hex("#00FF00")("After")
        ]);
    });
});
