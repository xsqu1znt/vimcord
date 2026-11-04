import assert from "node:assert/strict";
import { ChatInputCommandInteraction, ContextMenuCommandBuilder, SlashCommandBuilder } from "discord.js";

// Offline transport: serialize the same payload Discord would receive, without network latency.
function interaction(name, subcommand = null) {
    const source = Object.create(ChatInputCommandInteraction.prototype);
    const state = { sends: 0, deferrals: 0, payload: null };
    const properties = {
        commandName: name,
        user: { id: "member", username: "Maya", bot: false },
        guild: null,
        guildId: null,
        member: null,
        memberPermissions: null,
        appPermissions: null,
        createdTimestamp: Date.now(),
        replied: false,
        deferred: false,
        options: {
            getSubcommand: () => subcommand,
            getSubcommandGroup: () => null,
            getString: () => "Please review the rules",
            getUser: () => ({ id: "target", username: "Sam" })
        },
        targetMessage: { id: "saved-message", content: "Useful resource" },
        targetUser: { id: "target", username: "Sam" },
        isChatInputCommand: () => true,
        isContextMenuCommand: () => false,
        isAutocomplete: () => false,
        deferReply: async () => {
            state.deferrals++;
            source.deferred = true;
        },
        reply: async data => {
            state.sends++;
            state.payload = JSON.parse(JSON.stringify(data));
            source.replied = true;
        },
        editReply: async data => {
            state.sends++;
            state.payload = JSON.parse(JSON.stringify(data));
            return null;
        }
    };
    Object.defineProperties(
        source,
        Object.fromEntries(
            Object.entries(properties).map(([key, value]) => [key, { value, writable: true, configurable: true }])
        )
    );
    return {
        source,
        state,
        reset() {
            source.replied = false;
            source.deferred = false;
        }
    };
}

export const apps = [
    {
        name: "utility",
        setup(client, { SlashCommandModule }) {
            const io = interaction("uptime");
            client.modules.commands.slash.register(
                new SlashCommandModule({
                    builder: b => b.setName("uptime").setDescription("Show bot uptime"),
                    execute: ({ interaction }) => interaction.reply({ content: "Online and ready" })
                })
            );
            return {
                run: () => {
                    io.reset();
                    return client.modules.commands.dispatchInteraction(io.source);
                },
                verify: () => assert.equal(io.state.payload.content, "Online and ready"),
                io
            };
        }
    },
    {
        name: "economy",
        setup(client, { PrefixCommandModule }) {
            let balance = 0;
            const io = interaction("bank");
            const message = {
                content: "!bank deposit 5",
                author: io.source.user,
                guild: null,
                guildId: null,
                createdTimestamp: Date.now(),
                reply: io.source.reply
            };
            client.modules.commands.prefix.register(
                new PrefixCommandModule({
                    name: "bank",
                    aliases: ["wallet"],
                    subcommands: {
                        deposit: {
                            handler: ({ splitContent, message }) => {
                                const amount = Number(splitContent()[0]);
                                if (!Number.isSafeInteger(amount) || amount <= 0)
                                    return message.reply({ content: "Enter a positive whole amount" });
                                balance += amount;
                                return message.reply({ content: `Balance: ${balance}` });
                            }
                        },
                        balance: { handler: ({ message }) => message.reply({ content: `Balance: ${balance}` }) }
                    }
                })
            );
            return {
                run: () => client.modules.commands.dispatchMessage(message, ["!"]),
                verify: () => {
                    assert.ok(balance > 0);
                    assert.equal(io.state.payload.content, `Balance: ${balance}`);
                },
                io
            };
        }
    },
    {
        name: "moderation",
        setup(client, { SlashCommandModule }) {
            const warnings = new Map();
            const io = interaction("mod", "warn");
            client.modules.commands.slash.register(
                new SlashCommandModule({
                    builder: new SlashCommandBuilder()
                        .setName("mod")
                        .setDescription("Moderate members")
                        .addSubcommand(b =>
                            b
                                .setName("warn")
                                .setDescription("Warn a member")
                                .addUserOption(o => o.setName("user").setDescription("Member to warn").setRequired(true))
                                .addStringOption(o =>
                                    o.setName("reason").setDescription("Reason for warning").setRequired(true)
                                )
                        ),
                    permissions: { users: ["member"] },
                    conditions: [() => ({ passed: true })],
                    routes: [
                        {
                            path: "warn",
                            handler: ({ interaction }) => {
                                const user = interaction.options.getUser("user");
                                warnings.set(user.id, (warnings.get(user.id) ?? 0) + 1);
                                return interaction.reply({
                                    content: `Warned ${user.username}: ${interaction.options.getString("reason")}`,
                                    flags: "Ephemeral"
                                });
                            }
                        }
                    ]
                })
            );
            return {
                run: () => {
                    io.reset();
                    return client.modules.commands.dispatchInteraction(io.source);
                },
                verify: () => {
                    assert.ok(warnings.get("target") > 0);
                    assert.match(io.state.payload.content, /^Warned Sam:/);
                },
                io
            };
        }
    },
    {
        name: "support",
        setup(client, { BetterEmbed, SlashCommandModule }) {
            const io = interaction("ticket", "open");
            client.modules.commands.slash.register(
                new SlashCommandModule({
                    builder: b =>
                        b
                            .setName("ticket")
                            .setDescription("Support tickets")
                            .addSubcommand(b => b.setName("open").setDescription("Open a ticket")),
                    routes: [
                        {
                            path: "open",
                            deferReply: true,
                            handler: ({ interaction }) =>
                                new BetterEmbed({
                                    title: "Support ticket",
                                    description: ["Tell us what happened.", "A moderator will reply here."],
                                    color: 0x5865f2
                                }).send(interaction)
                        }
                    ]
                })
            );
            return {
                run: () => {
                    io.reset();
                    return client.modules.commands.dispatchInteraction(io.source);
                },
                verify: () => {
                    assert.equal(io.state.payload.embeds[0].title, "Support ticket");
                    assert.ok(io.state.deferrals > 0);
                },
                io
            };
        }
    },
    {
        name: "bookmarks",
        setup(client, { MessageContextCommandModule, UserContextCommandModule }) {
            const saved = new Set();
            const io = interaction("Save message");
            io.source.isChatInputCommand = () => false;
            io.source.isContextMenuCommand = () => true;
            io.source.isMessageContextMenuCommand = () => true;
            io.source.isUserContextMenuCommand = () => false;
            client.modules.commands.context.message.register(
                new MessageContextCommandModule({
                    builder: new ContextMenuCommandBuilder().setName("Save message"),
                    execute: ({ interaction }) => {
                        saved.add(interaction.targetMessage.id);
                        return interaction.reply({ content: "Bookmark saved", flags: "Ephemeral" });
                    }
                })
            );
            client.modules.commands.context.user.register(
                new UserContextCommandModule({
                    builder: new ContextMenuCommandBuilder().setName("View profile"),
                    execute: ({ interaction }) =>
                        interaction.reply({ content: `Profile: ${interaction.targetUser.username}` })
                })
            );
            let profile = false;
            return {
                run: () => {
                    io.reset();
                    profile = !profile;
                    io.source.commandName = profile ? "View profile" : "Save message";
                    io.source.isMessageContextMenuCommand = () => !profile;
                    io.source.isUserContextMenuCommand = () => profile;
                    return client.modules.commands.dispatchInteraction(io.source);
                },
                verify: () => {
                    assert.ok(saved.has("saved-message"));
                    assert.ok(io.state.payload.content);
                },
                io
            };
        }
    }
];
