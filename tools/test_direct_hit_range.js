/* 验证：编辑器「无投射物 / 无指向性」即时形态（直接命中对手）必须走编译层范围判定，
   圆外敌人不结算，圆内才结算；无范围模块时退化为直接命中对手（向后兼容）。 */
const assert = require('assert');
const SM = require('../skill-modules.js');

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); console.log('PASS ' + name); pass++; }
  catch (e) { console.log('FAIL ' + name + ' :: ' + e.message); fail++; }
}
function eq(got, want, msg) { assert.deepStrictEqual(got, want, msg); }
function truthy(v, msg) { assert.ok(v, msg); }

// 用户实际链路：来源 -> 范围判定(圆形 70, 我方, 公共) -> 像素特效 -> 伤害·结算（无投射物）
function directRangeSkill(origin) {
  const nodes = [
    SM.node('source', 40, 90, { trigger: 'onCharge' }),
    SM.node('range', 250, 90, { shape: 'circle', radius: 70, origin: origin || 'caster' }),
    SM.node('fx', 460, 90, { effect: 'fire/fireball' }),
    SM.node('damage', 460, 200, { base: 25 })
  ];
  const edges = [
    { from: nodes[0].id, to: nodes[1].id },
    { from: nodes[1].id, to: nodes[2].id },
    { from: nodes[2].id, to: nodes[3].id }
  ];
  return SM.compile({ name: 'direct-range', mods: {}, charge: 3, graph: SM.makeGraph(nodes, edges) });
}
// 无范围模块、无投射物：应退化为「直接命中对手」
function directNoRangeSkill() {
  const nodes = [
    SM.node('source', 40, 90, { trigger: 'onCharge' }),
    SM.node('damage', 250, 90, { base: 25 })
  ];
  const edges = [{ from: nodes[0].id, to: nodes[1].id }];
  return SM.compile({ name: 'direct-norange', mods: {}, charge: 3, graph: SM.makeGraph(nodes, edges) });
}

// 沙盘坐标（与 admin.js seStartPreview 一致）
const H = 600, W = 1000;
const caster = { id: 'p', x: 70, y: H / 2, r: 16, side: 'player' };
const farEnemy = { id: 'e', x: W - 80, y: H / 2, r: 20, side: 'enemy' };   // 距施法者约 850，远在圆外
const nearEnemy = { id: 'e', x: 70 + 50, y: H / 2, r: 20, side: 'enemy' }; // 距施法者 50，在圆内

ok('范围判定模块归到公共桶（无投射物时仍能取到）', () => {
  const C = directRangeSkill('caster');
  const PUB = SM.publicView(C);
  const d = SM.rangeDescriptor(PUB, { caster, opponent: farEnemy, entities: [caster, farEnemy] });
  eq(d.shape, 'circle', '形状=圆形');
  eq(d.radius, 70, '半径=70');
  eq(d.origin, 'caster', '圆心=我方');
  eq(Math.round(d.x), caster.x, '圆心 x=施法者');
  eq(Math.round(d.y), caster.y, '圆心 y=施法者');
});

ok('圆外敌人（距离≈850 > 70）被范围判定过滤，不结算', () => {
  const C = directRangeSkill('caster');
  const PUB = SM.publicView(C);
  const ctx = { caster, opponent: farEnemy, entities: [caster, farEnemy], angle: 0, point: null, targets: [] };
  const d = SM.rangeDescriptor(PUB, ctx);
  ctx.desc = d;
  ctx.targets = SM.targetsInRange(d, ctx);
  eq(ctx.targets.length, 0, '圆外敌人不应出现在可结算目标里（这正是之前 bug 的修复点）');
});

ok('圆内敌人（距离 50 < 70）被判定命中', () => {
  const C = directRangeSkill('caster');
  const PUB = SM.publicView(C);
  const ctx = { caster, opponent: nearEnemy, entities: [caster, nearEnemy], angle: 0, point: null, targets: [] };
  const d = SM.rangeDescriptor(PUB, ctx);
  ctx.desc = d;
  ctx.targets = SM.targetsInRange(d, ctx);
  eq(ctx.targets.length, 1, '圆内敌人应被结算');
  eq(ctx.targets[0].id, 'e', '命中目标=敌方');
});

ok('无范围模块 + 无投射物：退化为「直接命中对手」（contact），敌人在即命中', () => {
  const C = directNoRangeSkill();
  const PUB = SM.publicView(C);
  const ctx = { caster, opponent: farEnemy, entities: [caster, farEnemy], angle: 0, point: null, targets: [] };
  const d = SM.rangeDescriptor(PUB, ctx);
  eq(d.shape, 'contact', '无范围模块时退化 contact（直接命中对手）');
  ctx.desc = d;
  ctx.targets = SM.targetsInRange(d, ctx);
  eq(ctx.targets.length, 1, '无范围时直接命中对手（向后兼容旧行为）');
});

ok('伤害模块（inherit）在判定区内对敌人生效，区外不生效', () => {
  const C = directRangeSkill('caster');
  const PUB = SM.publicView(C);
  const gHit = (PUB.events && PUB.events.onHit) || PUB;
  // inherit 跟随载体判定：圆外 -> false，圆内 -> true
  const dFar = SM.rangeDescriptor(PUB, { caster, opponent: farEnemy, entities: [caster, farEnemy] });
  truthy(!SM.moduleInRange(gHit.damageList[0], dFar, farEnemy, { caster, opponent: farEnemy, desc: dFar }), '圆外 damage 不生效');
  const dNear = SM.rangeDescriptor(PUB, { caster, opponent: nearEnemy, entities: [caster, nearEnemy] });
  truthy(SM.moduleInRange(gHit.damageList[0], dNear, nearEnemy, { caster, opponent: nearEnemy, desc: dNear }), '圆内 damage 生效');
});

console.log('\n' + (fail ? ('FAIL ' + fail) : 'ALL PASS') + ' / total ' + (pass + fail));
process.exit(fail ? 1 : 0);
