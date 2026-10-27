/* Real Blink rendering, synthetic HTML and mocked chrome.storage.
 * This does NOT load an extension and does NOT access live Google Search.
 * Development-only dependency: playwright (never shipped in extension/).
 */
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const ext = path.join(root, 'extension');
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/search.html'), 'utf8');
const css = fs.readFileSync(path.join(ext, 'content.css'), 'utf8');
const script = fs.readFileSync(path.join(ext, 'content.js'), 'utf8');
const results = [];

function storageMock() {
  const listeners = [];
  const state = {enabled: true};
  window.__mock = {listeners, state, gets: 0, failSet: false, failGet: false};
  window.chrome = {
    runtime: {},
    storage: {
      onChanged: {addListener(fn) { listeners.push(fn); }},
      local: {
        get(defaults, cb) {
          window.__mock.gets++;
          queueMicrotask(() => {
            if (window.__mock.failGet) chrome.runtime.lastError = {message: 'test failure'};
            cb({...defaults, ...state});
            delete chrome.runtime.lastError;
          });
        },
        set(values, cb) {
          queueMicrotask(() => {
            if (window.__mock.failSet) {
              chrome.runtime.lastError = {message: 'test failure'};
              cb();
              delete chrome.runtime.lastError;
              return;
            }
            const oldValue = state.enabled;
            Object.assign(state, values);
            listeners.forEach(fn => fn({enabled: {oldValue, newValue: state.enabled}}, 'local'));
            cb();
          });
        }
      }
    }
  };
  window.__setEnabled = value => {
    const oldValue = state.enabled;
    state.enabled = value;
    listeners.forEach(fn => fn({enabled: {oldValue, newValue: value}}, 'local'));
  };
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    headless: true,
    args: ['--no-sandbox']
  });
  try {
    const context = await browser.newContext({viewport: {width: 1100, height: 900}});
    const requests = [];
    const errors = [];
    context.on('page', p => p.on('pageerror', e => errors.push(String(e))));
    await context.route('**/*', route => {
      requests.push(route.request().url());
      const url = new URL(route.request().url());
      if (url.hostname !== 'search-clean.test') return route.abort();
      if (url.pathname === '/search') {
        const html = fixture.replace('<style>', `<style>${css}\n`);
        return route.fulfill({contentType: 'text/html', body: html});
      }
      const filename = path.basename(url.pathname);
      if (['popup.html', 'popup.css', 'popup.js'].includes(filename)) {
        return route.fulfill({body: fs.readFileSync(path.join(ext, filename)),
          contentType: filename.endsWith('.html') ? 'text/html' : filename.endsWith('.css') ? 'text/css' : 'text/javascript'});
      }
      return route.abort();
    });
    await context.addInitScript(storageMock);
    const page = await context.newPage();
    await page.addInitScript({content: script});
    const test = async (name, fn) => {await fn(); results.push({name, result: 'PASS'});};
    const hidden = async selector => assert.equal(await page.locator(selector).isVisible(), false, selector);
    const visible = async selector => assert.equal(await page.locator(selector).isVisible(), true, selector);
    const preserved = ['#organic-ja','#organic-en','#weather','#maps','#calculator','#class-only','#label-only','#outside','#ai-mode','#rcnt','#rso'];
    await test('日本語・英語見出し、本文、専用枠の非表示と専用余白除去', async () => {
      await page.goto('https://search-clean.test/search?hl=ja');
      await hidden('#ai-wrapper'); await hidden('#ai-heading'); await hidden('#m-x-content');
      assert.equal(await page.locator('#ai-wrapper').evaluate(el => el.getBoundingClientRect().height), 0);
    });
    await test('通常記事・天気・地図・電卓・AIモード入口と共通祖先の維持', async () => {
      for (const selector of preserved) await visible(selector);
    });
    await test('OFFでGoogle側のinline styleと本文を保ったまま復元、ONで再非表示', async () => {
      await page.locator('#ai-wrapper').evaluate(el => el.style.setProperty('display', 'grid'));
      const before = await page.locator('#ai-wrapper').evaluate(el => el.outerHTML);
      await page.evaluate(() => window.__setEnabled(false));
      await visible('#ai-wrapper'); await visible('#m-x-content');
      assert.equal(await page.locator('#ai-wrapper').evaluate(el => getComputedStyle(el).display), 'grid');
      assert.equal(await page.locator('#ai-wrapper').evaluate(el => el.outerHTML), before);
      await page.evaluate(() => window.__setEnabled(true));
      await hidden('#ai-wrapper');
    });
    await test('AI概要なしの結果、単語・aria-label・クラスだけの要素を維持', async () => {
      await page.locator('#ai-wrapper').evaluate(el => el.remove());
      for (const selector of preserved) await visible(selector);
    });
    await test('遅延追加・結果領域全体の差し替えをCSSで処理', async () => {
      await page.locator('#rso').evaluate(el => el.insertAdjacentHTML('afterbegin', '<div id="late" class="Wm5I1e"><h2>AI Overview</h2><div id="m-x-content">Late body</div></div>'));
      await hidden('#late');
      await page.locator('#rcnt').evaluate(el => el.outerHTML = '<div id="rcnt"><div id="replacement" class="hdzaWe"><h2>AIによる概要</h2><div id="m-x-content">Replacement</div></div><article id="new-result"><h3>AI Overviewについての記事</h3></article></div>');
      await hidden('#replacement'); await visible('#new-result');
    });
    await test('data-attrid完全一致のみ処理、部分一致や汎用data-hveidは維持', async () => {
      await page.locator('#rcnt').evaluate(el => el.innerHTML = '<div id="exact-a" data-attrid="AIOverview">A</div><div id="exact-b" data-attrid="ai_overview">B</div><div id="substring" data-attrid="about_AIOverview">Article</div><div id="generic" data-hveid="x">Ordinary</div>');
      await hidden('#exact-a'); await hidden('#exact-b'); await visible('#substring'); await visible('#generic');
    });
    await test('未知の枠は共有結果を保護して本文だけ処理', async () => {
      await page.locator('#rcnt').evaluate(el => el.innerHTML = '<div id="unknown"><h2 id="left-heading">AI Overview</h2><div id="m-x-content">Body</div></div><article id="ordinary">Result</article>');
      await hidden('#m-x-content'); await visible('#left-heading'); await visible('#ordinary');
    });
    await test('100回切り替えと100回追加でlistener増加・追加storage読込なし', async () => {
      const before = await page.evaluate(() => ({gets: __mock.gets, listeners: __mock.listeners.length}));
      await page.evaluate(() => {
        for (let n=0;n<100;n++) {
          __setEnabled(n%2 === 0);
          const item = document.createElement('article'); item.textContent = 'Ordinary '+n;
          document.getElementById('rcnt').append(item);
        }
        __setEnabled(true);
      });
      await hidden('#m-x-content');
      assert.deepEqual(await page.evaluate(() => ({gets: __mock.gets, listeners: __mock.listeners.length})), before);
      assert.equal(await page.locator('#rcnt article').count(), 101);
    });
    await test('英語表示の検証HTMLでも同じ識別子で処理', async () => {
      await page.goto('https://search-clean.test/search?hl=en');
      await page.locator('html').evaluate(el => el.lang = 'en');
      await page.locator('#ai-heading').evaluate(el => el.textContent = 'AI Overview');
      await hidden('#ai-wrapper'); await visible('#organic-en');
    });
    const popup = await context.newPage();
    await test('ポップアップ表示、スイッチ1個、キーボード切替・保存失敗・再試行', async () => {
      await popup.goto('https://search-clean.test/popup.html');
      const input = popup.getByRole('switch', {name: 'AIによる概要を非表示'});
      assert.equal(await popup.getByRole('switch').count(), 1);
      assert.equal(await input.isChecked(), true);
      await input.focus(); await input.press('Space');
      assert.equal(await input.isChecked(), false);
      assert.equal(await popup.locator('#status').innerText(), 'OFF：非表示は無効です');
      await popup.evaluate(() => __mock.failSet = true);
      // The expected rollback makes Playwright.check() fail its postcondition.
      await input.click();
      assert.equal(await input.isChecked(), false);
      assert.match(await popup.locator('#status').innerText(), /保存できませんでした/);
      await popup.evaluate(() => __mock.failSet = false);
      await input.check();
      assert.match(await popup.locator('#status').innerText(), /ON/);
      assert.equal(await popup.locator('body').evaluate(el => el.scrollWidth), 316);
    });
    if (process.env.SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.SCREENSHOT_DIR, {recursive: true});
      await popup.locator('body').screenshot({path: path.join(process.env.SCREENSHOT_DIR, 'popup.png')});
      await page.screenshot({path: path.join(process.env.SCREENSHOT_DIR, 'fixture-on.png')});
    }
    await test('fixture通信はローカル差し替え4ファイルのみ、ページ例外なし', async () => {
      assert(requests.every(u => u.startsWith('https://search-clean.test/')));
      assert.deepEqual(errors, []);
    });
    const source_sha256 = Object.fromEntries(['manifest.json','content.css','content.js','popup.html','popup.css','popup.js'].map(name => [name,crypto.createHash('sha256').update(fs.readFileSync(path.join(ext,name))).digest('hex')]));
    console.log(JSON.stringify({engine: browser.version(), source_version: JSON.parse(fs.readFileSync(path.join(ext,'manifest.json'),'utf8')).version, source_sha256, mode: 'Headless Shell / synthetic fixture / chrome.storage mock; extension NOT loaded; live Google NOT accessed', tests: results, requests, errors}, null, 2));
    await context.close();
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode=1;});
