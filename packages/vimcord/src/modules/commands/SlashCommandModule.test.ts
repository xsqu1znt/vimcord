import type { StaffGlobals } from "@/client/globals.js";

import { SlashCommandBuilder } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { defaultAppGlobals } from "@/client/globals.js";
import { SlashCommandModule } from "./SlashCommandModule.js";

const STAFF_DEFAULTS: StaffGlobals = { users: [], roles: [], guildId: null };

function createClient() {
    return {
        isReady: () => true,
        logger: { debug: vi.fn(), error: vi.fn(), warn: vi.fn(), commandUsed: vi.fn(), options: { verbose: false } },
        globals: { hooks: undefined, app: defaultAppGlobals(), staff: STAFF_DEFAULTS }
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
    it("rejects a command with neither an execute handler nor subcommands", () => {
        expect(
            () => new SlashCommandModule({ builder: new SlashCommandBuilder().setName("noop").setDescription("d") })
        ).toThrow(/execute.*subcommand/);
    });

    it("rejects duplicate subcommands after normalization", () => {
        expect(
            () =>
                new SlashCommandModule({
                    builder: builderWithSubcommands(),
                    subcommands: { Ping: { handler: () => undefined }, ping: { handler: () => undefined } }
                })
        ).toThrow(/duplicate subcommand/i);
    });

    it("rejects a subcommands-only command missing coverage for a builder subcommand", () => {
        expect(
            () =>
                new SlashCommandModule({
                    builder: builderWithSubcommands(),
                    subcommands: { ping: { handler: () => undefined } }
                })
        ).toThrow(/pong/);
    });

    it("accepts a subcommands-only command that covers every builder subcommand", () => {
        expect(
            () =>
                new SlashCommandModule({
                    builder: builderWithSubcommands(),
                    subcommands: { ping: { handler: () => undefined }, pong: { handler: () => undefined } }
                })
        ).not.toThrow();
    });

    it("rejects subcommands-only configuration when the builder has no subcommands", () => {
        expect(
            () =>
                new SlashCommandModule({
                    builder: new SlashCommandBuilder().setName("flat").setDescription("d"),
                    subcommands: { unreachable: { handler: () => undefined } }
                })
        ).toThrow(/does not declare any/);
    });
});

describe("SlashCommandModule subcommand dispatch", () => {
    it("runs the configured execute handler for a subcommand when no subcommands are configured", async () => {
        const execute = vi.fn();
        const module = new SlashCommandModule({ builder: builderWithSubcommands(), execute });
        module.inject(createClient());

        const result = await module.runWithResult(createInteraction("ping"));

        expect(result.executed).toBe(true);
        expect(execute).toHaveBeenCalledOnce();
    });

    it("routes group:subcommand keys and exposes the match on the context", async () => {
        const handler = vi.fn(ctx => ctx.subcommand);
        const module = new SlashCommandModule({
            builder: builderWithSubcommands(),
            execute: () => {},
            subcommands: { "mod:kick": { handler } }
        });
        module.inject(createClient());
        const interaction = createInteraction("kick");
        interaction.options.getSubcommandGroup = () => "mod";

        expect(await module.run(interaction)).toBe("mod:kick");
    });

    it("fails a subcommand permission check without running the handler or counting the invocation as executed", async () => {
        const handler = vi.fn();
        const onBlocked = vi.fn();

        const module = new SlashCommandModule({
            builder: builderWithSubcommands(),
            subcommands: { ping: { handler, access: { users: ["someone-else"] } }, pong: { handler } },
            hooks: { onBlocked }
        });
        module.inject(createClient());

        const result = await module.runWithResult(createInteraction("ping"));

        expect(result.executed).toBe(false);
        expect(handler).not.toHaveBeenCalled();
        expect(onBlocked).toHaveBeenCalledExactlyOnceWith(
            expect.anything(),
            expect.objectContaining({ kind: "permission", reason: "UserNotAllowed" })
        );
    });

    it("blocks an unmatched subcommand as unknownRoute without counting the invocation as executed", async () => {
        const handler = vi.fn();
        const onBlocked = vi.fn();

        const module = new SlashCommandModule({
            builder: builderWithSubcommands(),
            subcommands: { ping: { handler }, pong: { handler } },
            hooks: { onBlocked }
        });
        module.inject(createClient());

        const result = await module.runWithResult(createInteraction("typo"));

        expect(result.executed).toBe(false);
        expect(handler).not.toHaveBeenCalled();
        expect(onBlocked).toHaveBeenCalledExactlyOnceWith(expect.anything(), { kind: "unknownRoute", path: "typo" });
    });

    it("defers per the subcommand setting even when it disables what the command enables", async () => {
        const deferReply = vi.fn();
        const handler = vi.fn();

        const module = new SlashCommandModule({
            builder: builderWithSubcommands(),
            deferReply: true,
            subcommands: { ping: { handler, deferReply: false }, pong: { handler } }
        });
        module.inject(createClient());

        const interaction = createInteraction("ping");
        interaction.deferReply = deferReply;

        await module.runWithResult(interaction);

        expect(deferReply).not.toHaveBeenCalled();
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it("defers an ephemeral subcommand with the flag", async () => {
        const deferReply = vi.fn();
        const module = new SlashCommandModule({
            builder: builderWithSubcommands(),
            subcommands: { ping: { deferReply: "ephemeral", handler: () => {} }, pong: { handler: () => {} } }
        });
        module.inject(createClient());
        const interaction = createInteraction("ping");
        interaction.deferReply = deferReply;

        await module.runWithResult(interaction);

        expect(deferReply).toHaveBeenCalledExactlyOnceWith({ flags: "Ephemeral" });
    });

    it("preserves dispatch for subclasses with custom context factories", async () => {
        class CustomContextModule extends SlashCommandModule {
            protected override createModuleCTX(args: Parameters<SlashCommandModule["run"]>) {
                return { ...super.createModuleCTX(args) };
            }
            protected override createHookCTX(
                ctx: ReturnType<CustomContextModule["createModuleCTX"]>,
                args: Parameters<SlashCommandModule["run"]>
            ) {
                return { ...super.createHookCTX(ctx, args) };
            }
        }
        const handler = vi.fn();
        const deferReply = vi.fn();
        const module = new CustomContextModule({
            builder: builderWithSubcommands(),
            execute: () => {},
            subcommands: { ping: { handler, deferReply: true } }
        });
        module.inject(createClient());
        const interaction = createInteraction("ping");
        interaction.deferReply = deferReply;
        expect(await module.runWithResult(interaction)).toMatchObject({ executed: true });
        expect(handler).toHaveBeenCalledOnce();
        expect(deferReply).toHaveBeenCalledOnce();
    });
});

describe("guildOnly narrowing", () => {
    it("narrows handler contexts, on the command and on one subcommand", () => {
        new SlashCommandModule({
            builder: builderWithSubcommands(),
            guildOnly: true,
            execute: ctx => {
                const guildId: string = ctx.interaction.guildId;
                return guildId;
            },
            subcommands: {
                ping: {
                    handler(ctx) {
                        const guildId: string = ctx.interaction.guildId;
                        return guildId;
                    }
                }
            }
        });
        new SlashCommandModule({
            builder: builderWithSubcommands(),
            execute(ctx) {
                // @ts-expect-error Without guildOnly the interaction may be in a DM.
                const guildId: string = ctx.interaction.guildId;
                return guildId;
            },
            subcommands: {
                ping: {
                    guildOnly: true,
                    handler(ctx) {
                        const guildId: string = ctx.interaction.guildId;
                        return guildId;
                    }
                },
                pong: {
                    handler(ctx) {
                        // @ts-expect-error This subcommand is not guildOnly.
                        const guildId: string = ctx.interaction.guildId;
                        return guildId;
                    }
                }
            }
        });
    });
});
