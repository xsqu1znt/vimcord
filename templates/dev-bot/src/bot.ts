import { GatewayIntentBits } from "discord.js";
import { Vimcord } from "vimcord";

export function createBot(): Vimcord {
    const bot = new Vimcord({
        client: {
            intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
        },

        features: {
            importModules: {
                events: "./events",
                slashCommands: "./commands/slash",
                prefixCommands: "./commands/prefix",
                contextCommands: "./commands/context"
            }
        },

        verbose: process.argv.includes("--verbose")
    });

    return bot;
}
