'use strict';
/* 端口契约测试：卡片覆盖 / 端口合法性 / 连线规则 / 主参数键存在性 / 语义数据源 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log('  FAIL ' + msg); } };

const ctx = {
  window: {}, console, Promise, Math, Object, Number, String, Array, JSON,
  isFinite, isNaN, Set, Map, WeakMap, parseFloat, parseInt, Date
};
ctx.window.window = ctx.window;
ctx.globalThis = ctx.window;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'skill-modules.js'), 'utf8'), ctx);
const SM = ctx.window.SkillModules;
const K = require(path.join(ROOT, 'skill-ports.js'));

console.log('① 卡片覆盖');
SM.TYPES.forEach(t => {
  const sp = K.spec(t);
  ok(!!sp, t + ' 必须有卡片规格');
  if (!sp) return;
  if (t === 'stats') {
    ok(sp.role === 'meta', 'stats 属于 meta 角色');
  } else {
    ok(!!sp.lane && !!K.lane(sp.lane), t + ' 的泳道必须存在：' + sp.lane);
    ok(sp.ins.length + sp.outs.length > 0, t + ' 至少有一个端口');
  }
  const ids = { in: {}, out: {} };
  (sp.ins || []).forEach(p => {
    ok(!ids.in[p.id], t + ' 输入端口 id 重复：' + p.id);
    ids.in[p.id] = 1;
    ok(!!K.PORT_TYPES[p.type], t + ' 端口类型非法：' + p.type);
    if (p.type === 'data') ok(!!p.data, t + ' 数据口必须有 data 种类：' + p.id);
    if (p.type === 'event') {
      ok(!!p.ev && !!K.EVENT_TO_GROUP[p.id], t + ' 事件口必须映射到运行时事件组：' + p.id);
      ok(['onCast', 'onHit', 'onWall', 'onExpire'].indexOf(p.ev) >= 0, t + ' 事件 ' + p.ev + ' 不是运行时事件组');
    }
  });
  (sp.outs || []).forEach(p => {
    ok(!ids.out[p.id], t + ' 输出端口 id 重复：' + p.id);
    ids.out[p.id] = 1;
    ok(!!K.PORT_TYPES[p.type], t + ' 端口类型非法：' + p.type);
    if (p.type === 'data') ok(!!p.data, t + ' 数据口必须有 data 种类：' + p.id);
    if (p.type === 'event') {
      ok(!!p.ev && !!K.EVENT_TO_GROUP[p.id], t + ' 事件口必须映射到运行时事件组：' + p.id);
      ok(['onCast', 'onHit', 'onWall', 'onExpire'].indexOf(p.ev) >= 0, t + ' 事件 ' + p.ev + ' 不是运行时事件组');
    }
  });
});

console.log('② 角色与主参数');
Object.keys(K.ROLE_TYPES).forEach(role => {
  K.ROLE_TYPES[role].forEach(t => ok(!!SM.MODULES[t], role + ' 角色引用了不存在的类型：' + t));
});
Object.keys(K.CARD_FIELDS).forEach(t => {
  const d = SM.MODULES[t];
  ok(!!d, 'CARD_FIELDS 引用了不存在的类型：' + t);
  if (!d) return;
  K.CARD_FIELDS[t].forEach(k => {
    ok((d.fields || []).some(f => f.key === k), t + ' 主参数键不存在：' + k);
  });
});

console.log('③ 连线规则');
function mk(nodes, edges) { return { graph: { nodes: nodes, edges: edges } }; }
function node(id, type, params) {
  return { id: id, type: type, x: 0, y: 0, params: Object.assign({}, SM.defaults(type), params || {}) };
}
const base = mk([node('s', 'source'), node('t', 'select'), node('p', 'projectile'), node('d', 'damage'), node('f', 'fx')],
  [{ from: 's', to: 't', fromPort: 'signal', toPort: 'signal' }]);
ok(K.canConnect(base, 'p', 'hit', 'd', 'hit').ok === true, '投射物·命中 → 伤害·命中原应可连');
ok(K.canConnect(base, 'p', 'wall', 'd', 'hit').code === 'EVENT_MISMATCH', '撞墙事件不能接命中口');
ok(K.canConnect(base, 'p', 'entity', 'd', 'hit').code === 'TYPE_MISMATCH', '数据口不能接事件口');
ok(K.canConnect(base, 'p', 'hit', 'd', 'cast').code === 'TYPE_MISMATCH', '事件口不能接执行口');
ok(K.canConnect(base, 'p', 'entity', 'd', 'targets').code === 'DATA_MISMATCH', '弹体句柄不能接目标集合口');
ok(K.canConnect(base, 's', 'cast', 'p', 'cast').ok === true, '触发·施放 → 投射物·执行 应可连');
ok(K.canConnect(base, 'p', 'hit', 'f', 'hit').ok === true, '投射物·命中 → 特效·命中 应可连');
ok(K.canConnect(base, 'p', 'hit', 'p', 'hit').code === 'SELF', '不能连自己');

const dup = mk([node('p', 'projectile'), node('d', 'damage')], [{ from: 'p', to: 'd', fromPort: 'hit', toPort: 'hit' }]);
ok(K.canConnect(dup, 'p', 'hit', 'd', 'hit').code === 'DUP', '重复连线要被拦下');

const cyc = mk([node('p', 'projectile'), node('d', 'damage')], [{ from: 'd', to: 'p', fromPort: 'cast', toPort: 'cast' }]);
ok(K.canConnect(cyc, 'p', 'cast', 'd', 'cast').code === 'CYCLE', '执行链成环要被拦下');

console.log('④ 真实果实：端口 / 语义');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/game-config.json'), 'utf8'));
cfg.skills.forEach(sk => {
  const nodes = (sk.graph && sk.graph.nodes) || [];
  const byId = {}; nodes.forEach(n => byId[n.id] = n);
  ((sk.graph && sk.graph.edges) || []).forEach((e, i) => {
    ok(!!byId[e.from] && !!byId[e.to], sk.name + ' 第 ' + i + ' 条边两端节点必须存在');
    if (e.fromPort) ok(!!K.port(byId[e.from].type, 'out', e.fromPort), sk.name + ' 边 ' + i + ' 的输出端口不存在：' + e.fromPort);
    if (e.toPort) ok(!!K.port(byId[e.to].type, 'in', e.toPort), sk.name + ' 边 ' + i + ' 的输入端口不存在：' + e.toPort);
  });
  const C = SM.compile(sk);
  ok(!!C.semantics && !!C.semantics.byNode, sk.name + ' 编译结果必须带 semantics');
  nodes.forEach(n => {
    const sem = C.semantics && C.semantics.byNode[n.id];
    ok(!!sem, sk.name + ' 节点 ' + n.id + ' 缺少语义数据');
    if (sem) {
      ok(typeof sem.delay === 'number', sk.name + ' 节点 ' + n.id + ' 的延迟必须是数字');
      ok(['onCast', 'onHit', 'onWall', 'onExpire', ''].indexOf(sem.event) >= 0, sk.name + ' 节点 ' + n.id + ' 事件组非法：' + sem.event);
    }
  });
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
