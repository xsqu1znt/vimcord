import { createConfigFactory } from "@/utils/config.factory";

export interface StaffConfig {
    ownerId: string | null;
    superUsers: string[];
    superUserRoles: string[];
    bypassers: { commandName: string; userIds: string[] }[];
    bypassesGuildAdmin: {
        allBotStaff: boolean;
        botOwner: boolean;
        superUsers: boolean;
        bypassers: boolean;
    };
    guild: {
        id: string | null;
        inviteUrl: string | null;
        channels: Record<string, string>;
    };
}

const defaultConfig: StaffConfig = {
    ownerId: null,
    superUsers: [],
    superUserRoles: [],
    bypassers: [],
    bypassesGuildAdmin: {
        allBotStaff: false,
        botOwner: false,
        superUsers: false,
        bypassers: false
    },
    guild: {
        id: null,
        inviteUrl: null,
        channels: {}
    }
};

export const createStaffConfig = createConfigFactory(defaultConfig);
