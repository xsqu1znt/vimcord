import { EventModule } from "@vimcord/core";

export default new EventModule({
    event: "interactionCreate",
    name: "Commands:InteractionDispatch",
    metadata: {
        category: ["Commands"],
        tags: ["slash", "context"]
    },

    async execute(client, interaction) {
        await client.modules.commands.dispatchInteraction(interaction);
    }
});
