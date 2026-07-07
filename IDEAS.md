show database ping stat in command and startup log
add instance process info to the CLI instead of showing on startup

Agentic `vimcord-agents` CLI tool for agents to run commands with to boilerplate code and tell it how to use certain tools or syntax instead of a bloated AGENTS.md prompt.

`BetterModal`: I also changed submit parsing to read from modalResult.interaction.fields in card.slash.ts, because that’s where discord.js exposes typed getters like getSelectedUsers, getRadioGroup, getStringSelectValues, and getCheckbox for modal components. pnpm run check and pnpm run format both pass.

Prompt engineering. When working with a vimcord skill, directly point to line numbers where they are relevant. When reading the front-facing `vimcord` skill, direct the AI like a topic index, that way it saves tokens and API calls figuring out what it needs to do.

`BetterEmbed`'s description field should allow and filter all falsey values.

A helper for prefix command subcommands and subgroups.

Automatically reset Discord/DB connections when issues are detected.

Be able to set the log color per client.

Vimcord-CLI: get info about a guild by id or name
Vimcord-CLI: be able to launch a separated instance of the CLI and still interact with the available clients

Paginator: fix jump being different than what it was, while keeping the new jump behavior, just under a different name