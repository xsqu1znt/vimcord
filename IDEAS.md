add timeout overrides to waitForReady for both client and mongo
show database ping stat in command and startup log
add instance process info to the CLI instead of showing on startup
show the amount of commands/events disabled

`MongoSchemaBuilder.extend` should wrap with execute and try/catch middleware

`EventBuilder` and `X*CommandBuilder` should have its execute args as an object, that way you can do `({ interaction })` for example instead of needing to add "client," first. This leaves room for introducing context based utils to execute.

Agentic `vimcord-agents` CLI tool for agents to run commands with to boilerplate code and tell it how to use certain tools or syntax instead of a bloated AGENTS.md prompt.

`BetterModal`: I also changed submit parsing to read from modalResult.interaction.fields in card.slash.ts, because that’s where discord.js exposes typed getters like getSelectedUsers, getRadioGroup, getStringSelectValues, and getCheckbox for modal components. pnpm run check and pnpm run format both pass.

`BetterModal`'s `getField` should allow you to retype the result.

Prompt engineering. When working with a vimcord skill, directly point to line numbers where they are relevant. When reading the front-facing `vimcord` skill, direct the AI like a topic index, that way it saves tokens and API calls figuring out what it needs to do.

`BetterEmbed`'s description field should allow and filter all falsey values.

Make sure packages only export public facing.

`useEnv` can be a built in plugin that comes with Vimcord.

`MongoSchemaBuilder` should introduce collision tests, so you pass in a function you want to generate an ID for example, and it'll retry (with configurable attempts) if it hits a collision.

A way to pass context from execute to `afterExecute`.

A helper for prefix command subcommands and subgroups.

Automatically reset Discord/DB connections when issues are detected.

Make all UX timeouts required.

Be able to set the log color per client.

Vimcord-CLI: get info about a guild by id or name
Vimcord-CLI: be able to launch a separated instance of the CLI and still interact with the available clients

Paginator: remove reaction based navigation
Paginator: allow custom buttons by passing their custom_id
Paginator: allow containers
Paginator: fix jump being different than what it was, while keeping the new jump behavior, just under a different name
Paginator: verify `PaginationType` and `PaginationTimeoutType`