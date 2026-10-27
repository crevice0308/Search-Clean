#!/usr/bin/env node
"use strict";

// Node-only unit tests with mock DOM/storage. These do not run a browser and
// do not establish whether current live Google markup matches content.css.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const extension = path.resolve(__dirname, "../extension");
const read = (file) => fs.readFileSync(path.join(extension, file), "utf8");
const popupSource = read("popup.js");
const contentSource = read("content.js");
let passed = 0;

function test(name, callback) {
  try {
    callback();
    passed += 1;
    console.log(`PASS ${passed}: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);
    throw error;
  }
}

function storageBus(initial = {}) {
  const data = { ...initial };
  const contexts = [];
  const gets = [];
  const sets = [];
  function invoke(context, callback, value, error) {
    context.chrome.runtime.lastError = error ? { message: error } : undefined;
    try { callback(value); }
    finally { context.chrome.runtime.lastError = undefined; }
  }
  function emit(changes, area = "local") {
    for (const context of contexts) {
      for (const listener of context.listeners) listener(changes, area);
    }
  }
  return {
    contexts, gets, sets, data, emit,
    connect(options = {}) {
      const context = { listeners: [], getCalls: 0, setCalls: 0, options };
      context.chrome = {
        runtime: {},
        storage: {
          onChanged: { addListener(listener) { context.listeners.push(listener); } },
          local: {
            get(defaults, callback) {
              context.getCalls += 1;
              if (options.throwGet) throw new Error("mock synchronous get error");
              gets.push({ context, callback, value: { ...defaults, ...data } });
            },
            set(values, callback) {
              context.setCalls += 1;
              if (options.throwSet) throw new Error("mock synchronous set error");
              sets.push({ context, callback, value: { ...values } });
            }
          }
        }
      };
      contexts.push(context);
      return context;
    },
    finishGet({ error = "", index = 0 } = {}) {
      const request = gets.splice(index, 1)[0];
      assert.ok(request, "a storage read must be pending");
      invoke(request.context, request.callback, request.value, error);
    },
    finishSet({ error = "", eventFirst = true, beforeCallback = () => {} } = {}) {
      const request = sets.shift();
      assert.ok(request, "a storage write must be pending");
      if (error) {
        invoke(request.context, request.callback, undefined, error);
        return;
      }
      const changes = {};
      for (const [key, value] of Object.entries(request.value)) {
        changes[key] = { oldValue: data[key], newValue: value };
        data[key] = value;
      }
      if (eventFirst) emit(changes);
      beforeCallback();
      invoke(request.context, request.callback);
      if (!eventFirst) emit(changes);
    }
  };
}

function popup(bus, options = {}) {
  const api = bus.connect(options);
  const classes = new Set();
  const input = {
    checked: true, disabled: true, handlers: {},
    addEventListener(event, listener) { this.handlers[event] = listener; }
  };
  const status = {
    textContent: "設定を読み込み中…",
    classList: { toggle(name, value) { if (value) classes.add(name); else classes.delete(name); } }
  };
  const main = { attrs: {}, setAttribute(key, value) { this.attrs[key] = value; } };
  const document = {
    getElementById(id) { return { enabled: input, status }[id]; },
    querySelector(selector) { assert.equal(selector, "main"); return main; }
  };
  vm.runInNewContext(popupSource, { chrome: api.chrome, document }, { filename: "popup.js" });
  return {
    api, input, status, classes, main,
    change(value) { input.checked = value; input.handlers.change(); }
  };
}

function content(bus, options = {}) {
  const api = bus.connect(options);
  const attrs = new Map(Object.entries({ lang: "ja", "data-unrelated": "preserve", style: "color:red" }));
  let writes = 0;
  let scans = 0;
  const root = {
    getAttribute(name) { return attrs.has(name) ? attrs.get(name) : null; },
    setAttribute(name, value) { writes += 1; attrs.set(name, value); }
  };
  const documentEvents = {};
  const windowEvents = {};
  const document = {
    documentElement: options.noRoot ? null : root,
    addEventListener(name, callback, config) {
      assert.equal(documentEvents[name], undefined, "document listener must not duplicate");
      documentEvents[name] = { callback, config };
    },
    querySelector() { scans += 1; throw new Error("unexpected DOM scan"); },
    querySelectorAll() { scans += 1; throw new Error("unexpected DOM scan"); }
  };
  const window = {
    addEventListener(name, callback) {
      assert.equal(windowEvents[name], undefined, "window listener must not duplicate");
      windowEvents[name] = callback;
    }
  };
  const warnings = [];
  vm.runInNewContext(contentSource, {
    chrome: api.chrome, document, window,
    location: { pathname: options.pathname || "/search" },
    console: { warn(message) { warnings.push(message); } },
    MutationObserver() { throw new Error("unexpected DOM observer"); },
    setInterval() { throw new Error("unexpected interval"); }
  }, { filename: "content.js" });
  return {
    api, attrs, document, root, documentEvents, windowEvents, warnings,
    state() { return attrs.get("data-search-clean-lite"); },
    writes() { return writes; }, scans() { return scans; }
  };
}

test("popup: missing setting defaults ON after initial read", () => {
  const bus = storageBus(); const view = popup(bus);
  assert.equal(view.input.disabled, true);
  bus.finishGet();
  assert.equal(view.input.checked, true);
  assert.equal(view.input.disabled, false);
  assert.match(view.status.textContent, /^ON/);
});

test("popup: saved OFF is read without changing storage", () => {
  const bus = storageBus({ enabled: false }); const view = popup(bus); bus.finishGet();
  assert.equal(view.input.checked, false);
  assert.match(view.status.textContent, /^OFF/);
  assert.equal(view.api.setCalls, 0);
});

test("popup: does not report save success before callback", () => {
  const bus = storageBus(); const view = popup(bus); bus.finishGet(); view.change(false);
  assert.equal(view.status.textContent, "保存中…");
  assert.equal(view.input.disabled, true);
  assert.equal(bus.data.enabled, undefined);
  bus.emit({ enabled: { newValue: false } });
  assert.equal(view.status.textContent, "保存中…");
  bus.finishSet();
  assert.match(view.status.textContent, /^OFF/);
  assert.equal(view.input.disabled, false);
});

test("popup: successful save also works when callback precedes event", () => {
  const bus = storageBus(); const view = popup(bus); bus.finishGet(); view.change(false);
  bus.finishSet({ eventFirst: false });
  assert.equal(view.input.checked, false);
  assert.match(view.status.textContent, /^OFF/);
});

test("popup: lastError write failure restores confirmed value and permits retry", () => {
  const bus = storageBus(); const view = popup(bus); bus.finishGet(); view.change(false);
  bus.finishSet({ error: "quota exceeded" });
  assert.equal(view.input.checked, true);
  assert.equal(view.input.disabled, false);
  assert.match(view.status.textContent, /保存できません/);
  assert.equal(view.classes.has("error"), true);
  view.change(false); bus.finishSet();
  assert.match(view.status.textContent, /^OFF/);
  assert.equal(view.classes.has("error"), false);
});

test("popup: synchronous write throw restores value and permits retry", () => {
  const options = { throwSet: true };
  const bus = storageBus({ enabled: false }); const view = popup(bus, options); bus.finishGet();
  view.change(true);
  assert.equal(view.input.checked, false);
  assert.equal(view.input.disabled, false);
  assert.match(view.status.textContent, /保存できません/);
  options.throwSet = false; view.change(true); bus.finishSet();
  assert.match(view.status.textContent, /^ON/);
});

test("popup: lastError initial read failure stays disabled and reports failure", () => {
  const bus = storageBus(); const view = popup(bus); bus.finishGet({ error: "read failed" });
  assert.equal(view.input.disabled, true);
  assert.match(view.status.textContent, /読み込めません/);
});

test("popup: synchronous initial read throw reports failure", () => {
  const bus = storageBus(); const view = popup(bus, { throwGet: true });
  assert.equal(view.input.disabled, true);
  assert.match(view.status.textContent, /読み込めません/);
});

test("popup: a newer storage event wins over stale initial read", () => {
  const bus = storageBus(); const view = popup(bus);
  bus.emit({ enabled: { newValue: false } }); bus.finishGet();
  assert.equal(view.input.checked, false);
  assert.match(view.status.textContent, /^OFF/);
});

test("popup: stale initial error does not overwrite a valid newer event", () => {
  const bus = storageBus(); const view = popup(bus);
  bus.emit({ enabled: { newValue: false } }); bus.finishGet({ error: "old failure" });
  assert.equal(view.input.checked, false);
  assert.equal(view.classes.has("error"), false);
});

test("popup: multiple contexts receive the same saved setting", () => {
  const bus = storageBus(); const a = popup(bus); const b = popup(bus);
  bus.finishGet(); bus.finishGet(); a.change(false); bus.finishSet();
  assert.equal(a.input.checked, false); assert.equal(b.input.checked, false);
  assert.match(b.status.textContent, /^OFF/);
});

test("popup: sync area and unrelated local keys are ignored", () => {
  const bus = storageBus(); const view = popup(bus); bus.finishGet();
  bus.emit({ enabled: { newValue: false } }, "sync");
  bus.emit({ somethingElse: { newValue: false } });
  assert.equal(view.input.checked, true);
});

test("popup: deleted/invalid stored setting restores the ON default", () => {
  const bus = storageBus({ enabled: false }); const view = popup(bus); bus.finishGet();
  bus.emit({ enabled: { oldValue: false } }); assert.equal(view.input.checked, true);
  bus.emit({ enabled: { newValue: "invalid" } }); assert.equal(view.input.checked, true);
});

test("popup: repeated change while saving cannot enqueue another write", () => {
  const bus = storageBus(); const view = popup(bus); bus.finishGet();
  view.change(false); view.change(true);
  assert.equal(view.api.setCalls, 1); bus.finishSet();
});

test("popup: latest external confirmed value survives a failed pending write", () => {
  const bus = storageBus(); const view = popup(bus); bus.finishGet(); view.change(false);
  bus.emit({ enabled: { newValue: false } }); bus.finishSet({ error: "failed" });
  assert.equal(view.input.checked, false);
  assert.match(view.status.textContent, /保存できません/);
});

test("popup: newer external event is preserved when an older successful write callback arrives", () => {
  const bus = storageBus(); const view = popup(bus); bus.finishGet(); view.change(false);
  bus.finishSet({ beforeCallback() {
    bus.data.enabled = true;
    bus.emit({ enabled: { oldValue: false, newValue: true } });
    assert.equal(view.status.textContent, "保存中…");
  } });
  assert.equal(view.input.checked, true);
  assert.match(view.status.textContent, /^ON/);
  assert.equal(bus.data.enabled, true);
});

test("popup: multiple external events during a failing write restore the last confirmed value", () => {
  const bus = storageBus({ enabled: false }); const view = popup(bus); bus.finishGet();
  view.change(true);
  bus.emit({ enabled: { newValue: true } });
  bus.emit({ enabled: { newValue: false } });
  bus.finishSet({ error: "failed" });
  assert.equal(view.input.checked, false);
  assert.equal(view.input.disabled, false);
  assert.match(view.status.textContent, /保存できません/);
});

test("content: initial missing setting applies ON", () => {
  const bus = storageBus(); const view = content(bus); bus.finishGet();
  assert.equal(view.state(), "on"); assert.equal(view.scans(), 0);
});

test("content: initial saved OFF applies off marker and preserves unrelated attributes", () => {
  const bus = storageBus({ enabled: false }); const view = content(bus); bus.finishGet();
  assert.equal(view.state(), "off");
  assert.equal(view.attrs.get("style"), "color:red");
  assert.equal(view.attrs.get("lang"), "ja");
  assert.equal(view.attrs.get("data-unrelated"), "preserve");
  assert.equal(view.attrs.size, 4);
});

test("content: OFF then ON only changes the extension root marker", () => {
  const bus = storageBus(); const view = content(bus); bus.finishGet();
  bus.emit({ enabled: { newValue: false } }); assert.equal(view.state(), "off");
  bus.emit({ enabled: { newValue: true } }); assert.equal(view.state(), "on");
  assert.equal(view.attrs.get("style"), "color:red"); assert.equal(view.attrs.size, 4);
});

test("content: 1000 toggle pairs add no listeners, DOM scans or setting reads", () => {
  const bus = storageBus(); const view = content(bus); bus.finishGet();
  for (let i = 0; i < 1000; i += 1) {
    bus.emit({ enabled: { newValue: false } });
    bus.emit({ enabled: { newValue: true } });
  }
  assert.equal(view.state(), "on"); assert.equal(view.api.listeners.length, 1);
  assert.deepEqual(Object.keys(view.windowEvents), ["pageshow"]);
  assert.equal(view.scans(), 0); assert.equal(view.api.getCalls, 1);
});

test("content/popup: a saved OFF setting is read by newly created contexts", () => {
  const bus = storageBus(); const originalPopup = popup(bus); bus.finishGet();
  originalPopup.change(false); bus.finishSet();
  const newTab = content(bus); const reopenedPopup = popup(bus);
  bus.finishGet(); bus.finishGet();
  assert.equal(newTab.state(), "off");
  assert.equal(reopenedPopup.input.checked, false);
  assert.match(reopenedPopup.status.textContent, /^OFF/);
  assert.equal(newTab.api.setCalls, 0); assert.equal(reopenedPopup.api.setCalls, 0);
});

test("content/popup: a saved ON setting is read by newly created contexts", () => {
  const bus = storageBus({ enabled: false }); const originalPopup = popup(bus); bus.finishGet();
  originalPopup.change(true); bus.finishSet();
  const newTab = content(bus); const reopenedPopup = popup(bus);
  bus.finishGet(); bus.finishGet();
  assert.equal(newTab.state(), "on");
  assert.equal(reopenedPopup.input.checked, true);
  assert.match(reopenedPopup.status.textContent, /^ON/);
});

test("content/popup: serialized OFF storage seeds fresh restart-model contexts", () => {
  const before = storageBus(); const oldPopup = popup(before); before.finishGet();
  oldPopup.change(false); before.finishSet();
  // This is a model of retained bytes, not a browser restart/storage test.
  const retained = JSON.parse(JSON.stringify(before.data));
  const after = storageBus(retained); const newTab = content(after); const newPopup = popup(after);
  after.finishGet(); after.finishGet();
  assert.equal(newTab.state(), "off"); assert.equal(newPopup.input.checked, false);
  assert.equal(after.contexts.length, 2); assert.equal(before.contexts.length, 1);
});

test("content/popup: serialized ON storage seeds fresh restart-model contexts", () => {
  const before = storageBus({ enabled: false }); const oldPopup = popup(before); before.finishGet();
  oldPopup.change(true); before.finishSet();
  const retained = JSON.parse(JSON.stringify(before.data));
  const after = storageBus(retained); const newTab = content(after); const newPopup = popup(after);
  after.finishGet(); after.finishGet();
  assert.equal(newTab.state(), "on"); assert.equal(newPopup.input.checked, true);
});

test("content: repeated identical setting avoids duplicate attribute writes", () => {
  const bus = storageBus(); const view = content(bus); bus.finishGet();
  const before = view.writes();
  for (let i = 0; i < 100; i += 1) bus.emit({ enabled: { newValue: true } });
  assert.equal(view.writes(), before);
});

test("content: multiple tabs and popup receive the same saved setting", () => {
  const bus = storageBus(); const a = content(bus); const b = content(bus); const view = popup(bus);
  bus.finishGet(); bus.finishGet(); bus.finishGet(); view.change(false); bus.finishSet();
  assert.equal(a.state(), "off"); assert.equal(b.state(), "off");
  view.change(true); bus.finishSet();
  assert.equal(a.state(), "on"); assert.equal(b.state(), "on");
});

test("content: storage event wins over stale initial snapshot", () => {
  const bus = storageBus(); const view = content(bus);
  bus.emit({ enabled: { newValue: false } }); bus.finishGet();
  assert.equal(view.state(), "off");
});

test("content: lastError read failure fails open with one short warning", () => {
  const bus = storageBus(); const view = content(bus); bus.finishGet({ error: "failed" });
  assert.equal(view.state(), "off"); assert.equal(view.warnings.length, 1);
});

test("content: synchronous get throw fails open", () => {
  const bus = storageBus(); const view = content(bus, { throwGet: true });
  assert.equal(view.state(), "off"); assert.equal(view.warnings.length, 1);
});

test("content: stale read failure does not override later valid event", () => {
  const bus = storageBus(); const view = content(bus);
  bus.emit({ enabled: { newValue: true } }); bus.finishGet({ error: "old error" });
  assert.equal(view.state(), "on"); assert.equal(view.warnings.length, 0);
});

test("content: BFCache pageshow rereads setting only when persisted", () => {
  const bus = storageBus(); const view = content(bus); bus.finishGet();
  view.windowEvents.pageshow({ persisted: false }); assert.equal(view.api.getCalls, 1);
  bus.data.enabled = false;
  view.windowEvents.pageshow({ persisted: true }); assert.equal(view.api.getCalls, 2);
  bus.finishGet(); assert.equal(view.state(), "off");
});

for (const newest of [true, false]) {
  test(`content: latest of initial + two BFCache reads wins over old successful snapshots (${newest ? "ON" : "OFF"})`, () => {
    const bus = storageBus({ enabled: !newest }); const view = content(bus);
    view.windowEvents.pageshow({ persisted: true });
    bus.data.enabled = newest;
    view.windowEvents.pageshow({ persisted: true });
    assert.equal(bus.gets.length, 3);
    bus.finishGet({ index: 2 });
    const expected = newest ? "on" : "off";
    assert.equal(view.state(), expected);
    const writes = view.writes();
    bus.finishGet({ index: 0 }); assert.equal(view.state(), expected);
    bus.finishGet({ index: 0 }); assert.equal(view.state(), expected);
    assert.equal(view.writes(), writes);
    assert.equal(view.warnings.length, 0);
  });

  test(`content: latest of initial + two BFCache reads ignores old errors (${newest ? "ON" : "OFF"})`, () => {
    const bus = storageBus({ enabled: !newest }); const view = content(bus);
    view.windowEvents.pageshow({ persisted: true });
    bus.data.enabled = newest;
    view.windowEvents.pageshow({ persisted: true });
    bus.finishGet({ index: 2 });
    const expected = newest ? "on" : "off";
    const writes = view.writes();
    // Complete the older BFCache read before the even older initial read.
    bus.finishGet({ index: 1, error: "old BFCache error" });
    assert.equal(view.state(), expected);
    bus.finishGet({ index: 0, error: "old initial error" });
    assert.equal(view.state(), expected);
    assert.equal(view.writes(), writes);
    assert.equal(view.warnings.length, 0);
  });
}

test("content: no-root fallback registers one DOMContentLoaded listener", () => {
  const bus = storageBus({ enabled: false }); const view = content(bus, { noRoot: true });
  bus.finishGet(); assert.equal(view.state(), undefined);
  assert.equal(view.documentEvents.DOMContentLoaded.config.once, true);
  view.document.documentElement = view.root;
  view.documentEvents.DOMContentLoaded.callback(); assert.equal(view.state(), "off");
});

test("content: non-search paths perform no reads, writes, scans or subscriptions", () => {
  for (const pathname of ["/", "/searching", "/search/", "/maps", "/sorry/index"]) {
    const bus = storageBus(); const view = content(bus, { pathname });
    assert.equal(view.api.getCalls, 0); assert.equal(view.api.listeners.length, 0);
    assert.equal(view.writes(), 0); assert.equal(view.scans(), 0);
    assert.deepEqual(Object.keys(view.windowEvents), []);
  }
});

test("content: sync area/unrelated changes ignored and deletion restores ON", () => {
  const bus = storageBus({ enabled: false }); const view = content(bus); bus.finishGet();
  bus.emit({ enabled: { newValue: true } }, "sync"); assert.equal(view.state(), "off");
  bus.emit({ unrelated: { newValue: true } }); assert.equal(view.state(), "off");
  bus.emit({ enabled: { oldValue: false } }); assert.equal(view.state(), "on");
});

test("configuration: Manifest V3, storage/alarms and opt-in native updater only", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "1.0.0");
  assert.deepEqual(manifest.permissions, ["storage", "alarms"]);
  assert.deepEqual(manifest.optional_permissions, ["nativeMessaging"]);
  assert.deepEqual(manifest.background, { service_worker: "updater.js" });
  for (const key of ["host_permissions", "optional_host_permissions", "web_accessible_resources"]) {
    assert.equal(manifest[key], undefined, `${key} must be absent`);
  }
  assert.equal(manifest.content_scripts.length, 1);
  const scripts = manifest.content_scripts[0];
  assert.equal(scripts.run_at, "document_start"); assert.equal(scripts.all_frames, false);
  assert.deepEqual(scripts.js, ["content.js"]); assert.deepEqual(scripts.css, ["content.css"]);
  for (const match of scripts.matches) {
    assert.match(match, /^https:\/\/(?:www\.)?google\.(?:com|co\.jp)\/search(?:\?\*)?$/);
  }
});

test("configuration: no runtime network, polling, DOM observers or page scanning", () => {
  const sources = [popupSource, contentSource, read("popup.html"), read("popup.css"), read("content.css")].join("\n");
  assert.doesNotMatch(sources, /https?:\/\/|@import\b|\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bsendBeacon\s*\(|\bEventSource\b/);
  assert.doesNotMatch(sources, /\bsetInterval\s*\(|\bsetTimeout\s*\(|\bMutationObserver\b|\brequestAnimationFrame\s*\(/);
  assert.doesNotMatch(contentSource, /\bquerySelector(?:All)?\s*\(|\bgetElementsBy\w*\s*\(/);
  assert.match(JSON.parse(read("manifest.json")).content_security_policy.extension_pages, /connect-src 'none'/);
});

console.log(`\n${passed} Node mock/static tests passed. Browser rendering and live Google results are not tested here.`);
