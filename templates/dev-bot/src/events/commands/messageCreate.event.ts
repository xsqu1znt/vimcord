import { EventModule } from "@vimcord/core";

const PREFIX = "!";

export default new EventModule({
    event: "messageCreate",
    name: "Commands:PrefixDispatch",
    metadata: {
        category: ["Commands"],
        tags: ["prefix"]
    },

    async execute(client, message) {
        await client.modules.commands.dispatchMessage(message, PREFIX);
    }
});
