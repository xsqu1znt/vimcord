import { EventModule } from "vimcord";

export default new EventModule({
    event: "interactionCreate",
    name: "Commands:InteractionDispatch",
    metadata: {
        category: ["Commands"],
        tags: ["slash", "context"]
    },

    async execute({ client, args: [interaction] }) {
        await client.modules.commands.dispatchInteraction(interaction);
    }
});
