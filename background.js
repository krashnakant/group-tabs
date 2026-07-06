import { byDomain, CATEGORIES } from "./grouping.js";

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

// --- Auto-save: crash recovery snapshot ---
// Any group change schedules a debounced save (each event resets the 30s alarm).
const AUTO_NAME = "Auto-saved (crash recovery)";

for (const ev of [chrome.tabGroups.onCreated, chrome.tabGroups.onUpdated, chrome.tabGroups.onRemoved]) {
  ev.addListener(scheduleAutoSave);
}
chrome.tabs.onUpdated.addListener((_id, info) => {
  if (info.groupId !== undefined) scheduleAutoSave();
});

function scheduleAutoSave() {
  chrome.alarms.create("autosave", { delayInMinutes: 0.5 });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "autosave") return;
  const groups = await chrome.tabGroups.query({});
  // ponytail: no groups → keep last good auto-save (crash-recovery bias over freshness)
  if (!groups.length) return;
  const snapshot = [];
  for (const g of groups) {
    const tabs = await chrome.tabs.query({ groupId: g.id });
    snapshot.push({ title: g.title, color: g.color, urls: tabs.map((t) => t.url) });
  }
  const { savedGroups = {} } = await chrome.storage.local.get("savedGroups");
  savedGroups[AUTO_NAME] = { savedAt: Date.now(), auto: true, groups: snapshot };
  await chrome.storage.local.set({ savedGroups });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handlers = { save, restore, removeSaved, listSaved };
  const handler = handlers[msg.action];
  if (!handler) return;
  handler(msg)
    .then(sendResponse)
    .catch((e) => sendResponse({ error: e.message }));
  return true; // async response
});

// mode "domain": instant, only ungrouped tabs. mode "ai": also regroups groups WE created
// (tracked in storage.session) — manual groups and pinned tabs are never touched.
async function group({ mode }, onProgress) {
  const { ownGroups = [] } = await chrome.storage.session.get("ownGroups");
  const own = new Set(ownGroups);
  const tabs = (await chrome.tabs.query({ lastFocusedWindow: true, pinned: false })).filter(
    (t) =>
      t.url?.startsWith("http") &&
      (t.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE || (mode === "ai" && own.has(t.groupId)))
  );
  if (!tabs.length) return { grouped: 0, groups: 0, mode };

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
  // shuffle: random colors each run, no repeats until all 9 are used
  const colors = [...COLORS].sort(() => Math.random() - 0.5);
  for (const [name, tabIds] of Object.entries(assignment)) {
    if (tabIds.length < 2) continue; // singletons stay loose
    const groupId = await chrome.tabs.group({ tabIds });
    await chrome.tabGroups.update(groupId, { title: name, color: colors[groups % colors.length] });
    newIds.push(groupId);
    grouped += tabIds.length;
    groups++;
  }
  await chrome.storage.session.set({ ownGroups: [...own, ...newIds] });
  return { grouped, groups, mode };
}

// Base session cached while the service worker lives (MV3 kills it after ~30s idle) —
// model load is the expensive part, so rapid re-runs skip it.
let baseSession = null;

async function getBaseSession(onProgress) {
  if (baseSession) return baseSession;
  if (typeof LanguageModel === "undefined") return null;
  if ((await LanguageModel.availability()) !== "available") return null;
  onProgress("Loading on-device model… (first run is slow)");
  baseSession = await LanguageModel.create({
    initialPrompts: [
      { role: "system", content: "You group browser tabs. Assign each tab to exactly one category." },
    ],
  });
  return baseSession;
}

// Chrome built-in Prompt API (Gemini Nano). Returns null when unavailable.
async function aiClassify(tabs, onProgress) {
  try {
    const base = await getBaseSession(onProgress);
    if (!base) return null;
    // clone: fresh context each run, no conversation buildup toward the token limit
    const session = await base.clone();
    const schema = {
      type: "object",
      properties: {
        tabs: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "number" },
              category: { type: "string", enum: CATEGORIES },
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
      const raw = await session.prompt(
        `Categories: ${CATEGORIES.join(", ")}\nTabs (id, title, host):\n${list}`,
        { responseConstraint: schema, omitResponseConstraintInput: true }
      );
      for (const { id, category } of JSON.parse(raw).tabs) {
        if (validIds.has(id)) (out[category] ??= []).push(id);
      }
    }
    session.destroy();
    return out;
  } catch {
    return null; // any AI failure reported as unavailable
  }
}

async function save({ name }) {
  const win = await chrome.windows.getLastFocused();
  const groups = await chrome.tabGroups.query({ windowId: win.id });
  if (!groups.length) return { error: "No tab groups in this window" };

  const snapshot = [];
  for (const g of groups) {
    const tabs = await chrome.tabs.query({ groupId: g.id });
    snapshot.push({ title: g.title, color: g.color, urls: tabs.map((t) => t.url) });
  }
  const { savedGroups = {} } = await chrome.storage.local.get("savedGroups");
  savedGroups[name] = { savedAt: Date.now(), groups: snapshot };
  await chrome.storage.local.set({ savedGroups });
  return { saved: snapshot.length };
}

async function restore({ name }) {
  const { savedGroups = {} } = await chrome.storage.local.get("savedGroups");
  const snap = savedGroups[name];
  if (!snap) return { error: `No saved set named "${name}"` };

  for (const g of snap.groups) {
    const tabs = await Promise.all(g.urls.map((url) => chrome.tabs.create({ url, active: false })));
    const groupId = await chrome.tabs.group({ tabIds: tabs.map((t) => t.id) });
    await chrome.tabGroups.update(groupId, { title: g.title, color: g.color });
  }
  return { restored: snap.groups.length };
}

async function removeSaved({ name }) {
  const { savedGroups = {} } = await chrome.storage.local.get("savedGroups");
  delete savedGroups[name];
  await chrome.storage.local.set({ savedGroups });
  return { ok: true };
}

async function listSaved() {
  const { savedGroups = {} } = await chrome.storage.local.get("savedGroups");
  return Object.entries(savedGroups).map(([name, s]) => ({
    name,
    savedAt: s.savedAt,
    auto: !!s.auto,
    groups: s.groups.length,
    tabs: s.groups.reduce((n, g) => n + g.urls.length, 0),
    titles: s.groups.map((g) => `${g.title || "(untitled)"} (${g.urls.length})`),
  }));
}
