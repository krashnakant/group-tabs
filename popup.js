const $ = (id) => document.getElementById(id);
const UPDATE_MESSAGE = "Reload Group Tabs in chrome://extensions to finish updating.";
async function send(message) {
  try {
    return (await chrome.runtime.sendMessage(message)) ?? { error: UPDATE_MESSAGE };
  } catch {
    return { error: UPDATE_MESSAGE };
  }
}

function setStatus(text, busy = false, action) {
  const status = $("status");
  status.textContent = "";
  if (busy) status.append(Object.assign(document.createElement("span"), { className: "spin" }));
  status.append(document.createTextNode(text));
  if (action) {
    const button = document.createElement("button");
    button.textContent = action.label;
    button.onclick = action.run;
    status.append(button);
  }
}

function ago(timestamp) {
  const minutes = Math.round((Date.now() - timestamp) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function groupResult(result) {
  if (result.error) return result.error;
  if (!result.eligible) return "No eligible loose tabs in this window.";
  if (!result.grouped) return `Nothing grouped. Left ${plural(result.skipped, "tab")} loose.`;
  const skipped = result.skipped ? ` Left ${plural(result.skipped, "single-site tab")} loose.` : "";
  return `Grouped ${plural(result.grouped, "tab")} into ${plural(result.groups, "group")}.${skipped}`;
}

async function refreshSummary() {
  const summary = await send({ action: "windowSummary" });
  if (summary.error) {
    $("summary").textContent = "Reload extension to finish updating";
    setStatus(summary.error);
    return;
  }
  $("summary").textContent = `${plural(summary.loose, "loose tab")} · ${plural(summary.groups, "group")}`;
  $("toggleCollapse").textContent = summary.collapsed ? "Expand groups" : "Collapse groups";
}

function runGroup(mode) {
  $("group").disabled = $("ai").disabled = true;
  setStatus("Organizing…", true);
  const port = chrome.runtime.connect({ name: "group" });
  let done = false;
  port.onDisconnect.addListener(() => {
    if (done) return;
    $("group").disabled = $("ai").disabled = false;
    setStatus("Organizing stopped unexpectedly. Try again.");
  });
  port.onMessage.addListener((message) => {
    if (message.progress) return setStatus(message.progress, true);
    done = true;
    $("group").disabled = $("ai").disabled = false;
    setStatus(groupResult(message));
    refreshSummary();
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
  const result = await send({ action: "save", name });
  $("save").disabled = false;
  setStatus(result.error ?? `Saved ${plural(result.saved, "group")} as “${name}”.`);
  if (!result.error) {
    $("saveName").value = "";
    refreshSessions();
  }
};

$("saveName").addEventListener("keydown", (event) => {
  if (event.key === "Enter") $("save").click();
});

$("ungroupAll").onclick = async () => {
  $("ungroupAll").disabled = true;
  setStatus("Ungrouping…", true);
  const result = await send({ action: "ungroupAll" });
  $("ungroupAll").disabled = false;
  if (result.error || !result.ungrouped) {
    setStatus(result.error ?? "No grouped tabs in this window.");
    return;
  }
  setStatus(`Ungrouped ${plural(result.ungrouped, "tab")}.`, false, {
    label: "Undo",
    run: async () => {
      const restored = await send({ action: "restoreGroups", groups: result.groups });
      setStatus(restored.error ?? `Restored ${plural(restored.restored, "tab")} to its groups.`);
      refreshSummary();
    },
  });
  refreshSummary();
};

$("toggleCollapse").onclick = async () => {
  $("toggleCollapse").disabled = true;
  const result = await send({ action: "toggleCollapse" });
  $("toggleCollapse").disabled = false;
  setStatus(result.error ?? (result.collapsed ? "Collapsed all groups." : "Expanded all groups."));
  refreshSummary();
};

function sessionRow(session) {
  const item = document.createElement("li");
  item.className = "session";

  const top = document.createElement("div");
  top.className = "session-top";
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = session.auto ? "Latest auto-save" : session.name;
  name.title = session.name;

  const remove = document.createElement("button");
  remove.className = "delete";
  remove.textContent = "×";
  remove.setAttribute("aria-label", `Delete ${session.name}`);
  remove.onclick = async () => {
    remove.disabled = true;
    const result = await send({ action: "removeSaved", name: session.name });
    if (result.error) {
      remove.disabled = false;
      setStatus(result.error);
      return;
    }
    await refreshSessions();
    setStatus(`Deleted “${session.name}”.`, false, {
      label: "Undo",
      run: async () => {
        const restored = await send({ action: "restoreSaved", name: session.name, entry: result.entry });
        setStatus(restored.error ?? `Restored “${session.name}”.`);
        refreshSessions();
      },
    });
  };
  top.append(name, remove);

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = `${plural(session.groups, "group")} · ${plural(session.tabs, "tab")} · ${ago(session.savedAt)} · ${session.storage}`;

  const titles = document.createElement("div");
  titles.className = "titles";
  titles.textContent = session.titles.join(" · ");
  titles.title = session.titles.join("\n");

  const restore = document.createElement("button");
  restore.className = "restore";
  restore.textContent = "Restore missing tabs in new window";
  restore.onclick = async () => {
    restore.disabled = true;
    setStatus(`Restoring “${session.name}”…`, true);
    const result = await send({ action: "restore", name: session.name });
    restore.disabled = false;
    setStatus(
      result.error ??
        `Restored ${plural(result.tabs, "tab")} in ${plural(result.restored, "group")}; skipped ${plural(result.skipped, "already-open tab")}.`
    );
  };

  item.append(top, meta, titles, restore);
  return item;
}

async function refreshSessions() {
  const sessions = await send({ action: "listSaved" });
  if (!Array.isArray(sessions)) {
    setStatus(sessions.error ?? UPDATE_MESSAGE);
    return;
  }
  const recovery = sessions.filter((session) => session.auto).sort((a, b) => b.savedAt - a.savedAt)[0];
  const manual = sessions.filter((session) => !session.auto).sort((a, b) => b.savedAt - a.savedAt);

  $("recovery").textContent = "";
  $("recoverySection").hidden = !recovery;
  if (recovery) $("recovery").append(sessionRow(recovery));

  $("saved").textContent = "";
  if (!manual.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "Organize this window, then save it here.";
    $("saved").append(empty);
    return;
  }
  $("saved").append(...manual.map(sessionRow));
}

$("settings").onclick = () => chrome.runtime.openOptionsPage();

send({ action: "aiStatus" }).then(({ ai }) => {
  $("ai").hidden = !ai;
  $("aiUnavailable").hidden = ai;
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.savedGroups) refreshSessions();
});

refreshSummary();
refreshSessions();
