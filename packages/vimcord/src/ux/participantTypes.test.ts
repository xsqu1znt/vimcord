import type {
    ButtonInteraction,
    ChatInputCommandInteraction,
    DMChannel,
    GuildMember,
    GuildTextBasedChannel,
    Message,
    TextChannel,
    User
} from "discord.js";
import type { DynaSendOptions, TriggeredMessage } from "./dynaSend.js";

import { expect, it } from "vitest";
import { BetterCollector } from "./betterCollector.js";
import { BetterContainer } from "./BetterContainer.js";
import { BetterEmbed } from "./betterEmbed.js";
import { dynaSend } from "./dynaSend.js";
import { Paginator } from "./paginator.js";
import { promptMessage } from "./prompt.js";

/**
 * The participant rules are enforced by the compiler, so `pnpm check` is what runs this file.
 * Every `@ts-expect-error` fails the check if the line under it starts compiling. Nothing here ever executes.
 */
async function compileChecks(
    channel: GuildTextBasedChannel,
    text: TextChannel,
    dm: DMChannel,
    mixed: GuildTextBasedChannel | DMChannel,
    message: Message,
    messageOrButton: Message | ButtonInteraction,
    interaction: ChatInputCommandInteraction,
    button: ButtonInteraction,
    user: User,
    member: GuildMember,
    sendOptions: DynaSendOptions
) {
    const idle = 1_000;
    const embed = new BetterEmbed();
    const container = new BetterContainer();
    const paginator = new Paginator();
    const triggered = (m: TriggeredMessage) => m;

    // --- BetterCollector: raw sends and guild channel sends must say who may click ---
    // @ts-expect-error A raw channel send has no trigger.
    new BetterCollector(await channel.send("x"));
    // @ts-expect-error A raw reply looks like any other message.
    new BetterCollector(await message.reply("x"));
    // @ts-expect-error A guild channel has no trigger.
    new BetterCollector(await container.send(channel));
    // @ts-expect-error A guild channel has no trigger.
    new BetterCollector(await embed.send(channel));
    // @ts-expect-error A guild channel has no trigger.
    new BetterCollector(await dynaSend(channel, { content: "x" }));
    // @ts-expect-error A union containing a guild channel might have no trigger.
    new BetterCollector(await container.send(mixed));
    // @ts-expect-error Options without participants don't help.
    new BetterCollector(await text.send("x"), { idle });
    // @ts-expect-error Editing a message might be editing the bot's own message.
    new BetterCollector(await container.send(message, { sendMethod: "edit" }));
    // @ts-expect-error Same for an embed.
    new BetterCollector(await embed.send(message, { sendMethod: "edit" }));
    // @ts-expect-error Same for dynaSend.
    new BetterCollector(await dynaSend(message, { content: "x", sendMethod: "edit" }));
    // @ts-expect-error A fresh interaction reply might not return a message.
    new BetterCollector(await container.send(interaction));

    // --- BetterCollector: Vimcord's own sends with a trigger ---
    new BetterCollector(await container.send(message));
    new BetterCollector(await embed.send(message), { idle });
    new BetterCollector(await dynaSend(message, { content: "x" }));
    new BetterCollector(await container.send(user));
    new BetterCollector(await container.send(member));
    new BetterCollector(await container.send(dm));
    new BetterCollector(await container.send(interaction, { withResponse: true }));
    new BetterCollector(await container.send(button, { sendMethod: "edit" }));
    new BetterCollector(await container.send(button, { sendMethod: "followUp" }));
    new BetterCollector(await embed.send(interaction, { withResponse: true }));
    new BetterCollector(await embed.send(interaction, { sendMethod: "edit" }));
    new BetterCollector(await dynaSend(interaction, { content: "x", sendMethod: "followUp" }));
    new BetterCollector(await container.followUp(interaction));
    new BetterCollector(await embed.followUp(interaction));

    const reply = await container.send(interaction);
    triggered(reply!);
    // @ts-expect-error Still nullable with no withResponse or sendMethod.
    triggered(reply);

    // --- BetterCollector: anything goes once it's explicit ---
    new BetterCollector(await text.send("x"), { participants: "anyone" });
    new BetterCollector(await message.reply("x"), { participants: [user, member, "id"], idle });
    new BetterCollector(await container.send(channel), { participants: [user] });
    new BetterCollector(await container.send(message, { sendMethod: "edit" }), { participants: "anyone" });
    new BetterCollector(await text.send("x"), { interaction });

    // --- Plain Message return types still hold ---
    const plain: Message[] = [await container.send(channel), await embed.send(channel), await container.edit(message)];

    // --- promptMessage ---
    // @ts-expect-error A guild channel has no trigger.
    await promptMessage(channel);
    // @ts-expect-error Options without participants don't help.
    await promptMessage(channel, { idle });
    // @ts-expect-error A union containing a guild channel might have no trigger.
    await promptMessage(mixed, { idle });
    // @ts-expect-error Same for a concrete guild channel type.
    await promptMessage(text, {});
    // @ts-expect-error participants has to be one of the two forms.
    await promptMessage(message, { participants: "nobody" });
    await promptMessage(channel, { participants: "anyone", idle }, { allowedMentions: {} });
    await promptMessage(mixed, { participants: [user] });
    await promptMessage(message);
    await promptMessage(interaction, { idle }, { flags: "Ephemeral" });
    await promptMessage(button);
    await promptMessage(user);
    await promptMessage(member);
    await promptMessage(dm, { timeout: idle });
    // @ts-expect-error Editing a message might be editing the bot's own message.
    await promptMessage(message, { idle }, { sendMethod: "edit" });
    // @ts-expect-error Same with no prompt options to speak of.
    await promptMessage(message, undefined, { sendMethod: "edit" });
    // @ts-expect-error A union containing a message might be that edit.
    await promptMessage(messageOrButton, {}, { sendMethod: "edit" });
    // @ts-expect-error Options that might hold an edit count as one.
    await promptMessage(message, {}, sendOptions);
    await promptMessage(message, { participants: [user] }, { sendMethod: "edit" });
    await promptMessage(message, { idle }, { allowedMentions: {} });
    await promptMessage(interaction, undefined, { sendMethod: "edit" });
    await promptMessage(button, { idle }, { sendMethod: "followUp" });
    await promptMessage(interaction, {}, sendOptions);

    // --- Paginator.send ---
    // @ts-expect-error A guild channel has no trigger.
    await paginator.send(channel);
    // @ts-expect-error Options without participants don't help.
    await paginator.send(channel, {});
    // @ts-expect-error A union containing a guild channel might have no trigger.
    await paginator.send(mixed, { content: "x" });
    // @ts-expect-error Participants moved to send, off the constructor.
    new Paginator({ participants: "anyone" });
    await paginator.send(channel, { participants: "anyone", content: "x" });
    await paginator.send(mixed, { participants: [user] });
    await paginator.send(message);
    // @ts-expect-error Editing a message might be editing the bot's own message.
    await paginator.send(message, { sendMethod: "edit" });
    // @ts-expect-error A union containing a message might be that edit.
    await paginator.send(messageOrButton, { sendMethod: "edit" });
    // @ts-expect-error Options that might hold an edit count as one.
    await paginator.send(message, sendOptions);
    await paginator.send(message, { sendMethod: "edit", participants: [user] });
    await paginator.send(message, { content: "x" });
    await paginator.send(interaction, { sendMethod: "edit" });
    await paginator.send(interaction, sendOptions);
    await paginator.send(interaction, { flags: "Ephemeral" });
    await paginator.send(button, { sendMethod: "followUp" });
    await paginator.send(user);
    await paginator.send(dm);

    // --- BetterContainer as a component ---
    await message.edit({ components: [container] });
    await text.send({ components: [container] });
    await interaction.reply({ components: [container] });
    await dynaSend(message, { components: [container] });
    new BetterCollector(await container.send(message), {
        onResolve: () => ({ action: "disable", components: [container] })
    });

    return plain;
}

it("exists for the compiler; see compileChecks", () => {
    expect(compileChecks).toBeTypeOf("function");
});
