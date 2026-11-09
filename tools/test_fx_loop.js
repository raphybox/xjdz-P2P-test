/* 像素特效「循环播放」语义回归测试（node tools/test_fx_loop.js）
   断言：勾上循环播放 = 每播完一轮（特效自身时长 ÷ 帧率倍率）就从第一帧重开，无限重复；
        取消循环 = 只播一次，一轮走完立刻回收。
   直接加载真实的 skill-effects.js，用假 PixelFX 记录每轮的 t 与重开次数。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');

let fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log('  FAIL', name, 'got', JSON.stringify(got), 'want', JSON.stringify(want)); }
  else console.log('  ok  ', name, '=', JSON.stringify(got));
}
function ok(name, cond) { eq(name, !!cond, true); }

/* ---------- 假 PixelFX：行为与 pixelfx-runtime.spawn 的实例一致 ---------- */
function makeInst(cycle, nativeLoop) {
  const inst = {
    alive: true, t: 0, cycle: cycle, nativeLoop: !!nativeLoop, restarts: 0,
    update(dt) { if (inst.alive) inst.t += dt; },
    restart() { if (!inst.alive) return false; inst.t = 0; inst.restarts += 1; return true; },
    done() { return !inst.alive || inst.t >= inst.cycle; },
    kill() { inst.alive = false; },
    render() {}
  };
  return inst;
}
const spawned = [];
const win = {
  PixelFX: {
    spawn(id, opts) { const i = makeInst(0.8); spawned.push(i); return Promise.resolve(i); }
  }
};
const ctx = { window: win, console, Promise, Math, Object, Number, String, Array, isFinite, WeakMap };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'skill-effects.js'), 'utf8'), ctx);
const SE = win.SkillEffects;

/* 画布桩：drawFx 只用到这些方法 */
function stubCtx() {
  return {
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, drawImage() {},
    globalAlpha: 1, globalCompositeOperation: 'source-over', imageSmoothingEnabled: false
  };
}
function fx(over) {
  return Object.assign({
    effect: 'melee/spin-slash', attach: 'marble', loop: true, life: 0,
    fps: 1, scale: 1, alpha: 1, light: 1, additive: false, flipX: false,
    matchRotation: true, rotation: 0, stackReplace: true
  }, over || {});
}
async function one(cfg, follow) {
  const arr = await SE.spawnFx([cfg], 'impact', 0, 0, 0, null, follow || null);
  return arr[0];
}
/* 按 60fps 推进 seconds 秒 */
function run(list, seconds, dt) {
  dt = dt || 1 / 60;
  for (let t = 0; t < seconds - 1e-9; t += dt) SE.stepFx(list, dt);
}

(async function main() {
  console.log('1) 循环播放开：一轮 0.8 秒，2 秒内应该重开 2 次且 t 始终回到周期内');
  {
    spawned.length = 0;
    const q = await one(fx({ loop: true }));
    const list = [q];
    run(list, 2.0);
    const inst = q.inst;
    eq('重开次数', inst.restarts, 2);
    ok('t 已回到周期内', inst.t < inst.cycle && inst.t >= 0);
    ok('实例还活着', inst.alive && list.length === 1);
    eq('累计存在时长仍在走', Math.round(q.age * 10) / 10, 2);
  }

  console.log('\n2) 循环播放关：只播一次，一轮走完由 drawFx 回收');
  {
    spawned.length = 0;
    const q = await one(fx({ loop: false }));
    const list = [q];
    run(list, 0.5);
    SE.drawFx(stubCtx(), list, null);
    eq('半秒时还在播', list.length, 1);
    eq('没有重开', q.inst.restarts, 0);
    run(list, 0.5);
    SE.drawFx(stubCtx(), list, null);
    eq('一轮走完被回收', list.length, 0);
    eq('实例已销毁', q.inst.alive, false);
  }

  console.log('\n3) 帧率倍率 2：一轮 0.8 秒 → 0.4 秒就重开，节奏跟着倍率走');
  {
    spawned.length = 0;
    const q = await one(fx({ loop: true, fps: 2 }));
    const list = [q];
    run(list, 1.0);
    eq('1 秒内重开 2 次', q.inst.restarts, 2);
  }

  console.log('\n4) 循环播放不会重置寿命：存在时长 2 秒照样到点回收');
  {
    spawned.length = 0;
    const marble = { x: 0, y: 0, vx: 10, vy: 0 };
    const q = await one(fx({ loop: true, attach: 'marble', life: 2 }), marble);
    const list = [q];
    run(list, 3.0);
    ok('在循环', q.inst.restarts >= 3);
    eq('ttl 仍是 2 秒', q.ttl, 2);
    ok('存在时长已超（宿主按 ttl 回收）', q.age > q.ttl);
  }

  console.log('\n5) 模块默认值：循环播放默认勾选');
  {
    const c2 = { window: { PixelFX: win.PixelFX }, console, Promise, Math, Object, Number, String, Array, isFinite, WeakMap };
    vm.createContext(c2);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'skill-modules.js'), 'utf8'), c2);
    eq('模块默认 loop', c2.window.SkillModules.defaults('fx').loop, true);
  }

  console.log('\n6) 特效本身自带循环（meta.loop）：不重复重开，避免每一轮被重置出现跳帧');
  {
    const q = { inst: makeInst(1.2, true), cfg: fx({ loop: true }), age: 0 };
    const list = [q];
    run(list, 3.0);
    eq('外层不重开', q.inst.restarts, 0);
    ok('仍在播（t 一直增长）', q.inst.t > 2.9);
  }

  console.log(fail ? '\nFAILED ' + fail + ' 项' : '\n全部通过');
  process.exit(fail ? 1 : 0);
})();
