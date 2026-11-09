/* -------------------------------------------------------------
   判定区域「半径圈」预览回归测试（node tools/test_range_ring_preview.js）
   -------------------------------------------------------------
   用户现场：挂了「范围判定」模块（圆形 半径 45）、勾选了「半径圈」，
   试放沙盘里却看不到任何判定圈；徽标与组合链路都正确显示范围。
   真因（改前）：
     · lastRange 只在「近战 / 区域落点 / 射线」这类即时形态里赋值，
       默认 delivery=projectile 的投射物永远走不到那行 → 一次都不画
     · 即便画了也在 1.6 秒后淡出，且画在弹珠 / 像素特效之前的背景层
   契约：每帧按当前编译结果实时重算、常驻、覆盖全部载体、叠在最上层。
   ------------------------------------------------------------- */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SM = require('../skill-modules.js');

const src = fs.readFileSync(path.join(__dirname, '../admin.js'), 'utf8');
const game = fs.readFileSync(path.join(__dirname, '../game.js'), 'utf8');
let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ' :: ' + e.message); }
}
function has(re, msg) { assert.ok(re.test(src), msg || ('缺 ' + re)); }
function no(re, msg) { assert.ok(!re.test(src), msg || ('不该存在 ' + re)); }

console.log('\n[1] 绘制链路：不再依赖「施放瞬间」的快照');
ok('存在每帧实时重算的 previewRangeDescs()', () => {
  has(/function previewRangeDescs\(\)/);
});
ok('lastRange / lastRangeAt 快照已彻底移除', () => {
  no(/\blastRange\b/, '仍在用 lastRange 快照');
});
ok('旧的背景层绘制调用已删除', () => {
  no(/if \(radiusOn && lastRange\)/);
});
ok('drawRangeShape 不再按 age 淡出（编辑器调试辅助常驻）', () => {
  no(/1 - age \/ 1\.6/, '仍在 1.6 秒淡出');
  has(/function drawRangeShape\(d\) \{/);
});

console.log('\n[2] 覆盖范围：所有载体都算，且用同一份编译描述');
ok('按 hostsOf(C) 遍历全部载体', () => {
  has(/SM\.hostsOf \? SM\.hostsOf\(C\) : \[\]/);
});
ok('没有载体时用公共视图兜底', () => {
  has(/SM\.publicView \? SM\.publicView\(C\) : C/);
});
ok('用 viewFor 取每个载体自己的视图', () => {
  has(/SM\.viewFor\(C, h\.id\)/);
});
ok('用 rangeDescriptor 生成判定描述，与对局结算同源', () => {
  has(/const d = SM\.rangeDescriptor\(V, ctx\)/);
});
ok('碰撞点形状不画几何圈、重复判定区去重', () => {
  has(/d\.shape === 'contact'\) return/);
  has(/if \(seen\[key\]\) return/);
});
ok('四种形状绘制分支都保留', () => {
  ["d.shape === 'line'", "d.shape === 'cone'", "d.shape === 'ring'", 'cx.arc\(d\.x, d\.y, d\.radius, 0, Math\.PI \* 2\)'].forEach(s => {
    assert.ok(src.indexOf(s) >= 0, '缺 ' + s);
  });
});

console.log('\n[3] 层级与开关：最上层叠层，正式对局不画');
ok('判定区域在绘制循环末尾（跳字之后、requestAnimationFrame 之前）', () => {
  const iFilter = src.indexOf('floats = floats.filter(f => f.life > 0);');
  const iDraw = src.indexOf('if (radiusOn) previewRangeDescs().forEach(drawRangeShape);');
  const iRAF = src.indexOf('requestAnimationFrame(draw);', iDraw);
  assert.ok(iFilter > 0 && iDraw > iFilter && iRAF > iDraw,
    '绘制位置不对 filter=' + iFilter + ' draw=' + iDraw + ' raf=' + iRAF);
});
ok('半径圈仍受 seRadiusToggle / showRadius 控制', () => {
  has(/const radiusOn = \(S\.skillEd\.showRadius !== false\) && \(!\$\('seRadiusToggle'\) \|\| \$\('seRadiusToggle'\)\.checked\);/);
});
ok('正式对局仍然默认关闭半径圈', () => {
  assert.ok(/const SHOW_HAZARD_RADIUS = false;/.test(game), 'game.js 半径圈默认被打开');
});
ok('勾选框 tooltip 说明常驻 / 参数实时生效', () => {
  has(/常驻显示当前判定区域/);
  has(/改参数实时生效，正式对局不显示/);
});

console.log('\n[4] 编译层联动：预览画的圆就是实际结算的圆');
ok('默认投射物 + 范围判定模块 → 圆形 半径 45（不再是 contact）', () => {
  const n = [
    SM.node('source', 40, 60, { trigger: 'onCharge' }),
    SM.node('projectile', 250, 60, { delivery: 'projectile', name: '测试弹' }),
    SM.node('range', 460, 60, { shape: 'circle', radius: 45 })
  ];
  const e = [{ from: n[0].id, to: n[1].id }, { from: n[1].id, to: n[2].id }];
  const C = SM.compile({ name: '圈', mods: {}, charge: 3, graph: SM.makeGraph(n, e) });
  const V = SM.viewFor(C, C.hosts[0].id);
  const d = SM.rangeDescriptor(V, {
    caster: { x: 70, y: 100, r: 16, side: 'player' },
    opponent: { x: 820, y: 100, r: 20, side: 'enemy' },
    entities: [], angle: 0, point: null, targets: []
  });
  assert.strictEqual(d.shape, 'circle');
  assert.strictEqual(d.radius, 45);
  assert.ok(/圆形 半径 45/.test(d.label), '标签不对：' + d.label);
});
ok('近战形态不接范围模块也能自动生成判定圆', () => {
  const n = [
    SM.node('source', 40, 60, { trigger: 'onCharge' }),
    SM.node('projectile', 250, 60, { delivery: 'melee', meleeRange: 60 })
  ];
  const C = SM.compile({ name: '近战', mods: {}, charge: 3, graph: SM.makeGraph(n, [{ from: n[0].id, to: n[1].id }]) });
  const d = SM.rangeDescriptor(SM.viewFor(C, C.hosts[0].id), {
    caster: { x: 70, y: 100, r: 16, side: 'player' },
    opponent: { x: 820, y: 100, r: 20, side: 'enemy' },
    entities: [], angle: 0, point: null, targets: []
  });
  assert.strictEqual(d.shape, 'circle');
  assert.strictEqual(d.radius, 60);
});

console.log('\n[5] 语法');
ok('admin.js 可被解析（不做 DOM 执行）', () => {
  new vm.Script(src, { filename: 'admin.js' });
});

console.log('\nPASS ' + pass + ' / FAIL ' + fail);
if (fail) process.exit(1);
