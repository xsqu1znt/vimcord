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
    LabelBuilder,
    MentionableSelectMenuBuilder,
    ModalBuilder,
    ModalSubmitInteraction,
    RoleSelectMenuBuilder,
    StringSelectMenuBuilder,
    TextInputBuilder,
    TextInputStyle,
    UserSelectMenuBuilder
} from "discord.js";
import { globalVimcordToolsConfig, VimcordToolsConfig } from "@/configs/tools.config";

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
    /** The ID of the modal, if not provided will generate a time-based ID */
    id?: string;
    /** The title of the modal */
    title?: string;
    /** Max 5 components */
    components?: BetterModalComponent[];
    config?: VimcordToolsConfig;
}

export interface ModalSubmitResult<T extends Record<string, any> = Record<string, any>> {
    /** Modal fields by custom_id */
    fields: T;
    /** Modal fields in the order components were added */
    values: any[];
    /** The modal submit interaction for replying */
    interaction: ModalSubmitInteraction;
}

function randomCharString(length: number) {
    const chars = "ABCDEFGHJKLMOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    return Array.from({ length }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join("");
}

export class BetterModal {
    id: string;
    options: BetterModalOptions;
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
        return `modal:${randomCharString(10)}-${Date.now()}`;
    }

    private createComponentId() {
        return `modal-component:${randomCharString(4)}-${Date.now().toString().slice(-4)}`;
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

    /** Show the modal via interaction */
    async show(interaction: Interaction): Promise<void> {
        if (!("showModal" in interaction)) throw new Error("Interaction does not support showing modals");
        if (!this.modal.data.title) throw new Error("Modal must have a title");
        this.build();
        await interaction.showModal(this.modal).catch(err => {
            console.error("Modal failed to send", err);
        });
    }

    /** Waits for the modal to be submitted and returns the component data
     * @param interaction The interaction used to show the modal
     * @param options Options */
    async awaitSubmit<T extends Record<string, any> = Record<string, string>>(
        interaction: Interaction,
        options?: Omit<AwaitModalSubmitOptions<ModalSubmitInteraction>, "filter">
    ): Promise<ModalSubmitResult<T> | null> {
        if (!("showModal" in interaction)) throw new Error("Interaction does not support showing modals");
        try {
            const modalSubmit = await interaction.awaitModalSubmit({
                time: this.config.timeouts.modalSubmit,
                ...options,
                filter: i => i.customId === this.id
            });

            const fields: Record<string, any> = {};
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

                fields[customId] = value;
                values.push(value);
            }

            return { fields: fields as T, values, interaction: modalSubmit };
        } catch (error) {
            return null;
        }
    }

    async showAndAwait<T extends Record<string, any> = Record<string, string>>(
        interaction: Interaction,
        options?: Omit<AwaitModalSubmitOptions<ModalSubmitInteraction>, "filter">
    ): Promise<ModalSubmitResult<T> | null> {
        if (!("showModal" in interaction)) throw new Error("Interaction does not support showing modals");
        await this.show(interaction);
        return this.awaitSubmit<T>(interaction, options);
    }
}
