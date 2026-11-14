# Basic bot

Copy this folder into your project and use Node.js 22+ with pnpm. After Vimcord 5 is published, replace the two `workspace:*` dependencies with `"vimcord": "^5.0.0"` and `"@vimcord/plugin-dotenv": "^0.1.12"` (use a dotenv release whose Vimcord peer range includes v5).

Run `pnpm install`, copy `.env.example` to `.env`, and fill in `TOKEN` (`TOKEN_DEV` for `--dev`). Enable the Message Content intent in the Discord developer portal and invite the bot with the `bot` and `applications.commands` scopes.

Run `pnpm dev` for automatic restarts or `pnpm start` without watching; append `--dev` to use `TOKEN_DEV`. Try `/ping` or `!ping`. Run `pnpm check` to type-check.
