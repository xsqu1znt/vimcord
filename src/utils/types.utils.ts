/**
 * Deep partial type utility - recursively makes all properties optional
 * Replaces type-fest's PartialDeep
 */
export type PartialDeep<T> = T extends object
    ? T extends ReadonlyArray<infer U>
        ? ReadonlyArray<PartialDeep<U>>
        : T extends Array<infer U>
          ? Array<PartialDeep<U>>
          : {
                [K in keyof T]?: PartialDeep<T[K]>;
            }
    : T;
