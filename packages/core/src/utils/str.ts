import { humanId } from "human-id";

/** Creates a short random ID for transient framework components. */
export function createRandomId(): string {
    return `v-${Math.random().toString(36).split(".")[1]!}`;
}

/** Creates a human-readable random ID. */
export function createHumanId(): string {
    return humanId({ separator: "-", capitalize: false });
}
