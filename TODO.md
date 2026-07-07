Agent rules:
1. ensure comments for readability and scanability are added, don't be scared to add relevant comments to the code you write
2. the code you write must be clean and performant, no slop, no files full of utility function slop (inline code where possible, but remember D.R.Y)
3. all public facing interface props and types and functions and class functions should have proper jsdoc that reads naturally and concise

TODOs:

- [x] Paginator: remove reaction based navigation
  - Removed reaction collectors, reaction events, and `useReactions`; pagination now uses component controls only.
- [x] Paginator: support MessageComponentsV2 for pages (BetterContainer + native discordjs containers)
  - `ContainerBuilder` page support was already present; added `BetterContainer` page support via a new `toBuilder()` method.
- [x] Paginator: rename `PaginationTimeoutType` to `PaginationTimeout`
  - Renamed without a compatibility alias because this is unreleased v2 API cleanup.

- [x] MongoSchemaBuilder: jsdoc should clarify that `returnDocument` is by default "after"
  - Clarified this on `upsert` and `update`; both return the post-update document.
- [x] MongoSchemaBuilder: jsdoc should clarify what `required: true` does when fetching
  - Clarified that `required: true` throws when no document is found and removes `null` from the return type.
- [x] MongoSchemaBuilder: i think if you try updating or fetching or anything by a document's `_id`, mongoose will throw an error because the ObjectId isn't be properly formatted for mongoose to use or something, check what mongoose requires to work with `_id`'s and make sure our schema builder is automatically compatible with it without the end user having to do anything different besides just using `_id` when working with their documents
  - Added valid ObjectId string normalization for query filters before calling Mongoose. Invalid values are left untouched so Mongoose still reports its normal cast error.

- [x] Vimcord: implement /home/xsqu1znt/Desktop/Stuff/Development/02_Personal/Modules/vimcord_old/src/modules/status.manager.ts as a clean version that matches our new v2 style
  - Added `StatusManager`, `client.status`, typed user-provided status configs, placeholder formatting, activity rotation, and re-apply on future `clientReady` events. No default status config is provided; statuses are fully user-owned.
- [x] Vimcord: implement global command hooks (similar to defineGlobalToolConfig, but for command hooks that'll use the globally defined hook, allowing if the user passes a custom hook during command module creation that the custom hook overrides the global hook), this for example would let a user define a default error hook that will be used to either run custom logging or send error message to the channel etc using the provided ctx for custom logic that depends on certain context
  - Added `defineGlobalCommandHooks`; command-local hooks override `client.globals.hooks`, which override package-level global hooks.
- [x] Vimcord: add util to client to test if a userId is a bot staff member
  - Added `client.isBotStaff(userId)`, checking owner, superusers, and configured staff guild roles when available.
- [x] Vimcord: i want the connection to Discord to automatically refresh (refresh the connection, or re-login) if the bot detects the connection to not be properly working or it was dropped, i've had an issue with bots running for multiple days at a time and usually their connections would start failing after a while, not responding to commands until the bot restarts. maybe ping the client every X amount of time and when it starts failing automatically try refreshing? this should also be a customizable behavior for the end-user to configure when making a Vimcord client, it should also log to the client using the Logger when it's refreshing the connection
  - Added `connectionRefresh` client options. It defaults on after login, can be disabled with `connectionRefresh: false`, pings Discord REST, and relogs with the cached token after repeated failures.

- [x] plugin-mongoose: similar to my idea for the automatic Discord connection refresh, if the connection to mongo seems to be failing or keep dropping, it should automatically try refreshing the connection
  - Added `autoRefresh` plugin options. It defaults on after install, checks `readyState` plus Mongo admin ping, and reconnects after repeated failures.

- [x] PrefixCommandModule: rename `content` execute param to `messageContent`
  - This is a clean v2 breaking rename; no `content` compatibility alias was kept. Also fixed `splitContent()` to split the normalized lowercase/uppercase content.

- [x] @internal/Logger: fix for some terminals that don't have a space after the emoji add a space after the emoji for consistency (if possible)
  - Normalized `prefixEmoji` by trimming trailing whitespace and adding exactly one separator before the prefix.
