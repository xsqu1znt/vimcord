import { EventBuilder } from "@/builders/event.builder";

export const contextCommandHandler = new EventBuilder({
    event: "interactionCreate",
    name: "ContextCommandHandler",
    async execute(client, interaction): Promise<void> {
        if (!interaction.isContextMenuCommand()) return;

        const command = client.commands.context.get(interaction.commandName);

        if (!command) {
            const content = `**${interaction.commandName}** is not a registered context command.`;

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
