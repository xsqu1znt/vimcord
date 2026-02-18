import _ from "lodash";
import { PartialDeep } from "type-fest";

export function createConfigFactory<T>(defaultConfig: T, validate?: (config: T) => void) {
    return (options: PartialDeep<T> = {} as PartialDeep<T>, existing?: T): T => {
        const result = _.merge({}, defaultConfig, existing, options);
        validate?.(result);
        return result;
    };
}
