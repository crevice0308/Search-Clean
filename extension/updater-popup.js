"use strict";
(() => {
  const toggle = document.getElementById("auto-update");
  const button = document.getElementById("update-now");
  const status = document.getElementById("update-status");
  const en = !navigator.language.toLowerCase().startsWith("ja");
  const texts = en ? {
    off: "Automatic updates are off.", ready: "Automatic updates enabled.", checking: "Checking…",
    updated: "Updated. Reopening the extension…", current: "Already up to date.",
    error: "Update unavailable. Check helper installation and signing configuration.",
    denied: "Native messaging permission was not granted.", recent: "Checked recently. Try again later.", busy: "Update already in progress."
  } : {
    off: "自動更新はOFFです。", ready: "自動更新が有効です。", checking: "確認中…",
    updated: "更新しました。拡張機能を再読み込みします。", current: "最新版です。",
    error: "更新できません。補助ツールの導入・署名設定を確認してください。",
    denied: "補助ツールとの通信が許可されませんでした。", recent: "確認済みです。しばらく待ってください。", busy: "更新処理中です。"
  };
  document.getElementById("update-label").textContent = en ? "Automatic updates (optional)" : "自動更新（任意）";
  document.getElementById("update-help").textContent = en
    ? "Requires a separately installed Windows helper and trusted release signing. No helper is installed by this switch."
    : "別途Windows補助ツールの導入と信頼済み署名の設定が必要です。この操作でツールは導入されません。";
  button.textContent = en ? "Check and update now" : "今すぐ確認・更新";
  let busy = false;
  function render(code) { status.textContent = texts[code] || texts.error; }
  function refresh(resultCode) {
    chrome.storage.local.get({ updaterEnabled: false, updaterStatus: "off" }, values => {
      if (chrome.runtime.lastError) { render("error"); return; }
      toggle.checked = values.updaterEnabled === true;
      if (!busy) render(resultCode || values.updaterStatus);
      toggle.disabled = busy; button.disabled = busy;
    });
  }
  function send(message) {
    chrome.runtime.sendMessage(message, result => {
      const failed = chrome.runtime.lastError;
      busy = false; toggle.disabled = false; button.disabled = false;
      refresh(failed ? "error" : result?.status);
    });
  }
  function act(message, needsPermission) {
    if (busy) return;
    busy = true; toggle.disabled = true; button.disabled = true; render("checking");
    if (!needsPermission) { send(message); return; }
    // Must run directly in the user gesture, not from an alarm or content script.
    chrome.permissions.request({ permissions: ["nativeMessaging"] }, granted => {
      const failed = chrome.runtime.lastError;
      if (failed || !granted) {
        busy = false; toggle.disabled = false; button.disabled = false;
        refresh("denied"); return;
      }
      send(message);
    });
  }
  toggle.addEventListener("change", () => act({ action: "configure-updater", enabled: toggle.checked }, toggle.checked));
  button.addEventListener("click", () => act({ action: "update-now" }, true));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.updaterEnabled || changes.updaterStatus)) refresh();
  });
  refresh();
})();
