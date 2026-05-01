import { GatewayIntentBits } from "discord.js";
import { Vimcord } from "vimcord";

export function createBot(): Vimcord {
    const bot = new Vimcord({
        client: {
            intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
        },

        features: {
            importModules: {
                slashCommands: "./commands/slash",
                prefixCommands: "./commands/prefix",
                contextCommands: "./commands/context",
                events: "./events"
            }
        },

        verbose: process.argv.includes("--verbose")
    });

    return bot;
}
