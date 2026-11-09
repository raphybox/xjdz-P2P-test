/* 回归：对局 / 每回合开始所有技能「未充能」，只有触发时机=回合开始 才允许在开局释放
   node tools/test_skill_charge_start.js
   1) 从 game.js 抽真实的 initSkillCasters 在 vm 里跑，验证开局 charge=0
   2) 从 game.js 抽真实的「计时/充能型 source」循环，验证三种触发时机在 charge=0/1 下的释放
   3) 静态断言：事件型触发仍需充满；充能推进公式未变；source 默认触发时机仍是 roundStart
   ------------------------------------------------------------------------------ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = (typeof got === 'number' && typeof want === 'number')
    ? Math.abs(got - want) < 1e-9
    : JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ok  ', name, '=', JSON.stringify(got)); }
  else { fail++; console.log('  FAIL', name, 'got', JSON.stringify(got), 'want', JSON.stringify(want)); }
}

const g = read('game.js');

/* ---------------- 1. 开局充能状态 ---------------- */
console.log('\n1) 开局充能状态（game.js initSkillCasters）');
const ia = g.indexOf('  function initSkillCasters()');
const ib = g.indexOf('  // 技能充能秒数', ia);
if (ia < 0 || ib <= ia) throw new Error('initSkillCasters 切片失败');
const initSrc = g.slice(ia, ib);
eq('静态：charge 初始为 0', /charge:\s*0\b/.test(initSrc), true);
eq('静态：不再有 charge: 1', /charge:\s*1\b/.test(initSrc), false);

function compiled(trigger) {
  return {
    active: true, charge: 3,
    sources: [{ trigger: trigger, enabled: true, interval: 2.2, maxCasts: 0 }]
  };
}
function initCase(skills) {
  const ctx = {
    SKILL_RT: { SE: {}, SM: {} }, MOTION: null,
    G: {
      player: { hp: 100 }, enemy: { hp: 100 },
      playerSkills: skills, enemySkills: skills,
      clock: 0, movers: []
    },
    console
  };
  vm.createContext(ctx);
  vm.runInContext(initSrc + '\ninitSkillCasters();', ctx);
  return ctx.G;
}
const G1 = initCase([
  { id: 's1', compiled: compiled('onCharge') },
  { id: 's2', compiled: compiled('interval') }
]);
eq('我方两个技能开局都未充能', G1.player._skillCasters.map(c => c.charge), [0, 0]);
eq('对手两个技能开局都未充能', G1.enemy._skillCasters.map(c => c.charge), [0, 0]);
eq('施放器按技能逐个建立', G1.player._skillCasters.length, 2);

/* ---------------- 2. 触发循环的真实行为 ---------------- */
console.log('\n2) 三种触发时机在开局 / 充满后的释放行为（game.js stepSkillRuntime）');
const la = g.indexOf('    // 计时/充能型 source');
const lb = g.indexOf('    // 生命过低触发', la);
if (la < 0 || lb <= la) throw new Error('触发循环切片失败');
const loopSrc = g.slice(la, lb);

function runLoop(charge, triggers, opts) {
  opts = opts || {};
  const casts = [];
  const sources = triggers.map(tr => ({
    src: { trigger: tr, enabled: true, interval: 2.2, maxCasts: opts.maxCasts || 0 },
    at: 0, n: 0, lastEv: -10
  }));
  const caster = { C: { charge: 3 }, charge: charge, sources: sources };
  const ctx = {
    G: { clock: opts.clock || 0, player: { _skillCasters: [caster] }, enemy: { _skillCasters: [] } },
    fireSkillCast: (f, C, src) => casts.push(src.trigger),
    console
  };
  vm.createContext(ctx);
  vm.runInContext(loopSrc, ctx);
  if (opts.repeat) vm.runInContext(loopSrc, ctx);
  return { casts: casts, caster: caster };
}

let r = runLoop(0, ['roundStart', 'interval', 'onCharge', 'onHit']);
eq('开局(未充能)：只有「回合开始」释放一次', r.casts, ['roundStart']);
eq('开局释放后充能仍为 0', r.caster.charge, 0);

r = runLoop(0, ['interval']);
eq('开局：定时循环不释放', r.casts, []);
r = runLoop(0, ['onCharge']);
eq('开局：充能完成时不释放', r.casts, []);
r = runLoop(0, ['onHit']);
eq('开局：事件型触发不进入本循环', r.casts, []);

r = runLoop(1, ['onCharge']);
eq('充满后：充能完成时释放一次', r.casts, ['onCharge']);
eq('释放后充能清零，进入下一轮回充', r.caster.charge, 0);
r = runLoop(1, ['interval']);
eq('充满后：定时循环释放一次', r.casts, ['interval']);
eq('循环间隔已排到 2.2 秒后', r.caster.sources[0].at, 2.2);

r = runLoop(0.4, ['roundStart']);
eq('回合开始不受充能条限制', r.casts, ['roundStart']);

r = runLoop(0, ['roundStart'], { repeat: true });
eq('回合开始每回合只放一次（at 节流）', r.casts, ['roundStart']);
r = runLoop(0, ['roundStart'], { maxCasts: 1, repeat: true });
eq('maxCasts=1 时只放一次', r.casts, ['roundStart']);

r = runLoop(1, ['roundStart', 'onCharge']);
eq('同一技能共用一条充能：回合开始放完后本帧不再放', r.casts, ['roundStart']);

/* ---------------- 3. 链路一致性静态断言 ---------------- */
console.log('\n3) 链路一致性静态断言');
const ta = g.indexOf('  function triggerSkillEvent(');
const tb = g.indexOf('  function fireSkillCast(', ta);
eq('事件型触发仍需充满才响应', /caster\.charge < 1\) return;/.test(g.slice(ta, tb)), true);
eq('触发循环只对 roundStart 豁免充能', /tr !== 'roundStart' && caster\.charge < 1/.test(loopSrc), true);
eq('充能推进仍按各自充能时间回充', /c\.charge = Math\.min\(1, c\.charge \+ dt \/ skillChargeTime/.test(g), true);
eq('HUD 充能条仍读 caster.charge', /casters\[i\]\.charge/.test(g), true);
eq('source 默认触发时机仍是 roundStart', /sel\('trigger', '触发时机', 'roundStart'/.test(read('skill-modules.js')), true);

console.log('\n---------------------------------------------');
console.log('PASS ' + pass + ' / FAIL ' + fail);
if (fail) process.exit(1);
