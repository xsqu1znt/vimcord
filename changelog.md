# Changelog

## 2026-07-22

### Added

- Added named role IDs to `globals.staff.guild.roles`, alongside the existing named channel IDs.
- Added public cache-first `fetchRole` and `fetchMember` UX helpers with nullable failure results.

## 2026-07-17

### Fixed

- Standardized plugin-scoped logger labels as uppercase `PLUGIN` across normal, debug, success, error, and startup summary output.
- Made CLI tables wrap within the detected terminal width with a compact maximum instead of expanding to their longest values.
- Removed blank-line padding before and after CLI command results.
- Restored the full startup banner on hosts that report a narrow terminal width despite supporting the complete layout.

### Changed

- Changed CLI target labels to show the application name and Discord bot tag without the internal Vimcord client ID.
- Moved Vimcord package-version resolution into a shared internal utility used by startup and CLI output.

### Added

- Added bot-staff status to `/userinfo` text and JSON output.
- Added the installed Vimcord package version to `/version` text and JSON output.
