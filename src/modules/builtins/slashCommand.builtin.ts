import { EventBuilder } from "@/builders/event.builder";

export const slashCommandHandler = new EventBuilder({
    event: "interactionCreate",
    name: "SlashCommandHandler",
    async execute(client, interaction): Promise<void> {
        if (!interaction.isChatInputCommand()) return;

        const command = client.commands.slash.get(interaction.commandName);

        if (!command) {
            const content = `**/\`${interaction.commandName}\`** is not a registered command.`;

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content, flags: "Ephemeral" });
            } else {
                await interaction.reply({ content, flags: "Ephemeral" });
            }
            return;
        }

        try {
            await command.run(client, client, interaction);
        } catch (err) {
            await client.error.handleCommandError(err as Error, interaction.guild, interaction);
        }
    }
});
