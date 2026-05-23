import { userMention } from "discord.js";
import { EventModule } from "vimcord";

export default new EventModule({
    event: "messageCreate",
    name: "CommandDispatch:Prefix",
    metadata: {
        category: ["Commands"],
        tags: ["prefix"]
    },

    async execute({ client, args: [message] }) {
        if (message.author.bot) return;

        const allowedPrefixes = [
            ";",
            `${userMention(client.user.id)} ` // Mentioning the bot
        ];
        await client.modules.commands.dispatchMessage(message, allowedPrefixes);
    }
});
