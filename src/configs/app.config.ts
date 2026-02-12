import { PartialDeep } from "type-fest";
import _ from "lodash";

export interface AppConfig {
    devMode: boolean;
    name: string;
    appVersion: string;

    /** Enable verbose console logs?
     * @defaultValue false */
    verbose: boolean;

    /** Disable the vimcord client banner on startup
     * @defaultValue false */
    disableBanner: boolean;

    /** Only auto import modules that end with these suffixes */
    moduleSuffixes: {
        /** @defaultValue slash */
        slashCommand: "slash";
        /** @defaultValue ctx */
        contextCommand: "ctx";
        /** @defaultValue prefix */
        prefixCommand: "prefix";
        /** @defaultValue event */
        event: "event";
    };
}

const defaultConfig: AppConfig = {
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

export function createAppConfig(options: PartialDeep<AppConfig> = {}): AppConfig {
    return _.merge(defaultConfig, options);
}
