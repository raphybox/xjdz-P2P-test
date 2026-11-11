'use strict';
/* 无头 Edge 冒烟：存在时长 > 动画时长时的「动画播完后」三种模式
   freeze 定格最后一帧 / loop 循环最后 0.1 秒 / restart 整轮重播，
   以及存在时长优先于「循环播放」、旧配置兼容、age 继续累加到 ttl。
   依赖本地服务 127.0.0.1:8787 与调试端口 9222。 */
const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const wait = ms => new Promise(r => setTimeout(r, ms));
function getJson(p) {
  return new Promise((res, rej) => {
    http.get('http://127.0.0.1:9222' + p, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on('error', rej);
  });
}
(async () => {
  const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox', '--remote-debugging-port=9222',
    '--user-data-dir=/tmp/edge_fx_tail', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
  await wait(2600);
  const list = await getJson('/json/list');
  const page = list.find(t => t.type === 'page') || list[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pend = new Map(); const errors = [];
  ws.on('message', m => {
    const d = JSON.parse(m);
    if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
    if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception || {}).description || 'exception');
  });
  await new Promise(r => ws.on('open', r));
  const send = (method, params) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { __err: r.result.exceptionDetails.text };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8787/admin.html' });
  await wait(3800);

  const r = await ev(`(async function(){
    try {
      var SE = window.SkillEffects, PF = window.PixelFX;
      var meta = PF.get('fire/fireball');
      var base = { effect:'fire/fireball', attach:'impact', fps:1, loop:false, scale:1, alpha:1, light:1,
                   offsetX:0, offsetY:0, rotation:0, stackReplace:true, _nid:'tail_probe' };
      function mk(o){ return Object.assign({}, base, o); }
      async function one(o){ var a = await SE.spawnFx([mk(o)], 'impact', 100, 100, 0, null, null, null, null, 0); return a[0]; }
      // A 定格：播完 1.2s 一轮后冻结，再推进 5s 画面时间不变、age 继续累加
      var A = await one({ life:7, tailMode:'freeze' });
      SE.stepFx([A], 1.3);
      var a1 = { t:A.inst.t, frozen:A.frozen };
      SE.stepFx([A], 5);
      var a2 = { t:A.inst.t, age:A.age, ttl:A.ttl };
      // B 循环末尾 0.1s：越过终点后时间轴回到 endT-0.1，而不是 0
      var B = await one({ life:7, tailMode:'loop' });
      SE.stepFx([B], 1.3);
      var b1 = { t:B.inst.t, frozen:!!B.frozen };
      SE.stepFx([B], 0.2);
      var b2 = { t:B.inst.t };
      // C 整轮重播：回到 clipStart(0)
      var C = await one({ life:7, tailMode:'restart' });
      SE.stepFx([C], 1.3);
      var c1 = { t:C.inst.t };
      // D 无存在时长：仍按「循环播放」整轮重开，且不会冻结
      var D = await one({ life:0, loop:true, tailMode:'freeze' });
      SE.stepFx([D], 1.3);
      var d1 = { t:D.inst.t, frozen:!!D.frozen };
      // E 旧配置（没有 tailMode 字段）：默认定格
      var E = await one({ life:7 });
      SE.stepFx([E], 1.3);
      var e1 = { mode:E.tailMode, frozen:E.frozen, t:E.inst.t };
      return { cycle: meta && meta.duration, A:a1, A2:a2, B:b1, B2:b2, C:c1, D:d1, E:e1 };
    } catch (e) { return { __err: String(e && e.stack || e) }; }
  })()`);
  console.log('① 运行期结果:', JSON.stringify(r));

  const near = (a, b, tol) => Math.abs(Number(a) - Number(b)) <= (tol == null ? 0.06 : tol);
  const cyc = Number(r && r.cycle) || 1.2;
  const checks = {
    '定格：播完一轮后 frozen=true 且停在末尾': r && r.A && r.A.frozen === true && near(r.A.t, cyc),
    '定格：后续 5s 画面时间不变、age 继续累加': r && r.A2 && near(r.A2.t, cyc) && r.A2.age > 6 && near(r.A2.ttl, 7),
    '定格：存在时长未到时不回收（ttl=7）': r && r.A2 && near(r.A2.ttl, 7) && r.A2.age < 7,
    '末尾0.1s循环：回拨到 endT-0.1 而非 0': r && r.B && near(r.B.t, cyc - 0.1, 0.08) && r.B.frozen === false,
    '末尾0.1s循环：再次越过终点仍回拨': r && r.B2 && near(r.B2.t, cyc - 0.1, 0.08),
    '整轮重播：回到动画起始(0)': r && r.C && near(r.C.t, 0, 0.08),
    // fire/fireball 是 nativeLoop 素材：无存在时长时不重开，时间轴继续推进才对
    '无存在时长仍持续播放、不被冻结': r && r.D && r.D.frozen === false && Number(r.D.t) >= cyc,
    '旧配置无 tailMode 时默认定格': r && r.E && r.E.mode === 'freeze' && r.E.frozen === true
  };
  let fail = 0;
  Object.keys(checks).forEach(k => { console.log('  ' + (checks[k] ? '✓' : '✗') + ' ' + k); if (!checks[k]) fail++; });
  console.log('② 捕获到的错误数:', errors.length, errors.slice(0, 2).join(' | '));
  const pass = !fail && !errors.length && !(r && r.__err);
  console.log('RESULT:', pass ? 'PASS' : 'FAIL');
  ws.close(); edge.kill(); process.exit(pass ? 0 : 1);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
