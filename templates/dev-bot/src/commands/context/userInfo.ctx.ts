import { ApplicationCommandType } from "discord.js";
import { ContextCommandModule } from "@vimcord/core";
import { dynaSend } from "@vimcord/ux";

export default new ContextCommandModule({
    builder: builder => builder.setName("User Info").setType(ApplicationCommandType.User),
    metadata: {
        category: ["Testing"],
        tags: ["context", "inferred-name"]
    },

    async execute(_client, interaction) {
        if (!interaction.isUserContextMenuCommand()) return;

        await dynaSend(interaction, {
            content: `${interaction.targetUser.tag} (${interaction.targetUser.id})`,
            flags: "Ephemeral"
        });
    }
});
