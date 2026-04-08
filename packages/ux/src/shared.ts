import type { GuildMember, Message, User } from "discord.js";

import { ComponentType } from "discord.js";

// --- Participants ---
export type Participant = GuildMember | User | string;
export function resolveParticipantId(participant: Participant): string {
    if (typeof participant === "string") return participant;
    return participant.id;
}

// --- Timeout Actions ---
export enum TimeoutAction {
    DisableComponents = "DisableComponents",
    DeleteMessage = "DeleteMessage",
    DoNothing = "DoNothing"
}
async function timeoutAction_disableComponents(message: Message | null | undefined): Promise<void> {
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
            console.error("[TimeoutAction] Failed to disable components:", err);
        }
    }
}
async function timeoutAction_deleteMessage(message: Message | null | undefined): Promise<void> {
    if (!message?.deletable) return;

    try {
        await message.delete();
    } catch (err) {
        if (err instanceof Error && !err.message.includes("Unknown Message")) {
            console.error("[TimeoutAction] Failed to delete message:", err);
        }
    }
}
export async function handleTimeoutAction(message: Message | null | undefined, action: TimeoutAction): Promise<void> {
    switch (action) {
        case TimeoutAction.DisableComponents:
            return timeoutAction_disableComponents(message);
        case TimeoutAction.DeleteMessage:
            return timeoutAction_deleteMessage(message);
        case TimeoutAction.DoNothing:
        default:
            break;
    }
}
