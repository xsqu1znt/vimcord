/**
 * Deep partial type utility - recursively makes all properties optional
 * Preserves function types to maintain their signatures
 */
export type PartialDeep<T> = T extends (...args: any[]) => any
    ? T
    : T extends object
      ? T extends ReadonlyArray<infer U>
          ? ReadonlyArray<PartialDeep<U>>
          : T extends Array<infer U>
            ? Array<PartialDeep<U>>
            : {
                  [K in keyof T]?: PartialDeep<T[K]>;
              }
      : T;
