import { Vimcord, VimcordConfig, VimcordFeatures } from "@/client/client";
import { ClientOptions } from "discord.js";
import { PartialDeep } from "type-fest";

export type VimcordConfigOptions = PartialDeep<VimcordConfig>;

export function useClient(clientId: number = 0) {
    return Vimcord.instances.get(clientId);
}

export async function useReadyClient(clientId: number = 0) {
    return useClient(clientId)?.waitForReady();
}

export function createClient(options: ClientOptions, features: VimcordFeatures = {}, config: VimcordConfigOptions = {}) {
    return new Vimcord(options, features, config);
}
