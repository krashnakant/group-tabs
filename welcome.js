const organize = document.getElementById("organize");
const status = document.getElementById("status");

document.getElementById("settings").onclick = () => chrome.runtime.openOptionsPage();

organize.onclick = () => {
  organize.disabled = true;
  organize.textContent = "Organizing…";
  status.textContent = "";
  const port = chrome.runtime.connect({ name: "group" });
  let done = false;
  port.onDisconnect.addListener(() => {
    if (done) return;
    organize.disabled = false;
    organize.textContent = "Try again";
    status.textContent = "Organizing stopped unexpectedly.";
  });
  port.onMessage.addListener((result) => {
    if (result.progress) {
      status.textContent = result.progress;
      return;
    }
    done = true;
    organize.disabled = false;
    organize.textContent = result.grouped ? "Organized" : "Organize loose tabs now";
    status.textContent = result.error
      ? result.error
      : result.grouped
        ? `Grouped ${result.grouped} tabs into ${result.groups} groups${result.skipped ? `; left ${result.skipped} single-site tabs loose` : ""}.`
        : "No matching loose tabs to group.";
    port.disconnect();
  });
  port.postMessage({ mode: "domain" });
};
