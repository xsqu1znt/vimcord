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

        expect(await testCommandPermissions(ctx, { access: { users: ["other"] } })).toMatchObject({
            passed: false,
            reason: MissingPermissionReason.UserNotAllowed
        });
        expect(await testCommandPermissions(ctx, { access: { roles: ["moderator"] } })).toMatchObject({
            passed: false,
            reason: MissingPermissionReason.Role
        });
        expect(await testCommandPermissions(ctx, { access: { botOwner: true } })).toMatchObject({
            passed: false,
            reason: MissingPermissionReason.NotBotOwner
        });
        expect(await testCommandPermissions(ctx, { access: { staff: true } })).toEqual({ passed: true });
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

        expect(await testCommandPermissions(ctx, { access: { permissions: required } })).toEqual({ passed: true });

        const missingOtherPermission = createInteractionContext(client);
        expect(await testCommandPermissions(missingOtherPermission, { access: { permissions: required } })).toMatchObject({
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

        expect(
            await testCommandPermissions(ctx, { access: { permissions: [PermissionFlagsBits.Administrator] } })
        ).toMatchObject({
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

        expect(
            await testCommandPermissions(createInteractionContext(client), {
                access: { permissions: [PermissionFlagsBits.Administrator] }
            })
        ).toEqual({ passed: true });
        expect(client.getStaffGuildRoleIds).not.toHaveBeenCalled();
    });

    it("applies must-pass restrictions before every grant and avoids staff lookups", async () => {
        const client = createClient({ ...STAFF_DEFAULTS, ownerId: "user" });
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
        const client = createClient({ ...STAFF_DEFAULTS, ownerId: "user" });
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
                    botOwner: true,
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

    it("uses configured staff-guild roles and shares one role lookup", async () => {
        const configuredStaff = createClient({
            ...STAFF_DEFAULTS,
            superUserRoles: ["staff"]
        });
        configuredStaff.getStaffGuildRoleIds.mockResolvedValue(["staff"]);
        const invokingMember = createInteractionContext(configuredStaff, { member: { roles: [] } });

        expect(await testCommandPermissions(invokingMember, { access: { staff: true } })).toEqual({ passed: true });

        const sharedLookup = createClient({
            ...STAFF_DEFAULTS,
            superUserRoles: ["staff"],
            bypassesStaff: [{ commandName: "manage", roleIds: ["bypass"] }]
        });
        const denied = createInteractionContext(sharedLookup, { member: { roles: ["staff", "bypass"] } });

        expect(await testCommandPermissions(denied, { access: { staff: true } })).toMatchObject({
            passed: false,
            reason: MissingPermissionReason.NotBotStaff
        });
        expect(sharedLookup.getStaffGuildRoleIds).toHaveBeenCalledTimes(1);
    });

    it("keeps bot permissions required ahead of staff bypasses", async () => {
        const client = createClient({
            ...STAFF_DEFAULTS,
            bypassesStaff: [{ commandName: "manage", userIds: ["user"] }]
        });

        expect(
            await testCommandPermissions(createInteractionContext(client), {
                botPermissions: [PermissionFlagsBits.ManageMessages],
                access: { staff: true }
            })
        ).toMatchObject({ passed: false, reason: MissingPermissionReason.Client });
    });
});
