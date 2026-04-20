# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Changed

#### Type Safety Improvements

- **BREAKING**: Updated public API types to use strict typing instead of `any`:
    - `BaseCommandConfig.execute`: Changed from `any` to `unknown` (allows returning any value including Promises)
    - `BaseCommandConfig.afterExecute`: Changed result parameter from `any` to `unknown`
    - `BaseCommandConfig.onError` and other hooks: Changed from `any` to `void | Promise<void>`
    - `EventConfig.execute`: Changed from `any` to `void | Promise<void>`
    - `EventConfig.afterExecute`: Changed result parameter from `any` to `unknown`
    - `CommandRateLimitOptions`: Removed generic constraint to allow flexible function types

#### Logging Standardization

- **Internal**: `CommandManager` now uses dedicated `Logger` instance instead of direct `console.*` calls
    - Added `logger` property to `CommandManager` class
    - Replaced 17 direct console calls with structured logging
    - Methods affected: `registerGlobal()`, `unregisterGlobal()`, `registerGuild()`, `unregisterGuild()`
    - Added explicit return types to all async methods

#### Code Quality

- Fixed builtin command handlers (`slashCommand.builtin.ts`, `contextCommand.builtin.ts`) to properly handle async execution without returning values
    - Changed from `return interaction.reply()` to `await interaction.reply()` followed by `return`
    - Added explicit `Promise<void>` return types

### Deprecated

- None

### Removed

- None

### Fixed

- Type consistency in command and event lifecycle hooks
- Eliminated type errors from overly restrictive generic constraints
- Removed `.catch(Boolean)` error swallowing in `Paginator.ts` - errors now properly propagate
- Fixed internal `any` types in multiple files:
    - `Logger.ts`: Changed variadic args from `any[]` to `unknown[]`
    - `importUtils.ts`: Removed generic `any` constraint, changed error type from `any` to `unknown`
    - `processUtils.ts`: Changed `getPackageJson()` return type from `any` to `Record<string, unknown>`
    - `helpers.ts`: Updated `PartialDeep` to use `unknown` instead of `any`
    - `baseCommand.builder.ts`: Used type assertions with `Record<string, unknown>` instead of `any`

### Security

- None

---

## Notes for Developers

### Type Migration Guide

The `any` types have been replaced with more specific types. **No code changes required** for most use cases:

**Before:**

```typescript
setExecute(async (client, interaction) => {
    return interaction.reply({ content: "Hello" });
});
```

**After:**

```typescript
setExecute(async (client, interaction) => {
    // Still works! Return type is now `unknown` which accepts any value
    return interaction.reply({ content: "Hello" });
});
```

**Key Changes:**

- `execute` return type changed from `any` to `unknown` - **no impact on existing code**
- `afterExecute` receives `result: unknown` instead of `any` - add type guard if you need to access specific properties
- Other hooks (beforeExecute, onError, etc.) now return `void | Promise<void>` - no impact since you weren't returning values anyway

### Logging Changes

The `CommandManager` now logs through Vimcord's Logger system. Console output will now include:

- Timestamps
- Log level indicators (INFO, SUCCESS, ERROR)
- Structured prefix: `[CommandManager]`

---

_This changelog documents changes made during the codebase cleanup initiative to eliminate bad practices and type inconsistencies._
