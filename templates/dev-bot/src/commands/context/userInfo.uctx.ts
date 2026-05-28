import { ApplicationCommandType } from "discord.js";
import { UserContextCommandModule } from "vimcord/dist/index.js";

export default new UserContextCommandModule({
    builder: builder => builder.setName("User Info").setType(ApplicationCommandType.User),

    metadata: { category: ["Fun"] },

    async execute({ interaction }) {
        await interaction.reply({
            content: `${interaction.targetUser.tag} (${interaction.targetUser.id})`,
            flags: "Ephemeral"
        });
    }
});
