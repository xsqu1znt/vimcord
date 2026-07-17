import type { APIInteractionGuildMember, Guild, GuildResolvable, Role, User } from "discord.js";
import type { CommandModuleHookContext } from "../abstracts/commands/CommandModuleTypeKit.js";
import type { StaffGlobals } from "../client/globals.js";

import { PermissionFlagsBits } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { CommandModuleType } from "../abstracts/commands/CommandModuleTypeKit.js";
import {
    MissingPermissionReason,
    testCommandPermissions,
    testGuildContext,
    testRoles,
    testUserBlacklist,
    testUserWhitelist
} from "./commandPermissions.js";

interface ContextOptions {
    commandName?: string;
    guild?: Guild | null;
    isBotStaff?: boolean;
    member?: APIInteractionGuildMember | null;
    staff?: StaffGlobals;
    userId: string;
}

function createStaff(overrides: Partial<StaffGlobals> = {}): StaffGlobals {
    return {
        ownerId: null,
        superUsers: [],
        superUserRoles: [],
        bypassers: [],
        bypassesGuildAdmin: {
            allBotStaff: false,
            botOwner: false,
            superUsers: false,
            bypassers: false,
            ...overrides.bypassesGuildAdmin
        },
        guild: {
            id: null,
            inviteUrl: null,
            channels: {},
            ...overrides.guild
        },
        ...overrides
    };
}

function createMember(roleIds: string[] = [], permissions: bigint = 0n): APIInteractionGuildMember {
    return {
        roles: roleIds,
        permissions: permissions.toString()
    } as APIInteractionGuildMember;
}

function createContext(options: ContextOptions): {
    ctx: CommandModuleHookContext<CommandModuleType.Slash>;
    isBotStaff: ReturnType<typeof vi.fn>;
} {
    const isBotStaff = vi.fn(async () => options.isBotStaff ?? false);
    const ctx = {
        client: {
            globals: { staff: options.staff ?? createStaff() },
            isBotStaff
        },
        interaction: {
            guild: options.guild ?? null,
            member: options.member ?? null,
            user: { bot: false, id: options.userId }
        },
        module: { name: options.commandName ?? "staff" }
    } as unknown as CommandModuleHookContext<CommandModuleType.Slash>;

    return { ctx, isBotStaff };
}

describe("testCommandPermissions", () => {
    it("merges staff and user whitelist access", async () => {
        const staff = createStaff({ ownerId: "staff-user" });
        const staffContext = createContext({ userId: "staff-user", staff, isBotStaff: true });
        const whitelistedContext = createContext({ userId: "extra-user", staff });
        const deniedContext = createContext({ userId: "other-user", staff });
        const permissions = { botStaffOnly: true, userWhitelist: ["extra-user"] };

        await expect(testCommandPermissions(staffContext.ctx, permissions)).resolves.toEqual({ passed: true });
        await expect(testCommandPermissions(whitelistedContext.ctx, permissions)).resolves.toEqual({ passed: true });
        await expect(testCommandPermissions(deniedContext.ctx, permissions)).resolves.toMatchObject({ passed: false });
    });

    it("grants per-command bypassers access using normalized command names", async () => {
        const staff = createStaff({
            bypassers: [{ commandName: " STAFF ", userIds: ["bypasser"] }]
        });
        const { ctx } = createContext({ commandName: "staff", userId: "bypasser", staff });

        await expect(testCommandPermissions(ctx, { botStaffOnly: true })).resolves.toEqual({ passed: true });
    });

    it("keeps user and role blacklists authoritative over bypassers", async () => {
        const staff = createStaff({
            bypassers: [{ commandName: "staff", userIds: ["bypasser"] }]
        });
        const fakeUser = { id: "bypasser" } as User;
        const fakeRole = { id: "blocked-role" } as Role;
        const { ctx } = createContext({
            userId: "bypasser",
            member: createMember(["blocked-role"]),
            staff
        });

        await expect(testCommandPermissions(ctx, { userBlacklist: [fakeUser] })).resolves.toEqual({
            passed: false,
            reason: MissingPermissionReason.UserBlacklisted
        });
        await expect(testCommandPermissions(ctx, { roleBlacklist: [fakeRole] })).resolves.toEqual({
            passed: false,
            reason: MissingPermissionReason.RoleBlacklisted
        });
    });

    it("uses configured staff-guild resolution for role-based staff", async () => {
        const { ctx, isBotStaff } = createContext({ userId: "role-staff", isBotStaff: true });

        await expect(testCommandPermissions(ctx, { botStaffOnly: true })).resolves.toEqual({ passed: true });
        expect(isBotStaff).toHaveBeenCalledWith("role-staff");
    });

    it("supports uncached interaction members", async () => {
        const member = createMember(["allowed-role"], PermissionFlagsBits.ManageGuild);
        const { ctx } = createContext({ userId: "user", member });

        await expect(
            testCommandPermissions(ctx, {
                roles: ["allowed-role"],
                user: [PermissionFlagsBits.ManageGuild]
            })
        ).resolves.toEqual({ passed: true });
    });

    it("applies configured Administrator bypasses without bypassing other required permissions", async () => {
        const staff = createStaff({
            superUsers: ["super-user"],
            bypassesGuildAdmin: {
                allBotStaff: false,
                botOwner: false,
                superUsers: true,
                bypassers: false
            }
        });
        const member = createMember([], PermissionFlagsBits.ManageGuild);
        const { ctx } = createContext({ userId: "super-user", member, staff });

        await expect(
            testCommandPermissions(ctx, {
                user: [PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageGuild]
            })
        ).resolves.toEqual({ passed: true });

        await expect(
            testCommandPermissions(ctx, {
                user: [PermissionFlagsBits.Administrator, PermissionFlagsBits.BanMembers]
            })
        ).resolves.toMatchObject({ passed: false, reason: MissingPermissionReason.User });
    });

    it("fails closed for guild-dependent access in DMs", async () => {
        const { ctx } = createContext({ userId: "user" });

        await expect(testCommandPermissions(ctx, { guildWhitelist: ["guild"] })).resolves.toMatchObject({
            passed: false,
            reason: MissingPermissionReason.NotInGuild
        });
        await expect(testCommandPermissions(ctx, { guildOwnerOnly: true })).resolves.toMatchObject({ passed: false });
        await expect(testCommandPermissions(ctx, { roles: ["role"] })).resolves.toMatchObject({ passed: false });
        await expect(testCommandPermissions(ctx, { user: [PermissionFlagsBits.ManageGuild] })).resolves.toMatchObject({
            passed: false
        });
    });
});

describe("permission resolvers", () => {
    it("resolves user and role objects by ID", () => {
        const fakeUser = { id: "user" } as User;
        const fakeRole = { id: "role" } as Role;
        const member = createMember(["role"]);

        expect(testUserWhitelist("user", [fakeUser])).toEqual({ passed: true });
        expect(testUserBlacklist("user", [fakeUser])).toMatchObject({
            passed: false,
            reason: MissingPermissionReason.UserBlacklisted
        });
        expect(testRoles(member, [fakeRole])).toEqual({ passed: true });
    });

    it("resolves guild-related objects to their guild ID", () => {
        const guild = { id: "guild" } as Guild;
        const channel = { guild, id: "channel" } as GuildResolvable;

        expect(testGuildContext(guild, false, [channel], undefined)).toEqual({ passed: true });
    });
});
