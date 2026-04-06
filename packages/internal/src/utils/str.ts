export function createRandomId(): string {
    return `v-${Math.random().toString(36).split(".")[1]!}`;
}
