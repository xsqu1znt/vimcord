import type { StaffGlobals } from "@/client/globals.js";

import { SlashCommandBuilder } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { SlashCommandModule } from "./SlashCommandModule.js";

const STAFF_DEFAULTS: StaffGlobals = {
    ownerId: null,
    superUsers: [],
    superUserRoles: [],
    bypassesStaff: [],
    bypassesGuildAdmin: { allBotStaff: false, botOwner: false, superUsers: false, bypassers: false },
    guild: { id: null, inviteUrl: null, channels: {}, roles: {} }
};

function createClient() {
    return {
        isReady: () => true,
        logger: { debug: vi.fn(), error: vi.fn(), warn: vi.fn(), options: { verbose: false } },
        globals: { hooks: undefined, staff: STAFF_DEFAULTS }
    } as any;
}

function builderWithSubcommands() {
    return new SlashCommandBuilder()
        .setName("manage")
        .setDescription("d")
        .addSubcommand(sub => sub.setName("ping").setDescription("d"))
        .addSubcommand(sub => sub.setName("pong").setDescription("d"));
}

function createInteraction(subcommand: string) {
    return {
        user: { id: "user", bot: false },
        guildId: null,
        guild: null,
        member: null,
        memberPermissions: null,
        appPermissions: null,
        replied: false,
        deferred: false,
        options: {
            getSubcommand: () => subcommand,
            getSubcommandGroup: () => null
        }
    } as any;
}

describe("SlashCommandModule configuration validation", () => {
    it("rejects a command with neither an execute handler nor routes", () => {
        expect(
            () => new SlashCommandModule({ builder: new SlashCommandBuilder().setName("noop").setDescription("d") })
        ).toThrow(/execute.*route/);
    });

    it("rejects duplicate route paths after normalization", () => {
        expect(
            () =>
                new SlashCommandModule({
                    builder: builderWithSubcommands(),
                    routes: [
                        { path: "Ping", handler: () => undefined },
                        { path: "ping", handler: () => undefined }
                    ]
                })
        ).toThrow(/duplicate route/i);
    });

    it("rejects a routes-only command missing coverage for a builder subcommand", () => {
        expect(
            () =>
                new SlashCommandModule({
                    builder: builderWithSubcommands(),
                    routes: [{ path: "ping", handler: () => undefined }]
                })
        ).toThrow(/pong/);
    });

    it("accepts a routes-only command that covers every builder subcommand", () => {
        expect(
            () =>
                new SlashCommandModule({
                    builder: builderWithSubcommands(),
                    routes: [
                        { path: "ping", handler: () => undefined },
                        { path: "pong", handler: () => undefined }
                    ]
                })
        ).not.toThrow();
    });

    it("rejects routes-only configuration when the builder has no subcommands", () => {
        expect(
            () =>
                new SlashCommandModule({
                    builder: new SlashCommandBuilder().setName("flat").setDescription("d"),
                    routes: [{ path: "unreachable", handler: () => undefined }]
                })
        ).toThrow(/does not declare any subcommands/);
    });
});

describe("SlashCommandModule route dispatch", () => {
    it("runs the configured execute handler for a subcommand when no routes are configured", async () => {
        const execute = vi.fn();
        const module = new SlashCommandModule({ builder: builderWithSubcommands(), execute });
        module.inject(createClient());

        const result = await module.runWithResult(createInteraction("ping"));

        expect(result.executed).toBe(true);
        expect(execute).toHaveBeenCalledOnce();
    });

    it("fails a route permission check without running the handler or counting the invocation as executed", async () => {
        const handler = vi.fn();
        const onPermissionTestFail = vi.fn();

        const module = new SlashCommandModule({
            builder: builderWithSubcommands(),
            routes: [
                { path: "ping", handler, permissions: { users: ["someone-else"] } },
                { path: "pong", handler }
            ],
            hooks: { onPermissionTestFail }
        });
        module.inject(createClient());

        const result = await module.runWithResult(createInteraction("ping"));

        expect(result.executed).toBe(false);
        expect(handler).not.toHaveBeenCalled();
        expect(onPermissionTestFail).toHaveBeenCalledTimes(1);
    });

    it("runs onUnknownRoute for an unmatched subcommand without counting the invocation as executed", async () => {
        const handler = vi.fn();
        const onUnknownRoute = vi.fn();

        const module = new SlashCommandModule({
            builder: builderWithSubcommands(),
            routes: [
                { path: "ping", handler },
                { path: "pong", handler }
            ],
            hooks: { onUnknownRoute }
        });
        module.inject(createClient());

        const result = await module.runWithResult(createInteraction("typo"));

        expect(result.executed).toBe(false);
        expect(handler).not.toHaveBeenCalled();
        expect(onUnknownRoute).toHaveBeenCalledTimes(1);
    });

    it("defers per the route setting even when the route disables what the command enables", async () => {
        const deferReply = vi.fn();
        const handler = vi.fn();

        const module = new SlashCommandModule({
            builder: builderWithSubcommands(),
            deferReply: true,
            routes: [
                { path: "ping", handler, deferReply: false },
                { path: "pong", handler }
            ]
        });
        module.inject(createClient());

        const interaction = createInteraction("ping");
        interaction.deferReply = deferReply;

        await module.runWithResult(interaction);

        expect(deferReply).not.toHaveBeenCalled();
        expect(handler).toHaveBeenCalledTimes(1);
    });
});
