'use strict';
/* 无头 Edge 冒烟：特效专属参数 height 的两个 bug
   1) 拖动 range 时 number 框 / .se-v 读数同步
   2) 拖到最小不会把 0 送进素材核心（安全下限 1），渲染异常不中断循环
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
    '--user-data-dir=/tmp/edge_fx_height', '--window-size=1400,950', 'about:blank'], { stdio: 'ignore' });
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
  await wait(5200);
  const boot = await ev(`({ url:location.href, ready:document.readyState, sm:typeof window.SkillModules, se:typeof window.SkillEffects, pf:typeof window.PixelFX })`);
  console.log('⓪ 页面状态:', JSON.stringify(boot));

  const injected = await ev(`(function(){
    var SM=window.SkillModules; if(!SM) return 'no SM';
    function N(id,t,x,y,p){var n=SM.node(t,x,y);n.id=id;if(p)Object.keys(p).forEach(function(k){n.params[k]=p[k];});return n;}
    var s=N('probe_s','source',40,90), p=N('probe_p','projectile',250,90,{count:1}),
        f=N('probe_fx','fx',470,90,{effect:'fire/campfire',attach:'projectile',triggerEvent:'onHit',fxOptions:{height:22}});
    var sk={id:'probe_h',name:'探针 height',tier:'common',mods:{},enabled:true,charge:1,intro:'',icon:'',
      graph:{nodes:[s,p,f],edges:[{from:s.id,to:p.id},{from:p.id,to:f.id}]}};
    var raw=localStorage.getItem('wowpinball.config.v1'); if(!raw) return 'no config';
    var cfg=JSON.parse(raw); cfg.skills=[sk];
    localStorage.setItem('wowpinball.config.v1', JSON.stringify(cfg));
    return 'ok';
  })()`);
  console.log('① 注入探针果实:', injected);

  await send('Page.navigate', { url: 'http://127.0.0.1:8787/admin.html' });
  await wait(3600);
  await ev(`(function(){var b=document.querySelector('[data-tab="skills"]');if(b)b.click();})()`);
  await wait(1000);
  await ev(`(function(){var b=document.querySelector('[data-act="se-skill"][data-id="probe_h"]');if(b)b.click();})()`);
  await wait(800);
  await ev(`(function(){
    var n=document.querySelector('.se-node[data-node="probe_fx"]'); if(!n) return;
    n.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:1,pointerType:'mouse'}));
  })()`);
  await wait(700);

  const initial = await ev(`(function(){
    var r=document.querySelector('input[type=range][data-sefx="height"]');
    var num=document.querySelector('input[type=number][data-sefx="height"]');
    var lab=r&&r.closest('.se-field')&&r.closest('.se-field').querySelector('.se-v');
    return {hasRange:!!r, hasNum:!!num, min:r?r.min:null, rangeVal:r?r.value:null,
            numVal:num?num.value:null, label:lab?lab.textContent:null};
  })()`);
  console.log('② height 控件初值:', JSON.stringify(initial));

  const drag = await ev(`(function(){
    var r=document.querySelector('input[type=range][data-sefx="height"]'); if(!r) return 'no range';
    r.value=r.min; r.dispatchEvent(new Event('input',{bubbles:true}));
    var num=document.querySelector('input[type=number][data-sefx="height"]');
    var lab=r.closest('.se-field').querySelector('.se-v');
    return {rangeVal:r.value, numVal:num?num.value:null, label:lab?lab.textContent:null};
  })()`);
  console.log('③ 拖到最小后:', JSON.stringify(drag));

  const typed = await ev(`(function(){
    var num=document.querySelector('input[type=number][data-sefx="height"]'); if(!num) return 'no num';
    num.value='0'; num.dispatchEvent(new Event('input',{bubbles:true}));
    var r=document.querySelector('input[type=range][data-sefx="height"]');
    var lab=num.closest('.se-field').querySelector('.se-v');
    return {numVal:num.value, rangeVal:r?r.value:null, label:lab?lab.textContent:null};
  })()`);
  console.log('④ 手输 0 后:', JSON.stringify(typed));

  const runtime = await ev(`(function(){
    try {
      var SE=window.SkillEffects;
      var o=SE.fxOpts({effect:'fire/campfire',fxOptions:{height:0,width:0,seed:0}});
      // 单个特效 render 抛错时，drawFx 不能中断剩余实例的渲染
      var cv=document.createElement('canvas');cv.width=64;cv.height=64;var cx=cv.getContext('2d');
      var painted=0;
      function inst(boom){return {render:function(){if(boom)throw new Error('boom');painted++;},
        kill:function(){},done:function(){return false},cycle:1,meta:null,t:0};}
      var bad={inst:inst(true),cfg:{},x:0,y:0,age:0};
      var good={inst:inst(false),cfg:{},x:0,y:0,age:0};
      var arr=[bad,good];
      var threw=false;
      try{SE.drawFx(cx,arr,[]);}catch(e){threw=true;}
      return {opts:o, painted:painted, remains:arr.length, threw:threw};
    } catch(e){ return {__err:String(e&&e.message||e)}; }
  })()`);
  console.log('⑤ 运行时夹正与异常隔离:', JSON.stringify(runtime));
  console.log('⑥ 捕获到的错误数:', errors.length, errors.slice(0, 2).join(' | '));

  const checks = {
    '注入成功': injected === 'ok',
    'height 控件存在且滑块下限为 1（不再是 0）': initial && initial.hasRange && initial.hasNum && initial.min === '1',
    '拖动滑块后数字框与读数同步': drag && drag.numVal === drag.rangeVal && drag.label === drag.rangeVal,
    '拖到最小写入安全值 1': drag && Number(drag.rangeVal) === 1,
    '手输 0 被夹回 1 且三处一致': typed && Number(typed.numVal) === 1 && typed.rangeVal === '1' && typed.label === '1',
    // campfire 目录里有 height(min=0)/seed(min=0)，没有 width；未登记的键原样透传即可
    '运行时把目录里 min=0 的 height 从 0 夹成 1': runtime && runtime.opts && runtime.opts.height === 1,
    '单个特效渲染异常不中断循环': runtime && runtime.painted === 1 && runtime.remains === 1 && runtime.threw === false
  };
  let fail = 0;
  Object.keys(checks).forEach(k => { console.log('  ' + (checks[k] ? '✓' : '✗') + ' ' + k); if (!checks[k]) fail++; });
  const pass = !fail && !errors.length;
  console.log('RESULT:', pass ? 'PASS' : 'FAIL');
  ws.close(); edge.kill(); process.exit(pass ? 0 : 1);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
