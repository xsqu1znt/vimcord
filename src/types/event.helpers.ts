import { type Vimcord } from "@/client";
import { ClientEvents } from "discord.js";

export type EventParameters<T extends keyof ClientEvents> = [client: Vimcord<true>, ...args: ClientEvents[T]];
