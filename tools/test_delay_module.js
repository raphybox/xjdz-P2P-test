/* 验证「延迟」模块：编译期延迟传播 + 流程守卫不误报。
   运行：node tools/test_delay_module.js */
'use strict';
const SM = require('../skill-modules.js');
require('../skill-flow-guard.js');
const Guard = globalThis.SkillFlowGuard || global.SkillFlowGuard;
const assert = require('assert');

let pass = 0;
function eq(name, a, b) {
  if (a !== b) { console.error('FAIL', name, 'got', JSON.stringify(a), 'want', JSON.stringify(b)); process.exit(1); }
  pass++; console.log('ok -', name);
}
function ok(name, cond) {
  if (!cond) { console.error('FAIL', name); process.exit(1); }
  pass++; console.log('ok -', name);
}

// 构造图：from → to 全为 flow 边（新模型严格判定）
function g(nodes, edges) {
  return { id: 't', name: 't', graph: { nodes: nodes, edges: edges.map(e => ({ from: e[0], to: e[1], kind: 'flow' })) } };
}
function nd(type, params) { return { id: type + '_' + Math.random().toString(36).slice(2, 7), type: type, params: Object.assign(SM.defaults(type), params || {}) }; }

// 1) 基础：fx(0) → delay(0.5) → status(0.5)
(function () {
  const s = nd('source', { trigger: 'interval' });
  const fx = nd('fx', { triggerEvent: 'onHit', attach: 'impact' });
  const dl = nd('delay', { seconds: 0.5 });
  const st = nd('status', { triggerEvent: 'onHit', status: 'slow', statusDuration: 2 });
  const sk = g([s, fx, dl, st], [[s.id, fx.id], [fx.id, dl.id], [dl.id, st.id]]);
  const c = SM.compile(sk);
  eq('基础: fx 延迟=0', c.events.onHit.fx[0]._delay, 0);
  eq('基础: status 延迟=0.5', c.events.onHit.status[0]._delay, 0.5);
  ok('基础: delay 节点不进事件桶', !c.events.onHit.delay);
})();

// 2) 串联两个延迟：累计 0.3 + 0.4 = 0.7
(function () {
  const s = nd('source');
  const dl1 = nd('delay', { seconds: 0.3 });
  const dl2 = nd('delay', { seconds: 0.4 });
  const st = nd('status', { triggerEvent: 'onHit', status: 'burn' });
  const sk = g([s, dl1, dl2, st], [[s.id, dl1.id], [dl1.id, dl2.id], [dl2.id, st.id]]);
  const c = SM.compile(sk);
  eq('串联: status 延迟=0.7', c.events.onHit.status[0]._delay, 0.7);
})();

// 3) 分支：delay 之后挂多个模块，全部继承同延迟
(function () {
  const s = nd('source');
  const dl = nd('delay', { seconds: 0.5 });
  const st = nd('status', { triggerEvent: 'onHit', status: 'freeze' });
  const fx = nd('fx', { triggerEvent: 'onHit', attach: 'impact' });
  const sk = g([s, dl, st, fx], [[s.id, dl.id], [dl.id, st.id], [dl.id, fx.id]]);
  const c = SM.compile(sk);
  eq('分支: status 延迟=0.5', c.events.onHit.status[0]._delay, 0.5);
  eq('分支: fx 延迟=0.5', c.events.onHit.fx[0]._delay, 0.5);
})();

// 4) 最长路径取 max：同一 status 经 delay(1) 与 delay(0.5) 两条路，取 1
(function () {
  const s = nd('source');
  const dlA = nd('delay', { seconds: 1 });
  const dlB = nd('delay', { seconds: 0.5 });
  const st = nd('status', { triggerEvent: 'onHit', status: 'stun' });
  // st 同时被 dlA 与 dlB 指向
  const sk = g([s, dlA, dlB, st], [[s.id, dlA.id], [s.id, dlB.id], [dlA.id, st.id], [dlB.id, st.id]]);
  const c = SM.compile(sk);
  eq('最长路径: status 延迟=1', c.events.onHit.status[0]._delay, 1);
})();

// 5) 无延迟模块时：status 延迟=0（旧行为不受影响）
(function () {
  const s = nd('source');
  const st = nd('status', { triggerEvent: 'onHit', status: 'slow' });
  const sk = g([s, st], [[s.id, st.id]]);
  const c = SM.compile(sk);
  eq('无延迟: status 延迟=0', c.events.onHit.status[0]._delay, 0);
})();

// 6) 守卫：含 delay 的图不应报 UNKNOWN_MODULE / 误报类型契约
(function () {
  const s = nd('source', { trigger: 'interval' });
  const fx = nd('fx', { triggerEvent: 'onHit', attach: 'impact' });
  const dl = nd('delay', { seconds: 0.5 });
  const st = nd('status', { triggerEvent: 'onHit', status: 'slow' });
  const sk = g([s, fx, dl, st], [[s.id, fx.id], [fx.id, dl.id], [dl.id, st.id]]);
  const issues = Guard.check(sk, SM);
  const errs = issues.filter(i => i.level === 'error');
  ok('守卫: 含 delay 的图无 error（UNKNOWN_MODULE/TYPE_CONTRACT 等）', errs.length === 0);
  if (errs.length) console.error('  实际 error:', errs.map(i => i.code + ':' + i.msg));
})();

// 7) 守卫（旧归属模型 / 纯 bind 边）：delay 也不应误报
(function () {
  const s = nd('source', { trigger: 'interval' });
  const fx = nd('fx', { triggerEvent: 'onHit', attach: 'impact' });
  const dl = nd('delay', { seconds: 0.5 });
  const st = nd('status', { triggerEvent: 'onHit', status: 'slow' });
  // 纯 bind 边（无 kind）→ legacy 模型
  const sk = { id: 't', name: 't', graph: { nodes: [s, fx, dl, st], edges: [{ from: s.id, to: fx.id }, { from: fx.id, to: dl.id }, { from: dl.id, to: st.id }] } };
  const issues = Guard.check(sk, SM);
  const errs = issues.filter(i => i.level === 'error');
  ok('守卫(legacy): 含 delay 的图无 error', errs.length === 0);
  if (errs.length) console.error('  实际 error:', errs.map(i => i.code + ':' + i.msg));
})();

console.log('\n延迟模块测试全部通过：' + pass + ' 项断言');
