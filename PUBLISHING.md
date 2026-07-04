# Publishing to the Chrome Web Store

## One-time setup

1. Register a developer account at https://chrome.google.com/webstore/devconsole — one-time **$5** fee, needs a Google account.
2. (Recommended) Enable 2FA on the account; the store requires it for publishers.

## Build the zip

```sh
cd /Users/chaurasiak/experiments/chrome-extentions/group-tabs
zip -r group-tabs.zip manifest.json background.js grouping.js popup.html popup.js icons \
  -x "icons/icon.svg"
```

Only ship what runs: no `test.mjs`, no `README.md`/`PUBLISHING.md`, no SVG source.

## Store listing requirements

| Asset | Spec | Status |
|---|---|---|
| Store icon | 128×128 PNG | `icons/icon128.png` ✅ |
| Screenshots | 1–5, 1280×800 or 640×400 PNG | **TODO** — screenshot popup + a grouped tab strip |
| Description | Short (132 chars) + detailed | Draft below |
| Category | Productivity → Tools | pick in console |
| Language | English | |

Optional but improves listing: small promo tile 440×280.

### Draft short description

> Auto-group tabs by domain or on-device AI. Save tab groups as snapshots and restore them anytime.

## Privacy / review questionnaire (the part that gets extensions rejected)

- **Single purpose**: "Organize browser tabs into groups and save/restore them." Say exactly this — one purpose, clearly.
- **Permission justifications**:
  - `tabs` — read tab titles/URLs to group them by domain/topic and to save snapshots. (This permission triggers extra review scrutiny; justification must be specific.)
  - `tabGroups` — create/update tab groups.
  - `storage` — store snapshots locally.
- **Data usage disclosure**: tab URLs/titles are processed **locally only** (domain rules or on-device Gemini Nano); nothing is transmitted anywhere. Declare "does not collect user data" — accurate because no remote calls exist.
- **Privacy policy URL**: `https://krashnakant.github.io/group-tabs/privacy.html` — live via GitHub Pages (source: `privacy.html` in this repo, main branch). Paste into the dev console privacy tab.
- **Remote code**: declare "No remote code" — true, everything is bundled.

## Submit

1. Dev console → "New item" → upload `group-tabs.zip`.
2. Fill listing, privacy tab, upload screenshots.
3. Set visibility: **Unlisted** first (installable via link, no public search) — sane for a v0.1 shakedown; flip to Public later without re-review of visibility itself.
4. Submit for review. Typical review: 1–3 days; `tabs` permission can push it longer.

## Each update after that

Bump `"version"` in `manifest.json` (e.g. 0.1.0 → 0.1.1) → rebuild zip → upload in console → resubmit. Users auto-update within hours after approval.
