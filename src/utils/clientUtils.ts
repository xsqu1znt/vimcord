import { clientInstances, Vimcord, VimcordConfig, VimcordFeatures } from "@/client";
import { ClientOptions } from "discord.js";
import { PartialDeep } from "type-fest";
import * as VimcordCLI from "./VimcordCLI";

export type VimcordConfigOptions = PartialDeep<VimcordConfig>;

export function useClient(index: number = 0) {
    return clientInstances.at(index);
}

export async function useReadyClient(index: number = 0) {
    return useClient(index)?.whenReady();
}

/** Automatically bundles **🚀 {@link VimcordCLI}** with client creation */
export function createClient(options: ClientOptions, features: VimcordFeatures = {}, config: VimcordConfigOptions = {}) {
    const client = new Vimcord(options, features, config);
    VimcordCLI.initCLI();
    return client;
}

export function getClientInstances() {
    return clientInstances;
}
