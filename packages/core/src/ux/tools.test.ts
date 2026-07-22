import type { Guild, GuildMember, Role } from "discord.js";

import { describe, expect, it, vi } from "vitest";
import { fetchMember, fetchRole } from "./tools.js";

describe("UX fetch tools", () => {
    it("returns cached roles and fetches role cache misses", async () => {
        const cachedRole = { id: "cached-role" } as Role;
        const fetchedRole = { id: "fetched-role" } as Role;
        const fetch = vi.fn(async () => fetchedRole);
        const guild = {
            roles: {
                resolveId: (role: string) => role,
                cache: new Map([[cachedRole.id, cachedRole]]),
                fetch
            }
        } as unknown as Guild;

        await expect(fetchRole(guild, cachedRole.id)).resolves.toBe(cachedRole);
        expect(fetch).not.toHaveBeenCalled();

        await expect(fetchRole(guild, fetchedRole.id)).resolves.toBe(fetchedRole);
        expect(fetch).toHaveBeenCalledWith(fetchedRole.id, { cache: true });
    });

    it("returns cached members and fetches member cache misses", async () => {
        const cachedMember = { id: "cached-member" } as GuildMember;
        const fetchedMember = { id: "fetched-member" } as GuildMember;
        const fetch = vi.fn(async () => fetchedMember);
        const guild = {
            members: {
                resolveId: (member: string) => member,
                cache: new Map([[cachedMember.id, cachedMember]]),
                fetch
            }
        } as unknown as Guild;

        await expect(fetchMember(guild, cachedMember.id)).resolves.toBe(cachedMember);
        expect(fetch).not.toHaveBeenCalled();

        await expect(fetchMember(guild, fetchedMember.id)).resolves.toBe(fetchedMember);
        expect(fetch).toHaveBeenCalledWith({ user: fetchedMember.id, cache: true });
    });

    it("returns null for absent inputs and failed fetches", async () => {
        const guild = {
            roles: {
                resolveId: (role: string) => role,
                cache: new Map(),
                fetch: vi.fn(async () => {
                    throw new Error("Missing role");
                })
            },
            members: {
                resolveId: (member: string) => member,
                cache: new Map(),
                fetch: vi.fn(async () => {
                    throw new Error("Missing member");
                })
            }
        } as unknown as Guild;

        await expect(fetchRole(null, "role")).resolves.toBeNull();
        await expect(fetchMember(guild, undefined)).resolves.toBeNull();
        await expect(fetchRole(guild, "role")).resolves.toBeNull();
        await expect(fetchMember(guild, "member")).resolves.toBeNull();
    });
});
