import type {
    APICheckboxComponent,
    APICheckboxGroupComponent,
    APIFileUploadComponent,
    APIModalInteractionResponseCallbackData,
    APIRadioGroupComponent,
    APITextDisplayComponent,
    ChannelSelectMenuComponentData,
    CommandInteraction,
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
    Collection,
    DiscordjsError,
    DiscordjsErrorCodes,
    FileUploadBuilder,
    LabelBuilder,
    MentionableSelectMenuBuilder,
    Message,
    ModalBuilder,
    ModalSubmitInteraction,
    RadioGroupBuilder,
    RoleSelectMenuBuilder,
    StringSelectMenuBuilder,
    TextDisplayBuilder,
    TextInputBuilder,
    TextInputStyle,
    UserSelectMenuBuilder
} from "discord.js";
import { createRandomId } from "@/utils/str.js";
import { dynaSend } from "./dynaSend.js";
import { awaitRoutedModal } from "./interactionRouter.js";
import { getGlobalUxConfig } from "./uxConfig.js";

interface LabelComponentOptions {
    label: string;
    description?: string;
}

/** A modal input: its Discord data, its label, and the `customId` its value is read back under. */
type ModalInput<Data, Id extends string> = Omit<Partial<Data>, "customId" | "custom_id" | "type"> &
    LabelComponentOptions & { customId: Id };

export type BetterTextInputComponent<Id extends string = string> = ModalInput<TextInputComponentData, Id>;
export type BetterCheckboxComponent<Id extends string = string> = ModalInput<APICheckboxComponent, Id>;
export type BetterCheckboxGroupComponent<Id extends string = string> = ModalInput<APICheckboxGroupComponent, Id>;
export type BetterRadioGroupComponent<Id extends string = string> = ModalInput<APIRadioGroupComponent, Id>;
export type BetterStringSelectComponent<Id extends string = string> = ModalInput<StringSelectMenuComponentData, Id>;
export type BetterChannelSelectComponent<Id extends string = string> = ModalInput<ChannelSelectMenuComponentData, Id>;
export type BetterUserSelectComponent<Id extends string = string> = ModalInput<UserSelectMenuComponentData, Id>;
export type BetterRoleSelectComponent<Id extends string = string> = ModalInput<RoleSelectMenuComponentData, Id>;
export type BetterMentionableSelectComponent<Id extends string = string> = ModalInput<
    MentionableSelectMenuComponentData,
    Id
>;
export type BetterFileUploadComponent<Id extends string = string> = ModalInput<APIFileUploadComponent, Id>;
export type BetterTextDisplayComponent = Pick<APITextDisplayComponent, "content">;

export type ModalShowableInteraction = CommandInteraction | MessageComponentInteraction;

export interface BetterModalOptions {
    customId?: string;
    title?: string;
}

export interface AwaitModalSubmitOptions {
    /** Time in milliseconds to wait for a submission. Defaults to the UX config's `modal.timeout`. */
    timeout?: number;
    deferUpdate?: boolean;
}

type SelectedUsers = NonNullable<ReturnType<ModalSubmitFields["getSelectedUsers"]>>;
type SelectedRoles = NonNullable<ReturnType<ModalSubmitFields["getSelectedRoles"]>>;
type SelectedChannels = NonNullable<ReturnType<ModalSubmitFields["getSelectedChannels"]>>;
type SelectedMentionables = NonNullable<ReturnType<ModalSubmitFields["getSelectedMentionables"]>>;
type UploadedFiles = NonNullable<ReturnType<ModalSubmitFields["getUploadedFiles"]>>;

/** The parsed submission, with one key per input's `customId`, and helpers to respond to it. */
export interface BetterModalSubmitResult<Fields extends object = Record<never, never>> {
    /** The original Discord.js modal submission interaction. */
    interaction: ModalSubmitInteraction;
    /** Submitted values, keyed by `customId`. Selects with nothing selected read as empty, not null. */
    fields: Fields;
    /** Replies to the modal submission. */
    reply: (options: RequiredDynaSendOptions) => Promise<Message | null>;
    /** Sends a follow-up to the modal submission. */
    followUp: (options: RequiredDynaSendOptions) => Promise<Message>;
}

type AddMethod =
    | "addTextInput"
    | "addTextDisplay"
    | "addStringSelect"
    | "addCheckbox"
    | "addCheckboxGroup"
    | "addRadioGroup"
    | "addChannelSelect"
    | "addUserSelect"
    | "addRoleSelect"
    | "addMentionableSelect"
    | "addFileUpload";

function isModalTimeout(error: unknown): boolean {
    return error instanceof DiscordjsError && error.code === DiscordjsErrorCodes.InteractionCollectorError;
}

/** The part of an input's data that goes on the component rather than on its label. */
function componentData<T extends LabelComponentOptions>(data: T): Omit<T, "label" | "description"> {
    const { label: _label, description: _description, ...component } = data;
    return component;
}

/** The same, for builders that take raw API data. */
function rawComponentData<T extends LabelComponentOptions & { customId: string }>(data: T) {
    const { customId, ...component } = componentData(data);
    return { ...component, custom_id: customId };
}

/**
 * A modal whose submitted values are typed by the inputs added to it.
 * Chain the `add*` calls so `result.fields` picks up each input; every input needs a `customId`.
 */
export class BetterModal<Fields extends object = Record<never, never>> {
    readonly customId: string;

    private readonly added: { method: AddMethod; data: unknown }[] = [];
    private readonly readers = new Map<string, (fields: ModalSubmitFields) => unknown>();
    private readonly modal: ModalBuilder;

    constructor(options?: BetterModalOptions) {
        this.customId = options?.customId ?? createRandomId();
        this.modal = new ModalBuilder().setCustomId(this.customId);

        if (options?.title) this.setTitle(options.title);
    }

    private validateComponentLength(): void {
        if (this.added.length >= 5) {
            throw new Error("[BetterModal] Modal can only have 5 top-level components");
        }
    }

    private addField<Id extends string, Value>(
        method: AddMethod,
        data: LabelComponentOptions & { customId: Id },
        read: (fields: ModalSubmitFields) => Value,
        attach: (label: LabelBuilder) => unknown
    ): BetterModal<Fields & Record<Id, Value>> {
        this.validateComponentLength();
        if (this.readers.has(data.customId)) {
            throw new Error(`[BetterModal] Duplicate input customId '${data.customId}'`);
        }

        const label = new LabelBuilder().setLabel(data.label);
        if (data.description) label.setDescription(data.description);
        attach(label);

        this.modal.addLabelComponents(label);
        this.readers.set(data.customId, read);
        this.added.push({ method, data });
        return this as unknown as BetterModal<Fields & Record<Id, Value>>;
    }

    private build(): ModalBuilder {
        if (!this.modal.data.title) throw new Error("[BetterModal] Modal must have a title");
        return this.modal;
    }

    clone(): BetterModal<Fields> {
        const clone = new BetterModal({ customId: this.customId, title: this.modal.data.title });
        for (const { method, data } of this.added) (clone[method] as (data: unknown) => unknown)(data);
        return clone as unknown as BetterModal<Fields>;
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

    addTextInput<const Id extends string>(data: BetterTextInputComponent<Id>): BetterModal<Fields & Record<Id, string>> {
        return this.addField(
            "addTextInput",
            data,
            f => f.getTextInputValue(data.customId),
            label => {
                label.setTextInputComponent(
                    new TextInputBuilder({ style: TextInputStyle.Short, required: false, ...componentData(data) })
                );
            }
        );
    }

    addTextDisplay(data: BetterTextDisplayComponent): this {
        this.validateComponentLength();
        this.modal.addTextDisplayComponents(new TextDisplayBuilder(data));
        this.added.push({ method: "addTextDisplay", data });
        return this;
    }

    addStringSelect<const Id extends string>(
        data: BetterStringSelectComponent<Id>
    ): BetterModal<Fields & Record<Id, readonly string[]>> {
        return this.addField(
            "addStringSelect",
            data,
            f => f.getStringSelectValues(data.customId),
            label => {
                label.setStringSelectMenuComponent(new StringSelectMenuBuilder(componentData(data)));
            }
        );
    }

    addCheckbox<const Id extends string>(data: BetterCheckboxComponent<Id>): BetterModal<Fields & Record<Id, boolean>> {
        return this.addField(
            "addCheckbox",
            data,
            f => f.getCheckbox(data.customId),
            label => {
                label.setCheckboxComponent(new CheckboxBuilder(rawComponentData(data)));
            }
        );
    }

    addCheckboxGroup<const Id extends string>(
        data: BetterCheckboxGroupComponent<Id>
    ): BetterModal<Fields & Record<Id, readonly string[]>> {
        return this.addField(
            "addCheckboxGroup",
            data,
            f => f.getCheckboxGroup(data.customId),
            label => {
                label.setCheckboxGroupComponent(new CheckboxGroupBuilder(rawComponentData(data)));
            }
        );
    }

    addRadioGroup<const Id extends string>(
        data: BetterRadioGroupComponent<Id>
    ): BetterModal<Fields & Record<Id, string | null>> {
        return this.addField(
            "addRadioGroup",
            data,
            f => f.getRadioGroup(data.customId),
            label => {
                label.setRadioGroupComponent(new RadioGroupBuilder(rawComponentData(data)));
            }
        );
    }

    addChannelSelect<const Id extends string>(
        data: BetterChannelSelectComponent<Id>
    ): BetterModal<Fields & Record<Id, SelectedChannels>> {
        const read = (f: ModalSubmitFields): SelectedChannels => f.getSelectedChannels(data.customId) ?? new Collection();
        return this.addField("addChannelSelect", data, read, label => {
            label.setChannelSelectMenuComponent(new ChannelSelectMenuBuilder(componentData(data)));
        });
    }

    addUserSelect<const Id extends string>(
        data: BetterUserSelectComponent<Id>
    ): BetterModal<Fields & Record<Id, SelectedUsers>> {
        const read = (f: ModalSubmitFields): SelectedUsers => f.getSelectedUsers(data.customId) ?? new Collection();
        return this.addField("addUserSelect", data, read, label => {
            label.setUserSelectMenuComponent(new UserSelectMenuBuilder(componentData(data)));
        });
    }

    addRoleSelect<const Id extends string>(
        data: BetterRoleSelectComponent<Id>
    ): BetterModal<Fields & Record<Id, SelectedRoles>> {
        const read = (f: ModalSubmitFields): SelectedRoles => f.getSelectedRoles(data.customId) ?? new Collection();
        return this.addField("addRoleSelect", data, read, label => {
            label.setRoleSelectMenuComponent(new RoleSelectMenuBuilder(componentData(data)));
        });
    }

    addMentionableSelect<const Id extends string>(
        data: BetterMentionableSelectComponent<Id>
    ): BetterModal<Fields & Record<Id, SelectedMentionables>> {
        const read = (f: ModalSubmitFields): SelectedMentionables =>
            f.getSelectedMentionables(data.customId) ?? {
                users: new Collection(),
                members: new Collection(),
                roles: new Collection()
            };
        return this.addField("addMentionableSelect", data, read, label => {
            label.setMentionableSelectMenuComponent(new MentionableSelectMenuBuilder(componentData(data)));
        });
    }

    addFileUpload<const Id extends string>(
        data: BetterFileUploadComponent<Id>
    ): BetterModal<Fields & Record<Id, UploadedFiles>> {
        const read = (f: ModalSubmitFields): UploadedFiles => f.getUploadedFiles(data.customId) ?? new Collection();
        return this.addField("addFileUpload", data, read, label => {
            label.setFileUploadComponent(new FileUploadBuilder(rawComponentData(data)));
        });
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
        options?: AwaitModalSubmitOptions
    ): Promise<BetterModalSubmitResult<Fields> | null> {
        await this.show(interaction);
        return this.awaitSubmit(interaction, options);
    }

    /**
     * Waits for this modal to be submitted, resolving to `null` when it times out.
     * @param interaction The interaction that showed the modal.
     * @param options Modal submission options.
     */
    async awaitSubmit(
        interaction: ModalShowableInteraction | null | undefined,
        options: AwaitModalSubmitOptions = {}
    ): Promise<BetterModalSubmitResult<Fields> | null> {
        if (!interaction) throw new Error("[BetterModal] Interaction is null or undefined");

        let modalSubmit: ModalSubmitInteraction;

        try {
            const timeout = options.timeout ?? getGlobalUxConfig().modal.timeout;
            modalSubmit = await awaitRoutedModal(interaction.client, this.customId, timeout);
        } catch (error) {
            if (isModalTimeout(error)) return null;
            throw error;
        }

        if (options.deferUpdate) {
            await modalSubmit.deferUpdate();
        }

        const fields = Object.fromEntries([...this.readers].map(([id, read]) => [id, read(modalSubmit.fields)]));

        return {
            interaction: modalSubmit,
            fields: fields as Fields,
            reply: async options => dynaSend(modalSubmit, options),
            followUp: async options => dynaSend(modalSubmit, { ...options, sendMethod: "followUp" })
        };
    }
}
