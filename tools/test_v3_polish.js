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
  const sel = (g.nodes || []).find(n => n && n.type === 'select');
  const outs = sel ? (g.edges || []).filter(e => e && e.from === sel.id).length : 0;
  if (!sel || outs === 0) allLinked = false;
  let C = null;
  try { C = SM.compile(sk); } catch (e) { C = null; }
  if (!C || !C.present || C.present.select !== true) allPresent = false;
});
ok('配置里 ' + cfg.skills.length + ' 个果实都有 select 且有下游出边', allLinked);
ok('编译后 present.select 全为 true', allPresent);
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

console.log('\nv3 打磨回归：通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
