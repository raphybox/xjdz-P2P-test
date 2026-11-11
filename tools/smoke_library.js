'use strict';
/* 果实库冒烟：种入库存后验证「介绍文字 / 搜索过滤 / 滚动区域」真实渲染。
   需要本地服务在 127.0.0.1:8787 运行（node server.js）。 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9224;
const ROOT = path.resolve(__dirname, '..');

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/game-config.json'), 'utf8'));
const ids = (cfg.skills || []).slice(0, 6).map(s => s.id).filter(Boolean);

function getJSON(url) {
  return new Promise((res, rej) => {
    http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); })
      .on('error', rej);
  });
}
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--remote-debugging-port=' + PORT,
    '--user-data-dir=/tmp/edge_lib_smoke', 'about:blank'
  ], { stdio: 'ignore' });
  await wait(2500);
  let targets;
  try { targets = await getJSON('http://127.0.0.1:' + PORT + '/json'); }
  catch (e) { console.log('FAIL 无法连接 CDP：' + e.message); process.exit(2); }
  const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  let id = 0; const pending = {};
  const send = (method, params) => new Promise(res => {
    const mid = ++id; pending[mid] = res; ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
  const errors = [];
  ws.on('message', m => {
    const o = JSON.parse(m);
    if (o.id && pending[o.id]) { pending[o.id](o.result); delete pending[o.id]; }
    if (o.method === 'Runtime.consoleAPICalled' && o.params.type === 'error') {
      errors.push('console.error: ' + (o.params.args || []).map(a => a.value || a.description || '').join(' '));
    }
    if (o.method === 'Runtime.exceptionThrown') {
      const d = o.params.exceptionDetails;
      errors.push('exception: ' + (d.exception && d.exception.description || d.text));
    }
  });
  await new Promise(r => ws.on('open', r));
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8787/' });
  await wait(2600);

  // 种入 6 种果实 + 昵称，然后重载，让首页按真实库存渲染
  await send('Runtime.evaluate', {
    expression: `(function(){
      localStorage.setItem('wowpinball.fruits.v1', JSON.stringify({
        owned: ${JSON.stringify(ids)}.map(id => ({ id: id })).concat(
               ${JSON.stringify(ids.slice(0, 2))}.map(id => ({ id: id }))),
        skinId: '', skinTheme: 'all'
      }));
      localStorage.setItem('wowpinball.profile.v1', JSON.stringify({ name: 'SmokeTester' }));
      return true;
    })()`, returnByValue: true
  });
  await send('Page.navigate', { url: 'http://127.0.0.1:8787/' });
  await wait(3000);

  const r1 = await send('Runtime.evaluate', {
    expression: `(function(){
      const grid = document.getElementById('fruitGrid');
      const cards = grid ? grid.querySelectorAll('.fruit-card') : [];
      const first = cards[0];
      const intro = first ? first.querySelector('.fc-intro') : null;
      const sc = document.querySelector('.fruit-scroll');
      return {
        searchExists: !!document.getElementById('fruitSearch'),
        countText: (document.getElementById('fruitCount') || {}).textContent || '',
        cards: cards.length,
        firstIntro: intro ? intro.textContent.slice(0, 40) : '',
        scrollOverflowY: sc ? getComputedStyle(sc).overflowY : '',
        scrollMaxH: sc ? getComputedStyle(sc).maxHeight : ''
      };
    })()`, returnByValue: true
  });
  console.log('果实库渲染:', JSON.stringify(r1.result.value));

  const r2 = await send('Runtime.evaluate', {
    expression: `(function(){
      const first = document.querySelector('#fruitGrid .fruit-card .fc-name');
      const kw = first ? first.textContent.trim() : '';
      const s = document.getElementById('fruitSearch');
      s.value = kw;
      s.dispatchEvent(new Event('input', { bubbles: true }));
      const cards = document.getElementById('fruitGrid').querySelectorAll('.fruit-card');
      return {
        keyword: kw,
        filtered: cards.length,
        countText: (document.getElementById('fruitCount') || {}).textContent || ''
      };
    })()`, returnByValue: true
  });
  console.log('按首张名称搜索:', JSON.stringify(r2.result.value));

  const r3 = await send('Runtime.evaluate', {
    expression: `(function(){
      const s = document.getElementById('fruitSearch');
      s.value = '';
      s.dispatchEvent(new Event('input', { bubbles: true }));
      return { restored: document.getElementById('fruitGrid').querySelectorAll('.fruit-card').length };
    })()`, returnByValue: true
  });
  console.log('清空搜索:', JSON.stringify(r3.result.value));

  // 界面属性：背景色 + 背景色不透明度 → 计算样式应为 rgba
  // 注意 .ghost-btn 有 background 过渡，必须等过渡结束再读 computed
  await send('Runtime.evaluate', {
    expression: `(function(){
      var UI = window.WowPinballUI, el = document.getElementById('nickBtn');
      if (UI && el) UI.setPatch('start', 'nickBtn', { bg: '#ff0000', bgA: 0.5 });
      return true;
    })()`, returnByValue: true
  });
  await wait(400);
  const r4 = await send('Runtime.evaluate', {
    expression: `(function(){
      var UI = window.WowPinballUI, el = document.getElementById('nickBtn');
      var rgba = el ? getComputedStyle(el).backgroundColor : '';
      var inline = el ? el.style.backgroundColor : '';
      if (UI && el) UI.setPatch('start', 'nickBtn', null);   // 只在内存里验证，立刻还原
      return { rgba: rgba, inline: inline };
    })()`, returnByValue: true
  });
  const bgA = r4.result.value || {};
  console.log('背景色透明度应用:', JSON.stringify(bgA));

  console.log('捕获到的错误数:', errors.length);
  errors.slice(0, 20).forEach(e => console.log('  - ' + e));
  ws.close(); edge.kill('SIGKILL');

  const v = r1.result.value || {}, f = r2.result.value || {};
  const pass = v.searchExists && v.cards >= 6 && v.firstIntro.length > 0 &&
    v.scrollOverflowY === 'auto' && f.filtered >= 1 && f.filtered < v.cards &&
    /rgba\(255,\s*0,\s*0,\s*0\.5\)/.test(bgA.rgba || '') && !errors.length;
  console.log(pass ? 'RESULT: PASS' : 'RESULT: FAIL');
  process.exit(pass ? 0 : 1);
})();
