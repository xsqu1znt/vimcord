import { GatewayIntentBits } from "discord.js";
import { Vimcord } from "vimcord";
import { DotEnvPlugin } from "@vimcord/plugin-dotenv";

const client = new Vimcord({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    plugins: [new DotEnvPlugin()],
    prefix: "!",
    modules: {
        slashCommands: { dir: "./commands", suffix: ".slash" },
        prefixCommands: { dir: "./commands", suffix: ".prefix" },
        events: { dir: "./events", suffix: ".event" }
    }
});

await client.login();
