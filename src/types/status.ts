import { ActivityType } from "discord.js";
import { PartialDeep } from "@/utils/types.utils";
import { deepMerge } from "@/utils/merge.utils";

export enum StatusType {
    DND = "dnd",
    Idle = "idle",
    Online = "online",
    Invisible = "invisible"
}

export interface ClientActivity {
    /** Mappings:
     * - `$USER_COUNT` - this.client.users.cache.size
     * - `$GUILD_COUNT` - this.client.guilds.cache.size
     * - `$STAFF_GUILD_MEMBER_COUNT` - self explanatory
     */
    name: string;
    type: ActivityType;
    status: StatusType;
    streamUrl?: string;
}

export interface ClientStatus {
    /** In seconds */
    interval?: number;
    randomize?: boolean;
    activity: ClientActivity | ClientActivity[];
}

export interface VimcordClientStatus {
    production: ClientStatus;
    development: ClientStatus;
}

const defaultPresence: VimcordClientStatus = {
    production: {
        interval: 60_000,
        randomize: false,
        activity: [
            { status: StatusType.Online, type: ActivityType.Custom, name: "Need help? Use /help or !help" },
            { status: StatusType.Online, type: ActivityType.Custom, name: "Join our community!" },
            { status: StatusType.Online, type: ActivityType.Watching, name: "✨ $GUILD_COUNT servers" }
        ]
    },
    development: {
        activity: { status: StatusType.DND, type: ActivityType.Custom, name: "In development!" }
    }
};

export function createVimcordStatusConfig(options: PartialDeep<VimcordClientStatus> = {}): VimcordClientStatus {
    return deepMerge({ ...defaultPresence }, options);
}
