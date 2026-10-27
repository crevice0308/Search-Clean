"use strict";
// Only the opt-in updater talks to the local host. Google pages never do.
const UPDATE_ALARM = "search-clean-update";
const DAY = 24 * 60 * 60 * 1000;
let updating = false;
const api = (fn, ...args) => new Promise((resolve, reject) => {
  fn(...args, value => chrome.runtime.lastError
    ? reject(new Error(chrome.runtime.lastError.message)) : resolve(value));
});
const read = () => api(chrome.storage.local.get.bind(chrome.storage.local), {
  updaterEnabled: false, updaterLastAttempt: 0, updaterStatus: "off"
});
const write = values => api(chrome.storage.local.set.bind(chrome.storage.local), values);
async function update(manual = false) {
  if (updating) return { status: "busy" };
  updating = true;
  try {
    const state = await read();
    const permitted = await api(chrome.permissions.contains.bind(chrome.permissions), { permissions: ["nativeMessaging"] });
    if (!permitted || (!manual && state.updaterEnabled !== true)) return { status: "off" };
    const elapsed = Date.now() - state.updaterLastAttempt;
    // Persist before native call, so reload/crash cannot create a retry loop.
    if (elapsed >= 0 && elapsed < (manual ? 60000 : DAY)) return { status: "recent" };
    await write({ updaterLastAttempt: Date.now(), updaterStatus: "checking" });
    const result = await api(chrome.runtime.sendNativeMessage.bind(chrome.runtime),
      "com.searchclean.updater", { protocol: 1, action: "update" });
    if (!result || result.protocol !== 1 || !["updated", "current", "error"].includes(result.status)
        || Object.keys(result).some(k => !["protocol", "status", "code"].includes(k))
        || (result.code !== undefined && typeof result.code !== "string")) throw new Error("Invalid host response");
    // The host has already committed the files. Reload must not depend on a
    // cosmetic status write; the anti-loop timestamp was saved before the call.
    if (result.status === "updated") {
      try { await write({ updaterStatus: result.status }); } catch { /* Still reload committed code. */ }
      chrome.runtime.reload();
    } else await write({ updaterStatus: result.status });
    return { status: result.status };
  } catch {
    try { await write({ updaterStatus: "error" }); } catch { /* Keep existing feature independent. */ }
    return { status: "error" };
  } finally { updating = false; }
}
async function configure(enabled) {
  if (enabled) {
    const permitted = await api(chrome.permissions.contains.bind(chrome.permissions), { permissions: ["nativeMessaging"] });
    if (!permitted) return { status: "denied" };
  }
  await write({ updaterEnabled: enabled, updaterStatus: enabled ? "ready" : "off" });
  if (enabled) {
    chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: 1440, delayInMinutes: 1440 });
    return update();
  }
  await api(chrome.alarms.clear.bind(chrome.alarms), UPDATE_ALARM);
  return { status: "off" };
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("popup.html") || sender.tab
      || !message || Object.keys(message).some(k => !["action", "enabled"].includes(k))) return false;
  let operation;
  if (message.action === "configure-updater" && typeof message.enabled === "boolean") operation = configure(message.enabled);
  else if (message.action === "update-now" && !Object.hasOwn(message, "enabled")) operation = update(true);
  else return false;
  operation.then(respond, () => respond({ status: "error" }));
  return true;
});
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === UPDATE_ALARM) void update(); });
async function startup() {
  try {
    const state = await read();
    if (state.updaterEnabled === true) {
      chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: 1440, delayInMinutes: 1440 });
      await update();
    } else await api(chrome.alarms.clear.bind(chrome.alarms), UPDATE_ALARM);
  } catch { /* Storage unavailable: do not run updater. */ }
}
chrome.runtime.onStartup.addListener(startup);
chrome.runtime.onInstalled.addListener(startup);
