import type {
    APICheckboxComponent,
    APICheckboxGroupComponent,
    APIFileUploadComponent,
    APIModalInteractionResponseCallbackData,
    APIRadioGroupComponent,
    ChannelSelectMenuComponentData,
    CommandInteraction,
    MentionableSelectMenuComponentData,
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
    UserSelectMenuBuilder
} from "discord.js";
import { createRandomId } from "@vimcord/internal";
import { dynaSend } from "./dynaSend.js";

// NOTES: Will eventually come from global config
const DEFAULT_OPTIONS = {
    timeout: 60_000
} as const;

interface LabelComponentOptions {
    label: string;
    description?: string;
}

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

export interface BetterModalOptions {
    customId?: string;
    components?: BetterModalComponent[];
}

export interface AwaitModalSubmitOptions {
    timeout?: number;
    deferUpdate?: boolean;
}

export interface BetterModalSubmitResult<T = unknown> {
    values: T[];
    interaction: ModalSubmitInteraction;
    getField(customId: string): T | undefined;
    reply: (options: RequiredDynaSendOptions) => Promise<Message | null>;
    followUp: (options: RequiredDynaSendOptions) => Promise<Message | null>;
    deferUpdate: () => ReturnType<ModalSubmitInteraction["deferUpdate"]>;
}

export class BetterModal {
    readonly customId: string;

    private components: Map<string, BetterModalComponent> = new Map();
    private labelComponents: LabelBuilder[] = [];
    private modal: ModalBuilder;

    constructor(options?: BetterModalOptions) {
        this.customId = options?.customId ?? createRandomId();
        this.modal = new ModalBuilder().setCustomId(this.customId);

        if (options?.components?.length) {
            this.addComponents(...options.components);
        }
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
        const modal = new BetterModal({ customId: this.customId, components: this.components.values().toArray() });
        if (this.modal.data.title) modal.setTitle(this.modal.data.title);
        return modal;
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
    setComponents(...components: BetterModalComponent[]): this {
        this.components.clear();
        this.labelComponents = [];
        this.addComponents(...components);
        return this;
    }

    /** Adds components to the modal. */
    addComponents(...components: BetterModalComponent[]): this {
        for (const component of components) {
            switch (component.type) {
                case ComponentType.TextInput:
                    this.addTextInput(component);
                    break;

                case ComponentType.Checkbox:
                    this.addCheckbox(component);
                    break;

                case ComponentType.CheckboxGroup:
                    this.addCheckboxGroup(component);
                    break;

                case ComponentType.RadioGroup:
                    this.addRadioGroup(component);
                    break;

                case ComponentType.StringSelect:
                    this.addStringSelect(component);
                    break;

                case ComponentType.ChannelSelect:
                    this.addChannelSelect(component);
                    break;

                case ComponentType.UserSelect:
                    this.addUserSelect(component);
                    break;

                case ComponentType.RoleSelect:
                    this.addRoleSelect(component);
                    break;

                case ComponentType.MentionableSelect:
                    this.addMentionableSelect(component);
                    break;

                case ComponentType.FileUpload:
                    this.addFileUpload(component);
                    break;
            }
        }
        return this;
    }

    private addTextInput(data: BetterTextInputComponent): this {
        this.validateComponentLength();

        const customId = data.customId ?? this.createComponentId();
        const textInput = new TextInputBuilder({ ...data, customId });
        const label = this.createLabelComponent(data);
        label.setTextInputComponent(textInput);

        this.components.set(customId, data);
        this.labelComponents.push(label);

        return this;
    }

    private addStringSelect(data: BetterStringSelectComponent): this {
        this.validateComponentLength();

        const customId = data.customId ?? this.createComponentId();
        const select = new StringSelectMenuBuilder({ ...data, customId });
        const label = this.createLabelComponent(data);
        label.setStringSelectMenuComponent(select);

        this.components.set(customId, data);
        this.labelComponents.push(label);

        return this;
    }

    private addCheckbox(data: BetterCheckboxComponent): this {
        this.validateComponentLength();

        const customId = data.custom_id ?? this.createComponentId();
        const checkbox = new CheckboxBuilder({ ...data, custom_id: customId });
        const label = this.createLabelComponent(data);
        label.setCheckboxComponent(checkbox);

        this.components.set(customId, data);
        this.labelComponents.push(label);

        return this;
    }

    private addCheckboxGroup(data: BetterCheckboxGroupComponent): this {
        this.validateComponentLength();

        const customId = data.custom_id ?? this.createComponentId();
        const checkboxGroup = new CheckboxGroupBuilder({ ...data, custom_id: customId });
        const label = this.createLabelComponent(data);
        label.setCheckboxGroupComponent(checkboxGroup);

        this.components.set(customId, data);
        this.labelComponents.push(label);

        return this;
    }

    private addRadioGroup(data: BetterRadioGroupComponent): this {
        this.validateComponentLength();

        const customId = data.custom_id ?? this.createComponentId();
        const radioGroup = new RadioGroupBuilder({ ...data, custom_id: customId });
        const label = this.createLabelComponent(data);
        label.setRadioGroupComponent(radioGroup);

        this.components.set(customId, data);
        this.labelComponents.push(label);

        return this;
    }

    private addChannelSelect(data: BetterChannelSelectComponent): this {
        this.validateComponentLength();

        const customId = data.customId ?? this.createComponentId();
        const channelSelect = new ChannelSelectMenuBuilder({ ...data, customId });
        const label = this.createLabelComponent(data);
        label.setChannelSelectMenuComponent(channelSelect);

        this.components.set(customId, data);
        this.labelComponents.push(label);

        return this;
    }

    private addUserSelect(data: BetterUserSelectComponent): this {
        this.validateComponentLength();

        const customId = data.customId ?? this.createComponentId();
        const userSelect = new UserSelectMenuBuilder({ ...data, customId });
        const label = this.createLabelComponent(data);
        label.setUserSelectMenuComponent(userSelect);

        this.components.set(customId, data);
        this.labelComponents.push(label);

        return this;
    }

    private addRoleSelect(data: BetterRoleSelectComponent): this {
        this.validateComponentLength();

        const customId = data.customId ?? this.createComponentId();
        const roleSelect = new RoleSelectMenuBuilder({ ...data, customId });
        const label = this.createLabelComponent(data);
        label.setRoleSelectMenuComponent(roleSelect);

        this.components.set(customId, data);
        this.labelComponents.push(label);

        return this;
    }

    private addMentionableSelect(data: BetterMentionableSelectComponent): this {
        this.validateComponentLength();

        const customId = data.customId ?? this.createComponentId();
        const mentionableSelect = new MentionableSelectMenuBuilder({ ...data, customId });
        const label = this.createLabelComponent(data);
        label.setMentionableSelectMenuComponent(mentionableSelect);

        this.components.set(customId, data);
        this.labelComponents.push(label);

        return this;
    }

    private addFileUpload(data: BetterFileUploadComponent): this {
        this.validateComponentLength();

        const customId = data.custom_id ?? this.createComponentId();
        const fileUpload = new FileUploadBuilder({ ...data, custom_id: customId });
        const label = this.createLabelComponent(data);
        label.setFileUploadComponent(fileUpload);

        this.components.set(customId, data);
        this.labelComponents.push(label);

        return this;
    }

    /**
     * Shows the modal to the user via interaction.
     * @param interaction The command interaction to show the modal with.
     * @param options Modal options.
     */
    async show(interaction: CommandInteraction, options?: Required<ShowModalOptions>): Promise<void> {
        const modal = this.build();
        await interaction.showModal(modal, options);
    }

    /**
     * Shows the modal and waits for it to be submitted.
     * @param interaction The interaction to show the modal with.
     * @param options Modal submission options.
     */
    async showAndAwait<T = unknown>(
        interaction: CommandInteraction,
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
        interaction: CommandInteraction,
        options?: AwaitModalSubmitOptions
    ): Promise<BetterModalSubmitResult<T> | null> {
        const timeout = options?.timeout ?? DEFAULT_OPTIONS.timeout;

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
                getField: (customId: string) => fields.get(customId) as T | undefined,
                reply: (options: RequiredDynaSendOptions) => dynaSend(modalSubmit, options),
                followUp: async (options: RequiredDynaSendOptions) => dynaSend(modalSubmit, options),
                deferUpdate: () => modalSubmit.deferUpdate()
            };
        } catch {
            return null;
        }
    }
}
