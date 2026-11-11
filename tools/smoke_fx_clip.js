'use strict';
/* 无头 Edge 冒烟：像素特效「动画播放区间」
   端到端调用真实运行时，验证 clipStart / clipEnd 的 seek、区间循环与旧配置兼容。
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
    '--user-data-dir=/tmp/edge_fx_clip', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
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

  const libs = await ev(`({ pf: typeof window.PixelFX, se: typeof window.SkillEffects, sm: typeof window.SkillModules })`);
  console.log('① 运行时加载:', JSON.stringify(libs));

  const r = await ev(`(async function(){
    try {
      var SE = window.SkillEffects, PF = window.PixelFX;
      var meta = PF.get('fire/fireball');
      var base = { effect:'fire/fireball', attach:'impact', fps:1, loop:true, scale:1, alpha:1, light:1,
                   offsetX:0, offsetY:0, rotation:0, stackReplace:true, _nid:'clip_probe' };
      function mk(o){ return Object.assign({}, base, o); }
      // ① 区间 3→6：生成后应直接停在素材第 3 秒
      var a = await SE.spawnFx([mk({clipStart:3, clipEnd:6})], 'impact', 100, 100, 0, null, null, null, null, 0);
      var qa = a[0] || {};
      var t0 = qa.inst ? qa.inst.t : -1;
      // ② 推进 4 秒素材时间：越过 clipEnd 后应重开并回到 clipStart
      SE.stepFx(a, 4);
      var t1 = qa.inst ? qa.inst.t : -1;
      // ③ 旧配置（无区间字段）仍从 0 开始，按素材一轮时长循环
      var b = await SE.spawnFx([mk({})], 'impact', 100, 100, 0, null, null, null, null, 0);
      var qb = b[0] || {};
      var tb = qb.inst ? qb.inst.t : -1;
      // ④ 结束早于起始时应被夹到起始之后
      var c = await SE.spawnFx([mk({clipStart:3, clipEnd:1})], 'impact', 100, 100, 0, null, null, null, null, 0);
      var qc = c[0] || {};
      // ⑤ 底层实例 seek / restart 直接可用
      var inst = await PF.spawn('fire/fireball', {});
      var raw0 = inst.t;
      inst.seek(2.5); var rawSeek = inst.t;
      inst.restart(1.5); var rawRestart = inst.t;
      return {
        metaDuration: meta && meta.duration, metaLoop: meta && meta.loop,
        aN:a.length, t0:t0, clipStart:qa.clipStart, clipEnd:qa.clipEnd, t1:t1,
        bN:b.length, tb:tb, bClipStart:qb.clipStart, bClipEnd:qb.clipEnd, bCycle:qb.inst&&qb.inst.cycle,
        cClipEnd:qc.clipEnd,
        raw0:raw0, rawSeek:rawSeek, rawRestart:rawRestart
      };
    } catch (e) { return { __err: String(e && e.stack || e) }; }
  })()`);
  console.log('② 运行期结果:', JSON.stringify(r));

  const near = (a, b, tol) => Math.abs(Number(a) - Number(b)) <= (tol == null ? 0.06 : tol);
  const checks = {
    '素材时长可读': Number(r && r.metaDuration) > 0,
    '区间特效生成成功': r && r.aN === 1,
    'clipStart=3 时实例从第 3 秒开始': r && near(r.t0, 3) && near(r.clipStart, 3),
    'clipEnd=6 记录正确': r && near(r.clipEnd, 6),
    '越过 6 秒后重开并回到 3 秒': r && near(r.t1, 3),
    '旧配置仍从 0 开始': r && r.bN === 1 && near(r.tb, 0) && near(r.bClipStart, 0) && near(r.bClipEnd, 0),
    '旧配置循环仍按素材时长': r && Number(r.bCycle) > 0,
    '结束早于起始时自动夹正': r && Number(r.cClipEnd) > 3,
    '底层 seek 生效': r && near(r.rawSeek, 2.5, 0.05),
    '底层 restart(from) 生效': r && near(r.rawRestart, 1.5, 0.05)
  };
  let fail = 0;
  Object.keys(checks).forEach(k => { console.log('  ' + (checks[k] ? '✓' : '✗') + ' ' + k); if (!checks[k]) fail++; });
  console.log('③ 捕获到的错误数:', errors.length, errors.slice(0, 2).join(' | '));
  const pass = !fail && !errors.length && !(r && r.__err);
  console.log('RESULT:', pass ? 'PASS' : 'FAIL');
  ws.close(); edge.kill(); process.exit(pass ? 0 : 1);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
