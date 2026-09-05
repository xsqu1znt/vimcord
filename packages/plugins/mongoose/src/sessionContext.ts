import type { ClientSession } from "mongoose";

import { AsyncLocalStorage } from "node:async_hooks";

export const sessionContext = new AsyncLocalStorage<ClientSession>();
