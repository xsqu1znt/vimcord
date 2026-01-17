import { PartialDeep } from "type-fest";
import _ from "lodash";

export interface VimcordStaffConfig {
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

const defaultConfig: VimcordStaffConfig = {
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

export function createVimcordStaffConfig(options: PartialDeep<VimcordStaffConfig> = {}): VimcordStaffConfig {
    return _.merge(defaultConfig, options);
}
