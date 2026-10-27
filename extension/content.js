/* CSS handles insertion, replacement and attribute changes automatically.
 * This script never searches result elements or monitors DOM mutations.
 */
(() => {
  "use strict";
  if (location.pathname !== "/search") return;

  const ATTRIBUTE = "data-search-clean-lite";
  let enabled = true;
  let revision = 0;

  function apply(value) {
    enabled = value !== false;
    const root = document.documentElement;
    const state = enabled ? "on" : "off";
    if (root && root.getAttribute(ATTRIBUTE) !== state) {
      root.setAttribute(ATTRIBUTE, state);
    }
  }

  function readSetting() {
    // Each read and each change invalidates every earlier snapshot, including
    // overlapping reads when a frozen history entry resumes more than once.
    const requestedAt = ++revision;
    function failOpen() {
      apply(false); // A read failure must not keep a saved OFF page hidden.
      console.warn("Search Clean Lite: 設定を読み込めませんでした。ページを再読み込みしてください。");
    }
    try {
      chrome.storage.local.get({enabled: true}, (settings) => {
        const error = chrome.runtime.lastError;
        // A later onChanged event is newer than this asynchronous snapshot.
        if (requestedAt !== revision) return;
        if (error) {
          failOpen();
          return;
        }
        apply(settings.enabled);
      });
    } catch {
      if (requestedAt === revision) failOpen();
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !Object.hasOwn(changes, "enabled")) return;
    revision += 1;
    apply(changes.enabled.newValue);
  });

  // document_start normally has an HTML root. No observer is needed even
  // when injection precedes the root in an unusual document.
  if (!document.documentElement) {
    document.addEventListener("DOMContentLoaded", () => apply(enabled), {once: true});
  }
  // A frozen back/forward-cache page may have missed storage notifications.
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) readSetting();
  });
  readSetting();
})();
