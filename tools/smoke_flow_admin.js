'use strict';
/* 无头 Edge 冒烟：后台「语义链路判定」接入
   验证两个守卫脚本加载、工具栏入口、诊断抽屉、真实拖拽拦截、发布校验不被旧果实误阻断。
   端口 9222；依赖本地服务 127.0.0.1:8787。 */
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
    '--user-data-dir=/tmp/edge_flow_admin', '--window-size=1400,950', 'about:blank'], { stdio: 'ignore' });
  await wait(2600);
  const list = await getJson('/json/list');
  const page = list.find(t => t.type === 'page') || list[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pend = new Map(); const errors = [];
  ws.on('message', m => {
    const d = JSON.parse(m);
    if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
    if (d.method === 'Runtime.exceptionThrown') errors.push('exception: ' + (d.params.exceptionDetails.exception || {}).description);
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error')
      errors.push('console.error: ' + (d.params.args || []).map(a => a.value || a.description || '').join(' '));
  });
  await new Promise(r => ws.on('open', r));
  const send = (method, params) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8787/admin.html' });
  await wait(3800);

  const libs = await ev(`({ sg: typeof window.SkillGraphGuard, fg: typeof window.SkillFlowGuard, sm: typeof window.SkillModules })`);
  console.log('① 守卫脚本加载:', JSON.stringify(libs));

  await ev(`(function(){var b=document.querySelector('[data-tab="skills"]');if(b)b.click();})()`);
  await wait(1200);
  const skills = await ev(`(function(){
    return {
      linkKindBtn: !!document.querySelector('[data-act="se-link-kind"]'),
      diagBtn: !!document.querySelector('[data-act="se-flow-diagnose"]'),
      comboFlow: !!document.querySelector('.se-combo-flow'),
      guardChip: !!document.querySelector('.sg-issues, .sg-ok')
    };
  })()`);
  console.log('② 技能编辑器快捷入口:', JSON.stringify(skills));

  await ev(`(function(){var b=document.querySelector('[data-act="se-flow-diagnose"]');if(b)b.click();})()`);
  await wait(700);
  const diag = await ev(`(function(){
    var d=document.querySelector('.sg-diag');
    return { open: !!d, hasFlow: !!document.querySelector('.sg-diag-flow'),
      flowText: (document.querySelector('.sg-diag-flow')||{}).textContent||'',
      items: document.querySelectorAll('.sg-diag-item').length };
  })()`);
  console.log('③ 链路诊断抽屉:', JSON.stringify(diag));

  // ④ 真实拖拽：先关掉诊断抽屉，否则遮罩会吃掉 pointerup
  await ev(`(function(){var b=document.getElementById('drawerClose');if(b)b.click();})()`);
  await wait(500);
  // 切到「因果连线」后画一条不成立的连线，应被语义判定拦下
  await ev(`(function(){var b=document.querySelector('[data-act="se-link-kind"]');if(b)b.click();})()`);
  await wait(1200);
  const kindTxt = await ev(`(document.querySelector('[data-act="se-link-kind"]')||{}).textContent||''`);
  const coords = await ev(`(function(){
    var outs=[].slice.call(document.querySelectorAll('.se-port.out'));
    var ins=[].slice.call(document.querySelectorAll('.se-port.in'));
    if(!outs.length||!ins.length) return null;
    var a=outs[0], b=ins.filter(function(x){return x.closest('.se-node')!==a.closest('.se-node');})[0];
    if(!b) return null;
    try { b.scrollIntoView({block:'center',inline:'center'}); } catch(e){}
    var ra=a.getBoundingClientRect(), rb=b.getBoundingClientRect();
    var x2=rb.x+rb.width/2, y2=rb.y+rb.height/2;
    var hit=document.elementFromPoint(x2,y2);
    return {x1:ra.x+ra.width/2,y1:ra.y+ra.height/2,x2:x2,y2:y2,
      hitClass: hit?hit.className:'', hitIsIn: !!(hit&&hit.closest('.se-port.in')),
      outCount: outs.length, inCount: ins.length};
  })()`);
  let drag = { skipped: true };
  if (coords) {
    await ev(`(function(){
      var outs=[].slice.call(document.querySelectorAll('.se-port.out'));
      var ins=[].slice.call(document.querySelectorAll('.se-port.in'));
      var a=outs[0], b=ins.filter(function(x){return x.closest('.se-node')!==a.closest('.se-node');})[0];
      var ra=a.getBoundingClientRect(), rb=b.getBoundingClientRect();
      var o={bubbles:true,cancelable:true,pointerId:1,pointerType:'mouse'};
      a.dispatchEvent(new PointerEvent('pointerdown', Object.assign({},o,{clientX:ra.x+ra.width/2,clientY:ra.y+ra.height/2})));
      window.dispatchEvent(new PointerEvent('pointerup', Object.assign({},o,{clientX:rb.x+rb.width/2,clientY:rb.y+rb.height/2})));
      return true;
    })()`);
    await wait(700);
    drag = await ev(`(function(){
      var t=[].slice.call(document.querySelectorAll('#toastWrap .toast')).map(function(x){return x.textContent;});
      return { toasts: t.slice(-3), blocked: t.some(function(x){return x.indexOf('链路不成立')>=0;}),
               hasFix: t.some(function(x){return x.indexOf('修法')>=0;}) };
    })()`);
  }
  console.log('④ 因果连线拦截:', kindTxt.trim(), JSON.stringify(drag));
  if (!coords || !coords.hitIsIn) console.log('   （端口坐标未命中，拖拽结果不可信）');

  await ev(`(function(){var b=document.querySelector('[data-tab="release"]');if(b)b.click();})()`);
  await wait(1000);
  const rel = await ev(`(function(){
    var errs=[].slice.call(document.querySelectorAll('.check-item.err')).map(function(e){return e.textContent.trim();});
    var warns=[].slice.call(document.querySelectorAll('.check-item.warn')).map(function(e){return e.textContent.trim();});
    return { errors: errs.length, warnings: warns.length,
      errSample: errs.slice(0,3), legacyWarn: warns.filter(function(x){return x.indexOf('旧「归属」模型')>=0;}).length };
  })()`);
  console.log('④ 校验与发布页:', JSON.stringify(rel));
  console.log('⑤ 捕获到的错误数:', errors.length, errors.slice(0, 3).join(' | '));

  const pass = libs.sg === 'object' && libs.fg === 'object' && skills.linkKindBtn && skills.diagBtn &&
    skills.comboFlow && diag.open && diag.hasFlow && diag.items >= 1 &&
    drag.blocked === true && drag.hasFix === true && coords && coords.hitIsIn === true &&
    rel.errors === 0 && rel.legacyWarn === 1 && !errors.length;
  console.log('RESULT:', pass ? 'PASS' : 'FAIL');
  ws.close(); edge.kill(); process.exit(pass ? 0 : 1);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
