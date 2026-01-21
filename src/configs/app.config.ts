import { PartialDeep } from "type-fest";
import _ from "lodash";

export interface VimcordAppConfig {
    devMode: boolean;
    name: string;
    appVersion: string;

    /** Enable verbose console logs?
     * @default false */
    verbose: boolean;

    /** Disable the vimcord client banner on startup
     * @default false */
    disableBanner: boolean;

    /** Only auto import modules that end with these suffixes */
    moduleSuffixes: {
        /** @default slash */
        slashCommand: "slash";
        /** @default ctx */
        contextCommand: "ctx";
        /** @default prefix */
        prefixCommand: "prefix";
        /** @default event */
        event: "event";
    };
}

const defaultConfig: VimcordAppConfig = {
    devMode: process.argv.includes("--dev"),
    name: "Discord Bot",
    appVersion: "1.0.0",
    verbose: false,
    disableBanner: false,

    moduleSuffixes: {
        slashCommand: "slash",
        contextCommand: "ctx",
        prefixCommand: "prefix",
        event: "event"
    }
};

export function createVimcordAppConfig(options: PartialDeep<VimcordAppConfig> = {}): VimcordAppConfig {
    return _.merge(defaultConfig, options);
}
