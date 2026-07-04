// Pure grouping logic — no chrome.* here so it stays testable in node.

export const CATEGORIES = ["Work", "Dev", "Social", "Media", "Shopping", "News", "Docs", "Other"];

// { name: [tabId, ...] } from tab {id, url} objects.
export function byDomain(tabs) {
  const out = {};
  for (const t of tabs) {
    let host;
    try {
      host = new URL(t.url).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    // ponytail: naive eTLD+1 — "foo.co.uk" yields "co"; swap in tldts if it ever matters
    const name = host.split(".").slice(-2)[0];
    (out[name] ??= []).push(t.id);
  }
  return out;
}
