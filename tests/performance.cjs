/* Synthetic Blink rendering measurement, not a live-search speed guarantee.
 * Runs entirely offline with setContent. Development dependency: playwright.
 */
const {chromium} = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const css = fs.readFileSync(path.join(__dirname, '../extension/content.css'), 'utf8');
const median = values => [...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];

(async () => {
  const browser = await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE || undefined, headless:true, args:['--no-sandbox']});
  try {
    const page = await browser.newPage();
    let networkRequests=0;
    await page.route('**/*', route=>{networkRequests++;return route.abort();});
    const variants = ['none', 'on', 'off'];
    const samples = Object.fromEntries(variants.map(v=>[v,[]]));
    const resultCount = 2000;
    // Ordinary linked titles and a candidate class on every tenth result put
    // pressure on CSS matching without performing any extension JS scans.
    const articles = Array.from({length:resultCount}, (_,i)=>`<div class="${i%10===0?'Wm5I1e':'result'}"><article><a href="#${i}"><h3>AI Overviewについての通常記事 ${i}</h3></a><p>普通の検索結果</p></article></div>`).join('');
    const body = `<div id="rcnt"><div class="Kevs9 SLPe5b"><div data-attnms="1"><h2>AIによる概要</h2><p>AI body</p></div></div><div id="rso">${articles}</div><div id="updates"></div></div>`;
    const commonCSS = 'body{font:14px sans-serif}article{padding:3px;margin:3px 0}h3,p{margin:0}.item{height:1px}';
    for (let round=0;round<6;round++) {
      // Rotate order so one mode is not always the first or last warm run.
      for (let offset=0;offset<variants.length;offset++) {
        const mode=variants[(round+offset)%variants.length];
        await page.setContent(`<html ${mode==='off'?'data-search-clean-lite="off"':''}><style>${commonCSS}${mode==='none'?'':css}</style><body>${body}</body></html>`);
        const ms=await page.evaluate(() => {
          const updates=document.getElementById('updates');
          void document.body.offsetHeight;
          const start=performance.now();
          for(let i=0;i<100;i++) {
            const node=document.createElement('div');node.className='item';node.textContent='Update '+i;
            updates.append(node);
            if(updates.children.length>4)updates.firstElementChild.remove();
            void document.body.offsetHeight;
          }
          return performance.now()-start;
        });
        samples[mode].push(ms);
      }
    }
    console.log(JSON.stringify({
      engine:browser.version(),
      mode:'Synthetic offline rendering benchmark; extension NOT loaded; storage APIs and live Google NOT measured',
      css_sha256:crypto.createHash('sha256').update(css).digest('hex'),
      results_per_page:resultCount, candidate_class_boxes:200, updates_and_forced_layouts_per_sample:100,
      metrics:Object.fromEntries(variants.map(v=>[v,{median_ms:Number(median(samples[v]).toFixed(2)),samples_ms:samples[v].map(x=>Number(x.toFixed(2)))}])),
      network_requests:networkRequests,
      interpretation:'Local workload only; OS scheduling, engine version and fixture shape affect timings. No zero-overhead claim or live-site performance guarantee.'
    },null,2));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
