import { PrefixCommandModule } from "vimcord/dist/index.js";

export default new PrefixCommandModule({
    name: "echo",
    aliases: ["say"],
    description: "Replies with the provided text.",
    metadata: {
        category: ["Testing"],
        tags: ["prefix", "dynaSend"]
    },

    async execute({ message }) {
        const content = message.content.split(/\s+/).slice(1).join(" ").trim();

        message.reply({ content: content || "Nothing to echo." });
    }
});
