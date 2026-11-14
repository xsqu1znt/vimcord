import { SlashCommandModule } from "vimcord";

export default new SlashCommandModule({
    builder: b => b.setName("ping").setDescription("Replies with Pong."),
    async execute({ interaction }) {
        await interaction.reply("Pong!");
    }
});
