import { ApplicationCommandType } from "discord.js";
import { ContextCommandModule, dynaSend } from "vimcord";

export default new ContextCommandModule({
    builder: builder => builder.setName("User Info").setType(ApplicationCommandType.User),
    metadata: {
        category: ["Testing"],
        tags: ["context", "inferred-name"]
    },

    async execute({ interaction }) {
        if (!interaction.isUserContextMenuCommand()) return;

        await interaction.reply({
            content: `${interaction.targetUser.tag} (${interaction.targetUser.id})`,
            flags: "Ephemeral"
        });
    }
});
