import { byDomain, domainName, formatTitle, groupAction, CATEGORIES } from "./grouping.js";

const COLORS = ["blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange", "grey"];

// Long-lived port for grouping so we can stream progress to the popup.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "group") return;
  port.onMessage.addListener(async (msg) => {
    try {
      const result = await group(msg, (text) => port.postMessage({ progress: text }));
      port.postMessage({ done: true, ...result });
    } catch (e) {
      port.postMessage({ done: true, error: e.message });
    }
  });
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "group-tabs") group({ mode: "domain" }, () => {});
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") chrome.tabs.create({ url: "welcome.html" });
});

// --- Auto-group: new ungrouped http tabs join/create a domain group as they load ---
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  // cheap, no-I/O checks first — storage.get is a real IPC call and this listener
  // fires on every tab load completion, most of which are already grouped/pinned
  if (info.status !== "complete") return;
  if (tab.pinned || tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) return;
  const name = domainName(tab.url ?? "");
  if (!name) return;
  const { autoGroup = false } = await chrome.storage.local.get("autoGroup");
  if (!autoGroup) return;

  const existing = await chrome.tabGroups.query({ windowId: tab.windowId });
  const match = existing.find((g) => g.title === name);
  if (match) {
    await chrome.tabs.group({ tabIds: [tabId], groupId: match.id });
    return;
  }

  const siblings = (
    await chrome.tabs.query({ windowId: tab.windowId, pinned: false, groupId: chrome.tabGroups.TAB_GROUP_ID_NONE })
  ).filter((t) => t.id !== tabId && t.url?.startsWith("http") && domainName(t.url) === name);
  if (!groupAction(undefined, 1 + siblings.length)) return; // singleton stays loose, same rule as group()

  const groupId = await chrome.tabs.group({ tabIds: [tabId, ...siblings.map((t) => t.id)] });
  await chrome.tabGroups.update(groupId, { title: name, color: COLORS[Math.floor(Math.random() * COLORS.length)] });
  const { ownGroups = [] } = await chrome.storage.session.get("ownGroups");
  await chrome.storage.session.set({ ownGroups: [...ownGroups, groupId] });
});

// --- Auto-organize on idle: sweep ungrouped tabs while the user is away ---
chrome.idle.setDetectionInterval(1800); // 30 min of no input
chrome.idle.onStateChanged.addListener((state) => {
  if (state !== "idle") return;
  return runIdleOrganize().catch(console.error);
});

async function runIdleOrganize() {
  const { idleMode = "off" } = await chrome.storage.local.get("idleMode");
  if (idleMode === "off") return { error: "Choose an organize-while-away mode first" };

  const loose = (
    await chrome.tabs.query({
      lastFocusedWindow: true,
      pinned: false,
      groupId: chrome.tabGroups.TAB_GROUP_ID_NONE,
    })
  ).filter((tab) => tab.url?.startsWith("http"));

  let result = { grouped: 0, groups: 0, mode: idleMode };
  let fallback = false;
  try {
    if (loose.length) {
      result = await group({ mode: idleMode, includeSingletons: true }, () => {});
      if (result.error && idleMode === "ai") {
        result = await group({ mode: "domain", includeSingletons: true }, () => {});
        fallback = true;
      }
    }
  } catch (error) {
    result = { error: error.message, grouped: 0, groups: 0, mode: idleMode };
  }

  const record = {
    ...result,
    at: Date.now(),
    requestedMode: idleMode,
    eligible: loose.length,
    skipped: Math.max(0, loose.length - (result.grouped ?? 0)),
    fallback,
  };
  await chrome.storage.local.set({ idleLastRun: record });
  return record;
}

// --- Auto-save: crash recovery snapshots ---
// Any group change schedules a debounced save (each event resets the 30s alarm).
// Keeps the last 3 auto-saves, always in storage.local (sync has write-rate limits).
const AUTO_KEEP = 3;

for (const ev of [chrome.tabGroups.onCreated, chrome.tabGroups.onUpdated, chrome.tabGroups.onRemoved]) {
  ev.addListener(scheduleAutoSave);
}
chrome.tabs.onUpdated.addListener((_id, info) => {
  if (info.groupId !== undefined) scheduleAutoSave();
});

async function scheduleAutoSave() {
  const { autoSaveMins = 0.5 } = await chrome.storage.local.get("autoSaveMins");
  if (!autoSaveMins) return; // off
  // throttle, not debounce — resetting the alarm on every event would postpone
  // the snapshot forever while tabs are churning, which is when recovery matters
  if (await chrome.alarms.get("autosave")) return;
  chrome.alarms.create("autosave", { delayInMinutes: autoSaveMins });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "autosave") return;
  // off-check at fire time too — a pending alarm survives the setting change
  const { autoSaveMins = 0.5 } = await chrome.storage.local.get("autoSaveMins");
  if (!autoSaveMins) return;
  const groups = await chrome.tabGroups.query({});
  // ponytail: no groups → keep last good auto-save (crash-recovery bias over freshness)
  if (!groups.length) return;
  const local = await getLocalSaved();
  const name = `Auto-saved ${new Date().toLocaleTimeString("en-GB")}`; // HH:MM:SS, unique key
  local[name] = { savedAt: Date.now(), auto: true, groups: await snapshotGroups(groups) };
  const autoNames = Object.entries(local)
    .filter(([, s]) => s.auto)
    .sort((a, b) => b[1].savedAt - a[1].savedAt)
    .map(([n]) => n);
  for (const n of autoNames.slice(AUTO_KEEP)) delete local[n];
  await chrome.storage.local.set({ savedGroups: local });
});

// One tabs.query for all groups instead of one per group.
async function snapshotGroups(groups) {
  const tabs = await chrome.tabs.query({});
  return groups.map((g) => ({
    title: g.title,
    color: g.color,
    urls: tabs.filter((t) => t.groupId === g.id).map((t) => t.url),
  }));
}

async function getLocalSaved() {
  return (await chrome.storage.local.get("savedGroups")).savedGroups ?? {};
}
async function getSyncSaved() {
  return (await chrome.storage.sync.get("savedGroups")).savedGroups ?? {};
}
// merges both storage areas — name collision: local wins
async function getSaved() {
  const [sync, local] = await Promise.all([getSyncSaved(), getLocalSaved()]);
  return { ...sync, ...local };
}

// Deletes `name` from both areas, optionally placing `entry` in one of them
// (sync when it fits the 8KB/item quota, else local). Only writes areas that
// actually changed — sync in particular has write-rate limits worth respecting.
async function writeSaved(name, entry) {
  const [local, sync] = await Promise.all([getLocalSaved(), getSyncSaved()]);
  const hadLocal = name in local;
  const hadSync = name in sync;
  delete local[name];
  delete sync[name];
  if (entry) {
    sync[name] = entry;
    // all sync snapshots share one storage item — the 8KB/item quota covers the
    // whole object, so size-check the object, not the entry; overflow goes local
    if (JSON.stringify(sync).length >= 7000) {
      delete sync[name];
      local[name] = entry;
    }
  }
  const writes = [];
  if (hadLocal || name in local) writes.push(chrome.storage.local.set({ savedGroups: local }));
  if (hadSync || name in sync) writes.push(chrome.storage.sync.set({ savedGroups: sync }));
  await Promise.all(writes);
}

const handlers = {
  save,
  restore,
  removeSaved,
  restoreSaved,
  listSaved,
  ungroupAll,
  restoreGroups,
  toggleCollapse,
  windowSummary,
  runIdleOrganize,
  aiStatus,
};
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = Object.hasOwn(handlers, msg.action) ? handlers[msg.action] : undefined;
  if (!handler) {
    sendResponse({ error: `Unsupported action: ${msg.action}. Reload the extension.` });
    return;
  }
  handler(msg)
    .then(sendResponse)
    .catch((e) => sendResponse({ error: e.message }));
  return true; // async response
});

// mode "domain": instant, only ungrouped tabs. mode "ai": also regroups groups WE created
// (tracked in storage.session) — manual groups and pinned tabs are never touched.
async function group({ mode, includeSingletons = false }, onProgress) {
  const { ownGroups = [] } = await chrome.storage.session.get("ownGroups");
  const own = new Set(ownGroups);
  const tabs = (await chrome.tabs.query({ lastFocusedWindow: true, pinned: false })).filter(
    (t) =>
      t.url?.startsWith("http") &&
      (t.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE || (mode === "ai" && own.has(t.groupId)))
  );
  if (!tabs.length) return { grouped: 0, groups: 0, mode, eligible: 0, skipped: 0 };

  let assignment;
  if (mode === "ai") {
    onProgress("Checking built-in AI…");
    assignment = await aiClassify(tabs, onProgress);
    if (!assignment) return { error: "Built-in AI unavailable on this machine" };
  } else {
    assignment = byDomain(tabs);
  }

  let grouped = 0;
  let groups = 0;
  const newIds = [];
  // existing groups by title — same-name tabs join them instead of duplicating
  // (reversed so with duplicate titles the oldest group wins, deterministically)
  const existing = await chrome.tabGroups.query({ windowId: tabs[0].windowId });
  const byTitle = new Map(existing.reverse().map((g) => [g.title, g.id]));
  // shuffle: random colors each run, no repeats until all 9 are used
  const colors = COLORS.map((c) => [Math.random(), c]).sort((a, b) => a[0] - b[0]).map(([, c]) => c);
  for (const [name, tabIds] of Object.entries(assignment)) {
    const title = formatTitle(mode, name);
    const existingId = byTitle.get(title);
    if (!groupAction(existingId, tabIds.length, includeSingletons)) continue;
    let groupId;
    try {
      groupId = await chrome.tabs.group(existingId !== undefined ? { tabIds, groupId: existingId } : { tabIds });
    } catch {
      // existing group emptied mid-loop and auto-removed — create fresh
      if (!groupAction(undefined, tabIds.length, includeSingletons)) continue;
      try {
        groupId = await chrome.tabs.group({ tabIds });
      } catch {
        continue; // tab closed mid-run — skip this group, keep the rest going
      }
    }
    if (groupId !== existingId) {
      await chrome.tabGroups.update(groupId, { title, color: colors[newIds.length % colors.length] });
      newIds.push(groupId);
    }
    grouped += tabIds.length;
    groups++;
  }
  // prune ids of groups that no longer exist so the list can't grow unbounded
  const live = new Set((await chrome.tabGroups.query({})).map((g) => g.id));
  await chrome.storage.session.set({ ownGroups: [...own, ...newIds].filter((id) => live.has(id)) });
  return { grouped, groups, mode, eligible: tabs.length, skipped: Math.max(0, tabs.length - grouped) };
}

// Brave/Edge and older Chromium lack the built-in Prompt API — popup hides AI controls.
async function aiStatus() {
  try {
    return { ai: typeof LanguageModel !== "undefined" && (await LanguageModel.availability()) !== "unavailable" };
  } catch {
    return { ai: false };
  }
}

async function windowSummary() {
  const win = await chrome.windows.getLastFocused();
  const [tabs, groups] = await Promise.all([
    chrome.tabs.query({ windowId: win.id }),
    chrome.tabGroups.query({ windowId: win.id }),
  ]);
  const loose = tabs.filter(
    (tab) => !tab.pinned && tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE && tab.url?.startsWith("http")
  ).length;
  return {
    tabs: tabs.length,
    groups: groups.length,
    loose,
    collapsed: groups.length > 0 && groups.every((group) => group.collapsed),
  };
}

async function ungroupAll() {
  const win = await chrome.windows.getLastFocused();
  const groups = await chrome.tabGroups.query({ windowId: win.id });
  const tabs = await chrome.tabs.query({ windowId: win.id });
  const undo = groups.map((group) => ({
    title: group.title,
    color: group.color,
    collapsed: group.collapsed,
    tabIds: tabs.filter((tab) => tab.groupId === group.id).map((tab) => tab.id),
  }));
  const tabIds = undo.flatMap((group) => group.tabIds);
  if (tabIds.length) await chrome.tabs.ungroup(tabIds);
  return { ungrouped: tabIds.length, groups: undo };
}

async function restoreGroups({ groups }) {
  const live = new Set((await chrome.tabs.query({})).map((tab) => tab.id));
  let restored = 0;
  for (const group of groups) {
    const tabIds = group.tabIds.filter((id) => live.has(id));
    if (!tabIds.length) continue;
    const groupId = await chrome.tabs.group({ tabIds });
    await chrome.tabGroups.update(groupId, {
      title: group.title,
      color: group.color,
      collapsed: group.collapsed,
    });
    restored += tabIds.length;
  }
  return { restored };
}

async function toggleCollapse() {
  const win = await chrome.windows.getLastFocused();
  const groups = await chrome.tabGroups.query({ windowId: win.id });
  if (!groups.length) return { error: "No tab groups" };
  const collapsed = groups.some((group) => !group.collapsed);
  await Promise.all(groups.map((group) => chrome.tabGroups.update(group.id, { collapsed })));
  return { collapsed };
}

// Base session cached while the service worker lives (MV3 kills it after ~30s idle) —
// model load is the expensive part, so rapid re-runs skip it.
let baseSession = null;

async function getBaseSession(onProgress) {
  if (baseSession) return baseSession;
  if (typeof LanguageModel === "undefined") return null;
  // "downloadable"/"downloading" still work — create() triggers the download,
  // and the monitor below streams progress to the popup
  if ((await LanguageModel.availability()) === "unavailable") return null;
  onProgress("Loading on-device model… (first run is slow)");
  baseSession = await LanguageModel.create({
    monitor(m) {
      m.addEventListener("downloadprogress", (e) => onProgress(`Downloading model… ${Math.round(e.loaded * 100)}%`));
    },
    initialPrompts: [
      { role: "system", content: "You group browser tabs. Assign each tab to exactly one category." },
    ],
  });
  return baseSession;
}

// Chrome built-in Prompt API (Gemini Nano). Returns null when unavailable.
async function aiClassify(tabs, onProgress) {
  // model load and prompt() are long silent awaits with no extension-API activity,
  // so MV3 can reap the worker after ~30s — a cheap API ping resets the idle timer
  const keepalive = setInterval(chrome.runtime.getPlatformInfo, 20_000);
  try {
    const base = await getBaseSession(onProgress);
    if (!base) return null;
    // clone: fresh context each run, no conversation buildup toward the token limit
    const session = await base.clone();
    const { categories } = await chrome.storage.sync.get("categories");
    // user-defined list = strict enum (they meant exactly those); default list =
    // open — the model may invent a short category when nothing fits
    const strict = !!categories;
    const known = [...(categories ?? CATEGORIES)];
    const schema = {
      type: "object",
      properties: {
        tabs: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "number" },
              category: strict ? { type: "string", enum: known } : { type: "string", maxLength: 24 },
            },
            required: ["id", "category"],
          },
        },
      },
      required: ["tabs"],
    };

    const validIds = new Set(tabs.map((t) => t.id));
    const batches = Math.ceil(tabs.length / 25);
    const out = {};
    for (let i = 0; i < tabs.length; i += 25) {
      // Nano's context window is small — batch tabs
      onProgress(`AI classifying ${tabs.length} tabs… (${i / 25 + 1}/${batches})`);
      const batch = tabs.slice(i, i + 25);
      const list = batch.map((t) => `${t.id}\t${t.title}\t${new URL(t.url).hostname}`).join("\n");
      const rules = strict
        ? `Categories: ${known.join(", ")}`
        : `Categories: ${known.join(", ")} — pick the best fit; invent a new 1-2 word category ONLY when none fits.`;
      const raw = await session.prompt(`${rules}\nTabs (id, title, host):\n${list}`, {
        responseConstraint: schema,
        omitResponseConstraintInput: true,
      });
      for (const { id, category } of JSON.parse(raw).tabs) {
        if (!validIds.has(id)) continue;
        (out[category] ??= []).push(id);
        // invented categories join the list so later batches reuse them
        if (!known.includes(category)) known.push(category);
      }
    }
    session.destroy();
    return out;
  } catch {
    return null; // any AI failure reported as unavailable
  } finally {
    clearInterval(keepalive);
  }
}

async function save({ name }) {
  const win = await chrome.windows.getLastFocused();
  const groups = await chrome.tabGroups.query({ windowId: win.id });
  if (!groups.length) return { error: "No tab groups in this window" };

  const entry = { savedAt: Date.now(), groups: await snapshotGroups(groups) };
  await writeSaved(name, entry);
  return { saved: groups.length };
}

async function restore({ name }) {
  const snap = (await getSaved())[name];
  if (!snap) return { error: `No saved set named "${name}"` };

  const totalTabs = snap.groups.reduce((count, group) => count + group.urls.length, 0);
  const open = new Set((await chrome.tabs.query({})).map((tab) => tab.url));
  const groups = snap.groups
    .map((group) => ({ ...group, urls: group.urls.filter((url) => !open.has(url)) }))
    .filter((group) => group.urls.length);
  const skipped = totalTabs - groups.reduce((count, group) => count + group.urls.length, 0);
  if (!groups.length) return { error: "All tabs are already open", skipped };

  const firstUrl = groups[0].urls.shift();
  const win = await chrome.windows.create({ url: firstUrl, focused: true });
  const activeTabId = win.tabs[0].id;
  const created = [activeTabId];

  for (const [index, group] of groups.entries()) {
    const tabs = await Promise.all(
      group.urls.map((url) => chrome.tabs.create({ windowId: win.id, url, active: false }))
    );
    const tabIds = (index === 0 ? [activeTabId] : []).concat(tabs.map((tab) => tab.id));
    created.push(...tabs.map((tab) => tab.id));
    const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId: win.id } });
    await chrome.tabGroups.update(groupId, { title: group.title, color: group.color });
  }

  await Promise.allSettled(created.filter((id) => id !== activeTabId).map((id) => chrome.tabs.discard(id)));
  return { restored: groups.length, tabs: created.length, skipped };
}

async function removeSaved({ name }) {
  const entry = (await getSaved())[name];
  if (!entry) return { error: `No saved set named "${name}"` };
  await writeSaved(name);
  return { ok: true, entry };
}

async function restoreSaved({ name, entry }) {
  await writeSaved(name, entry);
  return { ok: true };
}

async function listSaved() {
  const [sync, local] = await Promise.all([getSyncSaved(), getLocalSaved()]);
  return Object.entries({ ...sync, ...local }).map(([name, snapshot]) => ({
    name,
    savedAt: snapshot.savedAt,
    auto: !!snapshot.auto,
    storage: name in local ? "device" : "Chrome Sync",
    groups: snapshot.groups.length,
    tabs: snapshot.groups.reduce((count, group) => count + group.urls.length, 0),
    titles: snapshot.groups.map((group) => `${group.title || "Untitled"} (${group.urls.length})`),
  }));
}
