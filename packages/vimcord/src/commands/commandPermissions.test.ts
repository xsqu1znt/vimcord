import type { CommandModuleHookContext } from "@/abstracts/commands/CommandModuleTypeKit.js";
import type { StaffGlobals } from "@/client/globals.js";
import type { CommandAccess } from "./commandPermissions.js";

import { PermissionFlagsBits, PermissionsBitField } from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandModuleType } from "@/abstracts/commands/CommandModuleTypeKit.js";
import { MessageContextCommandModule } from "@/modules/commands/MessageContextCommandModule.js";
import { PrefixCommandModule } from "@/modules/commands/PrefixCommandModule.js";
import { SlashCommandModule } from "@/modules/commands/SlashCommandModule.js";
import { UserContextCommandModule } from "@/modules/commands/UserContextCommandModule.js";
import { Logger } from "@/utils/Logger.js";
import { MissingPermissionReason, pickRestrictions, testCommandPermissions } from "./commandPermissions.js";

const STAFF_DEFAULTS: StaffGlobals = { users: [], roles: [], guildId: null };

function createClient(staff: StaffGlobals = STAFF_DEFAULTS) {
    return {
        globals: { staff },
        fetchGuild: vi.fn(async () => null),
        getStaffGuildRoleIds: vi.fn<() => Promise<string[]>>(async () => [])
    };
}

function createInteractionContext(client = createClient(), overrides = {}) {
    return {
        client,
        module: { name: "manage" },
        interaction: {
            user: { id: "user", bot: false },
            guildId: "guild",
            guild: null,
            member: { roles: [] },
            memberPermissions: new PermissionsBitField(),
            appPermissions: new PermissionsBitField(),
            ...overrides
        }
    } as unknown as CommandModuleHookContext<CommandModuleType.Slash>;
}

function createMessageContext(client = createClient(), overrides = {}) {
    const permissionsFor = vi.fn<(member: { id: string }) => PermissionsBitField>(() => new PermissionsBitField());
    return {
        ctx: {
            client,
            module: { name: "manage" },
            message: {
                author: { id: "user", bot: false },
                guildId: "guild",
                guild: { members: { me: { id: "bot" } } },
                member: { roles: { cache: new Map() } },
                channel: { permissionsFor },
                ...overrides
            }
        } as unknown as CommandModuleHookContext<CommandModuleType.Prefix>,
        permissionsFor
    };
}

describe("testCommandPermissions", () => {
    it("uses staff as an alternative to Administrator without bypass flags", async () => {
        const client = createClient({ ...STAFF_DEFAULTS, users: ["user"] });
        const ctx = createInteractionContext(client);
        expect(testCommandPermissions(ctx, { access: { permissions: ["Administrator"], staff: true } })).toEqual({
            passed: true
        });
        expect(testCommandPermissions(ctx, { access: { permissions: ["Administrator"] } })).toMatchObject({
            passed: false,
            reason: MissingPermissionReason.User
        });
        expect(client.getStaffGuildRoleIds).not.toHaveBeenCalled();
    });

    it("applies must-pass restrictions before every grant and avoids staff lookups", async () => {
        const client = createClient({ ...STAFF_DEFAULTS, users: ["user"] });
        const ctx = createInteractionContext(client, { guildId: null, guild: null, memberPermissions: null });

        expect(
            await testCommandPermissions(ctx, { guildOnly: true, access: { users: ["user"], staff: true } })
        ).toMatchObject({
            passed: false,
            reason: MissingPermissionReason.NotInGuild
        });
        expect(client.getStaffGuildRoleIds).not.toHaveBeenCalled();
        expect(client.fetchGuild).not.toHaveBeenCalled();
    });

    it("grants access on any one entry", async () => {
        const ctx = createInteractionContext(createClient());
        expect(await testCommandPermissions(ctx, { access: { users: ["user"], roles: ["moderator"] } })).toEqual({
            passed: true
        });
    });

    it("does not resolve staff or channel permissions when local grants or no grants pass", async () => {
        const client = createClient();
        const interaction = createInteractionContext(client);
        const { ctx: prefix, permissionsFor } = createMessageContext(client, { guildId: null, guild: null });

        expect(await testCommandPermissions(interaction, {})).toEqual({ passed: true });
        expect(await testCommandPermissions(interaction, { access: { users: ["user"] } })).toEqual({ passed: true });
        expect(await testCommandPermissions(prefix, { access: { users: ["user"] } })).toEqual({ passed: true });

        expect(client.getStaffGuildRoleIds).not.toHaveBeenCalled();
        expect(client.fetchGuild).not.toHaveBeenCalled();
        expect(permissionsFor).not.toHaveBeenCalled();
    });

    it("uses known bot staff before an uncached guild-owner lookup", async () => {
        const client = createClient({ ...STAFF_DEFAULTS, users: ["user"] });
        const ctx = createInteractionContext(client);

        expect(await testCommandPermissions(ctx, { access: { guildOwner: true, staff: true } })).toEqual({ passed: true });
        expect(client.fetchGuild).not.toHaveBeenCalled();
        expect(client.getStaffGuildRoleIds).not.toHaveBeenCalled();
    });

    it("returns the first failed grant when none allow access", async () => {
        const ctx = createInteractionContext();

        expect(
            await testCommandPermissions(ctx, {
                access: {
                    permissions: [PermissionFlagsBits.BanMembers],
                    users: ["other"],
                    roles: ["moderator"],
                    guildOwner: true,
                    staff: true
                }
            })
        ).toMatchObject({ passed: false, reason: MissingPermissionReason.User });
    });

    it("uses interaction and prefix channel permission snapshots", async () => {
        const interaction = createInteractionContext(createClient(), {
            guild: null,
            memberPermissions: new PermissionsBitField(PermissionFlagsBits.BanMembers),
            appPermissions: new PermissionsBitField(PermissionFlagsBits.ManageMessages)
        });
        const { ctx: prefix, permissionsFor } = createMessageContext(createClient());
        permissionsFor.mockImplementation(
            member =>
                new PermissionsBitField(
                    member.id === "bot" ? PermissionFlagsBits.ManageMessages : PermissionFlagsBits.BanMembers
                )
        );

        const permissions = {
            access: { permissions: [PermissionFlagsBits.BanMembers] },
            botPermissions: [PermissionFlagsBits.ManageMessages]
        };
        expect(await testCommandPermissions(interaction, permissions)).toEqual({ passed: true });
        expect(await testCommandPermissions(prefix, permissions)).toEqual({ passed: true });
        expect(permissionsFor).toHaveBeenCalledTimes(2);
    });

    it("denies missing channel permissions even when cached guild permissions allow them", async () => {
        const { ctx, permissionsFor } = createMessageContext(createClient(), {
            guild: {
                members: { me: { id: "bot", permissions: new PermissionsBitField(PermissionFlagsBits.ManageMessages) } }
            },
            member: { roles: { cache: new Map() }, permissions: new PermissionsBitField(PermissionFlagsBits.BanMembers) }
        });
        permissionsFor.mockReturnValue(new PermissionsBitField());

        expect(
            await testCommandPermissions(ctx, { access: { permissions: [PermissionFlagsBits.BanMembers] } })
        ).toMatchObject({
            passed: false,
            reason: MissingPermissionReason.User
        });
        expect(await testCommandPermissions(ctx, { botPermissions: [PermissionFlagsBits.ManageMessages] })).toMatchObject({
            passed: false,
            reason: MissingPermissionReason.Client
        });
    });

    it("passes local roles synchronously without a staff lookup", () => {
        const client = createClient({ ...STAFF_DEFAULTS, guildId: "staff-guild" });
        const ctx = createInteractionContext(client, { member: { roles: ["helper"] } });
        expect(testCommandPermissions(ctx, { access: { roles: ["helper"] } })).toEqual({ passed: true });
        expect(client.getStaffGuildRoleIds).not.toHaveBeenCalled();
    });

    it.each(["guild", null])("falls back to staff-server roles from %s", async guildId => {
        const client = createClient({ ...STAFF_DEFAULTS, guildId: "staff-guild" });
        client.getStaffGuildRoleIds.mockResolvedValue(["helper"]);
        const ctx = createInteractionContext(client, { guildId, member: guildId ? { roles: [] } : null });
        expect(await testCommandPermissions(ctx, { access: { roles: ["helper"] } })).toEqual({ passed: true });
        expect(client.getStaffGuildRoleIds).toHaveBeenCalledExactlyOnceWith("user");
    });

    it("uses the invoking member inside the staff server without looking up failures", () => {
        const client = createClient({ ...STAFF_DEFAULTS, guildId: "guild", roles: ["staff"] });
        const ctx = createInteractionContext(client, { member: { roles: ["staff"] } });
        expect(testCommandPermissions(ctx, { access: { roles: ["helper"] } })).toMatchObject({ passed: false });
        expect(testCommandPermissions(ctx, { access: { staff: true } })).toEqual({ passed: true });
        expect(testCommandPermissions(ctx, { access: { roles: ["helper"], staff: true } })).toEqual({ passed: true });
        expect(client.getStaffGuildRoleIds).not.toHaveBeenCalled();
    });

    it("shares one lookup for command roles and configured staff roles", async () => {
        const client = createClient({ ...STAFF_DEFAULTS, guildId: "staff-guild", roles: ["staff"] });
        const ctx = createInteractionContext(client);
        client.getStaffGuildRoleIds.mockResolvedValue(["staff"]);
        expect(await testCommandPermissions(ctx, { access: { roles: ["helper"], staff: true } })).toEqual({ passed: true });
        expect(client.getStaffGuildRoleIds).toHaveBeenCalledTimes(1);
        client.getStaffGuildRoleIds.mockClear().mockResolvedValue([]);
        expect(await testCommandPermissions(ctx, { access: { roles: ["helper"], staff: true } })).toMatchObject({
            passed: false
        });
        expect(client.getStaffGuildRoleIds).toHaveBeenCalledTimes(1);
    });

    it("skips remote roles for a cheap pass or a failure without a staff server", () => {
        const client = createClient({ ...STAFF_DEFAULTS, roles: ["staff"] });
        const ctx = createInteractionContext(client);
        expect(testCommandPermissions(ctx, { access: { roles: ["helper"], staff: true } })).toMatchObject({ passed: false });
        client.globals.staff.guildId = "staff-guild";
        expect(testCommandPermissions(ctx, { access: { users: ["user"], roles: ["helper"], staff: true } })).toEqual({
            passed: true
        });
        expect(client.getStaffGuildRoleIds).not.toHaveBeenCalled();
    });

    it("keeps bot permissions required ahead of staff grants", async () => {
        const client = createClient({ ...STAFF_DEFAULTS, users: ["user"] });
        expect(
            await testCommandPermissions(createInteractionContext(client), {
                botPermissions: [PermissionFlagsBits.ManageMessages],
                access: { staff: true }
            })
        ).toMatchObject({ passed: false, reason: MissingPermissionReason.Client });
    });
});

describe("command access warnings", () => {
    afterEach(() => vi.restoreAllMocks());

    it.each([
        {
            kind: "prefix",
            create: (access: CommandAccess) => new PrefixCommandModule({ name: "manage", access, execute() {} })
        },
        {
            kind: "slash",
            create: (access: CommandAccess) =>
                new SlashCommandModule({
                    builder: b => b.setName("manage").setDescription("Manages records."),
                    access,
                    execute() {}
                })
        },
        {
            kind: "message context",
            create: (access: CommandAccess) =>
                new MessageContextCommandModule({ builder: b => b.setName("manage"), access, execute() {} })
        },
        {
            kind: "user context",
            create: (access: CommandAccess) =>
                new UserContextCommandModule({ builder: b => b.setName("manage"), access, execute() {} })
        }
    ])("warns once with the $kind command name and all unknown keys", ({ create }) => {
        const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
        const access = { botOwner: true, typo: true, users: undefined };
        create(access);

        expect(warn).toHaveBeenCalledTimes(1);
        for (const text of [
            "Command 'manage'",
            "unrecognized access keys: botOwner, typo",
            "open to everyone",
            "access: { users: [...] }"
        ]) {
            expect(warn).toHaveBeenCalledWith(expect.stringContaining(text));
        }
        expect(access).toEqual({ botOwner: true, typo: true, users: undefined });
    });

    it.each([
        {
            subcommand: "prune",
            create: (access: CommandAccess) =>
                new PrefixCommandModule({
                    name: "manage",
                    subcommands: { prune: { aliases: ["clear"], access, execute() {} } }
                })
        },
        {
            subcommand: "admin:prune",
            create: (access: CommandAccess) =>
                new SlashCommandModule({
                    builder: b =>
                        b
                            .setName("manage")
                            .setDescription("Manages records.")
                            .addSubcommandGroup(g =>
                                g
                                    .setName("admin")
                                    .setDescription("Admin tools")
                                    .addSubcommand(s => s.setName("prune").setDescription("Prunes records."))
                            ),
                    subcommands: { "admin:prune": { access, execute() {} } }
                })
        }
    ])("warns once for subcommand $subcommand without counting aliases", ({ subcommand, create }) => {
        const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
        const access = { typo: true, users: undefined };
        create(access);

        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining(`Command 'manage' subcommand '${subcommand}'`));
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("typo"));
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("open to everyone"));
        expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("access: { users: [...] }"));
    });

    it.each([
        { permissions: ["ManageGuild"] },
        { users: ["owner"] },
        { roles: ["moderator"] },
        { guildOwner: true },
        { staff: true }
    ] satisfies CommandAccess[])("does not call access open when a recognized grant is configured: %j", grant => {
        const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
        const access = { ...grant, typo: true };
        new PrefixCommandModule({ name: "manage", access, execute() {} });

        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("open to everyone"));
    });

    it("treats empty arrays and false flags as no grants and never warns during permission checks", async () => {
        const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
        const access = { botOwner: true, permissions: [], users: [], roles: [], guildOwner: false, staff: false };
        new PrefixCommandModule({ name: "manage", access, execute() {} });
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("open to everyone"));

        const ctx = createInteractionContext();
        for (let i = 0; i < 2; i++) {
            const restrictions = pickRestrictions({ access });
            expect(restrictions).toBeDefined();
            expect(await testCommandPermissions(ctx, restrictions!)).toEqual({ passed: true });
        }
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it.each([
        undefined,
        {},
        { permissions: [], users: [], roles: [], guildOwner: false, staff: false },
        { permissions: ["ManageGuild"], users: ["owner"], roles: ["moderator"], guildOwner: true, staff: true }
    ] satisfies (CommandAccess | undefined)[])("does not warn for valid access: %j", access => {
        const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
        new PrefixCommandModule({ name: "manage", access, subcommands: { prune: { access, execute() {} } }, execute() {} });
        expect(warn).not.toHaveBeenCalled();
    });

    it("logs one warning for each offending command or subcommand", () => {
        const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
        const access = { typo: true, users: ["owner"] };
        new PrefixCommandModule({
            name: "manage",
            access,
            subcommands: { prune: { access, execute() {} }, valid: { access: { staff: true }, execute() {} } }
        });

        expect(warn).toHaveBeenCalledTimes(2);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("Command 'manage' has unrecognized"));
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("Command 'manage' subcommand 'prune' has unrecognized"));
    });
});
