// Pure grouping logic — no chrome.* here so it stays testable in node.

export const CATEGORIES = ["Work", "Dev", "Social", "Media", "Shopping", "News", "Docs", "Other"];

// tabGroups API has no icon field — emoji in the title is the only way
export const CATEGORY_ICONS = {
  Work: "💼", Dev: "💻", Social: "💬", Media: "🎬",
  Shopping: "🛒", News: "📰", Docs: "📄", Other: "📌",
};

// http(s) URL -> domain name for grouping, or null if invalid/non-http.
export function domainName(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!u.protocol.startsWith("http")) return null;
  const host = u.hostname.replace(/^www\./, "");
  // ponytail: naive eTLD+1 — "foo.co.uk" yields "co"; swap in tldts if it ever matters
  return /^[\d.]+$/.test(host) ? host : (host.split(".").at(-2) ?? host);
}

// ai mode gets an emoji title prefix (tabGroups has no icon field); domain mode stays plain.
// Custom/invented categories get 📁 unless the model already produced its own emoji.
export function formatTitle(mode, name) {
  if (mode !== "ai") return name;
  const icon = CATEGORY_ICONS[name] ?? (/^[\p{L}\p{N}]/u.test(name) ? "📁" : "");
  return `${icon} ${name}`.trim();
}

// Default rule keeps singletons loose; idle sweeps opt in to grouping every tab.
// A singleton always joins an existing same-title group.
export function groupAction(existingGroupId, tabCount, includeSingletons = false) {
  if (existingGroupId !== undefined) return "join";
  return tabCount >= (includeSingletons ? 1 : 2) ? "create" : null;
}

// { name: [tabId, ...] } from tab {id, url} objects.
export function byDomain(tabs) {
  const out = {};
  for (const t of tabs) {
    const name = domainName(t.url);
    if (name === null) continue;
    (out[name] ??= []).push(t.id);
  }
  return out;
}
