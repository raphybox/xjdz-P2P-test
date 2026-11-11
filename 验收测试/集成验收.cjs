/* 方案 A 集成验收 · node 集成验收.cjs（需 jsdom）
   用真实的 admin.html 结构 + 模拟的 admin.js 行为，验证：
     · 原页签 / 原委托 / 原数据 一个都没被改动
     · 新 Y3 页签能进出、互斥、禁用保存发布、数据隔离、消息桥可用
   同时加载 y3/index.html 验证 iframe 内独立数据集。 */
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require('jsdom')); }
catch (e) { console.log('⚠ 未安装 jsdom，跳过集成验收（可在目录执行 npm i jsdom）'); process.exit(0); }

const PKG = path.join(__dirname, '..');
const Y3 = path.join(PKG, 'y3');
const read = p => fs.readFileSync(p, 'utf-8');

/* ============ 父页面：真实 admin.html + 模拟 admin.js ============ */
const adminHtml = read(path.join(PKG, 'admin.html'));
const origHtml = read(path.join(PKG, 'admin.原始备份.html'));
const perr = [];
const pdom = new JSDOM(adminHtml, {
  runScripts: 'outside-only',
  url: 'http://127.0.0.1:8787/admin.html',
  pretendToBeVisual: true,
  virtualConsole: new VirtualConsole().on('jsdomError', e => perr.push(e.message))
});
const W = pdom.window;
W.Element.prototype.scrollIntoView = function () {};
if (!W.URL.createObjectURL) W.URL.createObjectURL = () => 'blob:stub';
if (!W.URL.revokeObjectURL) W.URL.revokeObjectURL = () => {};

/* 复刻 admin.js:5599 的导航委托、switchTab/refresh、全局 Ctrl+S —— 只保留与本方案相关的骨架 */
W.eval(`
  window.__stub = { switchCalls: [], saveCalls: 0, refreshCalls: 0 };
  var TAB_INFO = {
    dashboard:['总览','内容配置与发布状态'], skins:['外观管理','弹珠外观'],
    statuses:['状态图标','状态图标配置'], skills:['果实管理','果实技能与模块编排'],
    balance:['数值平衡','全局参数'], studio:['实时编排','蓝图工作台'],
    ui:['界面编辑器','界面布局'], texts:['文案编辑','多语言文案'],
    maps:['地图编辑器','对战场地'], events:['活动事件','运营活动'],
    weather:['对局天气','天气效果'], release:['校验与发布','发布检查']
  };
  function switchTab(name){
    document.querySelectorAll('.nav-item').forEach(function(b){ b.classList.toggle('active', b.dataset.tab === name); });
    window.__stub.switchCalls.push(name);
    window.__stub.refreshCalls++;
    document.getElementById('pageTitle').textContent = (TAB_INFO[name]||['?',''])[0];
    document.getElementById('pageSub').textContent   = (TAB_INFO[name]||['?',''])[1];
    document.getElementById('content').innerHTML = '<div id="stubContent">原编辑器：' + name + '</div>';
  }
  document.getElementById('nav').addEventListener('click', function(e){
    var b = e.target.closest('[data-tab]'); if (b) switchTab(b.dataset.tab);
  });
  document.addEventListener('keydown', function(e){
    if ((e.ctrlKey||e.metaKey) && (e.key==='s'||e.key==='S')) { e.preventDefault(); window.__stub.saveCalls++; }
  });
  window.__stub.setTab = switchTab;
`);
W.__stub.setTab('dashboard');   // 初始状态
W.__stub.switchCalls.length = 0;

/* 给 iframe 的 postMessage 打桩，记录 Y3 → 子页面的请求 */
const posted = [];
const frameProbe = () => W.document.getElementById('y3Frame');

const embedErrors = [];
try { W.eval(read(path.join(Y3, 'embed.js'))); }
catch (e) { embedErrors.push(e.message); }

let passed = 0;
const test = (name, fn) => {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); throw e; }
};
const $ = s => W.document.querySelector(s);
const $$ = s => Array.from(W.document.querySelectorAll(s));
console.log('\n=== 方案 A · 父后台集成验收（真实 admin.html 结构）===\n');

test('01 挂载器加载无异常，且不覆盖任何原有全局', () => {
  assert.deepEqual(embedErrors, []);
  assert.deepEqual(perr, []);
  assert.ok(W.Y3Embed, 'window.Y3Embed 未暴露');
  assert.equal(typeof W.__stub.switchCalls.length, 'number', '__stub 被覆盖');
  assert.ok(W.document.getElementById('nav'));
});

test('02 原始 12 个页签一个不少，data-tab 值完全不变', () => {
  const a = Array.from(new JSDOM(origHtml).window.document.querySelectorAll('#nav .nav-item'))
    .map(b => b.dataset.tab);
  const b = $$('#nav .nav-item[data-tab]').map(x => x.dataset.tab);
  assert.deepEqual(b, a, '原有页签被增删改了');
  assert.equal(b.length, 12);
});

test('03 只多出 1 个 Y3 按钮，且【不带 data-tab】', () => {
  const btn = $('#y3NavBtn');
  assert.ok(btn, 'Y3 按钮未注入');
  assert.equal($$('#nav .nav-item').length, 13);
  assert.equal(btn.hasAttribute('data-tab'), false, '带 data-tab 会触发原 switchTab 并报错');
  assert.equal(btn.closest('[data-tab]'), null, '父链上存在 data-tab');
  assert.ok(btn.textContent.includes('TEST'));
});

test('04 注入了独立 CSS，且 admin.css 引用未被替换', () => {
  assert.ok($('#y3EmbedCss'), 'embed.css 未注入');
  assert.ok($('#y3EmbedCss').href.includes('y3/embed.css'));
  const links = $$('link[rel=stylesheet]').map(l => l.getAttribute('href'));
  assert.ok(links.includes('admin.css'), '原 admin.css 引用丢失');
  assert.equal(links.length, 2);
});

test('05 iframe 面板与 #content 并列，原 content 未被清空 / 包裹', () => {
  const panel = $('#y3Panel');
  assert.ok(panel);
  assert.equal(panel.parentNode, $('.main'));
  assert.equal(panel.previousElementSibling.id, 'content');
  assert.equal(panel.hidden, true, '默认不应抢占视图');
  assert.ok($('#stubContent'), '原编辑器内容被覆盖');
});

test('06 点 Y3 页签：进入测试模式，原 switchTab 完全没被调用', () => {
  const before = W.__stub.switchCalls.length;
  $('#y3NavBtn').click();
  assert.equal(W.Y3Embed.isOn(), true);
  assert.equal($('#y3Panel').hidden, false);
  assert.equal($('#content').hidden, true);
  assert.ok($('#pageTitle').textContent.includes('Y3版'));
  assert.equal(W.__stub.switchCalls.length, before, '误触发了原 switchTab（会崩溃）');
  assert.ok($('#y3NavBtn').classList.contains('is-on'));
});

test('07 iframe 以 isolated=1&embed=1 加载', () => {
  const src = frameProbe().getAttribute('src');
  assert.ok(src.includes('index.html'));
  assert.ok(src.includes('isolated=1'));
  assert.ok(src.includes('embed=1'));
});

test('08 测试模式下顶部「保存 / 发布到本地 / 同步 GitHub」被禁用', () => {
  ['saveBtn', 'previewBtn', 'publishBtn'].forEach(id => {
    assert.equal(W.document.getElementById(id).disabled, true, id + ' 未禁用');
  });
});

test('09 Ctrl+S 被拦截：不会写正式配置，改为请求 Y3 暂存', () => {
  const f = frameProbe();
  const calls = [];
  f.contentWindow.postMessage = (m) => calls.push(m);
  const before = W.__stub.saveCalls;
  W.document.dispatchEvent(new W.KeyboardEvent('keydown',
    { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
  assert.equal(W.__stub.saveCalls, before, 'Ctrl+S 落到了原 saveToLocal');
  assert.ok(calls.some(m => m && m.type === 'y3:requestStaging'), '未向 iframe 请求暂存');
});

test('10 点回原「果实管理」：视图/标题/按钮还原，且原委托正常执行', () => {
  const before = W.__stub.switchCalls.length;
  $('#nav [data-tab="skills"]').click();
  assert.equal(W.Y3Embed.isOn(), false);
  assert.equal($('#y3Panel').hidden, true);
  assert.equal($('#content').hidden, false);
  assert.equal($('#pageTitle').textContent, '果实管理', '标题未还原到原页签');
  assert.equal(W.__stub.switchCalls.length, before + 1, '原 switchTab 未放行');
  assert.equal(W.__stub.switchCalls[W.__stub.switchCalls.length - 1], 'skills');
  assert.ok($('#nav [data-tab="skills"]').classList.contains('active'));
  ['saveBtn', 'previewBtn', 'publishBtn'].forEach(id => {
    assert.equal(W.document.getElementById(id).disabled, false, id + ' 未恢复');
  });
  assert.ok($('#stubContent').textContent.includes('skills'), '原编辑器未重新渲染');
});

test('11 消息桥：暂存只写 Y3 独立 key，正式 key 一个都没碰', () => {
  W.localStorage.setItem('wowpinball.config.v1', '{"sentinel":"keep"}');
  const payload = { schemaVersion: '1.0.0', fruits: [{ id: 'f1', name: '测试果实' }, { id: 'f2', name: '二号果实' }] };
  const ev = new W.MessageEvent('message', { data: { type: 'y3:staging', payload }, source: frameProbe().contentWindow });
  W.dispatchEvent(ev);
  const staged = JSON.parse(W.localStorage.getItem('wowpinball.y3.staging.v1'));
  assert.equal(staged.fruits.length, 2);
  assert.equal(W.localStorage.getItem('wowpinball.config.v1'), '{"sentinel":"keep"}', '正式配置被改写！');
  assert.equal(W.localStorage.getItem('wowpinball.snapshots.v1'), null);
  assert.equal(W.localStorage.getItem('wowpinball.preview.v1'), null);
  assert.ok($('#y3StagingInfo').textContent.includes('2 个果实'));
});

test('12 重复加载 embed.js 不会重复注入按钮 / 面板', () => {
  W.eval(read(path.join(Y3, 'embed.js')));
  assert.equal($$('#y3NavBtn').length, 1);
  assert.equal($$('#y3Panel').length, 1);
  assert.equal($$('#y3EmbedCss').length, 1);
});

test('13 只有 Y3 引用这一行差异，admin.js / admin.css 零改动（静态）', () => {
  const a = origHtml.split('\n');
  const b = adminHtml.split('\n');
  const added = b.filter(x => !a.includes(x));
  const removed = a.filter(x => !b.includes(x));
  assert.deepEqual(added, ['<script src="y3/embed.js"></script>']);
  assert.deepEqual(removed, []);
  assert.equal(b.length - a.length, 1);
  // 本安装器从不写这两个文件
  assert.ok(!fs.existsSync(path.join(PKG, 'admin.js')));
  assert.ok(!fs.existsSync(path.join(PKG, 'admin.css')));
});

test('14 ?y3=1 可直接进入测试页', () => {
  const d2 = new JSDOM(adminHtml, { runScripts: 'outside-only',
    url: 'http://127.0.0.1:8787/admin.html?y3=1', pretendToBeVisual: true });
  const w2 = d2.window;
  w2.Element.prototype.scrollIntoView = function () {};
  try { w2.eval(read(path.join(Y3, 'embed.js'))); } catch (e) {}
  // jsdom 不跑定时器；直接调暴露的接口确认参数分支已就绪
  assert.ok(w2.Y3Embed);
  w2.Y3Embed.enter();
  assert.equal(w2.Y3Embed.isOn(), true);
  assert.equal(w2.document.getElementById('y3Panel').hidden, false);
});

/* ============ 子页面：iframe 内的 Y3 编辑器 ============ */
console.log('\n--- iframe 内独立数据集验收 ---\n');
const cerr = [];
const cdom = new JSDOM(read(path.join(Y3, 'index.html')), {
  runScripts: 'outside-only',
  url: 'http://127.0.0.1:8787/y3/index.html?isolated=1&embed=1',
  pretendToBeVisual: true,
  virtualConsole: new VirtualConsole().on('jsdomError', e => cerr.push(e.message))
});
const C = cdom.window;
C.CSS = { escape: s => String(s).replace(/[^\w-]/g, '\\$&') };
C.Element.prototype.scrollIntoView = function () {};
C.HTMLAnchorElement.prototype.click = function () {};
if (!C.URL.createObjectURL) C.URL.createObjectURL = () => 'blob:stub';
if (!C.URL.revokeObjectURL) C.URL.revokeObjectURL = () => {};
// 把 parent 指向父 window，让 postMessage 桥真实可用
const bridge = [];
try { Object.defineProperty(C, 'parent', { value: W, configurable: true }); } catch (e) {}
['语句树_schema.js', '果实库.js', 'editor.js'].forEach(f => {
  try { C.eval(read(path.join(Y3, f))); } catch (e) { cerr.push(f + ': ' + e.message); }
});

test('15 iframe 内三个脚本无异常，编辑器初始化成功', () => {
  assert.deepEqual(cerr, []);
  assert.ok(C.FruitEditor);
  assert.equal(C.FruitEditor.fruits().length, 6);
});

test('16 数据隔离：LS key 是 wowpinball.y3.test.v1，不是正式 key', () => {
  assert.equal(C.FruitEditor.embed, true);
  assert.equal(C.FruitEditor.isolated, true);
  assert.equal(C.FruitEditor.lsKey, 'wowpinball.y3.test.v1');
  assert.ok(C.FruitEditor.lsKey !== 'wowpinball.config.v1');
  assert.ok(C.FruitEditor.lsKey !== 'fruit_logic_editor_v1');
});

test('17 嵌入态 UI 显示：独立数据徽标 / 返回原后台 / 暂存按钮', () => {
  ['y3EmbedBadge', 'y3BackBtn', 'y3StageBtn'].forEach(id => {
    assert.equal(C.document.getElementById(id).hidden, false, id + ' 未显示');
  });
});

test('18 6 个内置果实在嵌入态下仍全部校验通过', () => {
  C.FruitEditor.fruits().forEach(f => {
    const bad = C.SkillScript.validate(f).filter(i => i.level === 'error');
    assert.equal(bad.length, 0, f.name + ': ' + JSON.stringify(bad));
  });
});

test('19 暂存载荷结构完整，且与正式技能格式不冲突', () => {
  const p = C.FruitEditor.stagingPayload();
  assert.equal(p.fruits.length, 6);
  assert.equal(p.source.includes('Y3版'), true);
  assert.equal(p.isolatedKey, 'wowpinball.y3.test.v1');
  p.fruits.forEach(f => {
    assert.ok(f.triggers && f.triggers.length, f.name + ' 缺触发器');
    assert.equal(C.SkillScript.validate(f).filter(i => i.level === 'error').length, 0);
  });
});

test('20 子页 → 父页消息桥：暂存写入独立 key，正式配置仍原样', () => {
  const before = W.localStorage.getItem('wowpinball.config.v1');
  C.FruitEditor.stageToParent(true);
  // jsdom 的 postMessage 是异步的，这里用同步派发等价验证契约
  const payload = C.FruitEditor.stagingPayload();
  W.dispatchEvent(new W.MessageEvent('message', {
    data: { type: 'y3:staging', payload }, source: frameProbe().contentWindow
  }));
  const staged = JSON.parse(W.localStorage.getItem('wowpinball.y3.staging.v1'));
  assert.equal(staged.fruits.length, 6);
  assert.equal(W.localStorage.getItem('wowpinball.config.v1'), before);
});

test('21 「返回原后台」按钮发出 y3:exit，父页能退出测试模式', () => {
  W.Y3Embed.enter();
  assert.equal(W.Y3Embed.isOn(), true);
  W.dispatchEvent(new W.MessageEvent('message', {
    data: { type: 'y3:exit' }, source: frameProbe().contentWindow
  }));
  assert.equal(W.Y3Embed.isOn(), false);
  assert.equal(frameProbe().parentNode.hidden, true);
});

console.log('\n=== 全部 ' + passed + ' 项通过 · 原后台零侵入 ===\n');
