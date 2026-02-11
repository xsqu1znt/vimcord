import { globalVimcordToolsConfig, VimcordToolsConfig } from "@/configs/tools.config";
import {
    APIChannelSelectComponent,
    APIFileUploadComponent,
    APIMentionableSelectComponent,
    APIModalInteractionResponseCallbackData,
    APIRoleSelectComponent,
    APIStringSelectComponent,
    APITextInputComponent,
    APIUserSelectComponent,
    AwaitModalSubmitOptions,
    ChannelSelectMenuBuilder,
    FileUploadBuilder,
    Interaction,
    InteractionDeferUpdateOptions,
    InteractionReplyOptions,
    InteractionResponse,
    LabelBuilder,
    MentionableSelectMenuBuilder,
    Message,
    MessagePayload,
    ModalBuilder,
    ModalSubmitInteraction,
    RoleSelectMenuBuilder,
    StringSelectMenuBuilder,
    TextInputBuilder,
    TextInputStyle,
    UserSelectMenuBuilder
} from "discord.js";
import { $ } from "qznt";
import { dynaSend, RequiredDynaSendOptions } from "./dynaSend";

type _TextInputComponentData = Partial<APITextInputComponent> & _LabelComponentData;
type _StringSelectComponentData = Partial<APIStringSelectComponent> & _LabelComponentData;
type _ChannelSelectComponentData = Partial<APIChannelSelectComponent> & _LabelComponentData;
type _UserSelectComponentData = Partial<APIUserSelectComponent> & _LabelComponentData;
type _RoleSelectComponentData = Partial<APIRoleSelectComponent> & _LabelComponentData;
type _MentionableSelectComponentData = Partial<APIMentionableSelectComponent> & _LabelComponentData;
type _FileUploadComponentData = Partial<APIFileUploadComponent> & _LabelComponentData;

export type BetterTextInputComponent = { textInput: _TextInputComponentData };
export type BetterStringSelectComponent = { stringSelect: _StringSelectComponentData };
export type BetterChannelSelectComponent = { channelSelect: _ChannelSelectComponentData };
export type BetterUserSelectComponent = { userSelect: _UserSelectComponentData };
export type BetterRoleSelectComponent = { roleSelect: _RoleSelectComponentData };
export type BetterMentionableSelectComponent = { mentionableSelect: _MentionableSelectComponentData };
export type BetterFileUploadSelectComponent = { fileUpload: _FileUploadComponentData };

export type BetterModalComponent =
    | BetterTextInputComponent
    | BetterStringSelectComponent
    | BetterChannelSelectComponent
    | BetterUserSelectComponent
    | BetterRoleSelectComponent
    | BetterMentionableSelectComponent
    | BetterFileUploadSelectComponent;

interface _LabelComponentData {
    label: string;
    description?: string;
}

export interface BetterModalOptions {
    /** The ID of the modal, if not provided will generate a time-based ID. */
    id?: string;
    /** The title of the modal. */
    title?: string;
    /** Max 5 components. */
    components?: BetterModalComponent[];
    /** A custom Vimcord config. */
    config?: VimcordToolsConfig;
}

export interface AwaitSubmitOptions extends Omit<AwaitModalSubmitOptions<ModalSubmitInteraction>, "filter" | "time"> {
    /** The time to wait for the modal to be submitted in milliseconds. */
    timeout?: number;
    /** Whether to automatically deferUpdate, simply closing the modal after submission. */
    autoDefer?: boolean;
}

export interface ModalSubmitResult<T extends any = any> {
    /** Gets a field by the component's custom_id. */
    getField(customId: string, required?: boolean): T | undefined;
    getField(customId: string, required: true): T;
    /** Modal fields in the order the components were added. */
    values: T[];
    /** The modal's submission interaction. */
    interaction: ModalSubmitInteraction;
    /** Replies to the interaction using DynaSend. */
    reply: (options: RequiredDynaSendOptions) => Promise<Message | null>;
    /** Defers the interaction, closing the modal. */
    deferUpdate: (options?: InteractionDeferUpdateOptions) => Promise<InteractionResponse>;
    /** Follow up the interaction. */
    followUp: (options: string | MessagePayload | InteractionReplyOptions) => Promise<Message | null>;
}

export class BetterModal {
    readonly id: string;
    readonly options: BetterModalOptions;

    private modal: ModalBuilder;
    private components = new Map<string, LabelBuilder>();
    private config: VimcordToolsConfig;

    constructor(options: BetterModalOptions = {}) {
        this.id = options.id || this.createModalId();
        this.options = options;
        this.modal = new ModalBuilder().setCustomId(this.id);
        this.config = options.config || globalVimcordToolsConfig;

        if (options.title) {
            this.setTitle(options.title);
        }

        if (options.components?.length) {
            this.addComponents(...options.components);
        }
    }

    private createModalId() {
        return `modal:${$.rnd.str(10, "alpha", { casing: "mixed" })}-${Date.now()}`;
    }

    private createComponentId() {
        return `modal-component:${this.id}-${$.rnd.str(4, "alpha", { casing: "mixed" })}-${Date.now().toString().slice(-4)}`;
    }

    private validateComponentLength() {
        if (this.components.size >= 5) throw new Error("Modal can only have 5 components");
    }

    toJSON(): APIModalInteractionResponseCallbackData {
        return this.modal.toJSON();
    }

    build(): ModalBuilder {
        this.modal.setLabelComponents(Array.from(this.components.values()));
        return this.modal;
    }

    setTitle(title: string): this {
        this.modal.setTitle(title);
        return this;
    }

    addComponents(...components: BetterModalComponent[]): this {
        for (const component of components) {
            if ("textInput" in component) {
                this.addTextInput(component.textInput);
            } else if ("stringSelect" in component) {
                this.addStringSelect(component.stringSelect);
            } else if ("channelSelect" in component) {
                this.addChannelSelect(component.channelSelect);
            } else if ("userSelect" in component) {
                this.addUserSelect(component.userSelect);
            } else if ("roleSelect" in component) {
                this.addRoleSelect(component.roleSelect);
            } else if ("mentionableSelect" in component) {
                this.addMentionableSelect(component.mentionableSelect);
            } else if ("fileUpload" in component) {
                this.addFileUpload(component.fileUpload);
            }
        }
        return this;
    }

    setComponents(...components: BetterModalComponent[]): this {
        this.modal.spliceLabelComponents(0, this.modal.components.length);
        this.addComponents(...components);
        return this;
    }

    addTextInput(data: _TextInputComponentData): this {
        this.validateComponentLength();
        let { label, description, custom_id, ...rest } = data;
        custom_id ||= this.createComponentId();
        const textInputComponent = new TextInputBuilder(rest).setCustomId(custom_id);
        if (!rest.style) textInputComponent.setStyle(TextInputStyle.Short);
        const labelComponent = new LabelBuilder().setLabel(label).setTextInputComponent(textInputComponent);
        if (description) labelComponent.setDescription(description);
        this.components.set(custom_id, labelComponent);
        return this;
    }

    addStringSelect(data: _StringSelectComponentData): this {
        this.validateComponentLength();
        let { label, description, custom_id, ...rest } = data;
        custom_id ||= this.createComponentId();
        const stringSelectComponent = new StringSelectMenuBuilder(rest).setCustomId(custom_id);
        const labelComponent = new LabelBuilder().setLabel(label).setStringSelectMenuComponent(stringSelectComponent);
        if (description) labelComponent.setDescription(description);
        this.components.set(custom_id, labelComponent);
        return this;
    }

    addChannelSelect(data: _ChannelSelectComponentData): this {
        this.validateComponentLength();
        let { label, description, custom_id, ...rest } = data;
        custom_id ||= this.createComponentId();
        const channelSelectComponent = new ChannelSelectMenuBuilder(rest).setCustomId(custom_id);
        const labelComponent = new LabelBuilder().setLabel(label).setChannelSelectMenuComponent(channelSelectComponent);
        if (description) labelComponent.setDescription(description);
        this.components.set(custom_id, labelComponent);
        return this;
    }

    addUserSelect(data: _UserSelectComponentData): this {
        this.validateComponentLength();
        let { label, description, custom_id, ...rest } = data;
        custom_id ||= this.createComponentId();
        const userSelectComponent = new UserSelectMenuBuilder(rest).setCustomId(custom_id);
        const labelComponent = new LabelBuilder().setLabel(label).setUserSelectMenuComponent(userSelectComponent);
        if (description) labelComponent.setDescription(description);
        this.components.set(custom_id, labelComponent);
        return this;
    }

    addRoleSelect(data: _RoleSelectComponentData): this {
        this.validateComponentLength();
        let { label, description, custom_id, ...rest } = data;
        custom_id ||= this.createComponentId();
        const roleSelectComponent = new RoleSelectMenuBuilder(rest).setCustomId(custom_id);
        const labelComponent = new LabelBuilder().setLabel(label).setRoleSelectMenuComponent(roleSelectComponent);
        if (description) labelComponent.setDescription(description);
        this.components.set(custom_id, labelComponent);
        return this;
    }

    addMentionableSelect(data: _MentionableSelectComponentData): this {
        this.validateComponentLength();
        let { label, description, custom_id, ...rest } = data;
        custom_id ||= this.createComponentId();
        const mentionableSelectComponent = new MentionableSelectMenuBuilder(rest).setCustomId(custom_id);
        const labelComponent = new LabelBuilder()
            .setLabel(label)
            .setMentionableSelectMenuComponent(mentionableSelectComponent);
        if (description) labelComponent.setDescription(description);
        this.components.set(custom_id, labelComponent);
        return this;
    }

    addFileUpload(data: _FileUploadComponentData): this {
        this.validateComponentLength();
        let { label, description, custom_id, ...rest } = data;
        custom_id ||= this.createComponentId();
        const fileUploadComponent = new FileUploadBuilder(rest).setCustomId(custom_id);
        const labelComponent = new LabelBuilder().setLabel(label).setFileUploadComponent(fileUploadComponent);
        if (description) labelComponent.setDescription(description);
        this.components.set(custom_id, labelComponent);
        return this;
    }

    /**
     * Shows the modal via interaction.
     * @param interaction The interaction used to show the modal
     */
    async show(interaction: Interaction): Promise<void> {
        if (!("showModal" in interaction)) throw new Error("Interaction does not support showing modals");
        if (!this.modal.data.title) throw new Error("Modal must have a title");
        this.build();
        await interaction.showModal(this.modal).catch(err => {
            console.error("Modal failed to send", err);
        });
    }

    /**
     * Waits for the modal to be submitted and returns the component data.
     * @param interaction The interaction used to show the modal
     * @param options Options */
    async awaitSubmit<T extends any = any>(
        interaction: Interaction,
        options?: AwaitSubmitOptions
    ): Promise<ModalSubmitResult<T> | null> {
        if (!("showModal" in interaction)) throw new Error("Interaction does not support showing modals");
        try {
            const modalSubmit = await interaction.awaitModalSubmit({
                filter: i => i.customId === this.id,
                time: options?.timeout ?? this.config.timeouts.modalSubmit,
                ...options
            });

            if (options?.autoDefer) {
                await modalSubmit.deferUpdate();
            }

            const fields = new Map<string, any>();
            const values: any[] = [];

            // Iterate in order
            for (const [customId] of this.components) {
                let value: any = null;

                try {
                    // Try text input
                    value = modalSubmit.fields.getTextInputValue(customId);
                } catch {
                    try {
                        // Try to get field from fields map
                        const field = modalSubmit.fields.fields.get(customId);
                        if (field && "values" in field) {
                            value = field.values;
                        }
                    } catch {}
                }

                fields.set(customId, value);
                values.push(value);
            }

            return {
                getField<T extends any>(customId: string, required?: boolean): T {
                    const value = fields.get(customId);
                    if (required && value === undefined) {
                        throw new Error(`ModalSubmitResult: Field ${customId} is required but was not found`);
                    }
                    return value;
                },
                values,
                interaction: modalSubmit,
                reply: (options: RequiredDynaSendOptions) => dynaSend(modalSubmit, options),
                deferUpdate: async (options?: InteractionDeferUpdateOptions) => await modalSubmit.deferUpdate(options),
                followUp: async (options: string | MessagePayload | InteractionReplyOptions) =>
                    await modalSubmit.followUp(options)
            };
        } catch (error) {
            return null;
        }
    }

    /**
     * Shows the modal and waits for the modal to be submitted, returning the component data.
     * @param interaction The interaction used to show the modal
     * @param options Options */
    async showAndAwait<T extends any = any>(
        interaction: Interaction,
        options?: AwaitSubmitOptions
    ): Promise<ModalSubmitResult<T> | null> {
        await this.show(interaction);
        return this.awaitSubmit<T>(interaction, options);
    }
}
