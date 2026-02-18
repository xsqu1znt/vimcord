import { createConfigFactory } from "@/utils/config.factory";
import { ColorResolvable } from "discord.js";
import { PartialDeep } from "@/utils/types.utils";

export interface ToolsConfig {
    devMode: boolean;

    embedColor: ColorResolvable[];
    embedColorDev: ColorResolvable[];

    timeouts: {
        collectorTimeout: number;
        collectorIdle: number;
        pagination: number;
        prompt: number;
        modalSubmit: number;
    };

    collector: {
        notAParticipantMessage: string;
        userLockMessage: string;
        notAParticipantWarningCooldown: number;
    };

    paginator: {
        notAParticipantMessage: string;

        jumpableThreshold: number;
        longThreshold: number;

        buttons: Record<
            "first" | "back" | "jump" | "next" | "last",
            { label: string; emoji: { animated?: boolean; name: string; id: string } }
        >;
    };

    prompt: {
        defaultTitle: string;
        defaultDescription: string;
        confirmLabel: string;
        rejectLabel: string;
    };
}

export const globalToolsConfig: ToolsConfig = {
    devMode: false,

    embedColor: [],
    embedColorDev: [],

    timeouts: {
        collectorTimeout: 60_000,
        collectorIdle: 60_000,
        pagination: 60_000,
        prompt: 30_000,
        modalSubmit: 60_000
    },

    collector: {
        notAParticipantMessage: "You are not allowed to use this.",
        userLockMessage: "Please wait until your current action is finished.",
        notAParticipantWarningCooldown: 5_000
    },

    paginator: {
        notAParticipantMessage: "You are not allowed to use this.",

        jumpableThreshold: 5,
        longThreshold: 4,

        buttons: {
            first: { label: "◀◀", emoji: { name: "⏮️", id: "⏮️" } },
            back: { label: "◀", emoji: { name: "◀️", id: "◀️" } },
            jump: { label: "📄", emoji: { name: "📄", id: "📄" } },
            next: { label: "▶", emoji: { name: "▶️", id: "▶️" } },
            last: { label: "▶▶", emoji: { name: "⏭️", id: "⏭️" } }
        }
    },

    prompt: {
        defaultTitle: "Are you sure?",
        defaultDescription: "Make sure you know what you're doing.",
        confirmLabel: "Confirm",
        rejectLabel: "Cancel"
    }
};

export const createToolsConfig = createConfigFactory(globalToolsConfig);

export const defineGlobalToolsConfig = (options: PartialDeep<ToolsConfig>) => {
    Object.assign(globalToolsConfig, createToolsConfig(options, globalToolsConfig));
};
