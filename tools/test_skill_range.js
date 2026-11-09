/* -------------------------------------------------------------
   范围判定层回归测试（node tools/test_skill_range.js）
   -------------------------------------------------------------
   契约：连线不只决定「属性归属于哪个载体」，还要决定「打到哪里」。
     · 载体按投递形态生成一份判定区域（近战圆 / 区域落点圆 / 射线带 / 碰撞点）
     · 可接「范围判定」模块覆盖形状 / 半径 / 角度 / 目标上限
     · 每个效果模块还能用「作用范围」单独缩窄自己的判定
     · 对局端与试放端只消费同一份编译描述，不允许再各算一遍
   用户现场：近战判定 + 投射物 + 像素特效 + 伤害结算，
   旧逻辑里伤害直接打到全图另一侧的敌人身上（全图范围判定）。
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

/* list: [{ t: 类型, p: 参数, from: [上游下标] }] */
function build(list) {
  const nodes = list.map((d, i) => SM.node(d.t, 40 + i * 210, 60 + (i % 3) * 130, d.p || {}));
  const edges = [];
  list.forEach((d, i) => (d.from || []).forEach(j => edges.push({ from: nodes[j].id, to: nodes[i].id })));
  return { nodes, edges };
}
function compile(list) {
  const g = build(list);
  const C = SM.compile({ name: '范围回归', mods: {}, charge: 3, graph: SM.makeGraph(g.nodes, g.edges) });
  return { C: C, nodes: g.nodes };
}
const caster = { x: 70, y: 100, r: 16, side: 'player' };
const far = { x: 820, y: 100, r: 20, side: 'enemy' };
const near = { x: 130, y: 100, r: 20, side: 'enemy' };
const near2 = { x: 160, y: 100, r: 20, side: 'enemy' };
const mid = { x: 220, y: 100, r: 20, side: 'enemy' };
const side = { x: 130, y: 150, r: 20, side: 'enemy' };
function ctxOf(over) {
  return Object.assign({
    caster: caster, opponent: far, entities: [caster, far],
    angle: 0, point: null, targets: []
  }, over || {});
}
function descOf(C, over) {
  const ctx = ctxOf(over);
  const d = SM.rangeDescriptor(C, ctx);
  return { d: d, ctx: ctx };
}
function meleeSkill(extra) {
  return compile([
    { t: 'source', p: { trigger: 'onCharge' } },
    { t: 'projectile', p: Object.assign({ delivery: 'melee', meleeRange: 60 }, extra && extra.proj), from: [0] },
    { t: 'fx', p: { effect: 'fire/fireball', triggerEvent: 'onCast' }, from: [1] },
    { t: 'damage', p: Object.assign({ base: 30 }, extra && extra.dmg), from: [2] }
  ]);
}
function hostView(C, i) { return SM.viewFor(C, C.hosts[i || 0].id); }

console.log('\n[1] Schema：范围判定是一等公民，效果模块都能声明自己的作用范围');
ok('新增「范围判定」模块且归到「投递」分组', () => {
  truthy(SM.MODULES.range, '缺 range 模块');
  eq(SM.MODULES.range.group, '投递');
  truthy(SM.TYPES.indexOf('range') >= 0, 'TYPES 未包含 range');
});
ok('伤害 / 元素 / 特效 / 状态 / 印记 / 粒子 / 命中 / 分裂 / 回响都带「作用范围」四字段', () => {
  ['element', 'damage', 'impact', 'status', 'mark', 'fx', 'particles', 'echo', 'split'].forEach(t => {
    const keys = SM.MODULES[t].fields.map(f => f.key);
    ['rangeMode', 'rangeRadius', 'rangeOrigin', 'rangeMaxTargets'].forEach(k => {
      truthy(keys.indexOf(k) >= 0, t + ' 缺 ' + k);
    });
    const f = SM.MODULES[t].fields.find(x => x.key === 'rangeMode');
    eq(f.section, '作用范围', t + ' 的分段');
    eq(f.def, 'inherit', t + ' 的默认值');
  });
});
ok('默认作用范围 = 跟随载体判定，旧存档无需迁移', () => {
  const d = SM.defaults('damage');
  eq(d.rangeMode, 'inherit');
  eq(d.rangeRadius, 0);
  eq(d.rangeOrigin, 'impact');
});
ok('多个同类模块的范围数值取最大而非相加（MERGE_MAX）', () => {
  const { C } = compile([
    { t: 'source' },
    { t: 'projectile', from: [0] },
    { t: 'damage', p: { base: 10, rangeMode: 'custom', rangeRadius: 100 }, from: [1] },
    { t: 'damage', p: { base: 20, rangeMode: 'custom', rangeRadius: 200 }, from: [1] }
  ]);
  eq(C.events.onHit.damage.rangeRadius, 200, 'rangeRadius 应取最大');
  eq(C.events.onHit.damage.base, 30, 'base 仍相加');
  eq(C.events.onHit.damageList.length, 2, '逐节点清单保留');
  eq(C.events.onHit.impactList.length, 0, 'impactList 应存在（空）');
});

console.log('\n[2] 投递形态 → 判定区域：用户现场的「近战不再全图命中」');
ok('近战判定：以施法者为圆心、半径 = 近战距离', () => {
  const { C } = meleeSkill();
  const { d } = descOf(hostView(C));
  eq(d.form, 'melee'); eq(d.shape, 'circle'); eq(d.radius, 60);
  eq(d.origin, 'caster'); eq(d.x, 70); eq(d.y, 100);
  eq(d.source, 'delivery');
});
ok('近战判定：远处敌人不在范围内（旧版会直接 -30）', () => {
  const { C } = meleeSkill();
  const { d, ctx } = descOf(hostView(C));
  eq(SM.targetsInRange(d, ctx).length, 0, '远处敌人不应被结算');
});
ok('近战判定：走近后同一份配置立刻命中（半径 60 + 体积 20 = 80）', () => {
  const { C } = meleeSkill();
  const close2 = { x: 140, y: 100, r: 20, side: 'enemy' };   // 距离 70，在判定内
  const { d, ctx } = descOf(hostView(C), { entities: [caster, near, close2], opponent: near });
  const ts = SM.targetsInRange(d, ctx);
  eq(ts.length, 2);
  eq(ts[0], near, '按距离由近到远排序');
});
ok('近战半径把目标体积计入（贴边也算命中）', () => {
  const { C } = meleeSkill();
  const { d, ctx } = descOf(hostView(C), { entities: [caster, { x: 145, y: 100, r: 20, side: 'enemy' }] });
  eq(SM.targetsInRange(d, ctx).length, 1, '60 + 20 = 80，距离 75 应命中');
});
ok('区域作用：落点按「落点距离」定长，不再追着对手跑全图', () => {
  const { C } = compile([
    { t: 'source' },
    { t: 'projectile', p: { delivery: 'aoe', areaRadius: 40, castRange: 240 }, from: [0] },
    { t: 'damage', p: { base: 30 }, from: [1] }
  ]);
  const { d } = descOf(hostView(C));
  eq(d.shape, 'circle'); eq(d.radius, 40); eq(d.castRange, 240);
  eq(d.origin, 'landing'); eq(d.x, 310); eq(d.y, 100);
  truthy(Math.abs(d.x - far.x) > 400, '落点不应等于对手坐标');
});
ok('区域作用：没有落点距离时按最大飞行距离，再兜底 260', () => {
  const a = compile([
    { t: 'source' }, { t: 'projectile', p: { delivery: 'aoe', range: 480 }, from: [0] }
  ]);
  eq(descOf(hostView(a.C)).d.castRange, 480);
  const b = compile([
    { t: 'source' }, { t: 'projectile', p: { delivery: 'aoe' }, from: [0] }
  ]);
  eq(descOf(hostView(b.C)).d.castRange, 260);
});
ok('射线判定：长度 / 宽度内命中，超长与偏离都不命中', () => {
  const { C } = compile([
    { t: 'source' },
    { t: 'projectile', p: { delivery: 'ray', rayRange: 600, rayWidth: 20 }, from: [0] },
    { t: 'damage', p: { base: 30 }, from: [1] }
  ]);
  const { d, ctx } = descOf(hostView(C), { entities: [caster, near, far, side] });
  eq(d.shape, 'line'); eq(d.length, 600); eq(d.width, 20); eq(d.origin, 'caster');
  const ts = SM.targetsInRange(d, ctx);
  eq(ts.length, 1, '只应命中射线带内的 near');
  eq(ts[0], near);
});
ok('射线判定：aim=默认「瞄准对手」时角度不再退化成 null/0° 固定向右', () => {
  const { C } = compile([
    { t: 'source' }, { t: 'projectile', p: { delivery: 'ray', rayRange: 600, rayWidth: 30 }, from: [0] }
  ]);
  const below = { x: 70, y: 400, r: 20, side: 'enemy' };
  const ctx = { caster, opponent: below, entities: [caster, below], angle: null, point: null, targets: [] };
  const d = SM.rangeDescriptor(hostView(C), ctx);
  eq(d.angle, Math.PI / 2, '应朝向正下方的对手');
  eq(SM.targetsInRange(d, ctx).length, 1, '朝下的射线应命中对手');
});
ok('投射物 / 召唤分身：碰撞点判定，命中目标由物理给出，不凭空多打', () => {
  const { C } = compile([
    { t: 'source' }, { t: 'projectile', p: { size: 9 }, from: [0] }, { t: 'damage', p: { base: 10 }, from: [1] }
  ]);
  const { d, ctx } = descOf(hostView(C), { point: { x: 200, y: 100 }, targets: [near] });
  eq(d.shape, 'contact');
  eq(SM.targetsInRange(d, ctx), [near], '应保持碰撞给出的目标');
});

console.log('\n[3] 「范围判定」模块：接在载体后面覆盖形状 / 半径 / 目标上限');
ok('范围模块按宿主归集，并写进所有编译视图', () => {
  const { C, nodes } = compile([
    { t: 'source' },
    { t: 'projectile', p: { delivery: 'melee', meleeRange: 60 }, from: [0] },
    { t: 'range', p: { shape: 'circle', radius: 300, maxTargets: 2 }, from: [1] },
    { t: 'damage', p: { base: 30 }, from: [2] }
  ]);
  eq(Object.keys(C.rangeByHost).length, 1);
  eq(C.rangeByHost[C.hosts[0].id].radius, 300);
  [SM.publicView(C), hostView(C), SM.exclusiveView(C, C.hosts[0].id)].forEach(V => {
    truthy(V.rangeByHost, '视图应带 rangeByHost');
  });
  eq(hostView(C)._hostType, 'projectile');
});
ok('范围模块覆盖投递参数：半径 / 目标上限 / 来源标记', () => {
  const { C } = compile([
    { t: 'source' }, { t: 'projectile', p: { delivery: 'melee', meleeRange: 60 }, from: [0] },
    { t: 'range', p: { radius: 300, maxTargets: 2 }, from: [1] }
  ]);
  const { d, ctx } = descOf(hostView(C), { entities: [caster, near, near2, mid] });
  eq(d.radius, 300); eq(d.maxTargets, 2); eq(d.source, 'module');
  const ts = SM.targetsInRange(d, ctx);
  eq(ts.length, 2, '目标上限生效');
  eq(ts[0], near, '按距离近→远取前 2 个');
});
ok('扇形：只命中发射方向扇区内的目标', () => {
  const { C } = compile([
    { t: 'source' }, { t: 'projectile', p: { delivery: 'melee' }, from: [0] },
    { t: 'range', p: { shape: 'cone', radius: 300, angleDeg: 90 }, from: [1] }
  ]);
  // 90° 扇形 = ±45°：正面 0° 命中，正侧 90° 与背后 180° 都必须排除
  const perpendicular = { x: 70, y: 180, r: 20, side: 'enemy' };
  const behind = { x: 20, y: 100, r: 20, side: 'enemy' };
  const { d, ctx } = descOf(hostView(C), { entities: [caster, near, perpendicular, behind] });
  eq(d.shape, 'cone'); eq(d.angleDeg, 90);
  const ts = SM.targetsInRange(d, ctx);
  eq(ts.length, 1, '正前方 near 命中，侧面与背后不命中');
  eq(ts[0], near);
});
ok('环形：内圈以内与外圈以外都不命中', () => {
  const { C } = compile([
    { t: 'source' }, { t: 'projectile', p: { delivery: 'melee' }, from: [0] },
    { t: 'range', p: { shape: 'ring', radius: 200, innerRadius: 100 }, from: [1] }
  ]);
  const { d, ctx } = descOf(hostView(C), { entities: [caster, near, mid, far] });
  const ts = SM.targetsInRange(d, ctx);
  eq(ts.length, 1);
  eq(ts[0], mid);
});
ok('射线带：范围模块可把近战改成定向长条', () => {
  const { C } = compile([
    { t: 'source' }, { t: 'projectile', p: { delivery: 'melee' }, from: [0] },
    { t: 'range', p: { shape: 'line', length: 900, width: 25 }, from: [1] }
  ]);
  const { d, ctx } = descOf(hostView(C), { entities: [caster, near, far] });
  eq(d.shape, 'line'); eq(d.origin, 'caster'); eq(d.length, 900); eq(d.width, 25);
  eq(SM.targetsInRange(d, ctx).length, 2, '长射线可同时命中多个敌人');
});
ok('判定圆心可手动指定施法者 / 命中点', () => {
  const mk = origin => compile([
    { t: 'source' }, { t: 'projectile', p: { delivery: 'aoe', castRange: 240, areaRadius: 50 }, from: [0] },
    { t: 'range', p: { radius: 80, origin: origin }, from: [1] }
  ]);
  const a = descOf(hostView(mk('caster').C), { point: { x: 310, y: 100 } }).d;
  eq(a.origin, 'caster'); eq(a.x, 70);
  const b = descOf(hostView(mk('impact').C), { point: { x: 310, y: 100 } }).d;
  eq(b.origin, 'impact'); eq(b.x, 310);
});
ok('落点距离可由范围模块覆盖；公共范围模块对所有载体生效', () => {
  const { C } = compile([
    { t: 'source' },
    { t: 'projectile', p: { delivery: 'aoe', areaRadius: 40, castRange: 100 }, from: [0] },
    { t: 'range', p: { castRange: 500, bindTo: 'global' }, from: [0] }
  ]);
  eq(C.rangeByHost[''].castRange, 500);
  eq(descOf(hostView(C)).d.castRange, 500);
});
ok('同一载体接多个范围模块时取第一个，行为稳定', () => {
  const { C } = compile([
    { t: 'source' }, { t: 'projectile', p: { delivery: 'melee' }, from: [0] },
    { t: 'range', p: { radius: 111 }, from: [1] },
    { t: 'range', p: { radius: 999 }, from: [1] }
  ]);
  eq(descOf(hostView(C)).d.radius, 111);
});
ok('多个载体各自持有独立判定区域，互不串味', () => {
  const { C } = compile([
    { t: 'source' },
    { t: 'projectile', p: { name: 'A', delivery: 'melee', meleeRange: 40 }, from: [0] },
    { t: 'range', p: { radius: 40 }, from: [1] },
    { t: 'projectile', p: { name: 'B', delivery: 'melee', meleeRange: 200 }, from: [0] },
    { t: 'range', p: { radius: 200 }, from: [3] }
  ]);
  eq(C.hosts.length, 2);
  const A = C.hosts.find(h => h.name === 'A'), B = C.hosts.find(h => h.name === 'B');
  eq(SM.rangeDescriptor(SM.viewFor(C, A.id), ctxOf()).radius, 40);
  eq(SM.rangeDescriptor(SM.viewFor(C, B.id), ctxOf()).radius, 200);
  eq(SM.targetsInRange(SM.rangeDescriptor(SM.viewFor(C, A.id), ctxOf({ entities: [caster, mid] })), ctxOf({ entities: [caster, mid] })).length, 0);
  eq(SM.targetsInRange(SM.rangeDescriptor(SM.viewFor(C, B.id), ctxOf({ entities: [caster, mid] })), ctxOf({ entities: [caster, mid] })).length, 1);
});
ok('includeSelf 时自身 / 友方也进入结算列表', () => {
  const { C } = compile([
    { t: 'source' }, { t: 'projectile', p: { delivery: 'melee', meleeRange: 60 }, from: [0] },
    { t: 'range', p: { radius: 60, includeSelf: true }, from: [1] }
  ]);
  const { d, ctx } = descOf(hostView(C), { entities: [caster, near] });
  eq(SM.targetsInRange(d, ctx).length, 2);
});

console.log('\n[4] 模块级「作用范围」：同一载体上的模块可各自精细化');
ok('跟随载体判定：伤害模块继承载体的近战半径', () => {
  const { C } = meleeSkill();
  const { d, ctx } = descOf(hostView(C), { entities: [caster, near, far] });
  const grp = SM.viewFor(C, C.hosts[0].id).events.onHit;
  const ts = SM.targetsInRange(d, ctx);
  eq(ts.length, 1);
  eq(SM.moduleTargets(ts.concat([far]), grp.damageList[0], d, ctx).length, 1, 'far 应被模块范围排除');
});
ok('自定义半径：小半径伤害只打近处，大半径伤害覆盖更远', () => {
  const { C } = compile([
    { t: 'source' }, { t: 'projectile', p: { delivery: 'melee', meleeRange: 60 }, from: [0] },
    { t: 'range', p: { radius: 900 }, from: [1] },
    { t: 'damage', p: { base: 10, rangeMode: 'custom', rangeRadius: 60, rangeOrigin: 'caster' }, from: [2] },
    { t: 'damage', p: { base: 20, rangeMode: 'custom', rangeRadius: 300, rangeOrigin: 'caster' }, from: [2] }
  ]);
  const V = hostView(C);
  const { d, ctx } = descOf(V, { entities: [caster, near, mid, far] });
  const ts = SM.targetsInRange(d, ctx);
  eq(ts.length, 3, '载体 900 半径内 3 个敌人');
  const list = V.events.onHit.damageList;
  eq(SM.moduleTargets(ts, list[0], d, ctx).length, 1, '半径 60 只打 near');
  eq(SM.moduleTargets(ts, list[1], d, ctx).length, 2, '半径 300 打 near + mid');
});
ok('自定义判定圆心：以命中点为准与以施法者为准结果不同', () => {
  const mk = origin => compile([
    { t: 'source' }, { t: 'projectile', p: { delivery: 'melee', meleeRange: 60 }, from: [0] },
    { t: 'range', p: { radius: 400 }, from: [1] },
    { t: 'damage', p: { base: 10, rangeMode: 'custom', rangeRadius: 50, rangeOrigin: origin }, from: [2] }
  ]);
  const point = { x: 200, y: 100 };
  const nearImpact = { x: 215, y: 100, r: 20, side: 'enemy' };
  const A = mk('impact'), B = mk('caster');
  const a = descOf(hostView(A.C), { point, entities: [caster, nearImpact] });
  const b = descOf(hostView(B.C), { point, entities: [caster, nearImpact] });
  const ts = SM.targetsInRange(a.d, a.ctx);
  eq(SM.moduleTargets(ts, hostView(A.C).events.onHit.damageList[0], a.d, a.ctx).length, 1, '以命中点为圆心应命中');
  eq(SM.moduleTargets(ts, hostView(B.C).events.onHit.damageList[0], b.d, b.ctx).length, 0, '以施法者为圆心应落空');
});
ok('不限范围：显式恢复到旧版「打到目标」的口径', () => {
  const { C } = meleeSkill({ dmg: { rangeMode: 'unlimited' } });
  const { d, ctx } = descOf(hostView(C));
  const grp = SM.viewFor(C, C.hosts[0].id).events.onHit;
  eq(SM.moduleInRange(grp.damageList[0], d, far, ctx), true);
});
ok('模块自己的目标上限：只截本模块，不影响其它模块与载体', () => {
  const { C } = compile([
    { t: 'source' }, { t: 'projectile', p: { delivery: 'melee' }, from: [0] },
    { t: 'range', p: { radius: 400 }, from: [1] },
    { t: 'damage', p: { base: 10, rangeMaxTargets: 1 }, from: [2] },
    { t: 'damage', p: { base: 20 }, from: [2] }
  ]);
  const V = hostView(C);
  const { d, ctx } = descOf(V, { entities: [caster, near, near2, mid] });
  const ts = SM.targetsInRange(d, ctx);
  eq(ts.length, 3);
  eq(SM.moduleTargets(ts, V.events.onHit.damageList[0], d, ctx).length, 1);
  eq(SM.moduleTargets(ts, V.events.onHit.damageList[1], d, ctx).length, 3);
});
ok('碰撞型载体上「跟随载体判定」不做二次收窄，自定义半径仍生效', () => {
  const { C } = compile([
    { t: 'source' }, { t: 'projectile', p: { size: 9 }, from: [0] },
    { t: 'damage', p: { base: 10 }, from: [1] },
    { t: 'damage', p: { base: 20, rangeMode: 'custom', rangeRadius: 5 }, from: [1] }
  ]);
  const V = hostView(C);
  const ctx = { caster, opponent: near, entities: [caster, near], angle: 0, point: { x: 200, y: 100 }, targets: [near] };
  const d = SM.rangeDescriptor(V, ctx);
  const list = V.events.onHit.damageList;
  eq(SM.moduleInRange(list[0], d, near, ctx), true, 'inherit 不应把贴边目标误判出界');
  eq(SM.moduleInRange(list[1], d, near, ctx), false, '半径 5 且圆心在命中点应排除远处目标');
});
ok('特效 / 粒子模块也带作用范围字段，可单独筛', () => {
  const { C } = compile([
    { t: 'source' }, { t: 'projectile', p: { delivery: 'melee', meleeRange: 60 }, from: [0] },
    { t: 'range', p: { radius: 400 }, from: [1] },
    { t: 'fx', p: { effect: 'fire/fireball', rangeMode: 'custom', rangeRadius: 50, rangeOrigin: 'caster' }, from: [2] },
    { t: 'particles', p: { count: 8 }, from: [2] }
  ]);
  const V = hostView(C);
  const { d, ctx } = descOf(V, { entities: [caster, near, mid] });
  const ts = SM.targetsInRange(d, ctx);
  eq(ts.length, 2);
  eq(SM.moduleTargets(ts, V.events.onHit.fx[0], d, ctx).length, 1);
  eq(SM.moduleTargets(ts, V.events.onHit.particles[0], d, ctx).length, 2);
});

console.log('\n[5] 落点、标签与旧存档兼容');
ok('rangePoint：近战=施法者、区域=落点、碰撞=命中点', () => {
  const mk = delivery => compile([
    { t: 'source' }, { t: 'projectile', p: Object.assign({ delivery: delivery }, delivery === 'aoe' ? { castRange: 240 } : {}), from: [0] }
  ]);
  const m = descOf(hostView(mk('melee').C));
  eq(SM.rangePoint(m.d, m.ctx), { x: 70, y: 100 });
  const a = descOf(hostView(mk('aoe').C));
  eq(SM.rangePoint(a.d, a.ctx), { x: 310, y: 100 });
  const p = descOf(hostView(mk('projectile').C), { point: { x: 200, y: 100 } });
  eq(SM.rangePoint(p.d, p.ctx), { x: 200, y: 100 });
});
ok('rangeLabel 可读：形状 / 半径 / 落点 / 目标上限', () => {
  const { C } = compile([
    { t: 'source' }, { t: 'projectile', p: { delivery: 'aoe', castRange: 240 }, from: [0] },
    { t: 'range', p: { radius: 90, maxTargets: 3 }, from: [1] }
  ]);
  const s = descOf(hostView(C)).d.label;
  truthy(s.indexOf('圆形') === 0 && s.indexOf('半径 90') > 0, s);
  truthy(s.indexOf('落点 240') > 0 && s.indexOf('上限 3') > 0, s);
});
ok('全部预设仍可编译，且都能产出判定描述', () => {
  SM.PRESETS.forEach(p => {
    const C = SM.compile({ name: p.name, mods: {}, charge: 3, graph: p.build() });
    truthy(C.active, p.name + ' 应为主动技能');
    truthy(SM.rangeDescriptor(SM.publicView(C), ctxOf()), p.name + ' 缺判定描述');
    (C.hosts || []).forEach(h => truthy(SM.rangeDescriptor(SM.viewFor(C, h.id), ctxOf()), p.name + ' 宿主视图缺判定'));
  });
});
ok('旧存档（无任何范围字段）按 inherit 处理，不产生 NaN / 空判定', () => {
  const { C } = compile([
    { t: 'source' }, { t: 'projectile', p: { delivery: 'melee' }, from: [0] },
    { t: 'damage', p: { base: 30 }, from: [1] }
  ]);
  const { d } = descOf(hostView(C));
  eq(d.radius, 60);
  truthy(isFinite(d.x) && isFinite(d.y) && isFinite(d.angle), '判定坐标必须有限');
  eq(SM.viewFor(C, C.hosts[0].id).events.onHit.damageList[0].rangeMode, 'inherit');
});
ok('只有触发 + 范围判定的图不算主动技能（不凭空生效）', () => {
  const { C } = compile([{ t: 'source' }, { t: 'range', p: { radius: 100 }, from: [0] }]);
  eq(C.active, false);
});
ok('describeBindings / setHosts 在含范围节点时仍稳定', () => {
  const { C } = compile([
    { t: 'source' }, { t: 'projectile', p: { delivery: 'melee' }, from: [0] },
    { t: 'range', p: { radius: 100 }, from: [1] }, { t: 'damage', p: { base: 10 }, from: [2] }
  ]);
  const d = SM.describeBindings(C);
  eq(d.hosts.length, 1);
  truthy(d.hosts[0].boundLabels.join('·').indexOf('范围') >= 0, '组合诊断应列出范围模块');
  const opts = SM.setHosts(C.graph);
  eq(opts.length, 3, 'auto / global / 1 个载体');
});

console.log('\n---------------------------------------------');
console.log('PASS ' + pass + ' / FAIL ' + fail);
console.log('---------------------------------------------\n');
if (fail) process.exit(1);
