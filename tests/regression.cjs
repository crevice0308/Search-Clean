/* Real Blink / self-authored synthetic HTML / mocked extension APIs.
 * This suite does NOT load an extension or access live Google Search.
 * Development dependency: playwright, installed outside extension/.
 */
"use strict";
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const extension = path.join(root, "extension");
const css = fs.readFileSync(path.join(extension, "content.css"), "utf8");
const source = fs.readFileSync(path.join(extension, "content.js"), "utf8");
const fixture = fs.readFileSync(path.join(__dirname, "fixtures/layouts.html"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(extension, "manifest.json"), "utf8"));

function storageMock() {
  const listeners = [];
  const state = { enabled: true };
  const pendingReads = [];
  const mock = { listeners, state, pendingReads, gets: 0, sets: 0, failSet: false, failGet: false };
  window.__mock = mock;
  const defer = new URL(location.href).searchParams.has("defer");
  window.chrome = {
    runtime: {},
    storage: {
      onChanged: { addListener(callback) { listeners.push(callback); } },
      local: {
        get(defaults, callback) {
          mock.gets++;
          const snapshot = { ...defaults, ...state };
          if (defer) { pendingReads.push({ callback, snapshot }); return; }
          queueMicrotask(() => {
            if (mock.failGet) chrome.runtime.lastError = { message: "synthetic failure" };
            callback(snapshot);
            delete chrome.runtime.lastError;
          });
        },
        set(values, callback) {
          mock.sets++;
          queueMicrotask(() => {
            if (mock.failSet) {
              chrome.runtime.lastError = { message: "synthetic failure" };
              callback(); delete chrome.runtime.lastError; return;
            }
            const oldValue = state.enabled;
            Object.assign(state, values);
            listeners.forEach(fn => fn({ enabled: { oldValue, newValue: state.enabled } }, "local"));
            callback();
          });
        }
      }
    }
  };
  window.__setEnabled = value => {
    const oldValue = state.enabled; state.enabled = value;
    listeners.forEach(fn => fn({ enabled: { oldValue, newValue: value } }, "local"));
  };
  window.__finishRead = (index, error = false) => {
    const pending = pendingReads.splice(index, 1)[0];
    if (!pending) throw new Error("No pending read at index " + index);
    if (error) chrome.runtime.lastError = { message: "synthetic read failure" };
    pending.callback(pending.snapshot); delete chrome.runtime.lastError;
  };
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, headless: true, args: ["--no-sandbox"] });
  const results = [];
  const errors = [];
  const requests = [];
  const test = async (name, callback) => {
    try { await callback(); results.push({ name, result: "PASS" }); }
    catch (error) { results.push({ name, result: "FAIL", diagnostic: String(error.stack || error) }); }
  };
  try {
    const context = await browser.newContext({ viewport: { width: 1100, height: 1000 } });
    context.on("page", page => page.on("pageerror", error => errors.push(String(error))));
    await context.route("**/*", route => {
      const url = new URL(route.request().url()); requests.push(url.href);
      if (url.hostname !== "search-clean.test") return route.abort();
      if (url.pathname === "/search") return route.fulfill({ contentType: "text/html", body: fixture.replace("<style>", `<style id="scl-css">${css}\n`) });
      const file = path.basename(url.pathname);
      if (["popup.html", "popup.css", "popup.js"].includes(file)) return route.fulfill({
        body: fs.readFileSync(path.join(extension, file)),
        contentType: file.endsWith(".html") ? "text/html" : file.endsWith(".css") ? "text/css" : "text/javascript"
      });
      return route.abort();
    });
    await context.addInitScript(storageMock);
    const page = await context.newPage();
    await page.addInitScript({ content: source });
    let scenario = 0;
    const reset = async (html, query = "") => {
      await page.goto("https://search-clean.test/search?scenario=" + (++scenario) + query);
      if (html !== undefined) await page.locator("#rcnt").evaluate((element, value) => element.innerHTML = value, html);
    };
    const hidden = async selector => assert.equal(await page.locator(selector).isVisible(), false, selector + " must be hidden");
    const visible = async selector => assert.equal(await page.locator(selector).isVisible(), true, selector + " must remain visible");
    const zeroHeight = async selector => assert.equal(await page.locator(selector).evaluate(element => element.getBoundingClientRect().height), 0, selector + " must have no layout height");

    await test("version is exactly 1.0.0 and CSS rule is parsed by Blink", async () => {
      assert.equal(manifest.version, "1.0.0"); await reset();
      const parsed = await page.locator("#scl-css").evaluate(element => [...element.sheet.cssRules].filter(rule => rule.style?.getPropertyValue("display") === "none").map(rule => rule.selectorText));
      assert.equal(parsed.length, 1); assert.match(parsed[0], /data-attnms/); assert.match(parsed[0], /folsrch/);
    });
    await test("data-attnms hides its complete Japanese heading and body", async () => {
      await reset(); await hidden("#attn-full"); await hidden("#attn-body"); await zeroHeight("#attn-full");
    });
    await test("known frame plus data-attnms hides English heading without body ID", async () => {
      await reset(); await hidden("#known-heading-frame"); await zeroHeight("#known-heading-frame");
    });
    await test("top Kevs9.SLPe5b frame removes its padding and margin box", async () => {
      await reset(); await hidden("#top-space"); await zeroHeight("#top-space");
      assert.equal(await page.locator("#top-space").evaluate(element => getComputedStyle(element).marginTop), "0px");
    });
    await test("middle sole-child chain collapses its dedicated outer frame", async () => {
      await reset(); await hidden("#middle-space"); await zeroHeight("#middle-space");
    });
    await test("middle shared outer frame and ordinary sibling article stay visible", async () => {
      await reset(); await visible("#shared-must-stay"); await visible("#ordinary-shared"); await hidden("#shared-ai");
    });
    await test("folsrch and data-aim=1 placeholder hides before overview content arrives", async () => {
      await reset(); await hidden("#async-placeholder"); await zeroHeight("#async-placeholder");
    });
    await test("ordinary article words, partial attributes and class-only elements stay visible", async () => {
      await reset(); for (const selector of ["#ordinary-async", "#partial-attribute", "#ordinary-title", "#class-only", "#outside-marker"]) await visible(selector);
    });
    await test("normal weather, maps and calculator mock widgets stay visible", async () => {
      await reset(); for (const selector of ["#weather", "#maps", "#calculator"]) await visible(selector);
    });
    await test("all shared result root IDs survive exact marker attributes", async () => {
      for (const id of ["search", "rso", "center_col", "main", "cnt"]) {
        await reset(`<div id="${id}" data-attnms="tc" data-attrid="AIOverview"><article id="normal"><h3>Ordinary</h3></article><div id="actual-ai" data-attnms="tc">AI body</div></div>`);
        await visible("#" + id); await visible("#normal"); await hidden("#actual-ai");
      }
    });
    await test("role=main container and rcnt are protected from marker misassignment", async () => {
      await reset('<div id="role-main" role="main" data-attrid="AIOverview"><h3 id="normal">Ordinary</h3></div>');
      await page.locator("#rcnt").evaluate(element => { element.dataset.attnms = "tc"; element.dataset.attrid = "AIOverview"; });
      await visible("#rcnt"); await visible("#role-main"); await visible("#normal");
    });
    await test("known frame shared with ordinary article preserves the ordinary article", async () => {
      await reset('<div id="shared" class="hdzaWe"><h2>AI Overview</h2><div id="ai" data-attnms="tc">AI</div><article id="normal"><h3>Normal</h3></article></div>');
      await visible("#shared"); await visible("#normal"); await hidden("#ai");
    });
    await test("known frame shared with bare organic h3 preserves its link", async () => {
      await reset('<div id="shared" class="Kevs9 SLPe5b"><div id="ai" data-attnms="tc">AI</div><a id="link" href="#normal"><h3 id="normal">Normal</h3></a></div>');
      await visible("#shared"); await visible("#link"); await visible("#normal"); await hidden("#ai");
    });
    await test("mixed weather, map and calculator widgets protect the named frame", async () => {
      for (const widget of ['<div id="wob_wc">Weather</div>', '<div id="lu_map">Map</div>', '<div id="cwos">4</div>', '<div data-attrid="Weather" id="weather-widget">晴れ</div>']) {
        await reset('<div id="shared" class="hdzaWe"><div id="ai" data-attnms="tc">AI</div>' + widget + '</div>');
        await visible("#shared"); await hidden("#ai");
        assert.equal(await page.locator("#shared > div").last().isVisible(), true);
      }
    });
    await test("h3 citation cards inside an AI marker do not prevent hiding its frame", async () => {
      await reset('<div id="frame" class="hdzaWe"><h2>AI Overview</h2><div data-attnms="tc"><article><h3>Citation</h3><p>AI citation text</p></article></div></div>');
      await hidden("#frame"); await zeroHeight("#frame");
    });
    await test("inline display:block!important cannot expose a matched overview", async () => {
      await reset('<section id="inline" data-attnms="tc" style="display:block!important;height:220px;padding:30px;margin:32px;border:3px solid red"><h2>AI Overview</h2><p>Body</p></section>');
      await hidden("#inline"); await zeroHeight("#inline");
      const old = await page.locator("#inline").getAttribute("style");
      await page.evaluate(() => __setEnabled(false)); await visible("#inline");
      assert.equal(await page.locator("#inline").getAttribute("style"), old);
      assert.equal(await page.locator("#inline").evaluate(element => getComputedStyle(element).height), "220px");
    });
    await test("OFF restores exact source DOM, element identity and event handlers", async () => {
      await reset('<div id="frame" class="hdzaWe" style="display:grid"><h2>AI Overview</h2><div id="m-x-content"><button id="inside">Button</button></div></div><article id="ordinary"><h3>Ordinary</h3></article>');
      await page.evaluate(() => { window.__before = document.getElementById("rcnt").outerHTML; window.__identity = document.getElementById("frame"); window.__clicks = 0; document.getElementById("inside").addEventListener("click", () => window.__clicks++); __setEnabled(false); });
      await visible("#frame"); await page.locator("#inside").click();
      assert.equal(await page.evaluate(() => __clicks), 1);
      assert.equal(await page.evaluate(() => __identity === document.getElementById("frame")), true);
      assert.equal(await page.evaluate(() => document.getElementById("rcnt").outerHTML === __before), true);
      await page.evaluate(() => __setEnabled(true)); await hidden("#frame");
    });
    await test("adding and removing the data-attnms attribute updates CSS automatically", async () => {
      await reset('<section id="candidate"><h2>AI Overview</h2>Body</section>'); await visible("#candidate");
      await page.locator("#candidate").evaluate(element => element.setAttribute("data-attnms", "tc")); await hidden("#candidate");
      await page.locator("#candidate").evaluate(element => element.removeAttribute("data-attnms")); await visible("#candidate");
    });
    await test("later AI marker insertion collapses an already present named heading frame", async () => {
      await reset('<div id="frame" class="hdzaWe"><h2>AI Overview</h2></div>'); await visible("#frame");
      await page.locator("#frame").evaluate(element => element.insertAdjacentHTML("beforeend", '<div data-attnms="tc">Late AI body</div>')); await hidden("#frame");
    });
    await test("same-page replacement of the entire result container is handled by CSS", async () => {
      await reset();
      await page.locator("#rcnt").evaluate(element => element.outerHTML = '<div id="rcnt"><section id="new-ai" data-attnms="tc"><h2>AIによる概要</h2></section><article id="new-normal"><h3>AI Overviewについての記事</h3></article></div>');
      await hidden("#new-ai"); await visible("#new-normal");
    });
    await test("1000 toggles and dynamic replacements do not duplicate subscriptions or storage reads", async () => {
      await reset('<section id="ai" data-attnms="tc"><h2>AI</h2></section><div id="dynamic"></div>');
      const before = await page.evaluate(() => ({ gets: __mock.gets, listeners: __mock.listeners.length }));
      assert.equal(before.listeners, 1);
      await page.evaluate(() => {
        for (let index = 0; index < 1000; index++) {
          __setEnabled(index % 2 === 0);
          document.getElementById("dynamic").innerHTML = '<article><h3>AI Overview ordinary ' + index + '</h3></article>';
        }
        __setEnabled(true);
      });
      await hidden("#ai"); await visible("#dynamic article");
      assert.deepEqual(await page.evaluate(() => ({ gets: __mock.gets, listeners: __mock.listeners.length })), before);
    });
    await test("out-of-order initial and BFCache read completion cannot restore stale ON", async () => {
      await reset('<section id="ai" data-attnms="tc">AI</section>', "&defer");
      await page.evaluate(() => { __mock.state.enabled = false; dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })); __finishRead(1); __finishRead(0); });
      await visible("#ai"); assert.equal(await page.locator("html").getAttribute("data-search-clean-lite"), "off");
    });
    await test("stale failed read cannot override a more recent setting notification", async () => {
      await reset('<section id="ai" data-attnms="tc">AI</section>', "&defer");
      await page.evaluate(() => { __setEnabled(true); __finishRead(0, true); }); await hidden("#ai");
    });
    await test("popup keyboard operation, storage error rollback and retry use the real popup source", async () => {
      const popup = await context.newPage(); await popup.goto("https://search-clean.test/popup.html");
      const control = popup.getByRole("switch", { name: "AIによる概要を非表示" });
      assert.equal(await popup.getByRole("switch").count(), 1); assert.equal(await control.isChecked(), true);
      await control.focus(); await control.press("Space"); assert.equal(await control.isChecked(), false);
      assert.match(await popup.locator("#status").innerText(), /OFF/);
      await popup.evaluate(() => __mock.failSet = true); await control.click();
      assert.equal(await control.isChecked(), false); assert.match(await popup.locator("#status").innerText(), /保存できません/);
      await popup.evaluate(() => __mock.failSet = false); await control.click();
      assert.equal(await control.isChecked(), true); assert.match(await popup.locator("#status").innerText(), /ON/);
      await popup.close();
    });
    await test("fixture network is fully intercepted and there are no uncaught page errors", async () => {
      assert(requests.every(url => url.startsWith("https://search-clean.test/"))); assert.deepEqual(errors, []);
    });
    const hashes = Object.fromEntries(["manifest.json", "content.css", "content.js", "popup.html", "popup.css", "popup.js"].map(file => [file, crypto.createHash("sha256").update(fs.readFileSync(path.join(extension, file))).digest("hex")]));
    const failed = results.filter(result => result.result !== "PASS").length;
    console.log(JSON.stringify({ engine: browser.version(), source_version: manifest.version, mode: "Real Blink rendering; self-authored synthetic HTML; mocked chrome.storage; extension NOT loaded; live Google NOT accessed", source_sha256: hashes, passed: results.length - failed, failed, tests: results, intercepted_request_count: requests.length, errors }, null, 2));
    if (failed) process.exitCode = 1;
    await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
