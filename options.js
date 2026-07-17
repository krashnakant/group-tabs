import { CATEGORIES } from "./grouping.js";

const $ = (id) => document.getElementById(id);
const send = (message) => chrome.runtime.sendMessage(message);

function time(timestamp) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(timestamp);
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function idleSummary(run) {
  if (!run) return "Not run yet.";
  const when = time(run.at);
  if (run.error) return `Last ran ${when}: Failed — ${run.error}`;
  if (!run.eligible) return `Last ran ${when}: Nothing changed — no eligible loose tabs.`;
  if (!run.grouped) return `Last ran ${when}: Nothing changed — ${plural(run.skipped, "tab")} stayed loose.`;
  const fallback = run.fallback ? " using site grouping because AI was unavailable" : "";
  return `Last ran ${when}: Grouped ${plural(run.grouped, "tab")} into ${plural(run.groups, "group")}${fallback}.`;
}

async function load() {
  const [{ autoSaveMins = 0.5, autoGroup = false, idleMode = "off", idleLastRun }, { categories = CATEGORIES }] =
    await Promise.all([chrome.storage.local.get(["autoSaveMins", "autoGroup", "idleMode", "idleLastRun"]), chrome.storage.sync.get("categories")]);

  const value = String(autoSaveMins);
  if (![...$("autoSave").options].some((option) => option.value === value)) {
    $("autoSave").add(new Option(`${autoSaveMins} minutes`, value));
  }
  $("autoSave").value = value;
  $("autoGroup").checked = autoGroup;
  $("idleMode").value = idleMode;
  $("categories").value = categories.join(", ");
  $("idleLastRun").textContent = idleSummary(idleLastRun);
  $("runIdle").disabled = idleMode === "off";
}

$("autoSave").onchange = (event) => chrome.storage.local.set({ autoSaveMins: Number(event.target.value) });
$("autoGroup").onchange = (event) => chrome.storage.local.set({ autoGroup: event.target.checked });
$("idleMode").onchange = (event) => {
  chrome.storage.local.set({ idleMode: event.target.value });
  $("runIdle").disabled = event.target.value === "off";
};
$("categories").onchange = (event) => {
  const categories = event.target.value.split(",").map((value) => value.trim()).filter(Boolean);
  if (categories.length) chrome.storage.sync.set({ categories });
  else chrome.storage.sync.remove("categories");
};

$("runIdle").onclick = async () => {
  $("runIdle").disabled = true;
  $("runIdle").textContent = "Running…";
  const result = await send({ action: "runIdleOrganize" });
  $("idleLastRun").textContent = idleSummary(result.error && !result.at ? { ...result, at: Date.now() } : result);
  $("runIdle").textContent = "Run now";
  $("runIdle").disabled = $("idleMode").value === "off";
};

send({ action: "aiStatus" }).then(async ({ ai }) => {
  if (ai) return;
  $("aiHeading").hidden = $("aiCard").hidden = true;
  $("aiUnavailable").hidden = false;
  [...$("idleMode").options].find((option) => option.value === "ai")?.remove();
  if ($("idleMode").value === "ai") {
    $("idleMode").value = "domain";
    await chrome.storage.local.set({ idleMode: "domain" });
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.idleLastRun) $("idleLastRun").textContent = idleSummary(changes.idleLastRun.newValue);
});

load();
