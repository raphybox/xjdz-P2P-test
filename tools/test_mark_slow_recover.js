/* 回归：印记「每层迟滞」到期恢复 + 像素特效兜底去重（node tools/test_mark_slow_recover.js）
   1) 从 game.js 抽真实的 markSlowMul 在 vm 里跑，验证印记到期后位移倍率回到 1
   2) 加载真实的 skill-effects.js，验证 dedupeFx 在 replaceKey 全部不同时仍能压住叠加
   3) 静态断言：对局与试放都在每帧调用了 dedupeFx，且积分用位移倍率而不是削 vx/vy */
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

/* ---------------- 1. 印记迟滞：到期即恢复 ---------------- */
console.log('\n1) 印记迟滞的位移倍率（game.js markSlowMul）');
const g = read('game.js');
const a = g.indexOf('function markSlowMul('), b = g.indexOf('  // 印记逐帧结算', a);
if (a < 0 || b <= a) throw new Error('markSlowMul 切片失败');
const G = { clock: 0 };
const c1 = { G, console };
vm.createContext(c1);
vm.runInContext(g.slice(a, b) + '\nthis.markSlowMul = markSlowMul;', c1);
const mul = c1.markSlowMul;

const ent = { _markStacks: 1, _markUntil: 5, _markCfg: { slowPct: 0.7 } };
eq('印记有效 · 70% 迟滞 → 倍率 0.3', mul(ent), 0.3);
G.clock = 4.99; eq('到期前一刻仍减速', mul(ent), 0.3);
G.clock = 5; eq('印记到期 → 倍率恢复 1', mul(ent), 1);
G.clock = 0; ent._markStacks = 0; eq('层数清零（被引爆/消耗）→ 恢复 1', mul(ent), 1);
ent._markStacks = 1; ent._markCfg = null; eq('配置快照清空 → 恢复 1', mul(ent), 1);
ent._markCfg = { slowPct: 0.7 }; ent._markStacks = 9; eq('多层迟滞有下限 0.3', mul(ent), 0.3);
eq('没有印记的实体 → 1', mul({ x: 0, y: 0 }), 1);

// 物理位移：用真实那两行公式模拟 1 秒位移，确认减速不改速度向量
const f = { x: 0, y: 0, vx: 100, vy: 0, _markStacks: 1, _markUntil: 5, _markCfg: { slowPct: 0.7 } };
const dt = 1;
f.x += f.vx * dt * mul(f);
eq('减速期间只走 30', f.x, 30);
eq('速度向量未被削（vx 仍是 100）', f.vx, 100);
f._markStacks = 0;
f.x += f.vx * dt * mul(f);
eq('印记消失当帧恢复全速（+100）', f.x, 130);

const stepA = g.indexOf('  function stepMarks('), stepB = g.indexOf('  function scheduleEchoModule(', stepA);
const stepSrc = g.slice(stepA, stepB);
eq('stepMarks 不再写 slowFactor（不会粘滞）', /\bt\.slowFactor\s*=/.test(stepSrc), false);
eq('stepMarks 不再续期 slowUntil', /\bt\.slowUntil\s*=/.test(stepSrc), false);
eq('积分改用位移倍率', /f\.vx \* dt \* markMul/.test(g), true);
eq('对局每帧调用 dedupeFx', /SE\.dedupeFx\(G\.skillFx\)/.test(g), true);
eq('试放每帧调用 dedupeFx', /SE\.dedupeFx\(fxs\)/.test(read('admin.js')), true);

/* ---------------- 2. dedupeFx：覆盖键失效时仍能压住 ---------------- */
console.log('\n2) 每帧兜底去重（skill-effects.js dedupeFx）');
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
const c2 = { window: win, console, Promise, Math, Object, Number, String, Array, isFinite, WeakMap };
vm.createContext(c2);
vm.runInContext(read('skill-effects.js'), c2);
const SE = win.SkillEffects;
eq('dedupeFx 已导出', typeof SE.dedupeFx, 'function');

const host = { side: 'enemy', x: 100, y: 0 };
const other = { side: 'enemy', x: 300, y: 0 };
function fakeQ(effect, nid, h, over) {
  const inst = {
    dead: false,
    kill() { this.dead = true; live.delete(this); },
    done() { return this.dead; },
    update() {}, render() {}
  };
  live.add(inst);
  return Object.assign({
    inst, cfg: { effect, attach: 'enemy', _nid: nid, stackReplace: true },
    follow: h, replaceKey: nid + '#forced-different',
    markLife: true, markFx: false, age: 0, ttl: 5
  }, over || {});
}

// 每次触发的节点 id 都不同 → replaceKey 不同 → pushFx 完全压不住
let list = [];
for (let k = 0; k < 8; k++) SE.pushFx(list, [fakeQ('status/slowed', 'node_' + k, host)]);
eq('pushFx 在 key 不同时确实叠了 8 份', list.length, 8);
SE.dedupeFx(list);
eq('dedupeFx 压到 1 份', list.length, 1);
eq('只剩 1 个存活实例', live.size, 1);
eq('留下的是最后一份', list[0].cfg._nid, 'node_7');

// 不同宿主（多敌人 all）各自保留一份
live.forEach(i => i.kill()); live.clear();
list = [fakeQ('status/slowed', 'n1', host), fakeQ('status/slowed', 'n2', other)];
SE.dedupeFx(list);
eq('不同敌人各留一份', list.length, 2);

// 用户明确关掉「同类特效覆盖」且没有印记绑定 → 尊重开关，允许叠
live.forEach(i => i.kill()); live.clear();
list = [];
for (let k = 0; k < 4; k++) {
  SE.pushFx(list, [fakeQ('status/slowed', 'x' + k, host, {
    cfg: { effect: 'status/slowed', attach: 'enemy', _nid: 'x' + k, stackReplace: false },
    markLife: false
  })]);
}
SE.dedupeFx(list);
eq('关掉覆盖且无印记时允许叠 4 份', list.length, 4);

// 但只要有印记绑定，即便关掉覆盖也强制只留一份
live.forEach(i => i.kill()); live.clear();
list = [];
for (let k = 0; k < 4; k++) {
  SE.pushFx(list, [fakeQ('status/slowed', 'y' + k, host, {
    cfg: { effect: 'status/slowed', attach: 'enemy', _nid: 'y' + k, stackReplace: false },
    markLife: true
  })]);
}
SE.dedupeFx(list);
eq('印记绑定 + 关掉覆盖仍只留 1 份', list.length, 1);

console.log('\n' + (fail ? 'FAILED ' + fail + ' 项' : '全部通过 ' + pass + ' 项'));
process.exit(fail ? 1 : 0);
