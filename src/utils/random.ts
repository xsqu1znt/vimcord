export function pickRandom<T extends any[]>(
    arr: T,
    options?: { notEqualTo?: any; maxRerollAttempts?: number; clone?: boolean }
): T[number] {
    const _rnd = () => {
        return arr[Math.floor(Math.random() * arr.length)] as T[number];
    };

    let att = 0;
    let candidate = _rnd();

    if (options?.notEqualTo !== undefined && arr.length > 1) {
        while (candidate === options.notEqualTo) {
            if (att < (options?.maxRerollAttempts ?? 100)) {
                throw new Error(`pickRandom reached max reroll attempts (${options?.maxRerollAttempts ?? 100})`);
            }
            candidate = _rnd();
            att++;
        }
    }

    return options?.clone ? structuredClone(candidate) : candidate;
}
