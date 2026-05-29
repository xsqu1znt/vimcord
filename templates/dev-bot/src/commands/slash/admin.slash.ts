import { SlashCommandModule } from "vimcord/dist/index.js";

export default new SlashCommandModule({
    builder: builder =>
        builder
            .setName("admin")
            .setDescription("Exercises grouped slash command routing.")
            .addSubcommandGroup(group =>
                group
                    .setName("user")
                    .setDescription("User admin test routes.")
                    .addSubcommand(command =>
                        command
                            .setName("ban")
                            .setDescription("Tests a grouped subcommand route without banning anyone.")
                            .addUserOption(option =>
                                option.setName("target").setDescription("User to include in the test response.")
                            )
                    )
                    .addSubcommand(command =>
                        command
                            .setName("info")
                            .setDescription("Tests a second grouped subcommand route.")
                            .addUserOption(option =>
                                option.setName("target").setDescription("User to inspect.").setRequired(true)
                            )
                    )
            ),

    deferReply: { flags: "Ephemeral" },
    metadata: {
        category: ["Testing"],
        tags: ["slash", "routes", "deferReply"]
    },

    routes: [
        {
            path: "user:ban",
            async handler({ interaction }) {
                const target = interaction.options.getUser("target");

                await interaction.editReply({
                    content: `Route \`user:ban\` resolved.${target ? ` Target: ${target.tag}.` : ""}`
                });
            }
        },

        {
            path: "user:info",
            async handler({ interaction }) {
                const target = interaction.options.getUser("target", true);

                await interaction.editReply({
                    content: `Route \`user:info\` resolved for ${target.tag} (${target.id}).`
                });
            }
        }
    ]
});
