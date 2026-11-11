/* 链路守卫回归测试 · Node 直接运行：node guard_test.cjs
   模拟真实项目的 window.SkillModules 编译层，验证 15 项修复点。 */
const assert = require('node:assert/strict');
global.window = global;
require('./skill-graph-guard.js');
const SG = global.SkillGraphGuard;

/* ---------- 模拟 skill-modules.js 编译层 ---------- */
const MODULES = {
  source:     { label: '触发·来源', short: '触发' },
  select:     { label: '目标·锁定', short: '锁定' },
  fx:         { label: '像素特效', short: '特效' },
  damage:     { label: '伤害·结算', short: '结算' },
  projectile: { label: '投射物',   short: '投射物' },
  range:      { label: '范围判定', short: '范围' },
  element:    { label: '元素',     short: '元素' },
  status:     { label: '状态',     short: '状态' },
  zone:       { label: '留场区域', short: '留场' }
};
const HOST_TYPES = { projectile: true };

function mockCompile(sk) {
  const nodes = (sk.graph && sk.graph.nodes) || [];
  const edges = (sk.graph && sk.graph.edges) || [];
  const map = {}; nodes.forEach(n => { map[n.id] = n; });
  const out = {}; nodes.forEach(n => { out[n.id] = []; });
  const valid = edges.filter(e => map[e.from] && map[e.to]);
  valid.forEach(e => out[e.from].push(e.to));
  const live = {};
  const roots = nodes.filter(n => n.type === 'source').map(n => n.id);
  const st = roots.slice();
  while (st.length) { const a = st.pop(); if (live[a]) continue; live[a] = true; (out[a] || []).forEach(v => st.push(v)); }
  // 模拟「静默裁决」：有多条入边的节点，取最后一条入边的来源作为 host
  const byNode = {};
  const hosts = nodes.filter(n => HOST_TYPES[n.type]).map(n => ({ id: n.id, label: MODULES[n.type].short, bound: [] }));
  const hostIds = {}; hosts.forEach(h => { hostIds[h.id] = true; });
  nodes.forEach(n => {
    const ins = valid.filter(e => e.to === n.id);
    if (ins.length > 1) {
      const pick = ins[ins.length - 1].from;
      if (hostIds[pick]) byNode[n.id] = pick;
    }
  });
  return { liveIds: Object.keys(live), bindings: { byNode }, hosts };
}
const SM = {
  MODULES, HOST_TYPES, compile: mockCompile,
  rangeDescriptor: () => ({}), targetsInRange: () => [], rangePoint: () => ({ x: 0, y: 0 }),
  describeBindings: () => ({ issues: [] })
};
const OLD_SM = Object.assign({}, SM);
delete OLD_SM.rangeDescriptor; delete OLD_SM.targetsInRange; delete OLD_SM.rangePoint;

let seq = 0;
const uid = t => t + '_' + (++seq) + '_test';
const N = (id, type, x, y) => ({ id, type, x: x || 60, y: y || 90, params: {} });
const E = (a, b) => ({ from: a, to: b });
function skill(nodes, edges) { return { id: 'sk_test', name: '测试果实', graph: { nodes, edges } }; }

let passed = 0;
const test = (name, fn) => {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); throw e; }
};

console.log('\n=== 链路守卫 · 回归测试（适配真实 admin.js）===\n');

/* 基准图：还原截图里的 4 节点链 触发 → 锁定 → 特效 → 结算 */
const base4 = () => skill(
  [N('s1', 'source'), N('l1', 'select'), N('f1', 'fx'), N('d1', 'damage')],
  [E('s1', 'l1'), E('l1', 'f1'), E('f1', 'd1')]
);

test('01 截图里的 4 节点链：体检全绿、摘要正确', () => {
  const sk = base4();
  assert.deepEqual(SG.check(sk, SM), []);
  const s = SG.summary(sk, SM);
  assert.ok(s.indexOf('触发') >= 0 && s.indexOf('结算') >= 0);
  assert.equal(s, SG.summary(sk, SM), '摘要确定性');
});

test('02 悬空连线（指向已删节点）被报 error；clean 能清掉', () => {
  const sk = base4();
  sk.graph.edges.push(E('ghost', 'd1'));
  const issues = SG.check(sk, SM);
  assert.ok(issues.some(i => i.code === 'DANGLING_EDGE' && i.level === 'error'));
  const r = SG.clean(sk);
  assert.equal(r.removed, 1);
  assert.equal(sk.graph.edges.length, 3);
});

test('03 重复连线 / 自连线被报 error', () => {
  const sk = base4();
  sk.graph.edges.push(E('l1', 'f1'), E('f1', 'f1'));
  const codes = SG.check(sk, SM).map(i => i.code);
  assert.ok(codes.includes('DUP_EDGE'));
  assert.ok(codes.includes('SELF_LOOP'));
});

test('04 成环连线被前置拒绝，且图不被改动', () => {
  const sk = base4();
  const before = sk.graph.edges.length;
  const r = SG.canConnect(sk, SM, 'd1', 'l1');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'CYCLE');
  assert.equal(sk.graph.edges.length, before, '失败不得留半条边');
  const r2 = SG.connect(sk, SM, 'd1', 'l1');
  assert.equal(r2.ok, false);
  assert.equal(sk.graph.edges.length, before);
});

test('05 多入边归属冲突被前置拒绝（加联动时的核心 bug）', () => {
  // 两个投射物载体同时接同一个特效 -> 运行时只能认一个
  const sk = skill(
    [N('s1', 'source'), N('p1', 'projectile'), N('p2', 'projectile'), N('f1', 'fx')],
    [E('s1', 'p1'), E('s1', 'p2'), E('p1', 'f1')]
  );
  const r = SG.canConnect(sk, SM, 'p2', 'f1');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'AMBIGUOUS_HOST');
  assert.ok(r.msg.indexOf('运行时只能认其中一个') >= 0);
});

test('06 「触发·来源」不能被接入；两个独立载体不能互连', () => {
  const sk = skill(
    [N('s1', 'source'), N('l1', 'select'), N('p1', 'projectile'), N('p2', 'projectile')],
    [E('s1', 'l1')]
  );
  assert.equal(SG.canConnect(sk, SM, 'l1', 's1').code, 'ROOT_HAS_INPUT');
  assert.equal(SG.canConnect(sk, SM, 'p1', 'p2').code, 'HOST_TO_HOST');
});

test('07 按引用删边，不靠数组下标（原 se-del-edge 的隐患）', () => {
  const sk = base4();
  sk.graph.edges.unshift(E('ghost', 'ghost2'));   // 前面插一条悬空边，制造下标偏移
  const before = sk.graph.edges.length;
  const n = SG.removeEdge(sk, 'l1|f1');
  assert.equal(n, 1);
  assert.equal(sk.graph.edges.length, before - 1);
  assert.ok(!sk.graph.edges.some(e => e.from === 'l1' && e.to === 'f1'));
  assert.equal(SG.removeEdge(sk, 'l1|f1'), 0, '重复删不误伤其它边');
});

test('08 clean 后画布上的连线与数据一一对应', () => {
  const sk = base4();
  sk.graph.edges.push(E('a', 'b'), E('s1', 'l1'), E('d1', 'd1'));
  SG.clean(sk);
  assert.equal(sk.graph.edges.length, 3);
  assert.deepEqual(SG.check(sk, SM), []);
});

test('09 多选复制粘贴：内部连线保留、外部连线不复制、id 全部重映射', () => {
  const sk = skill(
    [N('s1', 'source'), N('p1', 'projectile'), N('f1', 'fx'), N('d1', 'damage')],
    [E('s1', 'p1'), E('p1', 'f1'), E('f1', 'd1')]
  );
  const clip = SG.cloneSelection(sk, ['p1', 'f1'], uid);
  assert.equal(clip.nodes.length, 2);
  assert.equal(clip.edges.length, 1, 'p1→f1 内部线保留');
  const newIds = SG.paste(sk, clip, { uid, dx: 28, dy: 28 });
  assert.equal(newIds.length, 2);
  const edges = sk.graph.edges;
  assert.equal(edges.length, 4, '只多 1 条内部线，没有复制指向 s1/d1 的外部线');
  const inner = edges.filter(e => newIds.indexOf(e.from) >= 0 && newIds.indexOf(e.to) >= 0);
  assert.equal(inner.length, 1);
  const cross = edges.filter(e => (newIds.indexOf(e.from) >= 0) !== (newIds.indexOf(e.to) >= 0));
  assert.equal(cross.length, 0, '新节点不连回旧节点');
  assert.equal(new Set(sk.graph.nodes.map(n => n.id)).size, sk.graph.nodes.length, '无 id 冲突');
});

test('10 单选复制粘贴仍可用（兼容原来的 Ctrl+C 行为）', () => {
  const sk = base4();
  const clip = SG.cloneSelection(sk, ['f1'], uid);
  assert.equal(clip.edges.length, 0);
  const ids = SG.paste(sk, clip, { uid });
  assert.equal(ids.length, 1);
  assert.ok(SG.check(sk, SM).some(i => i.code === 'ORPHAN' && i.node === ids[0]),
    '粘贴出来的孤立模块会被体检提示「未接入」');
});

test('11 编译层静默裁决多入边 -> HOST_SILENT_PICK 明确报错', () => {
  const sk = skill(
    [N('s1', 'source'), N('p1', 'projectile'), N('p2', 'projectile'), N('f1', 'fx')],
    [E('s1', 'p1'), E('s1', 'p2'), E('p1', 'f1'), E('p2', 'f1')]
  );
  const codes = SG.check(sk, SM).map(i => i.code);
  assert.ok(codes.includes('AMBIGUOUS_HOST'));
  assert.ok(codes.includes('HOST_SILENT_PICK'), '把「后台连上了、游戏里没效果」讲清楚');
});

test('12 编辑器判断 vs 编译层实际不一致 -> COMPILE_MISMATCH', () => {
  const sk = base4();
  const weird = Object.assign({}, SM, {
    compile: (s) => { const C = mockCompile(s); C.liveIds = C.liveIds.filter(id => id !== 'f1'); return C; }
  });
  const iss = SG.check(sk, weird);
  assert.ok(iss.some(i => i.code === 'COMPILE_MISMATCH' && i.msg.indexOf('特效') >= 0));
});

test('13 旧编译层（缓存）被 buildTag 检出并给出强刷建议', () => {
  assert.equal(SG.buildTag(SM).fresh, true);
  const t = SG.buildTag(OLD_SM);
  assert.equal(t.fresh, false);
  assert.ok(t.missing.indexOf('rangeDescriptor') >= 0);
  assert.ok(t.advice.indexOf('Ctrl+F5') >= 0);
});

test('14 编译层抛错被捕获，不会让后台白屏', () => {
  const boom = Object.assign({}, SM, { compile: () => { throw new Error('参数炸了'); } });
  const iss = SG.check(base4(), boom);
  assert.ok(iss.some(i => i.code === 'COMPILE_ERROR'));
});

test('15 孤立模块 / 缺触发根 / 多触发根 分级报出', () => {
  const sk = skill(
    [N('s1', 'source'), N('l1', 'select'), N('orphan', 'fx')],
    [E('s1', 'l1')]
  );
  const a = SG.check(sk, SM).map(i => i.code);
  assert.ok(a.includes('ORPHAN'));
  const sk2 = skill([N('l1', 'select')], []);
  assert.ok(SG.check(sk2, SM).some(i => i.code === 'NO_TRIGGER' && i.level === 'error'));
  const sk3 = skill([N('s1', 'source'), N('s2', 'source')], []);
  assert.ok(SG.check(sk3, SM).some(i => i.code === 'MULTI_TRIGGER' && i.level === 'warn'));
});

test('16 兼容真实 admin.js：liveIds 是对象 map 而非数组', () => {
  const sk = base4();
  const asMap = Object.assign({}, SM, {
    compile: (s) => {
      const C = mockCompile(s), m = {};
      C.liveIds.forEach(id => { m[id] = true; });
      C.liveIds = m; return C;
    }
  });
  assert.deepEqual(SG.check(sk, asMap), []);
});

test('17 正常编排：一个载体挂多个属性模块不应误报冲突', () => {
  // 真实项目常见形态：投射物上同时挂 范围判定 / 元素 / 特效
  const sk = skill(
    [N('s1', 'source'), N('p1', 'projectile'), N('r1', 'range'), N('e1', 'element'), N('f1', 'fx')],
    [E('s1', 'p1'), E('p1', 'r1'), E('p1', 'e1'), E('p1', 'f1')]
  );
  const codes = SG.check(sk, SM).map(i => i.code);
  assert.ok(!codes.includes('AMBIGUOUS_HOST'), '同载体多分支是合法的');
  assert.ok(!codes.includes('HOST_SILENT_PICK'));
  assert.ok(!codes.includes('CYCLE'));
  assert.ok(SG.canConnect(sk, SM, 'p1', 's1').ok === false, '反向接回根仍要拦');
});

test('18 载入清洗 + 之后连线校验可连续工作（模拟 normalize 流程）', () => {
  const sk = base4();
  sk.graph.edges.push(E('deleted_node', 'd1'), E('s1', 'l1'), E('d1', 'd1'));
  const cr = SG.clean(sk);
  assert.equal(cr.removed, 3);
  assert.deepEqual(SG.check(sk, SM), []);
  const r = SG.connect(sk, SM, 'l1', 'd1');
  assert.equal(r.ok, true, '清洗后仍可正常加分支');
  const codes = SG.check(sk, SM).map(i => i.code);
  assert.ok(!codes.includes('DANGLING_EDGE'));
});

console.log('\n=== 全部 ' + passed + ' 项通过 ===\n');
