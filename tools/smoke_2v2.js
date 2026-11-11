'use strict';
/* 无头 Edge 冒烟测试：加载本地站，捕获加载期 / 运行期 JS 错误，
   并验证 2V2 关键 DOM（#seatGrid）与模式类切换的 CSS 规则存在。 */
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
function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--remote-debugging-port=' + PORT,
    '--user-data-dir=/tmp/edge_smoke', 'about:blank'
  ], { stdio: 'ignore' });
  await wait(2500);
  let targets, wsUrl;
  try {
    targets = await getJSON('http://127.0.0.1:' + PORT + '/json');
  } catch (e) { console.log('FAIL 无法连接 CDP：' + e.message); process.exit(2); }
  wsUrl = targets[0].webSocketDebuggerUrl;
  const ws = new WebSocket(wsUrl);
  let id = 0; const pending = {};
  const send = (method, params) => new Promise((res) => {
    const mid = ++id; pending[mid] = res; ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
  const errors = [];
  ws.on('message', m => {
    const o = JSON.parse(m);
    if (o.id && pending[o.id]) { pending[o.id](o.result); delete pending[o.id]; }
    if (o.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(o.params.type)) {
      errors.push('console.' + o.params.type + ': ' + (o.params.args || []).map(a => a.value || a.description || '').join(' '));
    }
    if (o.method === 'Runtime.exceptionThrown') {
      const d = o.params.exceptionDetails;
      errors.push('exception: ' + (d.exception && d.exception.description || d.text));
    }
  });
  await new Promise(r => ws.on('open', r));
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8787/' });
  await wait(3500);
  const dom = await send('Runtime.evaluate', {
    expression: `(function(){
      const g = document.getElementById('seatGrid');
      const bs = document.getElementById('battleScreen');
      return {
        seatGridExists: !!g,
        battleExists: !!bs,
        teamScoreLine: !!document.getElementById('teamScoreLine'),
        bootSplashGone: !document.getElementById('bootSplash'),
        startVisible: !document.getElementById('startScreen').hidden
      };
    })()`,
    returnByValue: true
  });
  console.log('DOM 检查:', JSON.stringify(dom.result.value));
  // 验证 2V2 模式类切换：隐藏合并血条、显示四卡网格
  const cssChk = await send('Runtime.evaluate', {
    expression: `(function(){
      var bs = document.getElementById('battleScreen');
      var sg = document.getElementById('seatGrid');
      var fp = document.querySelector('.fighter-panel');
      sg.hidden = false;            // 模拟 buildSeatGrid 去掉 [hidden] !important
      bs.classList.add('mode-2v2');
      var r = {
        seatGridDisplay: getComputedStyle(sg).display,
        fighterPanelDisplay: getComputedStyle(fp).display
      };
      bs.classList.remove('mode-2v2');
      sg.hidden = true;
      return r;
    })()`,
    returnByValue: true
  });
  console.log('CSS 模式切换:', JSON.stringify(cssChk.result.value));
  console.log('捕获到的错误数:', errors.length);
  errors.slice(0, 20).forEach(e => console.log('  - ' + e));
  ws.close(); edge.kill('SIGKILL');
  // 即使有 console.warning 也不算失败，仅 exception 与 console.error 视为失败
  const fatal = errors.filter(e => e.startsWith('exception') || e.startsWith('console.error'));
  console.log(fatal.length ? 'RESULT: FAIL (' + fatal.length + ' 个致命错误)' : 'RESULT: PASS');
  process.exit(fatal.length ? 1 : 0);
})();
