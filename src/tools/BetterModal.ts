import type {
    APICheckboxComponent,
    APICheckboxGroupComponent,
    APIFileUploadComponent,
    APIModalInteractionResponseCallbackData,
    APIRadioGroupComponent,
    ChannelSelectMenuComponentData,
    CommandInteraction,
    MentionableSelectMenuComponentData,
    MessageComponentInteraction,
    RoleSelectMenuComponentData,
    ShowModalOptions,
    StringSelectMenuComponentData,
    TextInputComponentData,
    UserSelectMenuComponentData
} from "discord.js";
import type { RequiredDynaSendOptions } from "./dynaSend.js";

import {
    ChannelSelectMenuBuilder,
    CheckboxBuilder,
    CheckboxGroupBuilder,
    FileUploadBuilder,
    LabelBuilder,
    MentionableSelectMenuBuilder,
    Message,
    ModalBuilder,
    ModalSubmitInteraction,
    RadioGroupBuilder,
    RoleSelectMenuBuilder,
    StringSelectMenuBuilder,
    TextInputBuilder,
    TextInputStyle,
    UserSelectMenuBuilder
} from "discord.js";
import { dynaSend } from "./dynaSend.js";

interface LabelComponentOptions {
    label: string;
    description?: string;
}

export type BetterAPITextInputComponent = { textInput: BetterTextInputComponent };
export type BetterAPICheckboxComponent = { checkbox: BetterCheckboxComponent };
export type BetterAPICheckboxGroupComponent = { checkboxGroup: BetterCheckboxGroupComponent };
export type BetterAPIRadioGroupComponent = { radioGroup: BetterRadioGroupComponent };
export type BetterAPIStringSelectComponent = { stringSelect: BetterStringSelectComponent };
export type BetterAPIChannelSelectComponent = { channelSelect: BetterChannelSelectComponent };
export type BetterAPIUserSelectComponent = { userSelect: BetterUserSelectComponent };
export type BetterAPIRoleSelectComponent = { roleSelect: BetterRoleSelectComponent };
export type BetterAPIMentionableSelectComponent = { mentionableSelect: BetterMentionableSelectComponent };
export type BetterAPIFileUploadComponent = { fileUpload: BetterFileUploadComponent };

export type BetterAPIModalComponent =
    | BetterAPITextInputComponent
    | BetterAPICheckboxComponent
    | BetterAPICheckboxGroupComponent
    | BetterAPIRadioGroupComponent
    | BetterAPIStringSelectComponent
    | BetterAPIChannelSelectComponent
    | BetterAPIUserSelectComponent
    | BetterAPIRoleSelectComponent
    | BetterAPIMentionableSelectComponent
    | BetterAPIFileUploadComponent;

export type BetterTextInputComponent = Partial<TextInputComponentData> & LabelComponentOptions;
export type BetterCheckboxComponent = Partial<APICheckboxComponent> & LabelComponentOptions;
export type BetterCheckboxGroupComponent = Partial<APICheckboxGroupComponent> & LabelComponentOptions;
export type BetterRadioGroupComponent = Partial<APIRadioGroupComponent> & LabelComponentOptions;
export type BetterStringSelectComponent = Partial<StringSelectMenuComponentData> & LabelComponentOptions;
export type BetterChannelSelectComponent = Partial<ChannelSelectMenuComponentData> & LabelComponentOptions;
export type BetterUserSelectComponent = Partial<UserSelectMenuComponentData> & LabelComponentOptions;
export type BetterRoleSelectComponent = Partial<RoleSelectMenuComponentData> & LabelComponentOptions;
export type BetterMentionableSelectComponent = Partial<MentionableSelectMenuComponentData> & LabelComponentOptions;
export type BetterFileUploadComponent = Partial<APIFileUploadComponent> & LabelComponentOptions;

export type BetterModalComponent =
    | BetterTextInputComponent
    | BetterCheckboxComponent
    | BetterCheckboxGroupComponent
    | BetterRadioGroupComponent
    | BetterStringSelectComponent
    | BetterChannelSelectComponent
    | BetterUserSelectComponent
    | BetterRoleSelectComponent
    | BetterMentionableSelectComponent
    | BetterFileUploadComponent;

export type ModalShowableInteraction = CommandInteraction | MessageComponentInteraction;

export interface BetterModalOptions {
    customId?: string;
    title?: string;
    components?: BetterAPIModalComponent[];
}

export interface AwaitModalSubmitOptions {
    timeout?: number;
    deferUpdate?: boolean;
}

export interface BetterModalSubmitResult<T = unknown> {
    values: T[];
    interaction: ModalSubmitInteraction;
    getField(customId: string, required: true): T;
    getField(customId: string, required?: boolean): T | undefined;
    reply: (options: RequiredDynaSendOptions) => Promise<Message | null>;
    followUp: (options: RequiredDynaSendOptions) => Promise<Message | null>;
    deferUpdate: () => ReturnType<ModalSubmitInteraction["deferUpdate"]>;
}

// TODO: Will eventually come from global config
const DEFAULT_CONFIG = {
    timeout: 60_000
} as const;

function createRandomId(): string {
    return `v-${Math.random().toString(36).split(".")[1]!}`;
}

export class BetterModal {
    readonly customId: string;

    private components: Map<string, BetterAPIModalComponent> = new Map();
    private labelComponents: LabelBuilder[] = [];
    private modal: ModalBuilder;

    constructor(options?: BetterModalOptions) {
        this.customId = options?.customId ?? createRandomId();
        this.modal = new ModalBuilder().setCustomId(this.customId);

        if (options?.title) this.setTitle(options.title);
        if (options?.components?.length) this.addComponents(...options.components);
    }

    private validateComponentLength(): void {
        if ((this.components.size ?? 0) >= 25) {
            throw new Error("[BetterModal] Modal can only have 25 components");
        }
    }

    private createComponentId(): string {
        return `${this.customId}:${createRandomId()}`;
    }

    private createLabelComponent(data: LabelComponentOptions): LabelBuilder {
        const component = new LabelBuilder().setLabel(data.label);
        if (data.description) component.setDescription(data.description);
        return component;
    }

    private build(): ModalBuilder {
        if (!this.modal.data.title) throw new Error("[BetterModal] Modal must have a title");
        this.modal.setLabelComponents(this.labelComponents);
        return this.modal;
    }

    clone(): BetterModal {
        return new BetterModal({
            customId: this.customId,
            title: this.modal.data.title,
            components: Array.from(this.components.values())
        });
    }

    toJSON(): APIModalInteractionResponseCallbackData {
        return this.build().toJSON();
    }

    /**
     * Sets the title of the modal.
     * @param title The title of the modal.
     */
    setTitle(title: string): this {
        this.modal.setTitle(title);
        return this;
    }

    /** Sets components for the modal. */
    setComponents(...components: BetterAPIModalComponent[]): this {
        this.components.clear();
        this.labelComponents = [];
        this.addComponents(...components);
        return this;
    }

    /** Adds components to the modal. */
    addComponents(...components: BetterAPIModalComponent[]): this {
        for (const component of components) {
            if ("textInput" in component) {
                this.addTextInput(component.textInput);
            } else if ("checkbox" in component) {
                this.addCheckbox(component.checkbox);
            } else if ("checkboxGroup" in component) {
                this.addCheckboxGroup(component.checkboxGroup);
            } else if ("radioGroup" in component) {
                this.addRadioGroup(component.radioGroup);
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

    addTextInput(data: BetterTextInputComponent): this {
        this.validateComponentLength();

        const customId = data.customId ?? this.createComponentId();
        const { label: _, ...textInputData } = data;
        const textInput = new TextInputBuilder({ style: TextInputStyle.Short, required: false, ...textInputData, customId });
        const label = this.createLabelComponent(data);
        label.setTextInputComponent(textInput);

        this.components.set(customId, { textInput: data });
        this.labelComponents.push(label);

        return this;
    }

    addStringSelect(data: BetterStringSelectComponent): this {
        this.validateComponentLength();

        const customId = data.customId ?? this.createComponentId();
        const select = new StringSelectMenuBuilder({ ...data, customId });
        const label = this.createLabelComponent(data);
        label.setStringSelectMenuComponent(select);

        this.components.set(customId, { stringSelect: data });
        this.labelComponents.push(label);

        return this;
    }

    addCheckbox(data: BetterCheckboxComponent): this {
        this.validateComponentLength();

        const customId = data.custom_id ?? this.createComponentId();
        const checkbox = new CheckboxBuilder({ ...data, custom_id: customId });
        const label = this.createLabelComponent(data);
        label.setCheckboxComponent(checkbox);

        this.components.set(customId, { checkbox: data });
        this.labelComponents.push(label);

        return this;
    }

    addCheckboxGroup(data: BetterCheckboxGroupComponent): this {
        this.validateComponentLength();

        const customId = data.custom_id ?? this.createComponentId();
        const checkboxGroup = new CheckboxGroupBuilder({ ...data, custom_id: customId });
        const label = this.createLabelComponent(data);
        label.setCheckboxGroupComponent(checkboxGroup);

        this.components.set(customId, { checkboxGroup: data });
        this.labelComponents.push(label);

        return this;
    }

    addRadioGroup(data: BetterRadioGroupComponent): this {
        this.validateComponentLength();

        const customId = data.custom_id ?? this.createComponentId();
        const radioGroup = new RadioGroupBuilder({ ...data, custom_id: customId });
        const label = this.createLabelComponent(data);
        label.setRadioGroupComponent(radioGroup);

        this.components.set(customId, { radioGroup: data });
        this.labelComponents.push(label);

        return this;
    }

    addChannelSelect(data: BetterChannelSelectComponent): this {
        this.validateComponentLength();

        const customId = data.customId ?? this.createComponentId();
        const channelSelect = new ChannelSelectMenuBuilder({ ...data, customId });
        const label = this.createLabelComponent(data);
        label.setChannelSelectMenuComponent(channelSelect);

        this.components.set(customId, { channelSelect: data });
        this.labelComponents.push(label);

        return this;
    }

    addUserSelect(data: BetterUserSelectComponent): this {
        this.validateComponentLength();

        const customId = data.customId ?? this.createComponentId();
        const userSelect = new UserSelectMenuBuilder({ ...data, customId });
        const label = this.createLabelComponent(data);
        label.setUserSelectMenuComponent(userSelect);

        this.components.set(customId, { userSelect: data });
        this.labelComponents.push(label);

        return this;
    }

    addRoleSelect(data: BetterRoleSelectComponent): this {
        this.validateComponentLength();

        const customId = data.customId ?? this.createComponentId();
        const roleSelect = new RoleSelectMenuBuilder({ ...data, customId });
        const label = this.createLabelComponent(data);
        label.setRoleSelectMenuComponent(roleSelect);

        this.components.set(customId, { roleSelect: data });
        this.labelComponents.push(label);

        return this;
    }

    addMentionableSelect(data: BetterMentionableSelectComponent): this {
        this.validateComponentLength();

        const customId = data.customId ?? this.createComponentId();
        const mentionableSelect = new MentionableSelectMenuBuilder({ ...data, customId });
        const label = this.createLabelComponent(data);
        label.setMentionableSelectMenuComponent(mentionableSelect);

        this.components.set(customId, { mentionableSelect: data });
        this.labelComponents.push(label);

        return this;
    }

    addFileUpload(data: BetterFileUploadComponent): this {
        this.validateComponentLength();

        const customId = data.custom_id ?? this.createComponentId();
        const fileUpload = new FileUploadBuilder({ ...data, custom_id: customId });
        const label = this.createLabelComponent(data);
        label.setFileUploadComponent(fileUpload);

        this.components.set(customId, { fileUpload: data });
        this.labelComponents.push(label);

        return this;
    }

    /**
     * Shows the modal to the user via interaction.
     * @param interaction The command interaction to show the modal with.
     * @param options Modal options.
     */
    async show(
        interaction: ModalShowableInteraction | null | undefined,
        options?: Required<ShowModalOptions>
    ): Promise<void> {
        if (!interaction) throw new Error("[BetterModal] Interaction is null or undefined");
        const modal = this.build();
        await interaction.showModal(modal, options);
    }

    /**
     * Shows the modal and waits for it to be submitted.
     * @param interaction The interaction to show the modal with.
     * @param options Modal submission options.
     */
    async showAndAwait<T = unknown>(
        interaction: ModalShowableInteraction | null | undefined,
        options?: AwaitModalSubmitOptions
    ): Promise<BetterModalSubmitResult<T> | null> {
        await this.show(interaction);
        return this.awaitSubmit<T>(interaction, options);
    }

    /**
     * Waits for this modal to be submitted, returning a helper utility object.
     * @param interaction The interaction to show the modal with.
     * @param options Modal submission options.
     */
    async awaitSubmit<T = unknown>(
        interaction: ModalShowableInteraction | null | undefined,
        options?: AwaitModalSubmitOptions
    ): Promise<BetterModalSubmitResult<T> | null> {
        if (!interaction) throw new Error("[BetterModal] Interaction is null or undefined");
        const timeout = options?.timeout ?? DEFAULT_CONFIG.timeout;

        try {
            const modalSubmit = await interaction.awaitModalSubmit({
                filter: i => i.customId === this.customId,
                time: timeout
            });

            if (options?.deferUpdate) {
                await modalSubmit.deferUpdate();
            }

            const fields = new Map<string, unknown>();
            const values: unknown[] = [];

            for (const customId of this.components.keys()) {
                let value: unknown = null;

                try {
                    value = modalSubmit.fields.getTextInputValue(customId);
                } catch {
                    try {
                        const field = modalSubmit.fields.fields.get(customId);
                        if (field && "values" in field) {
                            value = field.values;
                        }
                    } catch {
                        // NOTE: Field not found, leave as null
                    }
                }

                fields.set(customId, value);
                values.push(value);
            }

            return {
                values: values as T[],
                interaction: modalSubmit,
                getField: customId => fields.get(customId) as T,
                reply: options => dynaSend(modalSubmit, options),
                followUp: async options => dynaSend(modalSubmit, options),
                deferUpdate: () => modalSubmit.deferUpdate()
            };
        } catch {
            return null;
        }
    }
}
