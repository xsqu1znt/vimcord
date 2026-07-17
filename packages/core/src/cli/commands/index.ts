import type { CLICommand } from "../types.js";

import { createGeneralCLICommands } from "./general.js";
import { createInfoCLICommands } from "./info.js";
import { createRegistrationCLICommands } from "./registration.js";

/** Creates a fresh immutable-by-convention core command set for one CLI runtime. */
export function createBuiltinCLICommands(): readonly CLICommand[] {
    return [...createGeneralCLICommands(), ...createInfoCLICommands(), ...createRegistrationCLICommands()];
}
