import type {
    APICheckboxComponent,
    APICheckboxGroupComponent,
    APIFileUploadComponent,
    APIModalInteractionResponseCallbackData,
    APIRadioGroupComponent,
    ChannelSelectMenuComponentData,
    CommandInteraction,
    InteractionDeferReplyOptions,
    InteractionDeferUpdateOptions,
    MentionableSelectMenuComponentData,
    MessageComponentInteraction,
    ModalSubmitFields,
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
    ComponentType,
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
import { createRandomId } from "@/utils/str.js";
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
    timeout: number;
    deferUpdate?: boolean;
}

/** Discord.js modal field getters supported by the dynamic `getField` helper. */
export type BetterModalFieldGetter =
    | "getTextInputValue"
    | "getStringSelectValues"
    | "getSelectedUsers"
    | "getSelectedMembers"
    | "getSelectedChannels"
    | "getSelectedRoles"
    | "getSelectedMentionables"
    | "getUploadedFiles"
    | "getRadioGroup"
    | "getCheckboxGroup"
    | "getCheckbox";

/** Simplified values returned for each supported modal component type. */
export interface BetterModalFieldValueMap {
    /** Text input value. */
    [ComponentType.TextInput]: ReturnType<ModalSubmitFields["getTextInputValue"]>;
    /** Selected string values. */
    [ComponentType.StringSelect]: ReturnType<ModalSubmitFields["getStringSelectValues"]>;
    /** Selected users. */
    [ComponentType.UserSelect]: ReturnType<ModalSubmitFields["getSelectedUsers"]>;
    /** Selected roles. */
    [ComponentType.RoleSelect]: ReturnType<ModalSubmitFields["getSelectedRoles"]>;
    /** Selected channels. */
    [ComponentType.ChannelSelect]: ReturnType<ModalSubmitFields["getSelectedChannels"]>;
    /** Selected users, members, and roles. */
    [ComponentType.MentionableSelect]: ReturnType<ModalSubmitFields["getSelectedMentionables"]>;
    /** Uploaded files. */
    [ComponentType.FileUpload]: ReturnType<ModalSubmitFields["getUploadedFiles"]>;
    /** Selected radio value. */
    [ComponentType.RadioGroup]: ReturnType<ModalSubmitFields["getRadioGroup"]>;
    /** Selected checkbox-group values. */
    [ComponentType.CheckboxGroup]: ReturnType<ModalSubmitFields["getCheckboxGroup"]>;
    /** Checkbox state. */
    [ComponentType.Checkbox]: ReturnType<ModalSubmitFields["getCheckbox"]>;
}

/** Modal component types supported by the simplified field helper. */
export type BetterModalFieldType = keyof BetterModalFieldValueMap;

type ModalFieldGetterArgs<Getter extends BetterModalFieldGetter> = ModalSubmitFields[Getter] extends (
    customId: string,
    ...args: infer Args
) => unknown
    ? Args
    : never;

/** Helpers and parsed values returned after a BetterModal submission. */
export interface BetterModalSubmitResult {
    /** Simplified values for every component in insertion order. */
    values: unknown[];
    /** The original Discord.js modal submission interaction. */
    interaction: ModalSubmitInteraction;
    /** Gets a simplified field value and optionally requires a non-empty result. */
    getField<T = unknown>(customId: string, required: true): T;
    getField<T = unknown>(customId: string, required?: boolean): T | undefined;
    /** Gets a simplified value while validating the Discord component type. */
    getField<Type extends BetterModalFieldType>(
        customId: string,
        type: Type,
        required: true
    ): NonNullable<BetterModalFieldValueMap[Type]>;
    getField<Type extends BetterModalFieldType>(
        customId: string,
        type: Type,
        required?: boolean
    ): BetterModalFieldValueMap[Type];
    /** Calls one of Discord.js's typed modal field getters without accessing `interaction.fields` directly. */
    getField<Getter extends BetterModalFieldGetter>(
        customId: string,
        getter: Getter,
        ...args: ModalFieldGetterArgs<Getter>
    ): ReturnType<ModalSubmitFields[Getter]>;
    /** Replies to the modal submission. */
    reply: (options: RequiredDynaSendOptions) => Promise<Message | null>;
    /** Sends a follow-up to the modal submission. */
    followUp: (options: RequiredDynaSendOptions) => Promise<Message | null>;
    /** Defers an update response to the modal submission. */
    deferUpdate: (options?: InteractionDeferUpdateOptions) => ReturnType<ModalSubmitInteraction["deferUpdate"]>;
    /** Defers a reply to the modal submission. */
    deferReply: (options?: InteractionDeferReplyOptions) => ReturnType<ModalSubmitInteraction["deferReply"]>;
}

function getSimplifiedFieldValue(
    fields: ModalSubmitFields,
    customId: string,
    type?: BetterModalFieldType,
    required: boolean = false
): unknown {
    const field = fields.getField(customId, type);

    switch (field.type) {
        case ComponentType.TextInput:
            return fields.getTextInputValue(customId);
        case ComponentType.StringSelect:
            return fields.getStringSelectValues(customId);
        case ComponentType.UserSelect:
            return fields.getSelectedUsers(customId, required);
        case ComponentType.RoleSelect:
            return fields.getSelectedRoles(customId, required);
        case ComponentType.ChannelSelect:
            return fields.getSelectedChannels(customId, required);
        case ComponentType.MentionableSelect:
            return fields.getSelectedMentionables(customId, required);
        case ComponentType.FileUpload:
            return fields.getUploadedFiles(customId, required);
        case ComponentType.RadioGroup:
            return fields.getRadioGroup(customId, required);
        case ComponentType.CheckboxGroup:
            return fields.getCheckboxGroup(customId);
        case ComponentType.Checkbox:
            return fields.getCheckbox(customId);
    }
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
    async showAndAwait(
        interaction: ModalShowableInteraction | null | undefined,
        options: AwaitModalSubmitOptions
    ): Promise<BetterModalSubmitResult | null> {
        await this.show(interaction);
        return this.awaitSubmit(interaction, options);
    }

    /**
     * Waits for this modal to be submitted, returning a helper utility object.
     * @param interaction The interaction to show the modal with.
     * @param options Modal submission options.
     */
    async awaitSubmit(
        interaction: ModalShowableInteraction | null | undefined,
        options: AwaitModalSubmitOptions
    ): Promise<BetterModalSubmitResult | null> {
        if (!interaction) throw new Error("[BetterModal] Interaction is null or undefined");

        try {
            const modalSubmit = await interaction.awaitModalSubmit({
                filter: i => i.customId === this.customId,
                time: options.timeout
            });

            if (options?.deferUpdate) {
                await modalSubmit.deferUpdate();
            }

            const getField = ((
                customId: string,
                selector?: boolean | BetterModalFieldType | BetterModalFieldGetter,
                ...args: unknown[]
            ): unknown => {
                if (typeof selector === "string") {
                    const getter = modalSubmit.fields[selector] as unknown as (...getterArgs: unknown[]) => unknown;
                    return getter.call(modalSubmit.fields, customId, ...args);
                }

                const type = typeof selector === "number" ? selector : undefined;
                const required = typeof selector === "boolean" ? selector : args[0] === true;
                return getSimplifiedFieldValue(modalSubmit.fields, customId, type, required);
            }) as BetterModalSubmitResult["getField"];
            const values: unknown[] = [];

            for (const customId of this.components.keys()) {
                values.push(getField(customId));
            }

            return {
                values,
                interaction: modalSubmit,
                getField,
                reply: async options => dynaSend(modalSubmit, options),
                followUp: async options => dynaSend(modalSubmit, options),
                deferUpdate: async options => modalSubmit.deferUpdate(options),
                deferReply: async options => modalSubmit.deferReply(options)
            };
        } catch {
            return null;
        }
    }
}
