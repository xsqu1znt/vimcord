import { PrefixCommandModule } from "@vimcord/core";
import { dynaSend } from "@vimcord/ux";

export default new PrefixCommandModule({
    name: "echo",
    aliases: ["say"],
    description: "Replies with the provided text.",
    metadata: {
        category: ["Testing"],
        tags: ["prefix", "dynaSend"]
    },

    async execute(_client, message) {
        const content = message.content.split(/\s+/).slice(1).join(" ").trim();

        await dynaSend(message, {
            content: content || "Nothing to echo."
        });
    }
});
