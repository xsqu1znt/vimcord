import type { VimcordCommandLogData } from "./VimcordLogger.js";

import ansis from "ansis";
import { describe, expect, it } from "vitest";
import { stripAnsi } from "@/utils/Logger.js";
import { VimcordLogger } from "./VimcordLogger.js";

class CapturedLogger extends VimcordLogger {
    readonly entries: unknown[][] = [];

    protected override write(stream: "log" | "warn" | "error", ...data: unknown[]): void {
        this.entries.push([stream, ...data]);
    }
}

const ENTRY: VimcordCommandLogData = {
    commandName: "balance",
    userName: "maya",
    guildName: "Workshop",
    timings: { delivery: 31, pre: 2.1, exec: 15.4 }
};

function text(entry: unknown[]) {
    return entry.slice(3).map(p => stripAnsi(String(p)));
}

describe("command usage formatting", () => {
    it("prints the fixed timing line and failure suffix", () => {
        const logger = new CapturedLogger();
        logger.commandUsed({ ...ENTRY, failed: true });
        expect(text(logger.entries[0]!).join(" ")).toBe(
            "COMMAND /balance used by maya in Workshop | delivery 31.0ms | pre 2.1ms | exec 15.4ms | failed"
        );
    });

    it.each([undefined, -1, NaN])("prints unavailable delivery=%s as n/a", delivery => {
        const logger = new CapturedLogger();
        logger.commandUsed({ ...ENTRY, guildName: undefined, timings: { delivery, pre: 1.25, exec: 5 } });
        expect(text(logger.entries[0]!).join(" ")).toBe(
            "COMMAND /balance used by maya in Unknown Guild | delivery n/a | pre 1.3ms | exec 5.0ms"
        );
    });

    it("refreshes cached styles when colors change and keeps each entry's values independent", () => {
        const logger = new CapturedLogger({ colors: { muted: "#FF0000", error: "#0000FF" } });
        logger.commandUsed({ ...ENTRY, failed: true });
        logger.options.colors.muted = "#00FF00";
        logger.options.colors.error = "#FF00FF";
        logger.commandUsed({ commandName: "ping", userName: "sam", timings: ENTRY.timings, failed: true });
        expect(logger.entries[0]![3]).toBe(ansis.hex("#FF0000")("COMMAND"));
        expect(logger.entries[0]!.at(-1)).toBe(ansis.hex("#0000FF")("| failed"));
        expect(logger.entries[1]![3]).toBe(ansis.hex("#00FF00")("COMMAND"));
        expect(logger.entries[1]!.at(-1)).toBe(ansis.hex("#FF00FF")("| failed"));
        expect(text(logger.entries[1]!).slice(0, 4)).toEqual(["COMMAND", "/ping", "used by sam", "in Unknown Guild"]);
    });
});
