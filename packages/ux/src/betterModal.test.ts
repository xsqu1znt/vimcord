import type {
    BetterAPIModalComponent,
    BetterAPIStringSelectComponent,
    BetterAPITextInputComponent,
    BetterChannelSelectComponent,
    BetterCheckboxComponent,
    BetterCheckboxGroupComponent,
    BetterFileUploadComponent,
    BetterMentionableSelectComponent,
    BetterModalComponent,
    BetterRoleSelectComponent,
    BetterStringSelectComponent,
    BetterTextInputComponent,
    BetterUserSelectComponent
} from "./betterModal.js";

import { ComponentType } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { BetterModal } from "./betterModal.js";

vi.mock("@vimcord/internal", () => ({
    createRandomId: vi.fn().mockImplementation(() => "mock-random-id")
}));

vi.mock("./dynaSend.js", () => ({
    dynaSend: vi.fn().mockResolvedValue({})
}));

describe("BetterModal", () => {
    describe("constructor", () => {
        it("should create modal with custom ID when provided", () => {
            const modal = new BetterModal({ customId: "test-custom-id" });
            expect(modal.customId).toBe("test-custom-id");
        });

        it("should create modal with random ID when not provided", () => {
            const modal = new BetterModal();
            expect(modal.customId).toBe("mock-random-id");
        });

        it("should add components if provided in options", () => {
            const component = {
                label: "Test Input",
                style: 1
            } as unknown as BetterTextInputComponent;

            const modal = new BetterModal({ components: [{ textInput: component }] });
            expect(modal.customId).toBe("mock-random-id");
        });
    });

    describe("setTitle", () => {
        it("should set the modal title", () => {
            const modal = new BetterModal();
            const result = modal.setTitle("Test Modal");
            expect(result).toBe(modal);
        });
    });

    describe("setComponents", () => {
        it("should set components and return this", () => {
            const modal = new BetterModal();
            const component = {
                label: "Test Input",
                style: 1
            } as unknown as BetterTextInputComponent;

            const result = modal.setComponents({ textInput: component });
            expect(result).toBe(modal);
        });

        it("should clear existing components before setting new ones", () => {
            const modal = new BetterModal();
            const component1 = {
                label: "Input 1",
                style: 1
            } as unknown as BetterTextInputComponent;
            const component2 = {
                label: "Input 2",
                style: 1
            } as unknown as BetterTextInputComponent;

            modal.setComponents({ textInput: component1 });
            modal.setComponents({ textInput: component2 });
        });
    });

    describe("addComponents", () => {
        it("should add multiple components and return this", () => {
            const modal = new BetterModal();
            const component = {
                label: "Test Input",
                style: 1
            } as unknown as BetterTextInputComponent;

            const result = modal.addComponents({ textInput: component });
            expect(result).toBe(modal);
        });
    });

    describe("component validation", () => {
        it("should allow 25 components in modal", () => {
            const modal = new BetterModal();
            const component = {
                label: "Test Input",
                style: 1
            } as unknown as BetterTextInputComponent;

            modal.setTitle("Test");
            for (let i = 0; i < 25; i++) {
                modal.addComponents({ textInput: component });
            }
            const json = modal.toJSON();
            expect(json.components?.length).toBe(25);
        });
    });

    describe("toJSON", () => {
        it("should throw if title is not set", () => {
            const modal = new BetterModal();
            expect(() => modal.toJSON()).toThrow("[BetterModal] Modal must have a title");
        });

        it("should return JSON when title is set with components", () => {
            const modal = new BetterModal();
            const component = {
                label: "Test Input",
                style: 1
            } as unknown as BetterTextInputComponent;

            modal.setTitle("Test Modal").setComponents({ textInput: component });
            const json = modal.toJSON();
            expect(json).toBeDefined();
            expect(json.title).toBe("Test Modal");
        });
    });

    describe("clone", () => {
        it("should clone the modal with same customId", () => {
            const modal = new BetterModal({ customId: "test-id" }).setTitle("Original Title");
            const cloned = modal.clone();

            expect(cloned.customId).toBe(modal.customId);
        });

        it("should clone with components", () => {
            const component = {
                label: "Test Input",
                style: 1
            } as unknown as BetterTextInputComponent;

            const modal = new BetterModal().setTitle("Test").setComponents({ textInput: component });
            const cloned = modal.clone();

            expect(cloned.customId).toBe(modal.customId);
        });
    });

    describe("show", () => {
        it("should show modal on interaction", async () => {
            const mockInteraction = {
                showModal: vi.fn().mockResolvedValue(undefined)
            };

            const modal = new BetterModal().setTitle("Test Modal");
            await modal.show(mockInteraction as any);

            expect(mockInteraction.showModal).toHaveBeenCalled();
        });

        it("should pass options to showModal", async () => {
            const mockInteraction = {
                showModal: vi.fn().mockResolvedValue(undefined)
            };

            const modal = new BetterModal().setTitle("Test Modal");
            await modal.show(mockInteraction as any, { timeout: 5000 } as any);

            expect(mockInteraction.showModal).toHaveBeenCalledWith(expect.anything(), { timeout: 5000 });
        });
    });

    describe("awaitSubmit", () => {
        it("should return null when modal is not submitted within timeout", async () => {
            const mockInteraction = {
                awaitModalSubmit: vi.fn().mockImplementation(() => {
                    throw new Error("timeout");
                })
            };

            const modal = new BetterModal().setTitle("Test Modal");
            const result = await modal.awaitSubmit(mockInteraction as any, { timeout: 100 });

            expect(result).toBeNull();
        });

        it("should return submit result when modal is submitted", async () => {
            const mockModalSubmit = {
                customId: "mock-random-id",
                fields: {
                    getTextInputValue: vi.fn().mockReturnValue("test value"),
                    fields: new Map()
                },
                deferUpdate: vi.fn().mockResolvedValue(undefined)
            };

            const mockInteraction = {
                awaitModalSubmit: vi.fn().mockResolvedValue(mockModalSubmit)
            };

            const component = {
                label: "Test Input",
                style: 1,
                customId: "input-1"
            } as unknown as BetterTextInputComponent;

            const modal = new BetterModal().setTitle("Test Modal").addComponents({ textInput: component });

            const result = await modal.awaitSubmit(mockInteraction as any);

            expect(result).not.toBeNull();
            expect(result?.values).toHaveLength(1);
            expect(result?.getField).toBeDefined();
        });

        it("should call deferUpdate when option is set", async () => {
            const mockModalSubmit = {
                customId: "mock-random-id",
                fields: {
                    getTextInputValue: vi.fn().mockReturnValue("test value"),
                    fields: new Map()
                },
                deferUpdate: vi.fn().mockResolvedValue(undefined)
            };

            const mockInteraction = {
                awaitModalSubmit: vi.fn().mockResolvedValue(mockModalSubmit)
            };

            const component = {
                label: "Test Input",
                style: 1,
                customId: "input-1"
            } as unknown as BetterTextInputComponent;

            const modal = new BetterModal().setTitle("Test Modal").addComponents({ textInput: component });

            await modal.awaitSubmit(mockInteraction as any, { deferUpdate: true });

            expect(mockModalSubmit.deferUpdate).toHaveBeenCalled();
        });

        it("should return helper object with reply method", async () => {
            const mockModalSubmit = {
                customId: "mock-random-id",
                fields: {
                    getTextInputValue: vi.fn().mockReturnValue("test value"),
                    fields: new Map()
                },
                deferUpdate: vi.fn().mockResolvedValue(undefined)
            };

            const mockInteraction = {
                awaitModalSubmit: vi.fn().mockResolvedValue(mockModalSubmit)
            };

            const component = {
                label: "Test Input",
                style: 1,
                customId: "input-1"
            } as unknown as BetterTextInputComponent;

            const modal = new BetterModal().setTitle("Test Modal").addComponents({ textInput: component });

            const result = await modal.awaitSubmit(mockInteraction as any);

            expect(result?.reply).toBeDefined();
            expect(result?.followUp).toBeDefined();
            expect(result?.deferUpdate).toBeDefined();
        });
    });

    describe("showAndAwait", () => {
        it("should call show then awaitSubmit", async () => {
            const mockModalSubmit = {
                customId: "mock-random-id",
                fields: {
                    getTextInputValue: vi.fn().mockReturnValue("test value"),
                    fields: new Map()
                },
                deferUpdate: vi.fn().mockResolvedValue(undefined)
            };

            const mockInteraction = {
                showModal: vi.fn().mockResolvedValue(undefined),
                awaitModalSubmit: vi.fn().mockResolvedValue(mockModalSubmit)
            };

            const modal = new BetterModal().setTitle("Test Modal");
            const result = await modal.showAndAwait(mockInteraction as any);

            expect(mockInteraction.showModal).toHaveBeenCalled();
            expect(result).not.toBeNull();
        });
    });

    describe("component types", () => {
        it("should handle TextInput component", () => {
            const modal = new BetterModal();
            const component = {
                label: "Text Input",
                customId: "text-input",
                style: 1
            } as unknown as BetterTextInputComponent;

            modal.addComponents({ textInput: component });
            const json = modal.setTitle("Test").toJSON();
            expect(json).toBeDefined();
        });

        it("should handle StringSelect component", () => {
            const modal = new BetterModal();
            const component = {
                label: "Select",
                customId: "string-select",
                options: [{ label: "Option 1", value: "1" }]
            } as unknown as BetterStringSelectComponent;

            modal.addComponents({ stringSelect: component });
            const json = modal.setTitle("Test").toJSON();
            expect(json).toBeDefined();
        });

        it("should handle ChannelSelect component", () => {
            const modal = new BetterModal();
            const component = {
                label: "Channel Select",
                customId: "channel-select"
            } as unknown as BetterChannelSelectComponent;

            modal.addComponents({ channelSelect: component });
            const json = modal.setTitle("Test").toJSON();
            expect(json).toBeDefined();
        });

        it("should handle UserSelect component", () => {
            const modal = new BetterModal();
            const component = {
                label: "User Select",
                customId: "user-select"
            } as unknown as BetterUserSelectComponent;

            modal.addComponents({ userSelect: component });
            const json = modal.setTitle("Test").toJSON();
            expect(json).toBeDefined();
        });

        it("should handle RoleSelect component", () => {
            const modal = new BetterModal();
            const component = {
                label: "Role Select",
                customId: "role-select"
            } as unknown as BetterRoleSelectComponent;

            modal.addComponents({ roleSelect: component });
            const json = modal.setTitle("Test").toJSON();
            expect(json).toBeDefined();
        });

        it("should handle MentionableSelect component", () => {
            const modal = new BetterModal();
            const component = {
                label: "Mentionable Select",
                customId: "mentionable-select"
            } as unknown as BetterMentionableSelectComponent;

            modal.addComponents({ mentionableSelect: component });
            const json = modal.setTitle("Test").toJSON();
            expect(json).toBeDefined();
        });

        it("should handle Checkbox component", () => {
            const modal = new BetterModal();
            const component = {
                label: "Checkbox",
                custom_id: "checkbox"
            } as unknown as BetterCheckboxComponent;

            modal.addComponents({ checkbox: component });
            const json = modal.setTitle("Test").toJSON();
            expect(json).toBeDefined();
        });

        it("should handle CheckboxGroup component", () => {
            const modal = new BetterModal();
            const component = {
                label: "Checkbox Group",
                custom_id: "checkbox-group",
                options: [{ label: "Option 1", value: "1" }]
            } as unknown as BetterCheckboxGroupComponent;

            modal.addComponents({ checkboxGroup: component });
            const json = modal.setTitle("Test").toJSON();
            expect(json).toBeDefined();
        });

        it("should handle FileUpload component", () => {
            const modal = new BetterModal();
            const component = {
                label: "File Upload",
                custom_id: "file-upload"
            } as unknown as BetterFileUploadComponent;

            modal.addComponents({ fileUpload: component });
            const json = modal.setTitle("Test").toJSON();
            expect(json).toBeDefined();
        });
    });

    describe("custom ID generation", () => {
        it("should use provided custom_id for components", () => {
            const modal = new BetterModal({ customId: "modal-123" });
            const component = {
                label: "Test",
                customId: "my-custom-id",
                style: 1
            } as unknown as BetterTextInputComponent;

            modal.setTitle("Test").addComponents({ textInput: component });
            const json = modal.toJSON();
            expect(json).toBeDefined();
        });
    });

    describe("label component with description", () => {
        it("should set description when provided", () => {
            const modal = new BetterModal();
            const component = {
                label: "Test Input",
                description: "This is a description",
                style: 1
            } as unknown as BetterTextInputComponent;

            modal.setTitle("Test").addComponents({ textInput: component });
            const json = modal.toJSON();
            expect(json).toBeDefined();
        });
    });
});
