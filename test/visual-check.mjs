// Optional real-browser visual QA. Uses installed Edge and Node's built-in CDP
// client; no npm packages, real conversations, or existing browser profile.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const output = join(project, '.verification', 'visual-v2');
const profile = join(output, `edge-profile-${process.pid}`);
const assets = join(project, 'plugin', 'sidecars', 'context_glance');
const browserExe = process.env.CONTEXT_GLANCE_EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const conversationId = '00000000-0000-4000-a000-000000000001';
const paletteNames = ['host', 'midnight', 'jade', 'iris', 'paper', 'graphite'];
const fontSizes = ['compact', 'standard', 'large'];
const results = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
await mkdir(profile, { recursive: true });
assert.ok(existsSync(browserExe), 'Installed Edge not found');

const snapshot = {
  conversationId, status: 'ok', source: 'native-context',
  currentModel: { name: 'Gemini 3.8 Flash (High)', id: 'gemini-3.8-flash-n', source: 'request' },
  updatedAt: '2026-11-12T09:24:37.000Z', logModifiedAt: '2026-11-12T09:24:37.000Z', scanTruncated: false,
  metrics: {
    inputTokens: 2480, cacheReadTokens: 138412, outputTokens: 2011, promptTokens: 140892,
    usedTokens: 142903, capacityTokens: 256000, capacitySource: 'native', nativeEstimate: true,
    percent: 142903 / 256000 * 100, stepIndex: 225, model: 'Gemini 3.8 Flash', cachePercent: 138412 / 140892 * 100,
  },
  history: Array.from({ length: 18 }, (_, index) => ({ stepIndex: 208 + index, usedTokens: 120000 + Math.round(index / 17 * 22903), createdAt: '2026-11-12T09:24:37.000Z' })),
};
let activeSnapshot = snapshot;
let replyStatus = 200;
const mockPreload = `window.__snapshotRequestCount=0;window.sidecar={conversationId:${JSON.stringify(conversationId)},fetch:(url,options)=>{if(String(url).startsWith('/api/snapshot'))window.__snapshotRequestCount++;return window.fetch(url,options)}};
document.documentElement.style.setProperty('--background','#161a24');
document.documentElement.style.setProperty('--foreground','#e8edf5');
document.documentElement.style.setProperty('--muted-foreground','#a1acbe');
document.documentElement.style.setProperty('--primary','#8ab5ff');
document.addEventListener('DOMContentLoaded',()=>{
document.body.style.background='var(--background, #fafafa)';
document.body.style.color='var(--foreground, #333)';
document.body.style.fontFamily='-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
});`;

const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/api/snapshot') {
    const capacity = Number(url.searchParams.get('capacity'));
    const payload = activeSnapshot.metrics && Number.isSafeInteger(capacity) && capacity >= 1024 && capacity <= 100000000
      ? { ...activeSnapshot, metrics: { ...activeSnapshot.metrics, capacityTokens: capacity, capacitySource: 'manual', percent: activeSnapshot.metrics.usedTokens * 100 / capacity } }
      : activeSnapshot;
    response.writeHead(replyStatus, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(payload)); return;
  }
  if (url.pathname === '/preload.js') {
    response.writeHead(200, { 'Content-Type': 'application/javascript' });
    response.end(mockPreload); return;
  }
  const names = { '/': ['index.html', 'text/html'], '/styles.css': ['styles.css', 'text/css'], '/i18n.js': ['i18n.js', 'application/javascript'], '/dashboard.js': ['dashboard.js', 'application/javascript'] };
  if (!names[url.pathname]) { response.writeHead(404); response.end(); return; }
  try {
    const [name, type] = names[url.pathname];
    response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
    response.end(await readFile(join(assets, name)));
  } catch (error) { response.writeHead(500); response.end(error.message); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const pageUrl = `http://127.0.0.1:${server.address().port}/?conversationId=${conversationId}`;

let stderr = '';
const browser = spawn(browserExe, [
  '--headless=new', '--disable-gpu', '--remote-debugging-port=0',
  `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--disable-component-update', '--disable-sync',
  '--disable-extensions', '--hide-scrollbars', 'about:blank',
], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
browser.stderr.on('data', b => { stderr += b.toString(); });
let socket;
let sequence = 0;
const requests = new Map();

try {
  let port;
  for (let i = 0; i < 60; i++) {
    try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); if (port) break; } catch {}
    if (browser.exitCode !== null) throw new Error(`Edge exited: ${browser.exitCode}: ${stderr.slice(-800)}`);
    await delay(100);
  }
  assert.ok(port, 'Edge DevTools port unavailable: ' + stderr.slice(-800));
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = tabs.find(tab => tab.type === 'page');
  assert.ok(target?.webSocketDebuggerUrl, 'No Edge page target');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const pending = requests.get(message.id);
    requests.delete(message.id);
    if (message.error) pending?.reject(new Error(message.error.message));
    else pending?.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    requests.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + result.exceptionDetails.exception?.description);
    return result.result.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('DOM.enable');
  await send('CSS.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: pageUrl });
  for (let i = 0; i < 50; i++) {
    if (await evaluate(`document.querySelector('#percentage')?.textContent.includes('55.8') && !!document.querySelector('#remaining-count')`)) break;
    await delay(100);
  }
  assert.ok(await evaluate(`document.querySelector('#percentage')?.textContent.includes('55.8') && !!document.querySelector('#remaining-count')`), 'Updated dashboard not ready');
  assert.equal(await evaluate(`document.documentElement.lang`), await evaluate(`/^zh/i.test(navigator.language)?'zh-CN':'en'`), 'Initial language follows browser');
  const setLanguage = async language => {
    const state = await evaluate(`(()=>{const select=document.querySelector('#language-select');if(!select)throw Error('Missing language select');const before=window.__snapshotRequestCount;select.value=${JSON.stringify(language)};select.dispatchEvent(new Event('change',{bubbles:true}));return {before,after:window.__snapshotRequestCount,lang:document.documentElement.lang,percentage:document.querySelector('#percentage').textContent};})()`);
    assert.equal(state.lang, language, 'Language switches immediately');
    assert.equal(state.after, state.before, 'Language change must not fetch a snapshot');
    return state;
  };
  await setLanguage('zh-CN');
  assert.equal(await evaluate(`document.querySelector('#remaining-count').textContent.replace(/[^0-9]/g,'')`), '113097');
  assert.equal(await evaluate(`document.querySelector('#current-model-name').textContent`), 'Gemini 3.8 Flash (High)');
  assert.equal(await evaluate(`document.querySelector('#current-model-id').textContent`), 'gemini-3.8-flash-n');
  assert.equal(await evaluate(`document.querySelector('#current-model-status').textContent`), '最近一次请求的模型');
  assert.ok(await evaluate(`document.querySelector('#usage-health').textContent.trim().length > 0`));
  await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  const { root: documentRoot } = await send('DOM.getDocument');
  const platformFonts = {};
  for (const selector of ['h1', '.brand-kicker', '#percentage']) {
    const { nodeId } = await send('DOM.querySelector', { nodeId: documentRoot.nodeId, selector });
    platformFonts[selector] = (await send('CSS.getPlatformFontsForNode', { nodeId })).fonts;
  }

  const swatches = await evaluate(`Array.from(document.querySelectorAll('button[data-palette]')).map(el=>el.dataset.palette)`);
  for (const name of paletteNames) assert.ok(swatches.includes(name), `Missing palette ${name}`);
  const screenshots = [];
  const capture = async name => {
    await delay(80);
    const dimensions = await evaluate(`(()=>{const text=[];const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);while(walker.nextNode()){const node=walker.currentNode,parent=node.parentElement;if(node.textContent.trim()&&parent?.getClientRects().length){const style=getComputedStyle(parent);if(style.visibility!=='hidden')text.push({size:parseFloat(style.fontSize),text:node.textContent.trim().slice(0,30)});}}const smallest=text.sort((a,b)=>a.size-b.size).slice(0,3);return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,height:document.documentElement.scrollHeight,palette:document.documentElement.dataset.palette,font:document.documentElement.dataset.fontSize,rootFont:getComputedStyle(document.documentElement).fontSize,bodyFont:getComputedStyle(document.body).fontFamily,fg:getComputedStyle(document.body).color,bg:getComputedStyle(document.body).backgroundColor,smallest};})()`);
    const layout = await send('Page.getLayoutMetrics');
    const png = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: dimensions.width, height: Math.min(layout.cssContentSize.height, 2200), scale: 1 } });
    const filename = join(output, `${name}.png`);
    await writeFile(filename, Buffer.from(png.data, 'base64'));
    screenshots.push(filename);
    results.push({ case: name, ...dimensions });
    assert.ok(dimensions.scrollWidth <= dimensions.width && dimensions.bodyWidth <= dimensions.width, `Horizontal overflow ${name}: ${JSON.stringify(dimensions)}`);
    assert.ok(dimensions.smallest.every(item=>item.size>=11), `Text too small ${name}: ${JSON.stringify(dimensions.smallest)}`);
    if (name.startsWith('english-')) {
      const wrappedChoices = await evaluate(`Array.from(document.querySelectorAll('.font-choice')).filter(button=>{const range=document.createRange();range.selectNodeContents(button);return Array.from(range.getClientRects()).filter(rect=>rect.width>0&&rect.height>0).length>1;}).map(button=>button.textContent)`);
      assert.deepEqual(wrappedChoices, [], `Wrapped English font labels: ${name}`);
    }
    if (dimensions.palette === 'paper') {
      const channels = dimensions.bg.match(/[0-9.]+/g)?.slice(0,3).map(Number);
      assert.ok(channels?.every(channel=>channel>190), 'Explicit paper palette overridden by preload: ' + dimensions.bg);
    }
  };

  for (const name of paletteNames) {
    await evaluate(`document.querySelector('button[data-palette="${name}"]').click()`);
    assert.equal(await evaluate(`document.documentElement.dataset.palette`), name);
    assert.equal(await evaluate(`document.querySelector('button[data-palette="${name}"]').getAttribute('aria-pressed')`), 'true');
    await capture(`${name}-320-standard`);
  }
  for (const font of fontSizes) {
    await evaluate(`document.querySelector('button[data-font-size="${font}"]').click()`);
    assert.equal(await evaluate(`document.documentElement.dataset.fontSize`), font);
    for (const width of [280, 320, 600]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
      await capture(`graphite-${width}-${font}`);
    }
  }
  await evaluate(`document.querySelector('button[data-palette="paper"]').click();document.querySelector('button[data-font-size="large"]').click();`);
  await send('Page.reload', { ignoreCache: true });
  for (let i = 0; i < 40; i++) {
    if (await evaluate(`document.documentElement.dataset.palette==='paper'&&document.documentElement.dataset.fontSize==='large'&&document.querySelector('#percentage')?.textContent.includes('55.8')`)) break;
    await delay(100);
  }
  assert.equal(await evaluate(`document.documentElement.dataset.palette`), 'paper', 'Palette persistence');
  assert.equal(await evaluate(`document.documentElement.dataset.fontSize`), 'large', 'Font persistence');
  await capture('paper-600-large-restored');

  // Exercise English on the same live page: changing language must preserve
  // the conversation data and every independent user preference.
  const preferencesBefore = await evaluate(`({palette:document.documentElement.dataset.palette,font:document.documentElement.dataset.fontSize,percentage:document.querySelector('#percentage').textContent,model:document.querySelector('#current-model-name').textContent})`);
  await setLanguage('en');
  assert.deepEqual(await evaluate(`({palette:document.documentElement.dataset.palette,font:document.documentElement.dataset.fontSize,percentage:document.querySelector('#percentage').textContent,model:document.querySelector('#current-model-name').textContent})`), preferencesBefore, 'Language changes preserve data and appearance');
  const assertEnglish = async label => {
    const leftovers = await evaluate(`(()=>{const found=[];const cjk=/[\\u3400-\\u9fff]/;const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);while(walker.nextNode()){const n=walker.currentNode;if(n.parentElement?.closest('#language-select'))continue;if(cjk.test(n.textContent))found.push(n.textContent.trim().slice(0,160));}for(const el of document.querySelectorAll('[title],[aria-label],[placeholder]')){if(el.closest('#language-select'))continue;for(const key of ['title','aria-label','placeholder']){const value=el.getAttribute(key);if(value&&cjk.test(value))found.push(key+': '+value);}}if(cjk.test(document.title))found.push('document title: '+document.title);return found;})()`);
    assert.deepEqual(leftovers, [], `Untranslated English text/attributes: ${label}`);
  };
  await assertEnglish('initial English view');
  await evaluate(`document.querySelector('button[data-palette="midnight"]').click();document.querySelector('button[data-font-size="standard"]').click();`);
  await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 1000, deviceScaleFactor: 1, mobile: false });
  await capture('english-midnight-320-standard');
  for (const font of fontSizes) {
    await evaluate(`document.querySelector('button[data-font-size="${font}"]').click()`);
    for (const width of [280, 320, 600]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
      await assertEnglish(`width ${width}, font ${font}`);
      await capture(`english-midnight-${width}-${font}`);
    }
  }
  await evaluate(`document.querySelector('button[data-palette="paper"]').click();document.querySelector('button[data-font-size="large"]').click();`);
  await send('Page.reload', { ignoreCache: true });
  for (let i = 0; i < 40; i++) {
    if (await evaluate(`document.documentElement.lang==='en'&&document.querySelector('#percentage')?.textContent.includes('55.8')`)) break;
    await delay(100);
  }
  assert.equal(await evaluate(`document.documentElement.lang`), 'en', 'Language persistence');
  assert.equal(await evaluate(`document.documentElement.dataset.palette`), 'paper', 'Palette preserved with saved language');
  assert.equal(await evaluate(`document.documentElement.dataset.fontSize`), 'large', 'Font preserved with saved language');
  await assertEnglish('English after reload');
  await capture('english-paper-600-large');

  const showSnapshot = async (value, status = 200) => {
    activeSnapshot = value;
    replyStatus = status;
    await evaluate(`document.querySelector('#refresh').click()`);
    await delay(150);
  };
  for (const status of ['waiting', 'unavailable', 'invalid-conversation', 'no-conversation']) {
    await showSnapshot({ conversationId, status, message: '仅用于验证：后端中文信息不应泄漏到英文界面。', metrics: null, currentModel: null, history: [] });
    await assertEnglish(`status ${status}`);
    assert.ok(await evaluate(`document.querySelector('#status-label').textContent.trim().length>0`), `Missing status ${status}`);
  }
  await showSnapshot(snapshot, 503);
  await assertEnglish('HTTP failure');
  await showSnapshot({ ...snapshot, currentModel: null, metrics: { ...snapshot.metrics, model: null } });
  await assertEnglish('Unknown model');
  assert.notEqual(await evaluate(`document.querySelector('#current-model-name').textContent`), snapshot.currentModel.name, 'Unknown model must clear stale name');

  await showSnapshot(snapshot);
  await evaluate(`(()=>{document.querySelector('.settings-panel').open=true;const select=document.querySelector('#capacity-select');select.value='custom';select.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#custom-capacity').value='1';document.querySelector('#apply-capacity').click();})()`);
  await assertEnglish('Invalid custom capacity');
  assert.ok(await evaluate(`document.querySelector('#capacity-help').classList.contains('error')`), 'Custom validation visible');
  await evaluate(`document.querySelector('#custom-capacity').value='200000';document.querySelector('#apply-capacity').click()`);
  await delay(150);
  await assertEnglish('Manual capacity');
  assert.ok(await evaluate(`document.querySelector('#percentage').textContent.includes('71.5')`), 'Manual capacity remains functional in English');
  await setLanguage('zh-CN');
  assert.ok(await evaluate(`document.querySelector('#percentage').textContent.includes('71.5')`), 'Language toggle keeps manual capacity');
  assert.equal(await evaluate(`document.querySelector('#capacity-count').textContent.replace(/[^0-9]/g,'')`), '200000');
  await setLanguage('en');
  await assertEnglish('Manual capacity after language roundtrip');
  await evaluate(`(()=>{const select=document.querySelector('#capacity-select');select.value='auto';select.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.settings-panel').open=false;})()`);
  await delay(150);

  const previews = await Promise.all(paletteNames.map(async name => ({ name, data: (await readFile(join(output, `${name}-320-standard.png`))).toString('base64') })));
  const montage = await evaluate(`(async()=>{const previews=${JSON.stringify(previews)};const canvas=document.createElement('canvas');canvas.width=960;canvas.height=1240;const ctx=canvas.getContext('2d');ctx.fillStyle='#10131b';ctx.fillRect(0,0,960,1240);for(let i=0;i<previews.length;i++){const p=previews[i];const img=new Image();img.src='data:image/png;base64,'+p.data;await img.decode();const x=(i%3)*320,y=Math.floor(i/3)*620;ctx.fillStyle='#cbd5e1';ctx.font='15px Segoe UI';ctx.fillText(p.name,x+12,y+23);ctx.drawImage(img,0,0,320,590,x,y+30,320,590);}return canvas.toDataURL('image/png').split(',')[1];})()`);
  await writeFile(join(output, 'palette-montage.png'), Buffer.from(montage, 'base64'));
  await writeFile(join(output, 'report.json'), JSON.stringify({ passed: true, cases: results, screenshots, platformFonts }, null, 2));
  console.log(JSON.stringify({ passed: true, cases: results.length, output, screenshots: screenshots.length, platformFonts }));
} finally {
  socket?.close();
  if (browser.exitCode === null) browser.kill();
  await new Promise(resolve => server.close(resolve));
}
