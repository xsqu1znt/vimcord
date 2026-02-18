import { type Vimcord } from "@/client";
import { BetterEmbed } from "@/tools/BetterEmbed";
import { dynaSend } from "@/tools/dynaSend";
import { SendMethod } from "@/tools/types";
import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    CommandInteraction,
    ComponentType,
    Guild,
    Message
} from "discord.js";

export async function sendCommandErrorEmbed(
    client: Vimcord,
    error: Error,
    guild: Guild | null | undefined,
    messageOrInteraction: Message | CommandInteraction
) {
    if (!client.features.enableCommandErrorMessage) return null;

    const config =
        typeof client.features.enableCommandErrorMessage !== "boolean"
            ? client.features.enableCommandErrorMessage
            : undefined;

    const buttons = {
        supportServer: new ButtonBuilder({
            url: config?.inviteUrl || client.config.staff.guild.inviteUrl || "https://www.youtube.com/watch?v=dQw4w9WgXcQ", // may or may not be a rickroll
            label: config?.inviteButtonLabel || "Support Support",
            style: ButtonStyle.Link
        }),

        details: new ButtonBuilder({
            customId: "btn_details",
            label: config?.detailButtonLabel || "Details",
            style: ButtonStyle.Secondary
        })
    };

    // Action row
    const actionRow = new ActionRowBuilder<ButtonBuilder>({
        components:
            config?.inviteUrl && guild?.id !== (config.inviteUrl || client.config.staff.guild.id)
                ? [buttons.supportServer, buttons.details]
                : [buttons.details]
    });

    // Create the embed (Error)
    const embed_error =
        config?.embed?.(new BetterEmbed(), error, guild) ||
        new BetterEmbed({
            color: "Red",
            title: "Something went wrong",
            description: "If you keep encountering this error, please report it."
        });

    // Send the embed
    const msg = await dynaSend(messageOrInteraction, {
        embeds: [embed_error],
        components: [actionRow],
        flags: config?.ephemeral ? "Ephemeral" : undefined,
        deleteAfter: config?.deleteAfter
    });
    if (!msg) return null;

    // Collect interactions
    const collector = msg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        idle: config?.detailButtonIdleTimeout ?? 30_000,
        filter: i => i.customId === "btn_details"
    });

    collector.on("collect", i => {
        const attachment = new AttachmentBuilder(Buffer.from(`${error.message}\n\n${error.stack}`), {
            name: "error.txt"
        });

        // Send the error attachment
        i.reply({ files: [attachment], flags: "Ephemeral" });
    });

    collector.on("end", () => {
        // Disable the details button
        buttons.details.setDisabled(true);

        // Update the action row
        dynaSend(messageOrInteraction, {
            embeds: [embed_error],
            sendMethod: messageOrInteraction instanceof Message ? SendMethod.MessageEdit : undefined,
            components: [actionRow]
        });
    });

    return msg;
}
