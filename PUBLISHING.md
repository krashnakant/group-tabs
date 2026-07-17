# Publishing to the Chrome Web Store

## One-time setup

1. Register a developer account at https://chrome.google.com/webstore/devconsole — one-time **$5** fee, needs a Google account.
2. (Recommended) Enable 2FA on the account; the store requires it for publishers.

## Build the zip

```sh
cd /Users/chaurasiak/experiments/chrome-extentions/group-tabs
zip -FS -r group-tabs.zip manifest.json background.js grouping.js popup.html popup.js \
  options.html options.js welcome.html welcome.js privacy.html icons \
  -x "icons/icon.svg"
```

Only ship what runs: no `test.mjs`, no `README.md`/`PUBLISHING.md`, no SVG source.

## Store listing requirements

| Asset | Spec | Status |
|---|---|---|
| Store icon | 128×128 PNG | `icons/icon128.png` ✅ |
| Screenshots | 1–5, 1280×800 or 640×400 PNG | `store-assets/demo-{1-grouping,2-ai,3-snapshots}.png` ✅ |
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
  - `storage` — store manual sessions and settings; small manual sessions may use Chrome Sync, while large sessions and automatic recovery stay local.
  - `alarms` (v0.2+) — throttle automatic recovery snapshots after tab-group changes.
  - `idle` (v0.2+) — detect 30 minutes of inactivity for the optional "organize while away" sweep.
- **Data usage disclosure**: tab URLs/titles are processed locally by domain rules or the browser's on-device model. The extension has no developer-operated backend or analytics. Small manual sessions may sync through Chrome Sync; automatic recovery snapshots stay on the device. Declare that the developer does not collect user data.
- **Privacy policy URL**: `https://krashnakant.github.io/group-tabs/privacy.html` — live via GitHub Pages (source: `privacy.html` in this repo, main branch). Paste into the developer-console privacy tab.
- **Remote code**: declare "No remote code" — true, everything is bundled.

## Submit

1. Dev console → "New item" → upload `group-tabs.zip`.
2. Fill listing, privacy tab, upload screenshots.
3. Set visibility: **Unlisted** first (installable via link, no public search) — sane for a v0.1 shakedown; flip to Public later without re-review of visibility itself.
4. Submit for review. Typical review: 1–3 days; `tabs` permission can push it longer.

## Automated updates after the first publish

The initial listing, privacy questionnaire, and first visibility selection must still be completed manually. After that, `.github/workflows/publish-chrome.yml` tests, packages, uploads, and submits each tagged version for review through Chrome Web Store API v2.

### One-time API setup

1. In Google Cloud, enable **Chrome Web Store API**.
2. Create an **External** OAuth consent screen and add the publisher Google account as a test user.
3. Move the OAuth app to **In production** before generating the refresh token. Tokens issued while the app is in Testing expire after seven days.
4. Create a **Web application** OAuth client with `https://developers.google.com/oauthplayground` as an authorized redirect URI.
5. In OAuth Playground, enable **Use your own OAuth credentials**, authorize `https://www.googleapis.com/auth/chromewebstore` with the publisher account, then exchange the authorization code for a refresh token.
6. In GitHub → repository **Settings → Environments**, create `chrome-web-store`. Restrict deployment tags to `v*`, add the publisher as a required reviewer, and add these environment secrets:
   - `CWS_CLIENT_ID`
   - `CWS_CLIENT_SECRET`
   - `CWS_REFRESH_TOKEN`

The workflow uses publisher `3359ea7f-1e86-4a04-afad-2179a56c07e8` and extension `phgemhmkidohfhckegoemicfjeofnlbp`. These IDs are public and live in the workflow; OAuth credentials must remain protected environment secrets.

### Release a version

1. Bump `version` in `manifest.json` and update `CHANGELOG.md`.
2. Commit and push the release changes.
3. Push a matching tag:

```sh
git tag v0.2.1
git push origin v0.2.1
```

The tag must equal `v` plus the manifest version and point to a commit on `main`. The workflow runs `node test.mjs`, builds only runtime files, waits for upload processing, and calls `publish` with `DEFAULT_PUBLISH`, which submits the version for review and publishes it automatically after approval. Push one release tag at a time: the concurrency group lets the current run finish but retains only the newest pending release.

Official setup reference: https://developer.chrome.com/docs/webstore/using-api

## Microsoft Edge Add-ons (same zip)

Edge runs the extension unchanged, including AI mode (Edge 138+ ships the same Prompt API backed by Phi-4-mini; Brave/Opera/Vivaldi lack it and the UI hides AI options automatically).

1. Register at https://partner.microsoft.com/dashboard/microsoftedge — free, Microsoft account.
2. Upload the same `group-tabs.zip`, reuse the listing text and 1280×800 screenshots.
3. Same privacy answers apply (all processing local, no remote code). Review is typically a few days.
