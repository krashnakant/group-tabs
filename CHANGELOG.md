# Changelog

All notable changes to Group Tabs are documented here.

## [0.2.0] - 2026-07-17

### Added

- Settings for automatically grouping newly opened tabs.
- “Organize while away” automation with site and on-device AI modes, a manual run action, and detailed last-run results.
- Custom topic names for on-device AI grouping.
- Recovery snapshots that retain the latest three local versions.
- Small manual sessions sync across signed-in Chromium browsers; larger sessions remain local.
- Commands to ungroup all tabs, undo that action, and collapse or expand groups.
- First-run onboarding with immediate grouping and automation setup actions.
- Support for Chromium browsers that expose the built-in Prompt API, including Chrome and Microsoft Edge.

### Changed

- Redesigned the popup, settings, onboarding, website, and Chrome Web Store artwork.
- Site grouping now leaves single-tab sites loose during manual organization to reduce clutter.
- Tabs join existing same-name groups instead of creating duplicates.
- Restoring a session opens only missing tabs in a new window, preserves titles and colors, and lazy-loads larger sessions.
- AI controls are hidden when the browser does not provide on-device AI; site grouping remains available.
- Group colors vary between runs without repeating until the full palette is used.

### Fixed

- “Organize while away” now groups eligible single-site tabs instead of reporting a completed run without creating visible groups.
- AI-based idle organization falls back to site grouping when on-device AI is unavailable.
- Extension service workers remain active during long on-device AI classification runs.
