import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SendMethod } from "./dynaSend.types.js";

// Mock Discord.js classes to pass instanceof checks
class MockMessage {
    reply = vi.fn().mockResolvedValue({});
    edit = vi.fn().mockResolvedValue({});
    delete = vi.fn().mockResolvedValue(undefined);
    deletable = true;
    editable = true;
}

class MockUser {
    send = vi.fn().mockResolvedValue({});
}

class MockGuildMember {
    send = vi.fn().mockResolvedValue({});
}

class MockTextChannel {
    send = vi.fn().mockResolvedValue({});
}

class MockBaseInteraction {
    replied = false;
    deferred = false;
    reply = vi.fn().mockResolvedValue({});
    editReply = vi.fn().mockResolvedValue({});
    followUp = vi.fn().mockResolvedValue({});
}

// Replace the actual classes for testing
vi.mock("discord.js", async () => {
    const actual = await vi.importActual("discord.js");
    return {
        ...actual,
        Message: MockMessage,
        User: MockUser,
        GuildMember: MockGuildMember,
        BaseChannel: MockTextChannel,
        BaseInteraction: MockBaseInteraction
    };
});

describe("dynaSend", () => {
    let mockMessage: MockMessage;
    let mockUser: MockUser;
    let mockGuildMember: MockGuildMember;
    let mockChannel: MockTextChannel;
    let mockInteraction: MockBaseInteraction;

    beforeEach(() => {
        mockMessage = new MockMessage();
        mockUser = new MockUser();
        mockGuildMember = new MockGuildMember();
        mockChannel = new MockTextChannel();
        mockInteraction = new MockBaseInteraction();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe("send method detection", () => {
        it("should detect Reply method for unreplied interaction", async () => {
            const { dynaSend } = await import("./dynaSend.js");

            await dynaSend(mockInteraction as any, { content: "test" });

            expect(mockInteraction.reply).toHaveBeenCalled();
        });

        it("should detect EditReply method for already replied interaction", async () => {
            const { dynaSend } = await import("./dynaSend.js");
            mockInteraction.replied = true;

            await dynaSend(mockInteraction as any, { content: "test" });

            expect(mockInteraction.editReply).toHaveBeenCalled();
        });

        it("should detect Channel method for text-based channel", async () => {
            const { dynaSend } = await import("./dynaSend.js");

            await dynaSend(mockChannel as any, { content: "test" });

            expect(mockChannel.send).toHaveBeenCalled();
        });

        it("should detect MessageReply method for Message", async () => {
            const { dynaSend } = await import("./dynaSend.js");

            await dynaSend(mockMessage as any, { content: "test" });

            expect(mockMessage.reply).toHaveBeenCalled();
        });

        it("should detect User method for User instance", async () => {
            const { dynaSend } = await import("./dynaSend.js");

            await dynaSend(mockUser as any, { content: "test" });

            expect(mockUser.send).toHaveBeenCalled();
        });

        it("should detect User method for GuildMember instance", async () => {
            const { dynaSend } = await import("./dynaSend.js");

            await dynaSend(mockGuildMember as any, { content: "test" });

            expect(mockGuildMember.send).toHaveBeenCalled();
        });
    });

    describe("validation", () => {
        it("should throw when using interaction method with non-interaction handler", async () => {
            const { dynaSend } = await import("./dynaSend.js");

            await expect(
                dynaSend(mockChannel as any, {
                    sendMethod: SendMethod.Reply,
                    content: "test"
                })
            ).rejects.toThrow("requires BaseInteraction handler");
        });

        it("should throw when using Channel method with non-channel handler", async () => {
            const { dynaSend } = await import("./dynaSend.js");

            await expect(
                dynaSend(mockUser as any, {
                    sendMethod: SendMethod.Channel,
                    content: "test"
                })
            ).rejects.toThrow("requires BaseChannel handler");
        });

        it("should throw when using MessageReply method with non-message handler", async () => {
            const { dynaSend } = await import("./dynaSend.js");

            await expect(
                dynaSend(mockUser as any, {
                    sendMethod: SendMethod.MessageReply,
                    content: "test"
                })
            ).rejects.toThrow("requires Message handler");
        });

        it("should throw when using User method with interaction handler", async () => {
            const { dynaSend } = await import("./dynaSend.js");

            await expect(
                dynaSend(mockInteraction as any, {
                    sendMethod: SendMethod.User,
                    content: "test"
                })
            ).rejects.toThrow("requires User or GuildMember handler");
        });
    });

    describe("message data construction", () => {
        it("should pass content through", async () => {
            const { dynaSend } = await import("./dynaSend.js");

            await dynaSend(mockChannel as any, { content: "hello world" });

            expect(mockChannel.send).toHaveBeenCalledWith(expect.objectContaining({ content: "hello world" }));
        });

        it("should pass embeds through", async () => {
            const { dynaSend } = await import("./dynaSend.js");

            const mockEmbed = { title: "Test Embed" };
            await dynaSend(mockChannel as any, { embeds: [mockEmbed as any] });

            expect(mockChannel.send).toHaveBeenCalledWith(expect.objectContaining({ embeds: [mockEmbed] }));
        });

        it("should pass components through", async () => {
            const { dynaSend } = await import("./dynaSend.js");

            const mockComponent = { type: 1 } as any;
            await dynaSend(mockChannel as any, { components: [mockComponent] });

            expect(mockChannel.send).toHaveBeenCalledWith(expect.objectContaining({ components: [mockComponent] }));
        });

        it("should pass files through", async () => {
            const { dynaSend } = await import("./dynaSend.js");

            const mockFile = { attachment: "file.txt" } as any;
            await dynaSend(mockChannel as any, { files: [mockFile] });

            expect(mockChannel.send).toHaveBeenCalledWith(expect.objectContaining({ files: [mockFile] }));
        });

        it("should pass tts option through", async () => {
            const { dynaSend } = await import("./dynaSend.js");

            await dynaSend(mockChannel as any, { content: "test", tts: true });

            expect(mockChannel.send).toHaveBeenCalledWith(expect.objectContaining({ tts: true }));
        });

        it("should pass allowedMentions through", async () => {
            const { dynaSend } = await import("./dynaSend.js");

            const mentions = { users: ["123"] } as any;
            await dynaSend(mockChannel as any, { content: "test", allowedMentions: mentions });

            expect(mockChannel.send).toHaveBeenCalledWith(expect.objectContaining({ allowedMentions: mentions }));
        });
    });

    describe("flag filtering", () => {
        it("should filter Ephemeral flag for Channel method", async () => {
            const { dynaSend } = await import("./dynaSend.js");

            await dynaSend(mockChannel as any, {
                content: "test",
                flags: ["Ephemeral"] as any
            });

            expect(mockChannel.send).toHaveBeenCalledWith(expect.objectContaining({ flags: undefined }));
        });

        it("should filter Ephemeral and SuppressNotifications for EditReply method", async () => {
            const { dynaSend } = await import("./dynaSend.js");
            mockInteraction.replied = true;

            await dynaSend(mockInteraction as any, {
                content: "test",
                flags: ["Ephemeral", "SuppressNotifications"] as any
            });

            expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({ flags: undefined }));
        });

        it("should preserve non-filtered flags", async () => {
            const { dynaSend } = await import("./dynaSend.js");
            mockInteraction.replied = true;

            await dynaSend(mockInteraction as any, {
                content: "test",
                flags: ["SuppressEmbeds"] as any
            });

            expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({ flags: ["SuppressEmbeds"] }));
        });
    });

    describe("auto-delete", () => {
        it("should schedule message deletion after specified delay", async () => {
            const { dynaSend } = await import("./dynaSend.js");

            const setTimeoutSpy = vi.spyOn(global, "setTimeout");

            await dynaSend(mockMessage as any, { content: "test", deleteAfter: 5000 });

            expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 5000);

            setTimeoutSpy.mockRestore();
        });

        it("should warn if delete delay is less than 1 second", async () => {
            const { dynaSend } = await import("./dynaSend.js");

            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

            await dynaSend(mockMessage as any, { content: "test", deleteAfter: 500 });

            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Delete delay is less than 1 second"));

            warnSpy.mockRestore();
        });
    });

    describe("error handling", () => {
        it("should throw when message is not editable for MessageEdit", async () => {
            const { dynaSend } = await import("./dynaSend.js");
            mockMessage.editable = false;

            await expect(
                dynaSend(mockMessage as any, { sendMethod: SendMethod.MessageEdit, content: "test" })
            ).rejects.toThrow("Message is not editable");
        });

        it("should throw when send method cannot be detected", async () => {
            const { dynaSend } = await import("./dynaSend.js");

            await expect(dynaSend({} as any, { content: "test" })).rejects.toThrow("Unable to determine send method");
        });

        it("should throw when unknown send method is used", async () => {
            const { dynaSend } = await import("./dynaSend.js");

            await expect(
                dynaSend(mockChannel as any, {
                    sendMethod: 999 as SendMethod,
                    content: "test"
                })
            ).rejects.toThrow("Unknown send method");
        });
    });

    describe("options withResponse", () => {
        it("should pass withResponse to reply", async () => {
            const { dynaSend } = await import("./dynaSend.js");

            await dynaSend(mockInteraction as any, {
                content: "test",
                withResponse: true
            });

            expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({ withResponse: true }));
        });

        it("should pass withResponse to editReply", async () => {
            const { dynaSend } = await import("./dynaSend.js");
            mockInteraction.replied = true;

            await dynaSend(mockInteraction as any, {
                content: "test",
                withResponse: true
            });

            expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({ withResponse: true }));
        });
    });

    describe("poll and stickers", () => {
        it("should pass poll option to channel send", async () => {
            const { dynaSend } = await import("./dynaSend.js");

            const poll = { question: "Test?", answers: ["Yes", "No"] };
            await dynaSend(mockChannel as any, { poll: poll as any });

            expect(mockChannel.send).toHaveBeenCalledWith(expect.objectContaining({ poll: poll }));
        });

        it("should pass stickers option to channel send", async () => {
            const { dynaSend } = await import("./dynaSend.js");

            const stickers = ["stickerId"] as any;
            await dynaSend(mockChannel as any, { stickers });

            expect(mockChannel.send).toHaveBeenCalledWith(expect.objectContaining({ stickers }));
        });
    });
});
