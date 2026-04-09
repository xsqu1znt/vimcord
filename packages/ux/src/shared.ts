import type { GuildMember, Message, User } from "discord.js";

import { ComponentType } from "discord.js";

// --- Participants ---
export type Participant = GuildMember | User | string;
export function resolveParticipantId(participant: Participant): string {
    if (typeof participant === "string") return participant;
    return participant.id;
}

// --- Resolve Actions ---
export enum ResolveAction {
    DisableComponents = "DisableComponents",
    ClearComponents = "ClearComponents",
    DeleteMessage = "DeleteMessage",
    DeleteMessageOnConfirm = "DeleteMessageOnConfirm",
    DeleteMessageOnReject = "DeleteMessageOnReject",
    DoNothing = "DoNothing"
}
async function resolveAction_disableComponents(message: Message | null | undefined): Promise<void> {
    if (!message?.editable) return;

    try {
        const updatedRows = message.components.map(row => {
            const json = row.toJSON();

            if (json.type === ComponentType.Container) {
                return json;
            }

            if ("components" in json && Array.isArray(json.components)) {
                return {
                    ...json,
                    components: json.components.map(comp => ({ ...comp, disabled: true }))
                };
            }

            return json;
        });

        await message.edit({ components: updatedRows });
    } catch (err) {
        if (err instanceof Error && !err.message.includes("Unknown Message")) {
            console.error("[ResolveAction] Failed to disable components:", err);
        }
    }
}
async function resolveAction_clearComponents(message: Message | null | undefined): Promise<void> {
    if (!message?.editable) return;

    try {
        const updatedRows = message.components
            .map(row => row.toJSON())
            .filter(json => json.type !== ComponentType.Container);

        await message.edit({ components: updatedRows as never });
    } catch (err) {
        if (err instanceof Error && !err.message.includes("Unknown Message")) {
            console.error("[ResolveAction] Failed to clear components:", err);
        }
    }
}
async function resolveAction_deleteMessage(message: Message | null | undefined): Promise<void> {
    if (!message?.deletable) return;

    try {
        await message.delete();
    } catch (err) {
        if (err instanceof Error && !err.message.includes("Unknown Message")) {
            console.error("[ResolveAction] Failed to delete message:", err);
        }
    }
}
export async function handleResolveAction(message: Message | null | undefined, action: ResolveAction): Promise<void> {
    switch (action) {
        case ResolveAction.DisableComponents:
            return resolveAction_disableComponents(message);
        case ResolveAction.ClearComponents:
            return resolveAction_clearComponents(message);
        case ResolveAction.DeleteMessage:
            return resolveAction_deleteMessage(message);
        case ResolveAction.DoNothing:
        default:
            break;
    }
}
