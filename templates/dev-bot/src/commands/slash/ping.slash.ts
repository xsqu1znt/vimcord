import { SlashCommandModule } from "@vimcord/core";
import { dynaSend } from "@vimcord/ux";

export default new SlashCommandModule({
    builder: builder => builder.setName("ping").setDescription("Checks slash command dispatch and deferred replies."),
    deferReply: { ephemeral: true },
    metadata: {
        category: ["Testing"],
        tags: ["slash", "dynaSend", "deferReply"]
    },

    async execute(client, interaction) {
        await dynaSend(interaction, {
            content: `Pong. WebSocket latency: ${client.ws.ping}ms.`,
            flags: "Ephemeral"
        });
    }
});
