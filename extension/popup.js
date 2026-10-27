"use strict";

(() => {
  const input = document.getElementById("enabled");
  const status = document.getElementById("status");
  const main = document.querySelector("main");
  let confirmed = true;
  let loaded = false;
  let saving = false;
  let pending = true;
  let revision = 0;

  // Missing or invalid values use the initial ON setting.
  const normalize = (value) => typeof value === "boolean" ? value : true;

  function render(error = "") {
    input.checked = saving ? pending : confirmed;
    input.disabled = !loaded || saving;
    main.setAttribute("aria-busy", String(!loaded || saving));
    status.classList.toggle("error", Boolean(error));
    status.textContent = error || (saving
      ? "保存中…"
      : loaded
        ? confirmed ? "ON：非表示が有効です" : "OFF：非表示は無効です"
        : "設定を読み込み中…");
  }

  // Register before reading so a stale initial read cannot undo a newer change.
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !Object.hasOwn(changes, "enabled")) return;
    revision += 1;
    confirmed = normalize(changes.enabled.newValue);
    loaded = true;
    render();
  });

  const initialRevision = revision;
  try {
    chrome.storage.local.get({ enabled: true }, (values) => {
      const error = chrome.runtime.lastError;
      if (revision !== initialRevision) return;
      if (error) {
        render("設定を読み込めません。開き直してください。");
        return;
      }
      confirmed = normalize(values.enabled);
      loaded = true;
      render();
    });
  } catch {
    render("設定を読み込めません。開き直してください。");
  }

  input.addEventListener("change", () => {
    if (!loaded || saving) return;
    pending = input.checked;
    saving = true;
    const writeRevision = revision;
    render();

    function complete(error) {
      // onChanged may have already delivered this write or a newer external one.
      if (!error && revision === writeRevision) confirmed = pending;
      saving = false;
      render(error ? "保存できませんでした。もう一度お試しください。" : "");
    }

    try {
      chrome.storage.local.set({ enabled: pending }, () => {
        complete(chrome.runtime.lastError);
      });
    } catch {
      complete(true);
    }
  });
})();
