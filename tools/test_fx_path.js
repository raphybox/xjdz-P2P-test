/* 新增「弹珠移动路径」挂载位置 + 触发间隔 的回归/行为测试
   （node tools/test_fx_path.js）
   直接加载真实的 skill-effects.js / skill-modules.js，用假 PixelFX 验证：
     1) schema：ATTACH 新增「弹珠移动路径」；fx / particles 模块新增 pathInterval / pathDuration；
     2) 编译：path 特效只在 events 里，不混入投射物皮肤(projectileFx) / 墙面(wallFx)；
     3) 真实 spawnFx('pathDrop') 落点：静态(不跟随)、定位于施法弹珠当前坐标、互不跟随/去重，
        沿弹珠移动轨迹铺出多个独立落点 —— 即「移动时留下技能效果」的本质。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');

let fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log('  FAIL', name, 'got', JSON.stringify(got), 'want', JSON.stringify(want)); }
  else console.log('  ok  ', name);
}

/* ---------- 假 PixelFX：只统计实例生死 ---------- */
const live = new Set();
const win = {
  PixelFX: {
    spawn() {
      const inst = { dead: false, kill() { this.dead = true; live.delete(this); }, done() { return this.dead; }, update() {}, render() {} };
      live.add(inst);
      return Promise.resolve(inst);
    }
  },
  performance: { now: () => Date.now() },
  console, Math, Object, Number, String, Array, JSON, isFinite, Promise, WeakMap
};
const ctx = { window: win, console, Math, Object, Number, String, Array, JSON, isFinite, Promise, WeakMap, performance: win.performance };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'skill-effects.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'skill-modules.js'), 'utf8'), ctx);
const SE = win.SkillEffects;
const SM = win.SkillModules;

function resetLive() { live.forEach(i => i.kill()); live.clear(); }

/* ---------- 1) schema ---------- */
console.log('1) schema：挂载位置新增「弹珠移动路径」，fx / particles 新增触发间隔/持续时长');
const attachOpts = SM.MODULES.fx.fields.find(f => f.key === 'attach').options;
eq('ATTACH 含 path 选项', attachOpts.some(o => o[0] === 'path' && o[1] === '弹珠移动路径'), true);
const fxKeys = SM.MODULES.fx.fields.map(f => f.key);
eq('fx 含 pathInterval', fxKeys.indexOf('pathInterval') >= 0, true);
eq('fx 含 pathDuration', fxKeys.indexOf('pathDuration') >= 0, true);
const partKeys = SM.MODULES.particles.fields.map(f => f.key);
eq('particles 含 pathInterval', partKeys.indexOf('pathInterval') >= 0, true);
eq('particles 含 pathDuration', partKeys.indexOf('pathDuration') >= 0, true);
eq('pathInterval 默认值 0.15', (fxKeys, SM.MODULES.fx.fields.find(f => f.key === 'pathInterval').def), 0.15);
eq('pathDuration 默认值 2', (fxKeys, SM.MODULES.fx.fields.find(f => f.key === 'pathDuration').def), 2);

/* ---------- 2) 编译分组 ---------- */
console.log('\n2) 编译后 path 特效只在 events 里，不混入投射物皮肤 / 墙面');
const C = SM.compile({
  id: 'p', graph: {
    nodes: [
      { id: 'src', type: 'source', params: {} },
      { id: 'f1', type: 'fx', params: { triggerEvent: 'onCast', effect: 'fire/fireball', attach: 'path', pathInterval: 0.2, pathDuration: 1, life: 0.5 } },
      { id: 'f2', type: 'fx', params: { triggerEvent: 'onCast', effect: 'holy/heal-aoe', attach: 'wallFace' } }
    ],
    edges: [{ from: 'src', to: 'f1' }, { from: 'src', to: 'f2' }]
  }
});
eq('onCast.fx 含 path 节点', C.events.onCast.fx.some(f => f.attach === 'path'), true);
eq('projectileFx 不含 path', C.projectileFx.every(f => f.attach !== 'path'), true);
eq('wallFx 含 wallFace 节点', C.wallFx.some(f => f.attach === 'wallFace'), true);
eq('wallFx 不含 path 节点', C.wallFx.every(f => f.attach !== 'path'), true);

/* ---------- 3) 真实落点行为 ---------- */
console.log('\n3) 真实 spawnFx(pathDrop) 落点：静态、定位于弹珠当前坐标、互不跟随/去重');
async function dropTrail() {
  const marble = { side: 'player', x: 0, y: 0, r: 16, rot: 0 };
  const pathNode = C.events.onCast.fx.find(f => f.attach === 'path');
  const list = [];
  const interval = 0.2, duration = 1.0, dt = 0.2;
  let age = 0, tick = 0;
  // 与 game.js stepPathEmitters 完全一致的推进：先累加 age，>= 持续时长则退役（不再落点）
  while (true) {
    age += dt;
    if (age >= duration) break;                  // 模拟 em.age >= em.life 退役
    tick -= dt;
    if (tick <= 0) {
      tick += interval;
      marble.x = age * 100; marble.y = age * 50;  // 弹珠沿轨迹移动
      const arr = await SE.spawnFx([pathNode], 'pathDrop', marble.x, marble.y, 0, null, null, null, null, 0);
      SE.pushFx(list, arr);
    }
  }
  return { list, marble };
}
(async function main() {
  resetLive();
  const { list } = await dropTrail();
  eq('落点数量(duration/interval，边界退役不落点)', list.length, 4);    // 0.2/0.4/0.6/0.8 落点，1.0 处退役
  eq('所有落点都是静态(不跟随)', list.every(q => !q.follow || typeof q.follow !== 'object'), true);
  const xs = list.map(q => Math.round(q.x));
  eq('落点沿轨迹分布(坐标不全相同 → 真·路径铺点)', new Set(xs).size, list.length);
  // 每个落点独立：pushFx 不应把旧落点顶掉（path 落点无 replaceKey）
  eq('每个落点独立、未被去重', list.length, 4);
  // 兜底去重也不应误伤 path 落点（它们 follow 不是对象）
  SE.dedupeFx(list);
  eq('dedupeFx 不误删 path 落点', list.length, 4);
  // 最后再确认落点坐标 = 当时弹珠坐标（验证 makeFxJob 用传入的 x/y，而非跟随）
  eq('落点坐标 = 弹珠当时坐标(20)', list[0].x, 20);
  eq('落点坐标 = 弹珠当时坐标(80)', list[3].x, 80);

  /* ---------- 4) 粒子版路径落点 ---------- */
  resetLive();
  console.log('\n4) 粒子版：attach=path 的粒子在弹珠当前位置喷发、不跟随');
  const Cp = SM.compile({
    id: 'pp', graph: {
      nodes: [
        { id: 'src', type: 'source', params: {} },
        { id: 'p1', type: 'particles', params: { triggerEvent: 'onCast', attach: 'path', pathInterval: 0.2, pathDuration: 1, count: 6, speed: 120, life: 0.5 } }
      ],
      edges: [{ from: 'src', to: 'p1' }]
    }
  });
  const pnode = Cp.events.onCast.particles.find(p => p.attach === 'path');
  const parts = SE.burstParticles(pnode, 300, 150, 0, null, null, null);
  eq('粒子已生成', parts.length, 6);
  eq('粒子不跟随(无 follow)', parts.every(p => !p.follow), true);
  eq('粒子定位于弹珠坐标 x', Math.round(parts[0].x), 300);
  eq('粒子定位于弹珠坐标 y', Math.round(parts[0].y), 150);

  console.log(fail ? '\nFAILED ' + fail + ' 项' : '\n全部通过');
  process.exit(fail ? 1 : 0);
})();
