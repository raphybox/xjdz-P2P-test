'use strict';
/* 无头 Edge 冒烟：特效接管载体外观
   注入两个探针果实（投射物→特效 / 区域残留→特效），验证编译分流正确、
   试放能正常出画面且无 JS 错误，并输出两张截图供人工核对。
   依赖本地服务 127.0.0.1:8787 与调试端口 9222。 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
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
    '--user-data-dir=/tmp/edge_fx_shot', '--window-size=1500,1000', 'about:blank'], { stdio: 'ignore' });
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
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8787/admin.html' });
  await wait(3800);

  const injected = await ev(`(function(){
    var SM = window.SkillModules; if (!SM) return 'no SM';
    function N(t,x,y,p){ var n=SM.node(t,x,y); if(p) Object.keys(p).forEach(function(k){n.params[k]=p[k];}); return n; }
    function SK(name,id,nodes,edges){ return {id:id,name:name,tier:'common',mods:{},enabled:true,charge:1,intro:'',icon:'',graph:{nodes:nodes,edges:edges}}; }
    var fxP={effect:'fire/fireball',attach:'projectile',triggerEvent:'onHit',scale:1,loop:true,life:0};
    var a=N('source',40,90), b=N('projectile',250,90,{trail:true,count:1,speed:300}), c=N('fx',470,90,fxP);
    var A=SK('探针A 投射物+特效','probe_proj',[a,b,c],[{from:a.id,to:b.id},{from:b.id,to:c.id}]);
    var d=N('source',40,90), e=N('projectile',250,90,{count:1,speed:1100,trail:true}), f=N('zone',450,90,{radius:40,duration:6,color:'#ff7a30'}), g=N('fx',650,90,fxP);
    var B=SK('探针B 区域残留+特效','probe_zone',[d,e,f,g],[{from:d.id,to:e.id},{from:e.id,to:f.id},{from:f.id,to:g.id}]);
    var raw=localStorage.getItem('wowpinball.config.v1'); if(!raw) return 'no config';
    var cfg=JSON.parse(raw); cfg.skills=[A,B];
    localStorage.setItem('wowpinball.config.v1', JSON.stringify(cfg));
    return 'ok:'+A.graph.nodes.length+'/'+B.graph.nodes.length;
  })()`);
  console.log('① 注入探针果实:', injected);

  await send('Page.navigate', { url: 'http://127.0.0.1:8787/admin.html' });
  await wait(3600);
  await ev(`(function(){var b=document.querySelector('[data-tab="skills"]');if(b)b.click();})()`);
  await wait(1200);
  const compiled = await ev(`(function(){
    var cfg=JSON.parse(localStorage.getItem('wowpinball.config.v1'));
    var sk=(cfg.skills||[]).filter(function(s){return s.id==='probe_zone';})[0]; if(!sk) return 'no skill';
    var C=window.SkillModules.compile(sk);
    var z=(sk.graph.nodes.filter(function(n){return n.type==='zone';})[0]||{}).id;
    return {zoneNode:z, fxByHostNode:Object.keys(C.fxByHostNode||{}), projectileFx:(C.projectileFx||[]).length,
      zoneFxCount:((C.fxByHostNode||{})[z]||[]).length};
  })()`);
  console.log('① 编译分流:', JSON.stringify(compiled));

  // 关掉墙体，避免投射物撞墙而不是命中敌人（区域残留只在命中组里创建）
  await ev(`(function(){var w=document.getElementById('seWallToggle');if(w&&w.checked)w.click();})()`);
  await wait(300);
  async function shoot(skillId, file) {
    await ev(`(function(){
      var b=document.querySelector('[data-act="se-skill"][data-id="${skillId}"]'); if(b)b.click();
    })()`);
    await wait(900);
    await ev(`(function(){var b=document.querySelector('[data-act="se-preview-restart"]');if(b)b.click();})()`);
    await wait(2400);
    const box = await ev(`(function(){
      var c=document.getElementById('sePreviewCanvas'); if(!c) return null;
      try { c.scrollIntoView({block:'center',inline:'center'}); } catch(e){}
      var r=c.getBoundingClientRect();
      return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)};
    })()`);
    await wait(400);
    if (!box) { console.log(file, '无 canvas'); return 0; }
    const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 2 } });
    const buf = Buffer.from(shot.result.data, 'base64');
    fs.writeFileSync('tools/' + file, buf);
    console.log('② 截图', file, box.width + 'x' + box.height, buf.length + 'B');
    return buf.length;
  }
  const shotProj = await shoot('probe_proj', 'smoke_fx_proj.png');
  const shotZone = await shoot('probe_zone', 'smoke_fx_zone.png');
  console.log('③ 捕获到的错误数:', errors.length, errors.slice(0, 2).join(' | '));

  const pass = String(injected).indexOf('ok:') === 0 && compiled &&
    compiled.zoneFxCount === 1 && compiled.projectileFx === 0 &&
    shotProj > 8000 && shotZone > 8000 && !errors.length;
  console.log('RESULT:', pass ? 'PASS' : 'FAIL');
  ws.close(); edge.kill(); process.exit(pass ? 0 : 1);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
