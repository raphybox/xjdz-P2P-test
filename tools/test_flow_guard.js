'use strict';
/* SkillFlowGuard 语义链路判定回归测试（纯 Node，无需浏览器） */
require('../skill-flow-guard.js');
const FG = globalThis.SkillFlowGuard;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
function codes(sk) { return FG.check(sk).map(x => x.code); }
function errors(sk) { return FG.check(sk).filter(x => x.level === 'error'); }

function node(id, type, params) { return { id, type, params: params || {} }; }
function flow(a, b) { return { from: a, to: b, kind: 'flow' }; }
function bind(a, b) { return { from: a, to: b }; }
function skill(nodes, edges) { return { name: '测试果实', graph: { nodes, edges } }; }

console.log('\n1) 模型识别与旧图兼容');
{
  const legacy = skill([node('s', 'source'), node('d', 'damage')], [bind('s', 'd')]);
  ok('旧归属图识别为 legacy', FG.modelOf(legacy) === 'legacy');
  ok('旧图只给迁移提示，不灌 error（不阻断发布）',
    errors(legacy).length === 0 && codes(legacy).indexOf('LEGACY_GRAPH') >= 0);
  const flowy = skill([node('s', 'source'), node('d', 'damage')], [flow('s', 'd')]);
  ok('出现 flow 边即识别为新模型', FG.modelOf(flowy) === 'flow');
}

console.log('\n2) 类型契约 / 因果顺序');
{
  const bad = skill([node('s', 'source'), node('d', 'damage')], [flow('s', 'd')]);
  const es = errors(bad).map(x => x.code);
  ok('触发直连伤害会报上下文/因果错误',
    es.some(c => c === 'TYPE_CONTRACT' || c === 'MISSING_CONTEXT' || c === 'NO_TARGET_QUERY'), es.join(','));
  ok('同一模块不会被三条规则重复刷屏',
    errors(bad).filter(x => x.node === 'd').length === 1,
    errors(bad).filter(x => x.node === 'd').map(x => x.code).join(','));
  ok('提示带「为什么」和「怎么修」',
    errors(bad).every(x => x.why && x.fix));

  const good = skill([node('s', 'source'), node('r', 'range'), node('d', 'damage')],
    [flow('s', 'r'), flow('r', 'd')]);
  ok('触发 → 范围判定 → 伤害 零 error', errors(good).length === 0, errors(good).map(x => x.code).join(','));
}

console.log('\n3) 目标一致性与生命周期');
{
  const mismatch = skill([
    node('s', 'source'), node('sel', 'select', { side: 'self' }), node('d', 'damage', { affect: 'enemy' })
  ], [flow('s', 'sel'), flow('sel', 'd')]);
  ok('选自身却结算敌方伤害 → TARGET_MISMATCH', codes(mismatch).indexOf('TARGET_MISMATCH') >= 0);

  const noEntity = skill([
    node('s', 'source'), node('r', 'range'), node('d', 'damage'), node('t', 'tick')
  ], [flow('s', 'r'), flow('r', 'd'), flow('d', 't')]);
  ok('周期触发没挂实体 → TICK_NO_ENTITY', codes(noEntity).indexOf('TICK_NO_ENTITY') >= 0);

  const emptyTick = skill([
    node('s', 'source'), node('z', 'zone', { duration: 6 }), node('t', 'tick')
  ], [flow('s', 'z'), flow('z', 't')]);
  ok('周期触发后面没有判定/结算 → EMPTY_TICK', codes(emptyTick).indexOf('EMPTY_TICK') >= 0);
  ok('实体有存活时长时不报 TICK_NO_LIFETIME', codes(emptyTick).indexOf('TICK_NO_LIFETIME') < 0);
}

console.log('\n4) 用户示例：范围伤害 → 轨迹残留 → 残留区域持续伤害');
{
  const demo = skill([
    node('s', 'source', { trigger: 'roundStart' }),
    node('r1', 'range', { shape: 'circle', radius: 120, origin: 'caster' }),
    node('d1', 'damage', { affect: 'enemy', base: 20 }),
    node('z', 'zone', { attach: 'trail', duration: 6, radius: 70 }),
    node('fx', 'fx', { attach: 'trail' }),
    node('t', 'tick', { interval: 0.5 }),
    node('r2', 'range', { shape: 'circle', radius: 70, origin: 'impact' }),
    node('d2', 'damage', { affect: 'enemy', base: 4 })
  ], [
    flow('s', 'r1'), flow('r1', 'd1'), flow('d1', 'z'), flow('z', 'fx'),
    flow('z', 't'), flow('t', 'r2'), flow('r2', 'd2')
  ]);
  const e = errors(demo);
  ok('完整因果链路零 error', e.length === 0, e.map(x => x.code + ':' + x.msg).join(' | '));
  ok('不误报「重复结算」（中间有周期触发分隔）', codes(demo).indexOf('DUPLICATE_SETTLE') < 0);
  const desc = FG.describeFlow(demo);
  ok('链路解释写出顺序与阶段', /判定·范围判定/.test(desc) && /结算·伤害·结算/.test(desc) && /实体·区域·残留/.test(desc));
  ok('链路解释体现两级判定', (desc.match(/范围判定/g) || []).length >= 2);
  console.log('   链路：' + desc);
}

console.log('\n5) 结构问题与连线前置判定');
{
  const cyc = skill([node('s', 'source'), node('a', 'range'), node('b', 'damage')],
    [flow('s', 'a'), flow('a', 'b'), flow('b', 'a')]);
  ok('因果链成环 → FLOW_CYCLE', codes(cyc).indexOf('FLOW_CYCLE') >= 0);

  const noRoot = skill([node('a', 'range'), node('b', 'damage')], [flow('a', 'b')]);
  ok('没有触发起点 → NO_TRIGGER', codes(noRoot).indexOf('NO_TRIGGER') >= 0);

  const mixed = skill([node('s', 'source'), node('r', 'range'), node('d', 'damage')],
    [flow('s', 'r'), flow('r', 'd'), bind('s', 'd')]);
  ok('混用归属/因果连线 → MIXED_EDGE', codes(mixed).indexOf('MIXED_EDGE') >= 0);

  const base = skill([node('s', 'source'), node('d', 'damage')], []);
  const r = FG.canConnect(base, null, 's', 'd', 'flow');
  ok('连线前置能拦住不成立的组合', r.ok === false && r.level === 'error' && !!r.fix, JSON.stringify(r).slice(0, 160));
  const base2 = skill([node('s', 'source'), node('r', 'range'), node('d', 'damage')], [flow('s', 'r')]);
  const r2 = FG.canConnect(base2, null, 'r', 'd', 'flow');
  ok('连线前置放行成立的组合', r2.ok === true, r2.msg);
}

console.log('\n6) 汇总接口');
{
  const demo = skill([node('s', 'source'), node('r', 'range'), node('d', 'damage')],
    [flow('s', 'r'), flow('r', 'd')]);
  const sum = FG.summarize(demo);
  ok('summarize 给出 model / errors / warnings / flow',
    sum.model === 'flow' && sum.errors === 0 && typeof sum.flow === 'string' && Array.isArray(sum.issues));
}

console.log('\n语义链路判定回归：通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
