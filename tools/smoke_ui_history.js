'use strict';
/* 无头 Edge 冒烟：后台「界面编辑器」的撤销 / 重做 / 复制粘贴。
   验证链：
     改位移 → 撤销按钮亮起 → Ctrl+Z 数据与面板同步回滚 → Ctrl+Y 重做回来
     → Ctrl+C 复制 → 换元素 Ctrl+V 粘贴 → 目标元素拿到同一份样式 → Ctrl+Z 撤销粘贴
   断言以「预览 iframe 内 WowPinballUI.state.ui」为准（应用后的真实结果），
   全程捕获 JS 异常，有异常即判失败。 */
const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9222;

function getJSON(url) {
  return new Promise((res, rej) => {
    http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); })
      .on('error', rej);
  });
}
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + PORT, '--user-data-dir=/tmp/edge_ui_hist', 'about:blank'], { stdio: 'ignore' });
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
      errors.push('exception: ' + ((d.exception && d.exception.description) || d.text));
    }
  });
  await new Promise(r => ws.on('open', r));
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8787/admin.html' });
  await wait(3500);

  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (!r) return { __err: 'no result' };
    if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text };
    return r.result && r.result.value;
  };
  const hotkey = (k, shift) => ev(
    `document.dispatchEvent(new KeyboardEvent('keydown',{key:'${k}',ctrlKey:true,shiftKey:${shift ? 'true' : 'false'},bubbles:true,cancelable:true}))`);

  // ---- ① 等后台渲染完成，再切到界面编辑器 ----
  let booted = false;
  for (let i = 0; i < 40; i++) {
    await wait(300);
    const n = await ev(`(function(){
      var c = document.getElementById('content');
      return { navs: document.querySelectorAll('.nav-item[data-tab]').length, len: c ? c.innerHTML.length : 0 };
    })()`);
    if (n && n.navs > 0 && n.len > 200) { booted = true; break; }
  }
  console.log('① 后台就绪:', booted);
  await ev(`(document.querySelector('.nav-item[data-tab="ui"]') || { click: function(){} }).click()`);

  let ready = false, statusText = '';
  for (let i = 0; i < 50; i++) {
    await wait(400);
    statusText = String(await ev(`(document.getElementById('uiStatus')||{}).textContent||''`));
    if (statusText.indexOf('预览已就绪') >= 0) { ready = true; break; }
  }
  console.log('   预览就绪:', ready, '| uiStatus:', statusText.slice(0, 36));
  if (!ready) {
    const fatal0 = errors.filter(e => e.startsWith('exception') || e.startsWith('console.error'));
    fatal0.slice(0, 8).forEach(e => console.log('  ! ' + e));
    console.log('RESULT: FAIL 预览未就绪');
    ws.close(); edge.kill('SIGKILL'); process.exit(1);
  }

  // ---- ② 找两个带「位移」控件的图层（锁定的整页容器没有位移控件） ----
  const hits = [];
  for (let i = 0; i < 10 && hits.length < 2; i++) {
    const r = await ev(`(function(){
      var b = document.querySelectorAll('[data-act="ui-select"]')[${i}];
      if (!b) return { stop: 1 };
      b.click();
      return { id: b.dataset.id, hasDx: !!document.getElementById('uip_dx') };
    })()`);
    if (!r || r.stop) break;
    if (r.hasDx) hits.push({ idx: i, id: r.id });
  }
  console.log('② 测试图层:', JSON.stringify(hits));
  if (hits.length < 2) {
    console.log('RESULT: FAIL 找不到两个可测图层');
    ws.close(); edge.kill('SIGKILL'); process.exit(1);
  }
  const A = hits[0], B = hits[1];

  const readState = () => ev(`(function(){
    var f = document.getElementById('uiFrame');
    var UI = f && f.contentWindow && f.contentWindow.WowPinballUI;
    if (!UI) return { err: 'iframe 未就绪' };
    var st = UI.state;
    var p = ((st.ui.screens[st.screen] || {})[st.key]) || {};
    var t = document.getElementById('uip_dx');
    var u = document.querySelector('[data-act="ui-undo"]');
    var r = document.querySelector('[data-act="ui-redo"]');
    return {
      key: st.key, dx: p.dx, panel: t ? t.value : null,
      undoDisabled: u ? u.disabled : null, redoDisabled: r ? r.disabled : null,
      status: (document.getElementById('uiStatus') || {}).textContent || ''
    };
  })()`);

  // ---- ③ 把 A 的位移改成 24 ----
  const setRes = await ev(`(function(){
    document.querySelectorAll('[data-act="ui-select"]')[${A.idx}].click();
    var t = document.getElementById('uip_dx');
    if (!t) return { err: 'no dx input' };
    t.value = '24';
    t.dispatchEvent(new Event('input', { bubbles: true }));
    return { panel: t.value, undoDisabled: document.querySelector('[data-act="ui-undo"]').disabled };
  })()`);
  await wait(350);
  const afterSet = await readState();
  console.log('③ 设 dx=24:', JSON.stringify(setRes), '→ 预览:', JSON.stringify({ key: afterSet.key, dx: afterSet.dx }));

  // ---- ④ Ctrl+Z 撤销 ----
  await hotkey('z', false);
  await wait(450);
  const afterUndo = await readState();
  console.log('④ Ctrl+Z:', JSON.stringify({ dx: afterUndo.dx, panel: afterUndo.panel, undo: afterUndo.undoDisabled, redo: afterUndo.redoDisabled }));

  // ---- ⑤ Ctrl+Y 重做 ----
  await hotkey('y', false);
  await wait(450);
  const afterRedo = await readState();
  console.log('⑤ Ctrl+Y:', JSON.stringify({ dx: afterRedo.dx, panel: afterRedo.panel }));

  // ---- ⑥ 复制 A → 粘贴到 B ----
  await ev(`document.querySelectorAll('[data-act="ui-select"]')[${A.idx}].click()`);
  await wait(180);
  await hotkey('c', false);
  await wait(220);
  const copied = await ev(`(function(){
    var b = document.querySelector('[data-act="ui-paste"]');
    return { pasteReady: b ? !b.disabled : null, status: (document.getElementById('uiStatus')||{}).textContent||'' };
  })()`);
  await ev(`document.querySelectorAll('[data-act="ui-select"]')[${B.idx}].click()`);
  await wait(180);
  await hotkey('v', false);
  await wait(420);
  const pasted = await readState();
  console.log('⑥ 复制:', JSON.stringify(copied));
  console.log('   粘贴到', B.id, ':', JSON.stringify({ key: pasted.key, dx: pasted.dx, panel: pasted.panel }));

  // ---- ⑦ 撤销粘贴：A 的样式应保留（粘贴前状态），B 应回到无自定义样式 ----
  await hotkey('z', false);
  await wait(450);
  const afterUndoPaste = await ev(`(function(){
    var w = document.getElementById('uiFrame').contentWindow, UI = w.WowPinballUI, st = UI.state;
    var sc = st.ui.screens[st.screen] || {};
    return {
      key: st.key,
      a: (sc[${JSON.stringify(A.id)}] || {}).dx,
      b: (sc[${JSON.stringify(B.id)}] || {}).dx
    };
  })()`);
  console.log('⑦ 撤销粘贴:', JSON.stringify(afterUndoPaste));

  const fatal = errors.filter(e => e.startsWith('exception') || e.startsWith('console.error'));
  console.log('捕获到的致命错误:', fatal.length);
  fatal.slice(0, 10).forEach(e => console.log('  - ' + e));

  const ok = ready &&
    afterSet.dx === 24 && afterSet.undoDisabled === false &&
    afterUndo.dx === undefined && afterUndo.undoDisabled === true && afterUndo.redoDisabled === false &&
    afterRedo.dx === 24 &&
    copied.pasteReady === true &&
    pasted.dx === 24 && pasted.key === B.id &&
    afterUndoPaste.a === 24 && afterUndoPaste.b === undefined &&
    !fatal.length;
  console.log(ok ? 'RESULT: PASS' : 'RESULT: FAIL');
  ws.close(); edge.kill('SIGKILL');
  process.exit(ok ? 0 : 1);
})();
