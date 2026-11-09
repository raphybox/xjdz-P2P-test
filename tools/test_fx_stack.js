/* 像素特效「重复施加就无限叠加」的回归测试（node tools/test_fx_stack.js）
   直接加载真实的 skill-effects.js / skill-modules.js，用假的 PixelFX 统计存活实例。 */
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

/* ---------- 假 PixelFX：只统计实例生死 ---------- */
const live = new Set();
const win = {
  PixelFX: {
    spawn() {
      const inst = {
        dead: false,
        kill() { this.dead = true; live.delete(this); },
        done() { return this.dead; },
        update() {}, render() {}
      };
      live.add(inst);
      return Promise.resolve(inst);
    }
  }
};
const ctx = { window: win, console, Promise, Math, Object, Number, String, Array, isFinite, WeakMap };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'skill-effects.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'skill-modules.js'), 'utf8'), ctx);
const SE = win.SkillEffects;
const SM = win.SkillModules;

function resetLive() { live.forEach(function (i) { i.kill(); }); live.clear(); }

const caster = { side: 'player', x: 0, y: 0, r: 16 };
const enemy = { side: 'enemy', x: 100, y: 0, r: 20 };

function skill(fxParams, markParams) {
  const nodes = [
    { id: 'src', type: 'source', params: {} },
    { id: 'm1', type: 'mark', params: markParams || { triggerEvent: 'onCast', duration: 5 } },
    { id: 'f1', type: 'fx', params: Object.assign({ triggerEvent: 'onCast', effect: 'status/slowed', attach: 'enemy' }, fxParams) }
  ];
  return SM.compile({ id: 't', graph: { nodes, edges: [{ from: 'src', to: 'm1' }, { from: 'm1', to: 'f1' }] } });
}

/** 模拟一次触发：取同组 fx、带上同组印记时长、生成并并入列表 */
async function castOnce(C, list) {
  const grp = C.events.onCast;
  const life = (grp.mark || []).reduce((a, m) => Math.max(a, Number(m.duration) || 0), 0);
  const arr = await SE.spawnFx(grp.fx, 'impact', enemy.x, enemy.y, 0, null, caster, null, [enemy], life);
  SE.pushFx(list, arr);
  return arr;
}

(async function main() {
  console.log('1) 敌方身上 + 同组印记：连触发 5 次，列表恒为 1 份');
  {
    const C = skill();
    const list = [];
    for (let i = 0; i < 5; i++) await castOnce(C, list);
    eq('列表长度', list.length, 1);
    eq('存活实例', live.size, 1);
    eq('寿命=印记时长', list[0].ttl, 5);
    eq('随印记标记', list[0].markFx, true);
  }

  resetLive();
  console.log('\n2) 关掉「同类特效覆盖」也仍然只保留一份（一份印记配一份表现）');
  {
    const C = skill({ stackReplace: false });
    const list = [];
    for (let i = 0; i < 5; i++) await castOnce(C, list);
    eq('列表长度', list.length, 1);
    eq('存活实例', live.size, 1);
  }

  resetLive();
  console.log('\n3) 没有印记、又关掉覆盖：靠兜底寿命收敛（不会无限涨）');
  {
    const C = SM.compile({
      id: 't2', graph: {
        nodes: [
          { id: 'src', type: 'source', params: {} },
          { id: 'f1', type: 'fx', params: { triggerEvent: 'onCast', effect: 'status/slowed', attach: 'enemy', loop: true, stackReplace: false } }
        ],
        edges: [{ from: 'src', to: 'f1' }]
      }
    });
    const list = [];
    for (let i = 0; i < 5; i++) await castOnce(C, list);
    eq('这次生成了多份', list.length, 5);
    eq('每份都有兜底寿命', list[0].ttl, 4);
    // 逐帧推进 4.2 秒后，全部到点回收（模拟宿主过滤块）
    SE.stepFx(list, 4.2);
    const dropped = list.filter(q => q.ttl > 0 && (q.age || 0) > q.ttl);
    dropped.forEach(q => { if (q.inst) q.inst.kill(); });
    const kept = list.filter(q => dropped.indexOf(q) < 0);
    eq('到点后剩下的份数', kept.length, 0);
    eq('存活实例清零', live.size, 0);
  }

  resetLive();
  console.log('\n4) 显式「存在时长」优先于印记时长');
  {
    const C = skill({ life: 2 });
    const list = [];
    await castOnce(C, list);
    eq('寿命', list[0].ttl, 2);
    eq('不再挂印记跟随', list[0].markFx, true);   // 印记仍在，可提前回收，但不会活过 2 秒
  }

  resetLive();
  console.log('\n5) 挂在施法者身上的循环特效保持原行为（不套兜底寿命）');
  {
    const C = SM.compile({
      id: 't3', graph: {
        nodes: [
          { id: 'src', type: 'source', params: {} },
          { id: 'f1', type: 'fx', params: { triggerEvent: 'onCast', effect: 'holy/heal-aoe', attach: 'caster', loop: true } }
        ],
        edges: [{ from: 'src', to: 'f1' }]
      }
    });
    const list = [];
    for (let i = 0; i < 3; i++) await castOnce(C, list);
    eq('同目标同类特效只留一份', list.length, 1);
    eq('没有兜底寿命', list[0].ttl, 0);
  }

  console.log(fail ? '\nFAILED ' + fail + ' 项' : '\n全部通过');
  process.exit(fail ? 1 : 0);
})();
