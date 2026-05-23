import { PrefixCommandModule } from "vimcord";

export default new PrefixCommandModule({
    name: "echo",
    aliases: ["say"],
    description: "Replies with the provided text.",
    metadata: { category: ["Testing"], tags: ["prefix", "dynaSend"] },

    async execute(ctx) {
        console.log(ctx.content);
        console.log(ctx.prefix);
        console.log(ctx.trigger);
        const content = ctx.splitContent();
        console.log(content);
    }
});
