/* -------------------------------------------------------------
   范围判定「我方 / 敌方」圆心选择回归测试（node tools/test_range_origin.js）
   -------------------------------------------------------------
   契约：范围判定模块新增「敌方（对手）」圆心选项，并把默认圆心从「按投递形态自动」
   （投射物 → 命中点 = 敌方）改为「我方（施法者）」。
     · origin = caster  → 圆心 = 施法者（黄色弹珠）
     · origin = opponent → 圆心 = 对手（蓝色弹珠）
     · origin = impact  → 圆心 = 命中点
     · origin = auto（旧存档默认）→ 回落到 caster，避免旧技能仍默认挂在敌方身上
     · 模块级「作用范围」自定义圆心同样支持 opponent
   用户现场：实时试放里范围圈错误地画在蓝色敌方弹珠上。
   ------------------------------------------------------------- */
'use strict';
const assert = require('assert');
const SM = require('../skill-modules.js');

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ' :: ' + e.message); }
}
function eq(got, want, msg) { assert.deepStrictEqual(got, want, msg); }
function truthy(v, msg) { assert.ok(v, msg || 'expected truthy'); }

function build(list) {
  const nodes = list.map((d, i) => SM.node(d.t, 40 + i * 210, 60 + (i % 3) * 130, d.p || {}));
  const edges = [];
  list.forEach((d, i) => (d.from || []).forEach(j => edges.push({ from: nodes[j].id, to: nodes[i].id })));
  return { nodes, edges };
}
function compile(list) {
  const g = build(list);
  return SM.compile({ name: '圆心选择', mods: {}, charge: 3, graph: SM.makeGraph(g.nodes, g.edges) });
}
const caster = { x: 70, y: 100, r: 16, side: 'player' };
const opp = { x: 820, y: 100, r: 20, side: 'enemy' };
function ctxOf(over) {
  return Object.assign({
    caster: caster, opponent: opp, entities: [caster, opp],
    angle: 0, point: { x: opp.x, y: opp.y }, targets: []
  }, over || {});
}
function descOf(list, over) {
  const C = compile(list);
  const V = SM.hostsOf(C).length ? SM.viewFor(C, C.hosts[0].id) : SM.publicView(C);
  const d = SM.rangeDescriptor(V, ctxOf(over));
  return { C, d };
}

console.log('\n[1] 范围判定模块「判定圆心」选项与默认值');
ok('origin 选项包含 我方 / 敌方 / 命中落点 / 自动', () => {
  const f = SM.MODULES.range.fields.find(x => x.key === 'origin');
  const keys = f.options.map(o => o[0]);
  ['caster', 'opponent', 'impact', 'auto'].forEach(k => truthy(keys.indexOf(k) >= 0, '缺 ' + k));
});
ok('默认圆心 = caster（我方），不再默认挂在敌方', () => {
  const f = SM.MODULES.range.fields.find(x => x.key === 'origin');
  eq(f.def, 'caster', '默认应是我方');
});

console.log('\n[2] origin 解析到正确圆心');
ok('我方：圆心 = 施法者坐标', () => {
  const { d } = descOf([{ t: 'source', p: {} }, { t: 'range', p: { radius: 50, origin: 'caster' }, from: [0] }]);
  eq(d.origin, 'caster'); eq(d.x, 70); eq(d.y, 100);
  truthy(/我方/.test(d.label), '标签应含「我方」');
});
ok('敌方：圆心 = 对手坐标', () => {
  const { d } = descOf([{ t: 'source', p: {} }, { t: 'range', p: { radius: 50, origin: 'opponent' }, from: [0] }]);
  eq(d.origin, 'opponent'); eq(d.x, 820); eq(d.y, 100);
  truthy(/敌方/.test(d.label), '标签应含「敌方」');
});
ok('命中/落点：圆心 = 命中点', () => {
  const { d } = descOf([{ t: 'source', p: {} }, { t: 'range', p: { radius: 50, origin: 'impact' }, from: [0] }]);
  eq(d.origin, 'impact'); eq(d.x, 820); eq(d.y, 100);
});
ok('auto（旧存档默认）：回落到 caster，不再默认敌方', () => {
  const { d } = descOf([{ t: 'source', p: {} }, { t: 'range', p: { radius: 50, origin: 'auto' }, from: [0] }]);
  eq(d.origin, 'caster'); eq(d.x, 70); eq(d.y, 100);
});

console.log('\n[3] 模块级「作用范围」自定义圆心也支持敌方');
ok('damage 模块 rangeOrigin=opponent 时围绕对手量距离', () => {
  const C = compile([
    { t: 'source', p: {} },
    { t: 'range', p: { radius: 200, origin: 'opponent' }, from: [0] },
    { t: 'damage', p: { base: 10, rangeMode: 'custom', rangeRadius: 50, rangeOrigin: 'opponent' }, from: [1] }
  ]);
  const V = SM.hostsOf(C).length ? SM.viewFor(C, C.hosts[0].id) : SM.publicView(C);
  const ctx = ctxOf({ entities: [caster, opp] });
  const d = SM.rangeDescriptor(V, ctx);
  const dmgList = (V.events && V.events.onHit && V.events.onHit.damageList) || [];
  // 以对手（820,100）为圆心、半径 50 的自定义范围，对手本身落网、远处施法者不落网
  const hitOpp = SM.moduleTargets([opp], dmgList[0], d, ctx);
  const hitCaster = SM.moduleTargets([caster], dmgList[0], d, ctx);
  eq(hitOpp.length, 1, '对手应在自定义敌方范围内');
  eq(hitCaster.length, 0, '施法者不应在敌方范围内');
});

console.log('\n---------------------------------------------');
console.log('PASS ' + pass + ' / FAIL ' + fail);
console.log('---------------------------------------------');
process.exit(fail ? 1 : 0);
