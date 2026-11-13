/* v3 打磨回归：9 项修复（上传放宽 / 目标锁定 / 加载页 / 图层粒度 / 护盾特效 / 命中判定 / tips / BUFF 布局）
   纯 Node，编译层用真实 skill-modules.js，DOM 层用源码静态断言。 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SM = require(path.join(ROOT, 'skill-modules.js'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' → ' + extra : '')); }
}

const game = read('game.js'), admin = read('admin.js'), html = read('index.html');
const ui = read('ui-layout.js'), css = read('styles.css'), cfg = JSON.parse(read('data/game-config.json'));
const cfgLoader = read('config-loader.js'), fx = read('skill-effects.js'), mods = read('skill-modules.js');
const server = read('server.js');

console.log('1) 地图背景图上传放宽');
ok('原图上限 20 MB', /file\.size > 20 \* 1024 \* 1024/.test(admin));
ok('内嵌上限 600 万字符', /src\.length > 6000000/.test(admin));
ok('发布校验放宽到 900 万字符', /m\.bgImg\.length > 9000000/.test(admin));
ok('页面提示与实现一致（不再写 8 MB）', /原图最多 20 MB/.test(admin) && !/背景图单张最多 8 MB/.test(admin));
ok('服务端配置 POST 上限同步放宽', /s\.length > 20 \* 1024 \* 1024/.test(server));

console.log('2) 所有果实必须有目标·锁定且串在逻辑链路上');
ok('起始图自带 select 且 source→select→stats',
  /var s = node\('source', 40, 90\), sel = node\('select', 180, 90\)/.test(mods) &&
  /\{ from: s\.id, to: sel\.id \}, \{ from: sel\.id, to: st\.id \}/.test(mods));
ok('起始图默认锁定最近敌人', /sel\.params\.side = 'enemyOne'/.test(mods));
ok('旧存档 migrate 幂等补 select', /select_auto_/.test(cfgLoader) && /e\.from = sel\.id/.test(cfgLoader));
ok('后台发布校验提示缺锁定', /缺少「目标 · 锁定」模块/.test(admin));
let allLinked = true, allPresent = true;
cfg.skills.forEach(sk => {
  const g = sk.graph || {};
  // 单体用 select，范围用 range（选择对象/数量写在范围卡上），两者都算目标卡
  const sel = (g.nodes || []).find(n => n && (n.type === 'select' || n.type === 'range'));
  const outs = sel ? (g.edges || []).filter(e => e && e.from === sel.id).length : 0;
  if (!sel || outs === 0) allLinked = false;
  let C = null;
  try { C = SM.compile(sk); } catch (e) { C = null; }
  if (!C || !C.present || (C.present.select !== true && C.present.range !== true)) allPresent = false;
});
ok('配置里 ' + cfg.skills.length + ' 个果实都有目标卡（单体 / 范围）且有下游出边', allLinked);
ok('编译后目标卡（select / range）都参与编译', allPresent);
ok('默认图 starterGraph 编译后 present.select 为 true',
  (function () { try { return SM.compile({ id: 'tmp', name: 'tmp', graph: SM.starterGraph(null) }).present.select === true; } catch (e) { return false; } })());

console.log('3) 网站名称与默认加载页');
ok('<title> 静态默认与 h1 一致', /<title>果实弹珠<\/title>/.test(html) && /<h1>果实弹珠<\/h1>/.test(html));
ok('品牌标题注入时同步 document.title', /if \(t\.selector === '\.brand-text h1' && v\) document\.title = v;/.test(game));
ok('存在内联加载页样式（首帧即生效）', /#bootSplash\{/.test(html) && /@keyframes bsPulse/.test(html));
ok('body 开头有加载页节点', /<div id="bootSplash"/.test(html));
ok('startScreen 初始 hidden，避免半成品骨架外露', /<section id="startScreen" class="screen" hidden>/.test(html));
ok('初始化完成后移除加载页', /if \(bootSplash\) bootSplash\.remove\(\);/.test(game));
ok('预览 / 编辑器共用同一处收尾（不在分支里提前返回）',
  game.indexOf('if (bootSplash) bootSplash.remove();') > game.lastIndexOf('openHatchModal();'));

console.log('4/5) 界面编辑器图层粒度');
const startBlock = (ui.match(/var START_BASE = \[[\s\S]*?\n  \];/) || [''])[0];
['#nickBtn', '#speedBtn', '#soundBtn', '#rulesBtn'].forEach(sel => {
  ok('右上按钮单独图层 ' + sel, startBlock.indexOf("'" + sel + "'") >= 0);
});
['.brand-text h1', '.brand-text p', '#startScreen .section-head h2', '#startScreen .section-head p'].forEach(sel => {
  ok('文字单独图层 ' + sel, startBlock.indexOf("'" + sel + "'") >= 0);
});
ok('拆出的图层都不是 multi（可分别编辑）',
  /\['brandSub', '品牌副标题', '\.brand-text p', 0, 0,/.test(ui) &&
  /\['speedBtn', '速度按钮', '#speedBtn', 0, 0,/.test(ui));

console.log('6) 护盾手绘与弹珠圆心挂载');
ok('编译期判定护盾与特效相连', /var shieldHasFx = false;/.test(mods) && /shieldHasFx: shieldHasFx,/.test(mods));
ok('对局按编译结果给弹珠打标记', /f\._shieldHasFx = f\._skillCasters\.some/.test(game));
ok('护盾手绘环在已连特效时隐藏', /if \(f\.shield > 0\.5 && !f\._shieldHasFx\)/.test(game));
ok('试放沙盘同步隐藏手绘环', /!shieldHasFxPreview/.test(admin));
ok('ATTACH 新增弹珠圆心选项', /\['marbleCenter', '弹珠圆心（居中挂载）'\]/.test(mods));
ok('运行时按 origin 反向补偿到圆心', /q\.centerAlign/.test(fx) && /mt\.origin\[0\] - mt\.size\[0\] \/ 2/.test(fx));
ok('圆心特效锚定施法弹珠实体（跟随）', /f\.attach === 'marbleCenter'/.test(fx));
const skillHas = (s, type) => ((s.graph || {}).nodes || []).some(n => n && n.type === type);
const shieldSkill = cfg.skills.find(s => skillHas(s, 'shield') && skillHas(s, 'fx'));
ok('含护盾且连特效的果实编译出 shieldHasFx=true',
  !!shieldSkill && (function () { try { return SM.compile(shieldSkill).shieldHasFx === true; } catch (e) { return false; } })());
const chargeSkill = cfg.skills.find(s => skillHas(s, 'fx') && !skillHas(s, 'shield'));
ok('不含护盾的果实 shieldHasFx=false',
  !!chargeSkill && (function () { try { return SM.compile(chargeSkill).shieldHasFx === false; } catch (e) { return false; } })());

console.log('7) 命中时才播特效');
ok('只对 onHit 严格判定', /const strictHit = \(ev === 'onHit'\);/.test(game));
ok('空挥不播（无命中目标直接过滤）', /if \(!ts\.length\) return false;/.test(game));
ok('与「目标·锁定」结果取交集', /SM\.selectTargets\(C, followEnt/.test(game) && /locked\.indexOf\(t\) >= 0/.test(game));
ok('试放侧同口径', /const strictHit = \(evKey === 'onHit'\);/.test(admin) && /SM\.selectTargets\(V, caster/.test(admin));
ok('范围空挥不再主动播一次表现', !/空挥：只在判定点播一次表现/.test(game) && /空挥：没有任何命中目标/.test(game));

console.log('8/9) tips 去重与 BUFF 区预留');
ok('mini-skill 不再二次拼充能时间', !/· 充能 ' \+ t \+ 's'/.test(game));
ok('只保留被动说明', /!isActive \? ' · 被动 · 无需充能' : ''/.test(game));
ok('SKILLS.desc 仍保留唯一一份充能说明', /✸主动技能 · 充能 ' \+ charge\.toFixed\(1\) \+ 's'/.test(game));
ok('BUFF 栏常驻 min-height', /\.buff-bar \{[^}]*min-height: 28px;/.test(css));
ok('BUFF 空时不再 display:none', /\.buff-bar:empty \{ display: flex; \}/.test(css));

console.log('10) 2V2 · 四独立血条 + 每人各自选果实');
ok('HTML 有四卡容器 #seatGrid', /<div id="seatGrid" class="seat-grid" hidden>/.test(html));
ok('CSS：2V2 隐藏合并总血条、改显示四卡',
  /#battleScreen\.mode-2v2 \.fighter-panel \{ display: none; \}/.test(css) &&
  /#battleScreen\.mode-2v2 #seatGrid \{ display: grid; \}/.test(css));
ok('CSS：座位卡含各自护盾条与 BUFF 栏',
  /\.sc-shield-bar \{/.test(css) && /\.seat-card \.buff-bar/.test(css));
ok('game 构建四卡并切换 mode-2v2',
  /function buildSeatGrid\(\)/.test(game) && /classList\.toggle\('mode-2v2'/.test(game));
ok('recompute 按座位取果实（不再 team 共享）',
  /const fruit = \(G\.actorFruits && f\.seat != null\) \? G\.actorFruits\[f\.seat\] : null;/.test(game));
ok('2V2 房主为每座位点对点发各自候选',
  /for \(let s = 1; s < 4; s\+\+\) \{[\s\S]*?p2pSend\(\{ k: 'draft', r: G\.round, seat: s/.test(game));
ok('2V2 任意座位都开选果实（非仅队长）',
  /if \(G\.mode === '2v2' \|\| P2P\.mySeat === 1\) p2pGuestOpenDraft\(msg\);/.test(game));
ok('2V2 客机只写自己座位的果实',
  /G\.actorFruits = \{\}; G\.actorFruits\[P2P\.mySeat\] = x;/.test(game));
ok('2V2 房主按 seat 收集、集齐 4 人开局',
  /P2P\.pickBySeat\[seat\] = x;[\s\S]*?P2P\.draftSeatsDone \|\| 0\) >= 4/.test(game));
ok('房主广播每座位展示模型（昵称/果实/BUFF）',
  /function p2pSendSeatHud\(force\)/.test(game) && /k: 'hud'/.test(game));
ok('客机收到 hud 写回每座位模型',
  /case 'hud':[\s\S]*?G\.seatHud\[s\.seat\] = s;/.test(game));
ok('客机快照补齐队友 maxHp', /f\.maxHp = a\.maxHp;/.test(game));
ok('onSeats 不再把对象数组直接塞进 P2P.members（避免 [object Object]）',
  !/P2P\.members = members;/.test(game) && /const next = \[\];/.test(game));
ok('onSeats 保留 onCtrl 已写入的昵称串（房间轮询反复调用不覆盖）',
  /const prev = P2P\.members && P2P\.members\[seat\];/.test(game) &&
  /typeof prev === 'string' \? prev/.test(game));
ok('画布阵营名牌读每座位真实昵称（不再我方/对手都写成本机名）',
  /function drawSideLabel\(f, side\) \{[\s\S]*?const hud = \(G\.seatHud && f\.seat != null\) \? G\.seatHud\[f\.seat\] : null;/.test(game));
ok('seatNick 防御成员为对象时取 .nick（杜绝 [object Object]）',
  /return \(typeof m === 'string'\) \? m : \(m\.nick/.test(game));

console.log('11) 界面属性·背景色透明度 + 果实库介绍/滚动/搜索');
ok('后台属性面板有「背景色不透明度」控件', /uiNum\('bgA', '背景色不透明度'/.test(admin));
ok('bgA=1 视为中性值，不写进配置', /bgA: 1/.test(admin));
ok('ui-layout 白名单接受 bgA 并夹在 0~1', /keep\('bgA', 0, 1\)/.test(ui));
ok('backgroundColor 用 rgba 应用 bgA（不影响元素 opacity）',
  /function hexRgba\(hex, a\)/.test(ui) && /set\('backgroundColor', bgA === null \? p\.bg : hexRgba\(p\.bg, bgA\)\)/.test(ui));
ok('首页有果实库搜索框 #fruitSearch 与滚动容器 .fruit-scroll',
  /id="fruitSearch"/.test(html) && /class="fruit-scroll"/.test(html));
ok('果实库卡片渲染介绍文字 .fc-intro', /fc-intro/.test(game) && /x\.intro \|\| x\.desc/.test(game));
ok('搜索词参与过滤（名称/介绍/机制/来源/品质）',
  /let fruitQuery = ''/.test(game) && /String\(t \|\| ''\)\.toLowerCase\(\)\.indexOf\(q\) >= 0/.test(game));
ok('搜索框 input 事件重绘网格', /dom\.fruitSearch\.addEventListener\('input'/.test(game));
ok('CSS：滚动区限高可滚动、介绍最多 3 行',
  /\.fruit-scroll \{[\s\S]*?overflow-y: auto/.test(css) && /\.fc-intro \{[\s\S]*?-webkit-line-clamp: 3/.test(css));
ok('界面编辑器图层登记了搜索框与滚动区',
  /'fruitSearch'/.test(ui) && /'fruitScroll'/.test(ui) && /'fruitIntro'/.test(ui));

console.log('12) 界面编辑器·撤销 / 重做 / 复制粘贴');
const adminHtml = read('admin.html');
ok('界面编辑器有独立撤销栈（与地图 / 技能分开）',
  /uiHist: \{ undo: \[\], redo: \[\], current: null/.test(admin));
ok('撤销栈挂在 markDirty 统一入口（拖拽 / 属性 / 重置 / 粘贴全覆盖）',
  /S\.tab === 'ui' && !S\.hist\.mute && S\.data\) uiCommitHistory/.test(admin));
ok('快照把 base64 素材收进共享池（避免每步历史复制一份 PNG）',
  /const UI_HIST_LIMIT = 40/.test(admin) && /__uiImg/.test(admin) && /uiImgPool/.test(admin));
ok('撤销后只做局部同步，不重建预览 iframe',
  /if \(S\.tab !== 'ui'\) switchTab\('ui'\); else uiSync\(\);/.test(admin));
ok('Ctrl+Z / Ctrl+Y 在界面页签走独立历史',
  /else if \(S\.tab === 'ui'\) uiStepHistory\(e\.shiftKey \? 'redo' : 'undo'\)/.test(admin) &&
  /else if \(S\.tab === 'ui'\) uiStepHistory\('redo'\)/.test(admin));
ok('Ctrl+C / Ctrl+V 复制粘贴元素样式',
  /function uiCopyEl/.test(admin) && /function uiPasteEl/.test(admin) &&
  /S\.tab === 'ui' && \(k === 'c' \|\| k === 'C'\)/.test(admin) &&
  /S\.tab === 'ui' && \(k === 'v' \|\| k === 'V'\)/.test(admin));
ok('工具栏有撤销 / 重做 / 复制样式 / 粘贴样式四个按钮',
  /data-act="ui-undo"/.test(admin) && /data-act="ui-redo"/.test(admin) &&
  /data-act="ui-copy"/.test(admin) && /data-act="ui-paste"/.test(admin));
ok('复制时剥掉 ref，不把跟随关系搬给别的元素',
  /delete patch\.ref;/.test(admin));
ok('预览 iframe 内的组合键转发给父窗口',
  /post\(\{ type: 'key', key: k, shift: !!ev\.shiftKey \}\)/.test(ui));
ok('帮助面板登记了界面编辑器快捷键',
  /界面编辑器 · 撤销与复制/.test(adminHtml) && /界面编辑器 40 步/.test(adminHtml));
ok('位移不会解除滚动容器的裁剪（否则滚动条失效、长列表铺开）',
  /var scrollBox = /.test(ui) && /var crop = !scrollBox/.test(ui));

console.log('\n13) 后台已移除「实时编排」与「果实编辑器 Y3 版」');
ok('导航里没有实时编排页签', !/data-tab="studio"/.test(adminHtml) && !/实时编排/.test(adminHtml));
ok('admin.js 不再挂载 studio 渲染 / 预览推送',
  !/renderStudio/.test(admin) && !/initStudio/.test(admin) && !/pushPreviewConfig/.test(admin) && !/S\.studio/.test(admin));
ok('admin.js 不再监听预览引擎的 postMessage 事件流',
  !/kind !== 'pb'/.test(admin) && !/appendEventLog/.test(admin));
ok('admin.css 不再保留编排工作台样式',
  !/\.studio\s*\{/.test(read('admin.css')) && !/\.node-canvas/.test(read('admin.css')));
ok('Y3 挂载脚本已从后台页面移除', !/y3\/embed\.js/.test(adminHtml) && !/Y3版/.test(adminHtml));

console.log('\n14) 外观管理 · 弹珠素材尺寸');
ok('有贴图的外观卡渲染「素材尺寸」滑杆', /data-skm="scale"/.test(admin) && /素材尺寸/.test(admin));
ok('滑杆范围 30%~300%（与渲染器 normalize 的 0.3~3 对齐）',
  /min="30" max="300"/.test(admin) && /clamp\(\(parseFloat\(t\.value\) \|\| 100\) \/ 100, 0\.3, 3\)/.test(admin));
ok('写入真实字段 skins[].scale（预览与实战同源）',
  /s\.scale = clamp\(/.test(admin) && /side = 2 \* r \* skin\.scale/.test(read('skin-render.js')));
ok('拖动时只就地刷新读数与球体，不整页重渲染',
  /function syncSkinSizeUi/.test(admin) && /if \(cv\) paintSkinOrb\(cv\);/.test(admin) &&
  !/kind === 'scale'[\s\S]{0,400}refresh\(\)/.test(admin));
ok('像素读数按 marble.radius 换算（半径 21 → 直径 42）',
  /const radius = Number\(\(S\.data\.marble \|\| \{\}\)\.radius\) \|\| 21/.test(admin) &&
  /2 \* radius \* \(Number\(s\.scale\) \|\| 1\)/.test(admin));
ok('一键重置回 100%', /data-act="skm-scale-reset"/.test(admin) && /s\.scale = 1; markDirty\('skin-scale-reset:'/.test(admin));
ok('外观卡有尺寸控件样式', /\.skin-card \.sk-size\b/.test(read('admin.css')) && /\.sk-size-px/.test(read('admin.css')));

console.log('\n15) 外观卡重建后保持界面编辑器尺寸');
ok('renderSkins 重建卡片后重新应用界面配置',
  /function renderSkins\(\)[\s\S]{0,1800}?paintSkinOrbs\(\);[\s\S]{0,400}?window\.WowPinballUI\.apply\(\)/.test(game));
ok('界面编辑器登记了外观卡与外观球的尺寸/位移图层',
  /'skinCard',\s*'外观卡片',\s*'\.skin-card'/.test(ui) && /'orb',\s*'外观弹珠预览/.test(ui));
ok('外观球绘制仍走共用渲染器（scale 同源）',
  /SK\.paintThumb\(cv,\s*x\.color \|\| MARBLE\.color,\s*x\.src \? x : null/.test(game));

console.log('\n16) 果实编辑器 · 语义链路判定接入');
const fguard = read('skill-flow-guard.js');
const smokeFlow = read('tools/smoke_flow_admin.js');
ok('后台加载结构守卫与语义守卫脚本',
  /skill-graph-guard\.js/.test(adminHtml) && /skill-flow-guard\.js/.test(adminHtml));
ok('契约表覆盖 19 类模块且声明 inputs/outputs/phase/requires',
  /var CONTRACTS = \{/.test(fguard) && /source:\s*\{/.test(fguard) && /tick:\s*\{/.test(fguard) &&
  /phase:/.test(fguard) && /requires:/.test(fguard));
ok('判定引擎提供 check / canConnect / describeFlow / summarize',
  /function check\(/.test(fguard) && /function canConnect\(/.test(fguard) &&
  /function describeFlow\(/.test(fguard) && /function summarize\(/.test(fguard));
ok('旧归属图不灌 error（不阻断未迁移果实的发布）',
  /model === 'legacy'/.test(fguard) && /LEGACY_GRAPH/.test(fguard));
ok('连线前置使用端口契约判定，并写入 fromPort / toPort',
  /K\.canConnect\(sk, link\.from, link\.fromPort, toId, toPort\)/.test(admin) &&
  /fromPort: link\.fromPort, toPort: toPort/.test(admin) &&
  /function se2AutoInPort\(/.test(admin));
ok('体检结果与发布校验合并同一份判定，error 走阻断项',
  /list\.concat\(FG\.check\(/.test(admin) && /window\.SkillFlowGuard\.check\(s, window\.SkillModules\)/.test(admin) &&
  /it\.level === 'error' \? err : warn/.test(admin));
ok('链路诊断抽屉给出原因与修法',
  /function seOpenFlowDiagnose\(/.test(admin) && /sg-diag-why/.test(admin) && /sg-diag-fix/.test(admin) &&
  /\.sg-diag-item/.test(read('admin.css')));
ok('组合链路条显示因果链摘要',
  /FG\.describeFlow\(sk, window\.SkillModules\)/.test(admin) && /se-combo-flow/.test(read('admin.css')));
ok('配套语义回归与后台冒烟脚本存在',
  /语义链路判定回归/.test(read('tools/test_flow_guard.js')) && /RESULT:/.test(smokeFlow));

console.log('\n17) 特效接管载体外观（连接特效后只认特效素材）');
(function () {
  function N(id, t, p) { return { id: id, type: t, params: p || {} }; }
  function E(a, b) { return { from: a, to: b }; }
  const fxP = { effect: 'fire/fireball', attach: 'projectile', triggerEvent: 'onHit' };
  const zoneSk = { name: 'z', graph: { nodes: [
    N('s', 'source'), N('p', 'projectile'), N('z', 'zone', { duration: 6 }), N('f', 'fx', fxP)
  ], edges: [E('s', 'p'), E('p', 'z'), E('z', 'f')] } };
  const projSk = { name: 'p', graph: { nodes: [
    N('s', 'source'), N('p', 'projectile'), N('f', 'fx', fxP)
  ], edges: [E('s', 'p'), E('p', 'f')] } };
  let CZ, CP;
  try { CZ = SM.compile(zoneSk); CP = SM.compile(projSk); } catch (e) { CZ = CP = null; }
  ok('区域专属特效不再被误收进投射物皮肤', !!CZ && !(CZ.projectileFx || []).length);
  ok('区域专属特效登记到载体节点名下', !!CZ && ((CZ.fxByHostNode || {}).z || []).length === 1);
  ok('投射物专属特效仍进投射物皮肤', !!CP && (CP.projectileFx || []).length === 1 &&
    ((CP.fxByHostNode || {}).p || []).length === 1);
  ok('编译结果带 _hostType / fxByHostNode', /normalized\._hostType/.test(mods) && /fxByHostNode/.test(mods));
  ok('挂载位置枚举新增「跟随所属载体」', /\['host', '跟随所属载体/.test(mods));
  ok('连线到区域/光环时自动把特效切到 host',
    /fromN\.type === 'zone' \|\| fromN\.type === 'aura'/.test(admin) && /toN\.params\.attach = 'host'/.test(admin));
  ok('试放与对局的区域实体都创建并跟随专属特效',
    /SE\.spawnFx\(zfx, 'zone'/.test(admin) && /SE\.spawnFx\(zfx, 'zone'/.test(game) &&
    /q\.follow = rec/.test(admin) && /a\.follow = rec/.test(game));
  ok('区域到期时同步回收特效', /z\.dead = true/.test(admin) && /z\.dead = true/.test(game));
  ok('已挂特效的载体不再画默认外观（拖尾/手绘圆/纯色圆）',
    /if \(q\._skinFx\) return;[\s\S]{0,160}drawShotTrail/.test(admin) &&
    /if \(q\._skinFx\) return;[\s\S]{0,160}drawShotTrail/.test(game) &&
    /if \(z\._skinFx\) return/.test(admin) && /if \(z\._skinFx\) return/.test(game));
  ok('归属区域的特效不在事件点重复生成',
    /_hostType !== 'zone'/.test(admin) && /_hostType !== 'zone'/.test(game));
  ok('配套试放冒烟脚本验证编译分流与画面',
    /RESULT:/.test(read('tools/smoke_fx_host.js')) && /zoneFxCount/.test(read('tools/smoke_fx_host.js')));
})();

console.log('\n18) 像素特效 · 可选动画播放区间');
const pfx = read('pixelfx-runtime.js'), seSrc = read('skill-effects.js');
ok('特效属性新增「动画起始 / 动画结束」两个秒数字段',
  /n\('clipStart', '动画起始\(秒\)'/.test(mods) && /n\('clipEnd', '动画结束\(秒\)'/.test(mods));
ok('运行时提供 seek 与 restart(from)，按小步快进避免大 dt 破坏状态',
  /function fastForward\(/.test(pfx) && /seek: function \(t\)/.test(pfx) && /restart: function \(from\)/.test(pfx));
ok('生成时跳到动画起始、结束早于起始时自动夹正',
  /if \(cFrom > 0 && inst\.seek\) inst\.seek\(cFrom\)/.test(seSrc) &&
  /if \(cTo > 0 && cTo <= cFrom\) cTo = cFrom \+ 0\.05/.test(seSrc));
ok('循环与回收都按 clipEnd 判断，重开时回到 clipStart',
  /var endT = q\.clipEnd > 0 \? q\.clipEnd : \(inst\.cycle \|\| 0\)/.test(seSrc) &&
  /inst\.restart\(q\.clipStart \|\| 0\)/.test(seSrc) &&
  /var endT = q\.clipEnd > 0 \? q\.clipEnd : \(q\.inst\.cycle \|\| 0\)/.test(seSrc));
ok('属性面板显示当前素材一轮时长，预览与节点摘要同步区间',
  /meta\.duration \|\| 1/.test(admin) && /clipStart: Number\(n\.params\.clipStart\)/.test(admin) &&
  /' · 动画 ' \+ cs\.toFixed\(1\)/.test(admin));
ok('端到端冒烟覆盖 seek / 区间循环 / 旧配置兼容',
  /clipStart:3, clipEnd:6/.test(read('tools/smoke_fx_clip.js')) &&
  /越过 6 秒后重开并回到 3 秒/.test(read('tools/smoke_fx_clip.js')));

console.log('\n19) 存在时长 · 动画播完后的三种末尾表现');
ok('特效属性新增「动画播完后」下拉（定格 / 末尾0.1s循环 / 整轮重播）',
  /sel\('tailMode', '动画播完后', 'freeze'/.test(mods) &&
  /\['freeze', '定格最后一帧'\]/.test(mods) && /\['loop', '循环最后 0\.1 秒'\]/.test(mods) &&
  /\['restart', '整轮从头重播'\]/.test(mods));
ok('「循环播放 / 存在时长」文案改为存在时长优先，不再默认整轮补满',
  !/自动循环补满到该时长/.test(mods) && /填了存在时长时，播完一轮后的行为由下面/.test(mods) &&
  /不会提前消失/.test(mods));
ok('特效实例记录 tailMode 与 frozen 状态',
  /tailMode: f\.tailMode \|\| 'freeze', frozen: false/.test(seSrc));
ok('stepFx：定格不推进动画但继续累加 age 供按时长回收',
  /if \(q\.frozen\) return;/.test(seSrc) && /q\.frozen = true/.test(seSrc) &&
  /q\.age = \(q\.age \|\| 0\) \+ dt/.test(seSrc));
ok('stepFx：末尾 0.1 秒循环回拨到 endT-0.1',
  /var TAIL_SPAN = 0\.1/.test(seSrc) && /endT - TAIL_SPAN/.test(seSrc));
ok('stepFx：存在时长优先于「循环播放」，整轮重播为显式兜底',
  /if \(Number\(q\.cfg\.life\) > 0\)/.test(seSrc) && /mode === 'freeze'/.test(seSrc) &&
  /mode === 'loop'/.test(seSrc) && /else if \(inst\.restart\)/.test(seSrc) &&
  /\/\/ 无存在时长：循环播放由 loop 决定/.test(seSrc));
ok('特效库预览与节点摘要同步末尾模式',
  /tailMode: n\.params\.tailMode \|\| 'freeze'/.test(admin) && /tailMode = v\.tailMode \|\| 'freeze'/.test(pfx) &&
  /tailShort = \{ freeze: '定格末尾'/.test(admin));
ok('端到端冒烟覆盖三种模式 / 旧配置兼容 / 时长内不回收',
  /定格：存在时长未到时不回收/.test(read('tools/smoke_fx_tail.js')) &&
  /旧配置无 tailMode 时默认定格/.test(read('tools/smoke_fx_tail.js')));

console.log('\n20) 特效专属参数 height · 滑块同步与 0 值防护');
ok('新增数值安全下限函数（min=0 的参数夹到 1）',
  /function seSafeFxNumber\(/.test(admin) && /Number\(def\.min\) === 0 \? 1/.test(admin));
ok('拖动特效专属参数滑块时同步数字框与 .se-v 读数',
  /document\.querySelectorAll\('\[data-sefx="' \+ key \+ '"\]'\)\.forEach/.test(admin) &&
  /el\.type === 'number' \|\| el\.type === 'range'/.test(admin) &&
  /lab\.querySelector\('\.se-v'\)/.test(admin));
ok('控件下限与旧存档 0 值都被修正为 1',
  /Object\.assign\(\{\}, f, \{ min: 1 \}\)/.test(admin) && /v = 1; store\[f\.key\] = 1/.test(admin));
ok('预览参数同样夹正，并加 140ms 防抖避免拖动时反复重建实例',
  /Number\(opts\[f\.key\]\) <= 0\) opts\[f\.key\] = 1/.test(admin) &&
  /function seStartFxPreviewDebounced\(/.test(admin) && /setTimeout\(seStartFxPreview, 140\)/.test(admin));
ok('运行时 fxOpts 对旧存档 / 导入配置的 0 值做同口径夹正',
  /Number\(f\.min\) !== 0/.test(seSrc) && /o\[f\.key\] = 1/.test(seSrc));
ok('单个素材渲染异常不会中断整条 RAF 循环（防「卡死」）',
  /try \{[\s\S]{0,220}q\.inst\.render/.test(seSrc) && /list\.splice\(i, 1\);\s*continue;/.test(seSrc) &&
  /if \(inst\.kill\) inst\.kill\(\);/.test(pfx));
ok('配套冒烟覆盖滑块同步 / 安全下限 / 异常隔离',
  /RESULT:/.test(read('tools/smoke_fx_height.js')) && /拖到最小写入安全值 1/.test(read('tools/smoke_fx_height.js')));

console.log('\n21) 主页商店 / 金币 / 外观解锁 / 界面编辑器登记');
const gdata = read('game-data.js'), shopSmoke = read('tools/smoke_shop.js');
ok('三处配置都带 shop（默认 / 活配置 / 静态副本）',
  /"shop": \{/.test(gdata) && !!cfg.shop && /"shop": \{/.test(read('data/published-config.js')));
ok('6 种蛋价格、初始金币、奖励、初始解锁、重复返还齐备',
  !!cfg.shop && !!cfg.shop.prices.fruit.precious && !!cfg.shop.prices.skin.precious &&
  cfg.shop.coinsInit > 0 && cfg.shop.rewards.win > 0 && cfg.shop.initialSkins > 0);
ok('config-loader 不再删除 shop，且逐项补齐旧存档',
  !/delete d\.shop/.test(cfgLoader) && /defShop\.prices/.test(cfgLoader) && /s\.coinsInit/.test(cfgLoader));
ok('后台归一化补 shop 与外观品质',
  /d\.shop = clone\(DEFAULT\.shop/.test(admin) && /s\.tier = i < 6/.test(admin));
ok('主页有金币徽标 / 商店按钮 / 商店弹层与两种蛋池',
  /id="coinBadge"/.test(html) && /id="shopBtn"/.test(html) && /id="shopModal"/.test(html) &&
  /id="shopFruitPool"/.test(html) && /id="shopSkinPool"/.test(html));
ok('商店样式与界面编辑器 shop 屏图层齐备',
  /\.shop-pool-item/.test(css) && /\.coin-badge/.test(css) &&
  /\['eggIcon', '蛋图标/.test(ui) && /\['coinBadge', '金币徽标'/.test(ui) &&
  /\['shopBtn', '商店入口按钮'/.test(ui));
ok('界面编辑器给商店补样例与强制可见',
  /'#shopFruitPool', 3/.test(ui) && /'#shopSkinPool', 3/.test(ui) && /'#shopResult'/.test(ui));
ok('game.js 实现钱包 / 解锁 / 抽取 / 渲染，且旧空壳已清除',
  /const WALLET_KEY/.test(game) && /skinsOwned/.test(game) && /function drawEgg\(/.test(game) &&
  /function openShop\(\)/.test(game) && !/function openShop\(\) \{\}/.test(game));
ok('主页外观区只显示已解锁，并提示未解锁数量',
  /const ownedSkins = SKINS\.filter\(x => isOwned\(x\.id\)\)/.test(game) && /shop-lock-hint/.test(game));
ok('对局结算发放金币奖励', /if \(SHOP\.enabled\)/.test(game) && /addCoins\(gain\)/.test(game));
ok('后台数值平衡页与外观管理可配商店',
  /shop\.prices\.fruit\.precious/.test(admin) && /data-skm="tier"/.test(admin) && /kind === 'tier'/.test(admin));
ok('配套商店冒烟覆盖金币 / 抽取 / 解锁 / 图层',
  /RESULT:/.test(shopSmoke) && /六档价格各不相同/.test(shopSmoke) && /素材上传\/尺寸控件/.test(shopSmoke));

console.log('\nv3 打磨回归：通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
