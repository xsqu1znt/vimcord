import type { CommandModuleHookContext } from "@/abstracts/commands/CommandModuleTypeKit.js";
import type { StaffGlobals } from "@/client/globals.js";

import { PermissionFlagsBits, PermissionsBitField } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { CommandModuleType } from "@/abstracts/commands/CommandModuleTypeKit.js";
import { MissingPermissionReason, testCommandPermissions } from "./commandPermissions.js";

const STAFF_DEFAULTS: StaffGlobals = {
    ownerId: null,
    superUsers: [],
    superUserRoles: [],
    bypassesStaff: [],
    bypassesGuildAdmin: {
        allBotStaff: false,
        botOwner: false,
        superUsers: false,
        bypassers: false
    },
    guild: {
        id: null,
        inviteUrl: null,
        channels: {},
        roles: {}
    }
};

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
    it("uses bypassesStaff only as a bot staff grant", async () => {
        const client = createClient({
            ...STAFF_DEFAULTS,
            bypassesStaff: [{ commandName: "manage", userIds: ["user"] }]
        });
        const ctx = createInteractionContext(client);

        await expect(testCommandPermissions(ctx, { users: ["other"] })).resolves.toMatchObject({
            passed: false,
            reason: MissingPermissionReason.UserNotAllowed
        });
        await expect(testCommandPermissions(ctx, { roles: ["moderator"] })).resolves.toMatchObject({
            passed: false,
            reason: MissingPermissionReason.Role
        });
        await expect(testCommandPermissions(ctx, { botOwner: true })).resolves.toMatchObject({
            passed: false,
            reason: MissingPermissionReason.NotBotOwner
        });
        await expect(testCommandPermissions(ctx, { botStaff: true })).resolves.toEqual({ passed: true });
    });

    it("removes only Administrator for enabled staff bypasses", async () => {
        const client = createClient({
            ...STAFF_DEFAULTS,
            bypassesStaff: [{ commandName: "manage", userIds: ["user"] }],
            bypassesGuildAdmin: { ...STAFF_DEFAULTS.bypassesGuildAdmin, bypassers: true }
        });
        const ctx = createInteractionContext(client, {
            memberPermissions: new PermissionsBitField(PermissionFlagsBits.ManageMessages)
        });
        const required = [PermissionFlagsBits.Administrator | PermissionFlagsBits.ManageMessages];

        await expect(testCommandPermissions(ctx, { user: required })).resolves.toEqual({ passed: true });

        const missingOtherPermission = createInteractionContext(client);
        await expect(testCommandPermissions(missingOtherPermission, { user: required })).resolves.toMatchObject({
            passed: false,
            reason: MissingPermissionReason.User,
            missingUserPermissions: [PermissionFlagsBits.ManageMessages]
        });
    });

    it("keeps Administrator required when the bypasser flag is off", async () => {
        const client = createClient({
            ...STAFF_DEFAULTS,
            bypassesStaff: [{ commandName: "manage", userIds: ["user"] }]
        });
        const ctx = createInteractionContext(client, {
            memberPermissions: new PermissionsBitField(PermissionFlagsBits.ManageMessages)
        });

        await expect(testCommandPermissions(ctx, { user: [PermissionFlagsBits.Administrator] })).resolves.toMatchObject({
            passed: false,
            reason: MissingPermissionReason.User
        });
    });

    it("uses a known bypasser before staff role lookups for an Administrator exemption", async () => {
        const client = createClient({
            ...STAFF_DEFAULTS,
            superUserRoles: ["staff"],
            bypassesStaff: [{ commandName: "manage", userIds: ["user"] }],
            bypassesGuildAdmin: {
                ...STAFF_DEFAULTS.bypassesGuildAdmin,
                allBotStaff: true,
                bypassers: true
            }
        });

        await expect(
            testCommandPermissions(createInteractionContext(client), { user: [PermissionFlagsBits.Administrator] })
        ).resolves.toEqual({ passed: true });
        expect(client.getStaffGuildRoleIds).not.toHaveBeenCalled();
    });

    it("applies hard restrictions before every grant and avoids staff lookups", async () => {
        const client = createClient({ ...STAFF_DEFAULTS, ownerId: "user" });
        const ctx = createInteractionContext(client);

        await expect(
            testCommandPermissions(ctx, { guildBlacklist: ["guild"], users: ["user"], botStaff: true })
        ).resolves.toMatchObject({ passed: false, reason: MissingPermissionReason.GuildBlacklisted });
        expect(client.getStaffGuildRoleIds).not.toHaveBeenCalled();
        expect(client.fetchGuild).not.toHaveBeenCalled();
    });

    it("does not resolve staff or channel permissions when local grants or no grants pass", async () => {
        const client = createClient();
        const interaction = createInteractionContext(client);
        const { ctx: prefix, permissionsFor } = createMessageContext(client, { guildId: null, guild: null });

        await expect(testCommandPermissions(interaction, {})).resolves.toEqual({ passed: true });
        await expect(testCommandPermissions(interaction, { users: ["user"] })).resolves.toEqual({ passed: true });
        await expect(testCommandPermissions(prefix, { users: ["user"] })).resolves.toEqual({ passed: true });

        expect(client.getStaffGuildRoleIds).not.toHaveBeenCalled();
        expect(client.fetchGuild).not.toHaveBeenCalled();
        expect(permissionsFor).not.toHaveBeenCalled();
    });

    it("uses known bot staff before an uncached guild-owner lookup", async () => {
        const client = createClient({ ...STAFF_DEFAULTS, ownerId: "user" });
        const ctx = createInteractionContext(client);

        await expect(testCommandPermissions(ctx, { guildOwner: true, botStaff: true })).resolves.toEqual({ passed: true });
        expect(client.fetchGuild).not.toHaveBeenCalled();
        expect(client.getStaffGuildRoleIds).not.toHaveBeenCalled();
    });

    it("returns the first failed grant when none allow access", async () => {
        const ctx = createInteractionContext();

        await expect(
            testCommandPermissions(ctx, {
                user: [PermissionFlagsBits.BanMembers],
                users: ["other"],
                roles: ["moderator"],
                guildOwner: true,
                botOwner: true,
                botStaff: true
            })
        ).resolves.toMatchObject({ passed: false, reason: MissingPermissionReason.User });
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
            user: [PermissionFlagsBits.BanMembers],
            client: [PermissionFlagsBits.ManageMessages]
        };
        await expect(testCommandPermissions(interaction, permissions)).resolves.toEqual({ passed: true });
        await expect(testCommandPermissions(prefix, permissions)).resolves.toEqual({ passed: true });
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

        await expect(testCommandPermissions(ctx, { user: [PermissionFlagsBits.BanMembers] })).resolves.toMatchObject({
            passed: false,
            reason: MissingPermissionReason.User
        });
        await expect(testCommandPermissions(ctx, { client: [PermissionFlagsBits.ManageMessages] })).resolves.toMatchObject({
            passed: false,
            reason: MissingPermissionReason.Client
        });
    });

    it("uses configured staff-guild roles and shares one role lookup", async () => {
        const configuredStaff = createClient({
            ...STAFF_DEFAULTS,
            superUserRoles: ["staff"]
        });
        configuredStaff.getStaffGuildRoleIds.mockResolvedValue(["staff"]);
        const invokingMember = createInteractionContext(configuredStaff, { member: { roles: [] } });

        await expect(testCommandPermissions(invokingMember, { botStaff: true })).resolves.toEqual({ passed: true });

        const sharedLookup = createClient({
            ...STAFF_DEFAULTS,
            superUserRoles: ["staff"],
            bypassesStaff: [{ commandName: "manage", roleIds: ["bypass"] }]
        });
        const denied = createInteractionContext(sharedLookup, { member: { roles: ["staff", "bypass"] } });

        await expect(testCommandPermissions(denied, { botStaff: true })).resolves.toMatchObject({
            passed: false,
            reason: MissingPermissionReason.NotBotStaff
        });
        expect(sharedLookup.getStaffGuildRoleIds).toHaveBeenCalledTimes(1);
    });

    it("keeps user, role, and client restrictions ahead of staff bypasses", async () => {
        const client = createClient({
            ...STAFF_DEFAULTS,
            bypassesStaff: [{ commandName: "manage", userIds: ["user"] }]
        });

        await expect(
            testCommandPermissions(createInteractionContext(client), { userBlacklist: ["user"], botStaff: true })
        ).resolves.toMatchObject({
            passed: false,
            reason: MissingPermissionReason.UserBlacklisted
        });
        await expect(
            testCommandPermissions(createInteractionContext(client, { member: { roles: ["blocked"] } }), {
                roleBlacklist: ["blocked"],
                botStaff: true
            })
        ).resolves.toMatchObject({ passed: false, reason: MissingPermissionReason.RoleBlacklisted });
        await expect(
            testCommandPermissions(createInteractionContext(client), {
                client: [PermissionFlagsBits.ManageMessages],
                botStaff: true
            })
        ).resolves.toMatchObject({ passed: false, reason: MissingPermissionReason.Client });
    });
});
