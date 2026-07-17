import assert from "node:assert";
import { byDomain, domainName, groupAction } from "./grouping.js";

const tabs = [
  { id: 1, url: "https://github.com/foo" },
  { id: 2, url: "https://www.github.com/bar" },
  { id: 3, url: "https://gist.github.com/baz" },
  { id: 4, url: "https://news.ycombinator.com/" },
  { id: 5, url: "chrome://settings" },
  { id: 6, url: "not a url" },
  { id: 7, url: "https://192.168.1.10/x" },
];

const g = byDomain(tabs);
assert.deepStrictEqual(g.github, [1, 2, 3], "github tabs incl. www + subdomain");
assert.deepStrictEqual(g.ycombinator, [4]);
assert.ok(!Object.values(g).flat().includes(6), "invalid url skipped");
assert.deepStrictEqual(g["192.168.1.10"], [7], "IP hosts keep full host, not last-but-one octet");

assert.strictEqual(domainName("https://gist.github.com/baz"), "github");
assert.strictEqual(domainName("https://www.github.com/bar"), "github");
assert.strictEqual(domainName("https://192.168.1.10/x"), "192.168.1.10");
assert.strictEqual(domainName("not a url"), null);
assert.strictEqual(domainName("chrome://settings"), null);

assert.strictEqual(groupAction(undefined, 1), null, "manual grouping keeps singleton domains loose");
assert.strictEqual(groupAction(undefined, 1, true), "create", "idle grouping creates singleton domain groups");

let idleListener;
let messageListener;
let localWrite;
const groupCalls = [];
const ungroupCalls = [];
const groups = [];
const event = (capture) => ({ addListener: (listener) => capture?.(listener) });
const looseTabs = [
  { id: 10, url: "https://github.com/a", windowId: 1, pinned: false, groupId: -1 },
  { id: 11, url: "https://example.com/b", windowId: 1, pinned: false, groupId: -1 },
];

globalThis.chrome = {
  runtime: {
    onConnect: event(),
    onInstalled: event(),
    onMessage: event((listener) => {
      messageListener = listener;
    }),
  },
  commands: { onCommand: event() },
  windows: { getLastFocused: async () => ({ id: 1 }) },
  idle: {
    setDetectionInterval() {},
    onStateChanged: event((listener) => {
      idleListener = listener;
    }),
  },
  tabs: {
    onUpdated: event(),
    query: async () => looseTabs,
    group: async (options) => {
      groupCalls.push(options);
      return 100 + groupCalls.length;
    },
    ungroup: async (tabIds) => ungroupCalls.push(tabIds),
  },
  tabGroups: {
    TAB_GROUP_ID_NONE: -1,
    onCreated: event(),
    onUpdated: event(),
    onRemoved: event(),
    query: async () => groups,
    update: async (id, options) => {
      groups.push({ id, ...options });
    },
  },
  storage: {
    local: { get: async () => ({ idleMode: "domain" }), set: async (value) => { localWrite = value; } },
    session: { get: async () => ({ ownGroups: [] }), set: async () => {} },
    sync: { get: async () => ({}), set: async () => {} },
  },
  alarms: { get: async () => null, create() {}, onAlarm: event() },
};

await import("./background.js");
await idleListener("idle");
assert.deepStrictEqual(groupCalls.map(({ tabIds }) => tabIds), [[10], [11]], "idle sweep groups every loose tab");
assert.deepStrictEqual(
  { grouped: localWrite.idleLastRun.grouped, groups: localWrite.idleLastRun.groups, eligible: localWrite.idleLastRun.eligible, skipped: localWrite.idleLastRun.skipped },
  { grouped: 2, groups: 2, eligible: 2, skipped: 0 },
  "idle sweep records exactly what it changed"
);

groups.splice(0, groups.length, { id: 7, title: "Research", color: "blue", collapsed: false });
for (const tab of looseTabs) tab.groupId = 7;
const request = (message) => new Promise((resolve) => messageListener(message, null, resolve));
const ungrouped = await request({ action: "ungroupAll" });
assert.deepStrictEqual(ungroupCalls, [[10, 11]], "ungroup all targets the current window groups");
assert.deepStrictEqual(ungrouped.groups, [
  { title: "Research", color: "blue", collapsed: false, tabIds: [10, 11] },
], "ungroup returns enough state for undo");

const restored = await request({ action: "restoreGroups", groups: ungrouped.groups });
assert.strictEqual(restored.restored, 2, "undo restores live tabs to their previous group");

const unsupported = await request({ action: "missing" });
assert.match(unsupported.error, /Unsupported action/, "unknown popup actions always receive a response");
delete globalThis.chrome;

console.log("ok");
