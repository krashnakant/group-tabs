const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);

function setStatus(text, busy = false) {
  const el = $("status");
  el.textContent = "";
  if (busy) el.appendChild(Object.assign(document.createElement("span"), { className: "spin" }));
  el.appendChild(document.createTextNode(text));
}

function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

function runGroup(mode) {
  $("group").disabled = $("ai").disabled = true;
  setStatus("Grouping…", true);
  const port = chrome.runtime.connect({ name: "group" });
  port.onMessage.addListener((m) => {
    if (m.progress) return setStatus(m.progress, true);
    $("group").disabled = $("ai").disabled = false;
    setStatus(
      m.error ??
        (m.grouped
          ? `Grouped ${m.grouped} tabs into ${m.groups} groups (${m.mode})`
          : "Nothing to group")
    );
    port.disconnect();
  });
  port.postMessage({ mode });
}

$("group").onclick = () => runGroup("domain");
$("ai").onclick = () => runGroup("ai");

$("save").onclick = async () => {
  const name = $("saveName").value.trim() || new Date().toLocaleString();
  $("save").disabled = true;
  setStatus("Saving…", true);
  const r = await send({ action: "save", name });
  $("save").disabled = false;
  setStatus(r.error ?? `Saved ${r.saved} groups as "${name}"`);
  $("saveName").value = "";
  refresh();
};

async function refresh() {
  const list = await send({ action: "listSaved" });
  const ul = $("saved");
  ul.textContent = "";

  if (!list.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "None yet — group tabs, then save.";
    ul.append(li);
    return;
  }

  for (const s of list.sort((a, b) => b.savedAt - a.savedAt)) {
    const li = document.createElement("li");

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = s.name;
    name.title = s.name;

    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = `${s.auto ? "auto · " : ""}${s.groups}g · ${s.tabs}t · ${ago(s.savedAt)}`;
    meta.title = s.titles.join("\n");

    const restore = document.createElement("button");
    restore.textContent = "Restore";
    restore.onclick = async () => {
      restore.disabled = true;
      setStatus(`Restoring "${s.name}"…`, true);
      const r = await send({ action: "restore", name: s.name });
      restore.disabled = false;
      setStatus(r.error ?? `Restored ${r.restored} groups`);
    };

    const del = document.createElement("button");
    del.textContent = "✕";
    del.title = "Delete snapshot";
    del.onclick = async () => {
      await send({ action: "removeSaved", name: s.name });
      refresh();
    };

    li.append(name, meta, restore, del);
    ul.append(li);
  }
}

chrome.storage.local.get("autoSaveMins").then(({ autoSaveMins = 0.5 }) => {
  $("autoSave").value = String(autoSaveMins);
});
$("autoSave").onchange = (e) => {
  chrome.storage.local.set({ autoSaveMins: Number(e.target.value) });
};

refresh();
