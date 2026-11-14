import type { StaffGlobals } from "@/client/globals.js";

import { MessageFlags, SlashCommandBuilder } from "discord.js";
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
                    subcommands: { Ping: { execute: () => undefined }, ping: { execute: () => undefined } }
                })
        ).toThrow(/duplicate subcommand/i);
    });

    it("rejects a subcommands-only command missing coverage for a builder subcommand", () => {
        expect(
            () =>
                new SlashCommandModule({
                    builder: builderWithSubcommands(),
                    subcommands: { ping: { execute: () => undefined } }
                })
        ).toThrow(/pong/);
    });

    it("accepts a subcommands-only command that covers every builder subcommand", () => {
        expect(
            () =>
                new SlashCommandModule({
                    builder: builderWithSubcommands(),
                    subcommands: { ping: { execute: () => undefined }, pong: { execute: () => undefined } }
                })
        ).not.toThrow();
    });

    it("rejects subcommands-only configuration when the builder has no subcommands", () => {
        expect(
            () =>
                new SlashCommandModule({
                    builder: new SlashCommandBuilder().setName("flat").setDescription("d"),
                    subcommands: { unreachable: { execute: () => undefined } }
                })
        ).toThrow(/does not declare any/);
    });
});

describe("SlashCommandModule registration", () => {
    const builder = () => new SlashCommandBuilder().setName("flat").setDescription("d");

    it.each([
        [undefined, true],
        [{ guilds: ["staff"] }, false],
        [{ guilds: ["staff"], global: true }, true],
        [{ guilds: [] }, true],
        [{ global: false }, false]
    ])("resolves registration %j to global=%s", (registration, global) => {
        expect(new SlashCommandModule({ builder: builder(), registration, execute: () => {} }).registration.global).toBe(
            global
        );
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
            subcommands: { "mod:kick": { execute: handler } }
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
            subcommands: { ping: { execute: handler, access: { users: ["someone-else"] } }, pong: { execute: handler } },
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
            subcommands: { ping: { execute: handler }, pong: { execute: handler } },
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
            subcommands: { ping: { execute: handler, deferReply: false }, pong: { execute: handler } }
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
            subcommands: { ping: { deferReply: "ephemeral", execute: () => {} }, pong: { execute: () => {} } }
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
            subcommands: { ping: { execute: handler, deferReply: true } }
        });
        module.inject(createClient());
        const interaction = createInteraction("ping");
        interaction.deferReply = deferReply;
        expect(await module.runWithResult(interaction)).toMatchObject({ executed: true });
        expect(handler).toHaveBeenCalledOnce();
        expect(deferReply).toHaveBeenCalledOnce();
    });
});

describe("SlashCommandModule default replies", () => {
    function createRepliable(state: { deferred?: boolean; replied?: boolean } = {}) {
        const interaction = createInteraction("ping");
        Object.assign(interaction, {
            deferred: state.deferred ?? false,
            replied: state.replied ?? false,
            reply: vi.fn(),
            editReply: vi.fn(),
            followUp: vi.fn()
        });
        return interaction;
    }

    it.each([
        ["fresh", {}, "reply", { flags: MessageFlags.Ephemeral }],
        ["deferred", { deferred: true }, "editReply", {}],
        ["answered", { deferred: true, replied: true }, "followUp", { flags: MessageFlags.Ephemeral }]
    ] as const)("answers a %s interaction through %s", async (_name, state, method, extra) => {
        const module = new SlashCommandModule({
            builder: builderWithSubcommands(),
            subcommands: { ping: { execute: () => {} }, pong: { execute: () => {} } }
        });
        module.inject(createClient());
        const interaction = createRepliable(state);
        interaction.options.getSubcommand = () => "typo";

        await module.run(interaction);
        expect(interaction[method]).toHaveBeenCalledExactlyOnceWith({
            content: "Subcommand 'typo' was not found.",
            ...extra
        });
    });

    it("tells the user when the bot is missing permissions", async () => {
        const module = new SlashCommandModule({
            builder: builderWithSubcommands(),
            botPermissions: ["ManageMessages"],
            execute: () => {}
        });
        module.inject(createClient());
        const interaction = createRepliable();
        Object.assign(interaction, { guildId: "guild", appPermissions: { has: () => false } });

        await module.run(interaction);
        expect(interaction.reply).toHaveBeenCalledExactlyOnceWith({
            content: "I'm missing permissions needed to run this command.",
            flags: MessageFlags.Ephemeral
        });
    });

    it("replies to a failed handler on the direct path unless an onError hook owns it", async () => {
        const execute = () => {
            throw new Error("boom");
        };
        const builder = new SlashCommandBuilder().setName("flat").setDescription("d");
        const client = createClient();
        const bare = new SlashCommandModule({ builder, execute });
        bare.inject(client);
        const interaction = createRepliable();
        await bare.dispatch(interaction);
        expect(interaction.reply).toHaveBeenCalledExactlyOnceWith({
            content: "Something went wrong while running this command.",
            flags: MessageFlags.Ephemeral
        });
        expect(client.logger.error).toHaveBeenCalledOnce();

        const onError = vi.fn();
        const hooked = new SlashCommandModule({ builder, execute, hooks: { onError } });
        hooked.inject(client);
        const owned = createRepliable();
        await hooked.dispatch(owned);
        expect(onError).toHaveBeenCalledOnce();
        expect(owned.reply).not.toHaveBeenCalled();
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
                    execute(ctx) {
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
                    execute(ctx) {
                        const guildId: string = ctx.interaction.guildId;
                        return guildId;
                    }
                },
                pong: {
                    execute(ctx) {
                        // @ts-expect-error This subcommand is not guildOnly.
                        const guildId: string = ctx.interaction.guildId;
                        return guildId;
                    }
                }
            }
        });
    });
});
