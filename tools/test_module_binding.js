/* -------------------------------------------------------------
   模块组合 / 宿主绑定层回归测试（node tools/test_module_binding.js）
   -------------------------------------------------------------
   契约：连线不只是「可达性」，而是模块属性的归属。
     · 连在某个载体（投射物 / 光环 / 指向性 / 区域）后面的模块 → 只作用于该载体
     · 上游找不到载体的模块 → 技能级公共效果（兼容全部旧存档 / 旧预设）
     · 多个同类载体各自保留自己的属性，不再被 merge 成一份
     · 对局与试放取用同一份预编译视图，不各自推算归属
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
  const C = SM.compile({ name: '回归技能', mods: {}, charge: 3, graph: SM.makeGraph(g.nodes, g.edges) });
  return { C: C, nodes: g.nodes };
}
function viewHit(C, id, slot) { return (SM.viewFor(C, id).events.onHit[slot]); }
function publicHit(C, slot) { return (SM.publicView(C).events.onHit[slot]); }

console.log('\n[1] 旧预设 / 旧存档兼容性：单宿主技能不因绑定层改变行为');
ok('全部预设可编译且产出公共视图与宿主视图', () => {
  SM.PRESETS.forEach(p => {
    const C = SM.compile({ name: p.name, mods: {}, charge: 3, graph: p.build() });
    truthy(C.active, p.name + ' 应为主动技能');
    truthy(C._views && C._views.public, p.name + ' 缺公共视图');
    eq(Object.keys(C._views.hosts).length, C.hosts.length, p.name + ' 宿主视图数量');
  });
});
ok('单宿主时「宿主视图 = 全量组」，伤害 / 元素 / 特效一项不少', () => {
  SM.PRESETS.forEach(p => {
    const C = SM.compile({ name: p.name, mods: {}, charge: 3, graph: p.build() });
    (C.hosts || []).forEach(h => {
      const V = SM.viewFor(C, h.id);
      eq(V.events.onHit.damage.base, C.events.onHit.damage.base, p.name + ' damage.base');
      eq(V.events.onHit.elements.length, C.events.onHit.elements.length, p.name + ' elements');
      eq(V.events.onHit.fx.length, C.events.onHit.fx.length, p.name + ' fx');
      eq(V.events.onHit.particles.length, C.events.onHit.particles.length, p.name + ' particles');
      eq(V.events.onHit.mark.length, C.events.onHit.mark.length, p.name + ' mark');
    });
  });
});
ok('弹体外观：专属特效优先，公共特效兜底，数量与旧逻辑一致', () => {
  SM.PRESETS.forEach(p => {
    const C = SM.compile({ name: p.name, mods: {}, charge: 3, graph: p.build() });
    const proj = C.hosts.filter(h => h.type === 'projectile');
    if (!proj.length) return;
    const V = SM.viewFor(C, proj[0].id);
    eq(V.projectileFx.length, C.projectileFx.length, p.name + ' projectileFx');
  });
});
ok('旧存档节点没有 bindTo 字段时按「按连线自动」处理', () => {
  const g = build([
    { t: 'source', p: { trigger: 'interval' } },
    { t: 'projectile', p: { name: 'A', speed: 300 }, from: [0] },
    { t: 'damage', p: { base: 12 }, from: [1] }
  ]);
  g.nodes.forEach(n => { delete n.params.bindTo; });   // 模拟旧存档
  const C2 = SM.compile({ name: '旧存档', mods: {}, charge: 3, graph: SM.makeGraph(g.nodes, g.edges) });
  const h = C2.hosts[0];
  eq(h.bound.length, 1, 'damage 应自动绑定到投射物');
  eq(SM.viewFor(C2, h.id).events.onHit.damage.base, 12);
});

console.log('\n[2] 多个同类载体：各自属性独立，不再被错误地相加');
ok('两个投射物的速度 / 数量 / 半径互不影响', () => {
  const r = compile([
    { t: 'source', p: { trigger: 'interval' } },
    { t: 'projectile', p: { name: 'A', speed: 300, count: 1, size: 9 }, from: [0] },
    { t: 'projectile', p: { name: 'B', speed: 500, count: 3, size: 20 }, from: [0] }
  ]);
  const C = r.C;
  eq(C.hosts.length, 2);
  eq(C.projectile.speed, 300, '兜底单例取第一份，不是 800');
  const A = C.hosts.find(h => h.name === 'A'), B = C.hosts.find(h => h.name === 'B');
  eq(SM.viewFor(C, A.id).projectile.speed, 300);
  eq(SM.viewFor(C, B.id).projectile.speed, 500);
  eq(SM.viewFor(C, B.id).projectile.count, 3);
  eq(SM.viewFor(C, B.id).projectile.size, 20);
});

console.log('\n[3] 用户示例：投射物 → 特效（替换外观）→ 伤害（赋予该弹）');
ok('A / B 各自的特效与伤害互不串味，公共伤害对所有弹生效', () => {
  const r = compile([
    { t: 'source', p: { trigger: 'interval' } },
    { t: 'projectile', p: { name: 'A', speed: 300 }, from: [0] },
    { t: 'projectile', p: { name: 'B', speed: 500 }, from: [0] },
    { t: 'damage', p: { base: 5 }, from: [0] },                                  // 公共
    { t: 'fx', p: { name: '火', effect: 'fire/fireball', attach: 'projectile' }, from: [1] },
    { t: 'damage', p: { base: 10 }, from: [4] },
    { t: 'fx', p: { name: '冰', effect: 'ice/frost-nova', attach: 'projectile' }, from: [2] },
    { t: 'damage', p: { base: 50 }, from: [6] }
  ]);
  const C = r.C, A = C.hosts.find(h => h.name === 'A'), B = C.hosts.find(h => h.name === 'B');
  eq(publicHit(C, 'damage').base, 5, '公共伤害');
  eq(viewHit(C, A.id, 'damage').base, 15, 'A = 公共 5 + 专属 10');
  eq(viewHit(C, B.id, 'damage').base, 55, 'B = 公共 5 + 专属 50');
  eq(SM.viewFor(C, A.id).projectileFx.map(f => f.effect), ['fire/fireball']);
  eq(SM.viewFor(C, B.id).projectileFx.map(f => f.effect), ['ice/frost-nova']);
  eq(SM.publicView(C).projectileFx.length, 0, '没有公共弹体特效');
  truthy(SM.hitHasContent(SM.viewFor(C, A.id).events.onHit), 'A 命中组有内容');
});
ok('bindTo=global 可强制「连在载体后面也当公共效果」', () => {
  const r = compile([
    { t: 'source' },
    { t: 'projectile', p: { name: 'A' }, from: [0] },
    { t: 'projectile', p: { name: 'B' }, from: [0] },
    { t: 'damage', p: { base: 20, bindTo: 'global' }, from: [1] }
  ]);
  const C = r.C;
  eq(publicHit(C, 'damage').base, 20);
  eq(C.hosts.find(h => h.name === 'A').bound.length, 0, 'A 不应拿到这个模块');
  eq(viewHit(C, C.hosts.find(h => h.name === 'B').id, 'damage').base, 20, 'B 也应吃到公共伤害');
});
ok('bindTo=<载体id> 可越过连线精确指定作用对象', () => {
  const nodes = build([
    { t: 'source' },
    { t: 'projectile', p: { name: 'A' }, from: [0] },
    { t: 'projectile', p: { name: 'B' }, from: [0] },
    { t: 'fx', p: { name: '错位特效', effect: 'holy/halo', attach: 'projectile' }, from: [1] }
  ]);
  nodes.nodes[3].params.bindTo = nodes.nodes[2].id;   // 连在 A 后，却显式指定作用于 B
  const C = SM.compile({ name: '精确指定', mods: {}, charge: 3, graph: SM.makeGraph(nodes.nodes, nodes.edges) });
  const A = C.hosts.find(h => h.name === 'A'), B = C.hosts.find(h => h.name === 'B');
  eq(A.bound.length, 0);
  eq(SM.viewFor(C, B.id).projectileFx.map(f => f.effect), ['holy/halo']);
  eq(SM.viewFor(C, A.id).projectileFx.length, 0);
});

console.log('\n[4] 光环 / 区域：作为载体承接伤害与状态模块');
ok('连到光环的伤害 / 状态进入 tick 组，光环自身 dps 仍保留', () => {
  const r = compile([
    { t: 'source' },
    { t: 'aura', p: { name: '领域', dps: 8, triggerEvent: 'onCast' }, from: [0] },
    { t: 'damage', p: { base: 20 }, from: [1] },
    { t: 'status', p: { status: 'slow', statusPower: 0.5 }, from: [2] },
    { t: 'fx', p: { name: '领域特效', effect: 'holy/halo', attach: 'caster' }, from: [3] }
  ]);
  const C = r.C, au = C.hosts[0];
  eq(au.type, 'aura');
  eq(au.bound.length, 3, 'damage / status / fx 都归这个光环');
  const EX = SM.exclusiveView(C, au.id);
  eq(EX._tickGrp.damage.base, 20);
  eq(EX._tickGrp.status.length, 1);
  eq(EX._tickGrp.fx.length, 1, '跨事件展平：fx 的触发事件不影响它挂在光环上');
  eq(au.cfg.dps, 8);
  // C.events 是刻意保留的全量兼容组；真正参与结算的是公共视图与各载体视图
  eq(C.events.onHit.damage.base, 20, '全量兼容组仍含专属伤害');
  eq(SM.publicView(C).events.onHit.damage.base, 0, '公共组不含光环专属伤害');
  eq(SM.viewFor(C, au.id).events.onHit.damage.base, 20, '光环视图含自己的专属伤害');
});
ok('viewOfNode 能从模块参数反查回它所属光环的专属视图', () => {
  const r = compile([
    { t: 'source' },
    { t: 'aura', p: { name: '领域' }, from: [0] },
    { t: 'damage', p: { base: 33 }, from: [1] }
  ]);
  const C = r.C;
  const cfg = C.events.onCast.aura[0];
  truthy(cfg._nodeId, '光环配置应带 _nodeId');
  const V = SM.viewOfNode(C, cfg._nodeId);
  eq(V._exclusive, true);
  eq(V._tickGrp.damage.base, 33);
});
ok('区域残留同样能承接伤害模块', () => {
  const r = compile([
    { t: 'source' },
    { t: 'zone', p: { name: '毒潭', dps: 4 }, from: [0] },
    { t: 'damage', p: { base: 17 }, from: [1] }
  ]);
  const C = r.C, z = C.hosts[0];
  eq(z.type, 'zone');
  eq(SM.exclusiveView(C, z.id)._tickGrp.damage.base, 17);
});

console.log('\n[5] 载体嵌套与图鲁棒性');
ok('投射物 → 光环 → 伤害：parentId 正确，伤害归光环而非投射物', () => {
  const r = compile([
    { t: 'source' },
    { t: 'projectile', p: { name: '母弹' }, from: [0] },
    { t: 'aura', p: { name: '随弹光环' }, from: [1] },
    { t: 'damage', p: { base: 9 }, from: [2] }
  ]);
  const C = r.C;
  const proj = C.hosts.find(h => h.type === 'projectile'), au = C.hosts.find(h => h.type === 'aura');
  eq(au.parentId, proj.id);
  truthy(proj.bound.indexOf(au.id) >= 0, '光环节点归属母弹');
  eq(SM.exclusiveView(C, au.id)._tickGrp.damage.base, 9);
  eq(SM.viewFor(C, proj.id).events.onHit.damage.base, 0, '母弹不该吃到光环专属伤害');
});
ok('孤立（不可达）节点不进入任何视图', () => {
  const r = compile([
    { t: 'source' },
    { t: 'projectile', p: { name: 'A' }, from: [0] },
    { t: 'damage', p: { base: 999 } }                       // 没有入边
  ]);
  const C = r.C;
  eq(C.liveIds[r.nodes[2].id], undefined);
  eq(C.events.onHit.damage.base, 0);
  eq(SM.publicView(C).events.onHit.damage.base, 0);
});
ok('连线成环也能编译（不死循环）', () => {
  const nodes = build([
    { t: 'source' },
    { t: 'projectile', p: { name: 'A' }, from: [0] },
    { t: 'fx', p: { effect: 'fire/fireball', attach: 'projectile' }, from: [1] }
  ]);
  nodes.edges.push({ from: nodes.nodes[2].id, to: nodes.nodes[1].id });
  const C = SM.compile({ name: '环', mods: {}, charge: 3, graph: SM.makeGraph(nodes.nodes, nodes.edges) });
  eq(C.hosts.length, 1);
  eq(C.hosts[0].bound.length, 1);
});
ok('多个 damage 节点时墙面持续 / 半径取最大，不再把默认值翻倍', () => {
  const r = compile([
    { t: 'source' },
    { t: 'damage', p: { base: 3 }, from: [0] },
    { t: 'damage', p: { base: 4, wallDuration: 5, wallRadius: 90 }, from: [0] }
  ]);
  const C = r.C;
  eq(C.events.onHit.damage.base, 7);
  eq(C.events.onHit.damage.wallDuration, 5, 'max(3,5) 而不是 3+5=8');
  eq(C.events.onHit.damage.wallRadius, 90, 'max(60,90) 而不是 150');
});

console.log('\n[6] 视图与诊断 API');
ok('公共视图 / 宿主视图都带 _views，可继续反查其它载体', () => {
  const r = compile([
    { t: 'source' },
    { t: 'projectile', p: { name: 'A' }, from: [0] },
    { t: 'projectile', p: { name: 'B' }, from: [0] },
    { t: 'damage', p: { base: 7 }, from: [1] }
  ]);
  const C = r.C;
  truthy(SM.publicView(C)._views, '公共视图缺 _views');
  truthy(SM.viewFor(C, C.hosts[0].id)._views, '宿主视图缺 _views');
  eq(SM.exclusiveView(C, C.hosts[0].id)._exclusive, true);
  eq(SM.exclusiveView(C, C.hosts[1].id).events.onHit.damage.base, 0);
});
ok('describeBindings 能报出「指向性 + 投射物并存」「载体没接模块」', () => {
  const r = compile([
    { t: 'source' },
    { t: 'targeted', p: { name: '锁定' }, from: [0] },
    { t: 'projectile', p: { name: 'A' }, from: [0] },
    { t: 'projectile', p: { name: 'B' }, from: [0] }
  ]);
  const d = SM.describeBindings(r.C);
  truthy(d.issues.some(s => s.indexOf('指向性') >= 0), '缺指向性冲突提示');
  truthy(d.issues.some(s => s.indexOf('没有连接任何模块') >= 0), '缺空载体提示');
  eq(d.hosts.length, 3);
});
ok('setHosts 会把图中载体注入「作用对象」下拉', () => {
  const g = build([
    { t: 'source' },
    { t: 'projectile', p: { name: 'A' }, from: [0] },
    { t: 'aura', p: { name: '领域' }, from: [0] }
  ]);
  const opts = SM.setHosts(SM.makeGraph(g.nodes, g.edges));
  eq(opts.length, 4);
  truthy(opts.some(o => o[1].indexOf('投射物「A」') >= 0));
  truthy(opts.some(o => o[1].indexOf('光环「领域」') >= 0));
  eq(SM.MODULES.fx.fields[0].key, 'bindTo');
  eq(SM.MODULES.source.fields[0].key, 'trigger', 'source 不应被注入作用对象');
});

console.log('\n---------------------------------------------');
console.log('PASS ' + pass + ' / FAIL ' + fail);
if (fail) process.exit(1);
