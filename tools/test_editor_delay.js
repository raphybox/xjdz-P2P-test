/* 验证：编辑器「试放」预览的延迟 + 路径特效逻辑（mirror admin.js burstGroup / draw）
   用真实 SM.compile + 假 SE，确认带「延迟模块」下游的特效 / 路径特效确实延后 N 秒才出现。
   node tools/test_editor_delay.js
*/
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');

const win = {
  console, Math, Object, Number, String, Array, JSON, isFinite, Promise, WeakMap, performance: { now: () => Date.now() }
};
const ctx = Object.assign({ window: win }, win);
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'skill-modules.js'), 'utf8'), ctx);
const SM = win.SkillModules;

// 假 SE：记录每次 spawn 的 effect 与「当前预览时钟 t」（用闭包捕获）
let T = 0;                 // 预览时钟
const spawned = [];        // {effect, at}
const SE = {
  spawnFx(nodes, where, x, y, rot, extra, followEnt, contact, enemies, groupMarkLife) {
    return Promise.resolve((nodes || []).map(n => {
      const rec = { effect: n.effect, born: T, follow: null };
      spawned.push({ effect: n.effect, at: T });
      return rec;
    }));
  },
  burstParticles() { return []; },
  pushFx(list, arr) { (arr || []).forEach(a => list.push(a)); }
};

// ---- 复刻 admin.js 里新增的预览延迟 / 路径逻辑（与本次改动逐字一致）----
let skillTimersPreview = [], pathEmittersPreview = [];
function schedulePreview(delaySec, fn) {
  if (!fn) return;
  if (!(delaySec > 0)) { try { fn(); } catch (e) {} return; }
  skillTimersPreview.push({ fireAt: T + delaySec, fn: fn });
}
function stepSkillTimersPreview() {
  if (!skillTimersPreview.length) return;
  const now = T, ready = [], keep = [];
  for (let i = 0; i < skillTimersPreview.length; i++) {
    const tm = skillTimersPreview[i];
    if (tm.fireAt <= now) ready.push(tm); else keep.push(tm);
  }
  skillTimersPreview = keep;
  for (let i = 0; i < ready.length; i++) { try { ready[i].fn(); } catch (e) {} }
}
function registerPathDropPreview(att, node, kind) {
  if (!att) return;
  const interval = Math.max(0.02, Number(node.pathInterval) || 0.15);
  const life = Math.max(0.1, Number(node.pathDuration) || 2);
  pathEmittersPreview.push({ owner: att, kind: kind, node: node, interval: interval, life: life, age: 0, tick: 0 });
}
function stepPathEmittersPreview(dt) {
  if (!pathEmittersPreview.length) return;
  pathEmittersPreview = pathEmittersPreview.filter(em => {
    em.age += dt;
    if (em.age >= em.life) return false;
    em.tick -= dt;
    if (em.tick > 0) return true;
    em.tick += em.interval;
    const att = em.owner;
    if (!att) return true;
    if (em.kind === 'fx') {
      SE.spawnFx([em.node], 'pathDrop', att.x, att.y, (att.rot || 0), null, null, null, null, 0).then(a => { SE.pushFx([], a); });
    } else {
      SE.burstParticles(em.node, att.x, att.y, (att.rot || 0), null, null, null);
    }
    return true;
  });
}

// ---- 复刻 burstGroup 里 fx / 路径 部分（gate() 直接 true，x/y/rot/caster 占位）----
function burstGroupFx(grp, x, y, rot, caster) {
  const gate = () => true;
  const fxList = (grp.fx || []).filter(f => gate(f) && f._hostType !== 'zone' && f.attach !== 'path');
  const pathFx = (grp.fx || []).filter(f => gate(f) && f._hostType !== 'zone' && f.attach === 'path');
  const spawnFxNow = f => {
    SE.spawnFx([f], 'impact', x, y, rot, null, caster, null, [caster], 0);
  };
  fxList.forEach(f => { if ((f._delay || 0) > 0) schedulePreview(f._delay, () => spawnFxNow(f)); else spawnFxNow(f); });
  pathFx.forEach(f => { if ((f._delay || 0) > 0) schedulePreview(f._delay, () => registerPathDropPreview(caster, f, 'fx')); else registerPathDropPreview(caster, f, 'fx'); });
}

// ---- 用户的图：范围判定 -> 分支A(元素->frostFx(follow)->dmg1)
//                    范围判定 -> 延迟(0.8) -> poisonFx(path) -> dmg2 + slow ----
const range = SM.node('range', 40, 90, { radius: 80, maxTargets: 20, scope: 'global' });
const element = SM.node('element', 320, 20, { element: 'ice', damage: 0, damagePct: 0 });
const frostFx = SM.node('fx', 600, 20, { effect: 'ice/frost-nova', attach: 'follow', scale: 1 });
const dmg1 = SM.node('damage', 600, 200, { base: 0, crit: 0 });
const delay = SM.node('delay', 320, 240, { seconds: 0.8 });
const poisonFx = SM.node('fx', 600, 240, { effect: 'nature/poison-cloud', attach: 'path', scale: 0.75, pathDuration: 7, pathInterval: 0.15 });
const dmg2 = SM.node('damage', 880, 220, { base: 0, crit: 0 });
const slow = SM.node('status', 880, 360, { status: 'slow', affect: 'enemy' });

const C = SM.compile({
  id: 'u', name: 'demo', graph: SM.makeGraph(
    [range, element, frostFx, dmg1, delay, poisonFx, dmg2, slow],
    [
      { from: range.id, to: element.id }, { from: element.id, to: frostFx.id }, { from: frostFx.id, to: dmg1.id },
      { from: range.id, to: delay.id }, { from: delay.id, to: poisonFx.id },
      { from: poisonFx.id, to: dmg2.id }, { from: poisonFx.id, to: slow.id }
    ]
  )
});

// 试放：先触发 onHit 组（frostFx + poisonFx 都在 onHit），再 tick 时钟
burstGroupFx(C.events.onHit, 100, 100, 0, { x: 100, y: 100, rot: 0 });

// 模拟 draw 循环：每帧推进 0.05s，共 2s
const dt = 0.05;
for (let i = 0; i <= 40; i++) {
  T = i * dt;
  stepSkillTimersPreview();
  stepPathEmittersPreview(dt);
}

let fail = 0;
const frost = spawned.filter(s => s.effect === 'ice/frost-nova');
const poison = spawned.filter(s => s.effect === 'nature/poison-cloud');
function ok(name, cond, detail) { console.log((cond ? '  ok  ' : '  FAIL') + ' ' + name + (detail ? '  ' + detail : '')); if (!cond) fail++; }

console.log('frost(follow) 首次出现时刻:', frost.length ? frost[0].at.toFixed(2) : 'NONE');
console.log('poison(path) 首次出现时刻:', poison.length ? poison[0].at.toFixed(2) : 'NONE', ' 总落点数:', poison.length);
ok('frost 立即出现(at≈0)', frost.length && frost[0].at < 0.01, 'at=' + (frost[0] && frost[0].at.toFixed(2)));
ok('poison 延后出现(at≈0.8+)', poison.length && poison[0].at >= 0.75, 'at=' + (poison[0] && poison[0].at.toFixed(2)));
ok('poison 晚于 frost', poison.length && frost.length && poison[0].at > frost[0].at);
ok('poison 是路径多落点(>1)', poison.length > 1, 'count=' + poison.length);

console.log(fail ? '\nFAILED ' + fail : '\n全部通过：延迟模块在试放预览里生效（特效按延迟延后、路径特效独立发射）');
process.exit(fail ? 1 : 0);
