import type { Vimcord } from "../client/Vimcord.js";

import { afterEach, describe, expect, it, vi } from "vitest";
import { getCLI, setupCLI } from "../cli/setupCLI.js";
import { Vimcord as VimcordClient } from "../client/Vimcord.js";
import { VimcordLogger } from "../client/VimcordLogger.js";
import { Logger, stripAnsi } from "./Logger.js";

afterEach(() => {
    getCLI()?.stop();
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

    it("coordinates animated loaders across separate logger instances", () => {
        const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
        const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
        const cliLogger = new Logger({ prefix: "CLI", loaders: "always" });
        const clientLogger = new Logger({ prefix: "client" });

        const loader = cliLogger.loader("Registering commands");
        clientLogger.info("Gateway event received");
        loader.succeed("Commands registered");

        expect(output).toHaveBeenCalledTimes(1);
        expect(stdout.mock.calls.flat().join(" ")).toContain("Registering commands");
        expect(stdout.mock.calls.flat().join(" ")).toContain("Commands registered");
    });
});

describe("VimcordLogger", () => {
    it("uses an uppercase PLUGIN label for every plugin log type", () => {
        const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
        const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const logger = new VimcordLogger({ verbose: true });

        logger.plugin.log("mongoose", "Connecting");
        logger.plugin.debug("mongoose", "Compiling");
        logger.plugin.success("mongoose", "Connected");
        logger.plugin.error("mongoose", "Connection failed");

        const rendered = stripAnsi([...output.mock.calls, ...errors.mock.calls].flat().join(" "));
        expect(rendered.match(/PLUGIN <mongoose>/g)).toHaveLength(4);
        expect(rendered).not.toContain("Plugin <mongoose>");
    });

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

    it("only renders CLI guidance for clients participating in an initialized CLI", () => {
        const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
        const logger = new VimcordLogger();
        const enabled = new VimcordClient({ customId: "enabled", client: { intents: [] } });
        const disabled = new VimcordClient({
            customId: "disabled",
            client: { intents: [] },
            globals: { app: { enableCLI: false } }
        });

        logger.startupBanner(enabled).complete();
        expect(output.mock.calls.flat().join(" ")).not.toContain("Type /help");

        setupCLI({ loaders: "never" });
        output.mockClear();
        logger.startupBanner(disabled).complete();
        expect(output.mock.calls.flat().join(" ")).not.toContain("Type /help");

        output.mockClear();
        logger.startupBanner(enabled).complete();
        expect(output.mock.calls.flat().join(" ")).toContain("Type /help");
    });
});
