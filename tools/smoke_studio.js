'use strict';
/* 无头 Edge 冒烟：v4 工作流画布（渲染 / 端口连线 / 语义 / 缩放 / 控制台）
   依赖本地服务 127.0.0.1:8787；截图 tools/_studio.png、_studio_fit.png */
const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9223;
const wait = ms => new Promise(r => setTimeout(r, ms));
const getJson = p => new Promise((res, rej) => {
  http.get('http://127.0.0.1:' + PORT + p, r => {
    let b = ''; r.on('data', d => b += d); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
  }).on('error', rej);
});

(async () => {
  const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + path.join(require('os').tmpdir(), 'edge_studio'),
    '--window-size=1680,1000', 'about:blank'], { stdio: 'ignore' });
  await wait(2800);
  const list = await getJson('/json/list');
  const page = list.find(t => t.type === 'page') || list[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pend = new Map(); const errors = [];
  ws.on('message', m => {
    const d = JSON.parse(m);
    if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
    if (d.method === 'Runtime.exceptionThrown') errors.push('exception: ' + ((d.params.exceptionDetails.exception || {}).description || ''));
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error')
      errors.push('console.error: ' + (d.params.args || []).map(a => a.value || a.description || '').join(' '));
  });
  await new Promise(r => ws.on('open', r));
  const send = (method, params) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result && r.result.result ? r.result.result.value : (r.result && r.result.exceptionDetails ? 'EX:' + r.result.exceptionDetails.text : undefined);
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://127.0.0.1:8787/admin.html' });
  await wait(4200);

  console.log('① 脚本加载:', JSON.stringify(await ev('({K: typeof window.SkillPorts, SM: typeof window.SkillModules})')));
  await ev(`document.querySelector('[data-tab="skills"]').click()`);
  await wait(1400);
  await ev(`(function(){
    var items=[].slice.call(document.querySelectorAll('.se-item'));
    var t=items.filter(function(x){return x.textContent.indexOf('冰霜果实')>=0})[0]||items[0];
    if(t)t.click();
  })()`);
  await wait(3200);

  const stats = await ev(`(function(){
    var cards=[].slice.call(document.querySelectorAll('.se-card'));
    var sems=[].slice.call(document.querySelectorAll('.sd-sem'));
    return {
      cards: cards.length, dots: document.querySelectorAll('.sd-dot').length,
      edges: document.querySelectorAll('.se2-edge').length, sems: sems.length,
      lanes: document.querySelectorAll('.se-lane').length,
      stage: (function(){var st=document.getElementById('seStage');return st?st.style.width+' / '+st.style.height:''})(),
      live: sems.filter(function(s){return s.className.indexOf('off')<0}).length,
      dead: sems.filter(function(s){return s.className.indexOf('off')>=0}).length
    };
  })()`);
  console.log('② 画布结构:', JSON.stringify(stats));

  // 端口连线：触发(来源) 的 cast 输出 → 延迟卡 的 cast 输入
  const pair = await ev(`(function(){
    var cards=[].slice.call(document.querySelectorAll('.se-card'));
    function typeOf(c){var f=c.querySelector('.sd-type-fixed, .sd-type');return f?(f.value||f.textContent.trim()):'';}
    var src=cards.filter(function(c){return typeOf(c)==='source'})[0];
    var delay=cards.filter(function(c){return typeOf(c)==='delay'})[0];
    if(!src||!delay) return null;
    function pt(dot){var r=dot.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};}
    var a=src.querySelector('.sd-port.out[data-port="cast"] .sd-dot');
    var b=delay.querySelector('.sd-port.in[data-port="cast"] .sd-dot');
    var pa=pt(a),pb=pt(b);
    return {a:pa,b:pb,src:src.dataset.node,delay:delay.dataset.node,
      before:document.querySelectorAll('.se2-edge').length};
  })()`);
  if (pair) {
    const mouse = (type, x, y, extra) => send('Input.dispatchMouseEvent', Object.assign({ type, x, y, button: 'left', clickCount: 1 }, extra || {}));
    await mouse('mousePressed', pair.a.x, pair.a.y, { buttons: 1 });
    await wait(120);
    await mouse('mouseMoved', pair.a.x + 20, pair.a.y + 10, { buttons: 1 });
    await mouse('mouseMoved', pair.b.x - 10, pair.b.y, { buttons: 1 });
    await wait(120);
    await mouse('mouseReleased', pair.b.x, pair.b.y, { buttons: 0 });
    await wait(900);
    const linked = await ev(`(function(){
      var b=document.getElementById('seNodes');
      var d=document.querySelector('.se-card[data-node="' + ${JSON.stringify(pair.delay)} + '"] .sd-sem');
      return {after:document.querySelectorAll('.se2-edge').length, live:(d?d.className.indexOf('off')<0:null), txt:(d?d.textContent:'')};
    })()`);
    console.log('③ 端口连线:', JSON.stringify({ before: pair.before, after: linked.after, delayLive: linked.live, sem: linked.txt }));
    await ev(`document.querySelector('[data-act="se-undo"]').click()`);
    await wait(700);
    console.log('④ 撤销后连线数:', await ev(`document.querySelectorAll('.se2-edge').length`));
  } else {
    console.log('③ 端口连线: 未找到可测的触发/延迟卡片');
  }

  const mouse = (type, x, y, extra) => send('Input.dispatchMouseEvent', Object.assign({ type, x, y, button: 'left', clickCount: 1 }, extra || {}));

  // ⑤ 卡片内滑块：直接拖动 range，值必须变且卡片不能被重绘掉
  const sl = await ev(`(function(){
    var cards=[].slice.call(document.querySelectorAll('.se-card'));
    function typeOf(c){var f=c.querySelector('.sd-type-fixed, .sd-type');return f?(f.value||f.textContent.trim()):'';}
    var src=cards.filter(function(c){return typeOf(c)==='source'})[0];
    var r=src&&src.querySelector('.sd-fields input[type="range"]'); if(!r) return null;
    var b=r.getBoundingClientRect();
    return {x:Math.round(b.x),y:Math.round(b.y+b.height/2),w:Math.round(b.width),v:parseFloat(r.value),key:r.dataset.cfield};
  })()`);
  if (sl) {
    await mouse('mousePressed', sl.x + sl.w * 0.25, sl.y, { buttons: 1 });
    await wait(80);
    await mouse('mouseMoved', sl.x + sl.w * 0.55, sl.y, { buttons: 1 });
    await wait(80);
    await mouse('mouseMoved', sl.x + sl.w * 0.85, sl.y, { buttons: 1 });
    await wait(80);
    await mouse('mouseReleased', sl.x + sl.w * 0.85, sl.y, { buttons: 0 });
    await wait(600);
    const after = await ev(`(function(){
      var r=document.querySelector('.se-card .sd-fields input[type="range"]');
      return {v:r?parseFloat(r.value):null, cards:document.querySelectorAll('.se-card').length};
    })()`);
    console.log('⑤ 卡片内滑块:', JSON.stringify({ key: sl.key, from: sl.v, to: after.v, cards: after.cards }));
  }

  // ⑥ 点边线删除：命中路径必须能收到 click
  const ep = await ev(`(function(){
    var stage=document.getElementById('seStage');
    var z=parseFloat(stage.style.zoom)||1;
    var paths=[].slice.call(document.querySelectorAll('.se2-edge-hit'));
    for(var i=0;i<paths.length;i++){
      var p=paths[i], pt=p.getPointAtLength(p.getTotalLength()/2);
      var r=p.ownerSVGElement.getBoundingClientRect();
      var x=r.left+pt.x*z, y=r.top+pt.y*z;
      var el=document.elementFromPoint(x,y);
      if(el && (el===p || el===p.ownerSVGElement || el.classList.contains('se2-edges'))) return {x:x,y:y,n:paths.length};
    }
    return null;
  })()`);
  if (ep) {
    await mouse('mousePressed', ep.x, ep.y, { buttons: 1 });
    await mouse('mouseReleased', ep.x, ep.y, { buttons: 0 });
    await wait(700);
    const n2 = await ev(`document.querySelectorAll('.se2-edge').length`);
    console.log('⑥ 点线删除:', JSON.stringify({ before: ep.n, after: n2 }));
    console.log('⑥ 撤销按钮:', JSON.stringify(await ev(`(function(){var u=document.querySelector('[data-act="se-undo"]');return {dis:u?u.disabled:null,title:u?u.title:''}})()`)));
    await ev(`document.querySelector('[data-act="se-undo"]').click()`);
    await wait(700);
    console.log('⑥ 撤销后连线数:', await ev(`document.querySelectorAll('.se2-edge').length`));
  }

  // ⑦ 卡片内展开全部参数
  await ev(`(function(){
    var cards=[].slice.call(document.querySelectorAll('.se-card'));
    var dmg=cards.filter(function(c){var f=c.querySelector('.sd-type-fixed, .sd-type');return f&&(f.value||f.textContent.trim())==='damage'})[0];
    var btn=dmg&&dmg.querySelector('.sd-morebtn'); if(btn) btn.click();
  })()`);
  await wait(900);
  const exp = await ev(`(function(){
    var e=document.querySelector('.sd-expand');
    return e?{fields:e.querySelectorAll('.se-field').length, h:Math.round(e.getBoundingClientRect().height), insp:document.getElementById('seInspector').textContent.slice(0,20)}:null;
  })()`);
  console.log('⑦ 卡片内展开:', JSON.stringify(exp));
  // ⑧ 展开区里的滑块也要能直接拖
  await ev(`(function(){var r=document.querySelector('.sd-expand input[type="range"]');if(r)r.scrollIntoView({block:'center'});})()`);
  await wait(500);
  const exSl = await ev(`(function(){
    var r=document.querySelector('.sd-expand input[type="range"]'); if(!r) return null;
    var b=r.getBoundingClientRect();
    return {x:Math.round(b.x),y:Math.round(b.y+b.height/2),w:Math.round(b.width),v:parseFloat(r.value),key:r.dataset.sefield};
  })()`);
  if (exSl) {
    await mouse('mousePressed', exSl.x + exSl.w * 0.2, exSl.y, { buttons: 1 });
    await wait(80);
    await mouse('mouseMoved', exSl.x + exSl.w * 0.8, exSl.y, { buttons: 1 });
    await wait(80);
    await mouse('mouseReleased', exSl.x + exSl.w * 0.8, exSl.y, { buttons: 0 });
    await wait(600);
    const exAfter = await ev(`(function(){
      var e=document.querySelector('.sd-expand'); var r=e&&e.querySelector('input[type="range"]');
      return {v:r?parseFloat(r.value):null, fields:e?e.querySelectorAll('.se-field').length:0};
    })()`);
    console.log('⑧ 展开区滑块:', JSON.stringify({ key: exSl.key, from: exSl.v, to: exAfter.v, fields: exAfter.fields }));
  }

  // ⑨ 目标 + 范围融合：目标卡上的「合并成一张」应把选靶口径并入范围卡并删掉目标卡
  const mgBtn = await ev(`(function(){
    var cards=[].slice.call(document.querySelectorAll('.se-card'));
    var sel=cards.filter(function(c){var f=c.querySelector('.sd-type');return f&&f.value==='select'})[0];
    var btn=sel&&sel.querySelector('[data-act="se-merge-range"]');
    if(!btn) return null;
    btn.click();
    return {cards:cards.length, edges:document.querySelectorAll('.se2-edge').length};
  })()`);
  if (mgBtn) {
    await wait(900);
    const mgAfter = await ev(`(function(){
      var cards=[].slice.call(document.querySelectorAll('.se-card'));
      var r=cards.filter(function(c){var f=c.querySelector('.sd-type');return f&&f.value==='range'})[0];
      function val(key){
        var el=r&&r.querySelector('[data-cfield="'+key+'"]');
        return el?(el.value==null?'':el.value):null;
      }
      return {cards:cards.length, edges:document.querySelectorAll('.se2-edge').length,
        pick:val('pick'), maxTargets:val('maxTargets'), mergeBtn:!!(r&&r.querySelector('[data-act="se-merge-range"]'))};
    })()`);
    console.log('⑨ 目标+范围融合:', JSON.stringify({ before: mgBtn, after: mgAfter }));
    await ev(`document.querySelector('[data-act="se-undo"]').click()`);
    await wait(700);
    console.log('⑨ 撤销后卡片数:', await ev(`document.querySelectorAll('.se-card').length`));
  } else {
    console.log('⑨ 目标+范围融合: 未找到带合并按钮的目标卡');
  }

  // 100% 视图回到「目标」泳道，截图核对 单体/范围 切换与合并入口
  await ev(`document.querySelector('.se-stage-wrap').scrollLeft = 0`);
  await wait(500);
  const shotT = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1680, height: 880, scale: 1 } });
  fs.writeFileSync(path.join(__dirname, '_studio_target.png'), Buffer.from(shotT.result.data, 'base64'));

  // 把画布横向滚到「结算」泳道，截图看清展开后的卡片
  await ev(`document.querySelector('.se-stage-wrap').scrollLeft = 900`);
  await wait(600);

  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1680, height: 880, scale: 1 } });
  fs.writeFileSync(path.join(__dirname, '_studio.png'), Buffer.from(shot.result.data, 'base64'));

  await ev(`document.querySelector('[data-act="se-zoom-fit"]').click()`);
  await wait(700);
  console.log('⑤ 适应窗口:', await ev(`document.getElementById('seStage').style.zoom + ' | ' + document.querySelector('.se-zoompct').textContent`));
  const shot2 = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1680, height: 880, scale: 1 } });
  fs.writeFileSync(path.join(__dirname, '_studio_fit.png'), Buffer.from(shot2.result.data, 'base64'));

  console.log('⑥ 控制台错误:', errors.length ? errors.slice(0, 8) : '无');
  ws.close(); edge.kill();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.log('SMOKE ERROR', e && e.stack || e); process.exit(2); });
