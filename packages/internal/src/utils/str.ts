import { humanId } from "human-id";

export function createRandomId(): string {
    return `v-${Math.random().toString(36).split(".")[1]!}`;
}

export function createHumanId(): string {
    return humanId({ separator: "-", capitalize: false });
}
