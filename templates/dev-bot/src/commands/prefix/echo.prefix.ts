import { PrefixCommandModule } from "vimcord";

export default new PrefixCommandModule({
    name: "echo",
    aliases: ["say"],
    description: "Replies with the provided text.",
    metadata: { category: ["Testing"], tags: ["prefix", "dynaSend"] },

    async execute({ client, message }) {
        // client.
    }
});
