import type { Vimcord } from "../client/Vimcord.js";

import { afterEach, describe, expect, it, vi } from "vitest";
import { Vimcord as VimcordClient } from "../client/Vimcord.js";
import { VimcordLogger } from "../client/VimcordLogger.js";
import { Logger } from "./Logger.js";

afterEach(() => {
    vi.restoreAllMocks();
    VimcordClient.$instances.clear();
});

describe("Logger", () => {
    it("only emits debug output while verbose mode is enabled", () => {
        const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
        const logger = new Logger();

        logger.debug("hidden");
        expect(output).not.toHaveBeenCalled();

        logger.setVerbose(true).debug("visible");
        expect(output).toHaveBeenCalledTimes(1);
    });

    it("provides idempotent loader lifecycle controls", () => {
        const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
        const logger = new Logger();
        const loader = logger.loader("Starting");

        loader.update("Updated");
        loader.succeed();
        loader.fail("Ignored after completion");

        expect(output).toHaveBeenCalledTimes(2);
        expect(output.mock.calls.flat().join(" ")).toContain("Updated");
    });

    it("stops a loader silently when no final message is provided", () => {
        const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
        const logger = new Logger();
        const loader = logger.loader("Starting");

        loader.stop();

        expect(output).toHaveBeenCalledTimes(1);
    });

    it("preserves error stack output", () => {
        const output = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const logger = new Logger();

        logger.error("Request failed", new Error("Connection closed"));

        expect(output).toHaveBeenCalledTimes(2);
        expect(output.mock.calls.flat().join(" ")).toContain("Connection closed");
    });
});

describe("VimcordLogger", () => {
    it("keeps logger configuration isolated between clients", () => {
        const quiet = new VimcordClient({ customId: "quiet", client: { intents: [] }, verbose: false });
        const verbose = new VimcordClient({ customId: "verbose", client: { intents: [] }, verbose: true });
        const customLogger = new VimcordLogger({ verbose: true });
        const custom = new VimcordClient({ customId: "custom", client: { intents: [] }, logger: customLogger });

        expect(quiet.logger).not.toBe(verbose.logger);
        expect(quiet.logger.options.verbose).toBe(false);
        expect(verbose.logger.options.verbose).toBe(true);
        expect(custom.logger).toBe(customLogger);
        expect(custom.logger.options.verbose).toBe(true);

        verbose.$verboseMode = false;
        expect(quiet.logger.options.verbose).toBe(false);
    });

    it("only renders CLI guidance when enableCLI is true", () => {
        const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
        const logger = new VimcordLogger();

        const createClient = (enableCLI: boolean) =>
            ({
                $devMode: false,
                $name: "Test Bot",
                $version: "1.0.0",
                globals: { app: { enableCLI } },
                plugins: { getAll: () => [] },
                modules: {
                    events: { getAll: () => [] },
                    commands: {
                        slash: { getAll: () => [] },
                        prefix: { getAll: () => [] },
                        getAllContextCommands: () => []
                    }
                }
            }) as unknown as Vimcord;

        logger.startupBanner(createClient(false)).complete();
        expect(output.mock.calls.flat().join(" ")).not.toContain("Type /help");

        output.mockClear();
        logger.startupBanner(createClient(true)).complete();
        expect(output.mock.calls.flat().join(" ")).toContain("Type /help");
    });
});
