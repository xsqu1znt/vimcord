import { GatewayIntentBits } from "discord.js";
import { Vimcord } from "vimcord";
import { DotEnvPlugin } from "@vimcord/plugin-dotenv";

async function main() {
    // --- Initialize Client ---
    const client = new Vimcord({
        client: {
            intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
        },

        features: {
            importModules: {
                // slashCommands: "./commands/slash",
                prefixCommands: "./commands/prefix",
                // contextCommands: "./commands/context",
                events: "./events"
            }
        },

        verbose: process.argv.includes("--verbose")
    });

    // --- Plugins ---
    client.use(new DotEnvPlugin());

    // --- Start the Instance ---
    await client.login();
}

main();
