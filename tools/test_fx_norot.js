/* 特效「效果不跟随挂载位置旋转」（noRotFollow）回归测试（node tools/test_fx_norot.js）
   直接加载真实的 skill-effects.js / skill-modules.js：
   1) 模块默认值：noRotFollow 默认关
   2) 编译链路：fx 节点的 noRotFollow 原样带进事件组
   3) drawFx 跟随逻辑：勾选后位置仍跟随、角度冻结；不勾选则角度跟着挂载体转 */
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
const win = { PixelFX: { spawn() { return Promise.resolve(makeInst(0.8, false)); } } };
const ctx = { window: win, console, Promise, Math, Object, Number, String, Array, isFinite, WeakMap };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'skill-effects.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'skill-modules.js'), 'utf8'), ctx);
const SE = win.SkillEffects;
const SM = win.SkillModules;
const stubCtx = () => ({
  save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, drawImage() {},
  globalAlpha: 1, globalCompositeOperation: 'source-over', imageSmoothingEnabled: false
});

(async function main() {
  console.log('1) 模块默认值：noRotFollow 默认关');
  {
    const d = SM.defaults('fx');
    eq('noRotFollow 默认', d.noRotFollow, false);
  }

  console.log('\n2) 编译链路：fx 节点的 noRotFollow 原样带进事件组');
  {
    const C = SM.compile({
      id: 'norot', graph: {
        nodes: [
          { id: 'src', type: 'source', params: {} },
          { id: 'f1', type: 'fx', params: { triggerEvent: 'onCast', effect: 'nature/poison-cloud', attach: 'marble', noRotFollow: true } },
          { id: 'f2', type: 'fx', params: { triggerEvent: 'onCast', effect: 'nature/poison-cloud', attach: 'marble' } }
        ], edges: [{ from: 'src', to: 'f1' }, { from: 'src', to: 'f2' }]
      }
    });
    const f1 = C.events.onCast.fx[0];
    const f2 = C.events.onCast.fx[1];
    eq('f1 noRotFollow 编译后', f1.noRotFollow, true);
    eq('f2 未填 → 默认 false', f2.noRotFollow, false);
  }

  console.log('\n3) drawFx 跟随：勾选 noRotFollow → 位置跟、角度冻结；不勾选 → 角度跟着转');
  {
    const follow = { x: 100, y: 200, rot: 90 };
    // 不勾选：angle 应跟着 follow.rot 走（90 → 180）
    const qA = { inst: makeInst(0.8, false), cfg: { loop: true, attach: 'marble' }, x: 0, y: 0, rot: 0, follow: follow };
    const listA = [qA];
    SE.drawFx(stubCtx(), listA, null);
    eq('不勾选：位置跟随', [qA.x, qA.y], [100, 200]);
    eq('不勾选：角度=挂载体朝向 90', qA.rot, 90);
    follow.rot = 180;
    SE.drawFx(stubCtx(), listA, null);
    eq('不勾选：角度继续跟着转 180', qA.rot, 180);

    // 勾选：位置照跟，角度冻结在释放时的 0（不被 follow.rot 覆盖）
    const follow2 = { x: 100, y: 200, rot: 90 };
    const qB = { inst: makeInst(0.8, false), cfg: { loop: true, attach: 'marble', noRotFollow: true }, x: 0, y: 0, rot: 0, follow: follow2 };
    const listB = [qB];
    SE.drawFx(stubCtx(), listB, null);
    eq('勾选：位置仍跟随', [qB.x, qB.y], [100, 200]);
    eq('勾选：角度冻结在释放朝向 0', qB.rot, 0);
    follow2.rot = 180; follow2.x = 300; follow2.y = 400;
    SE.drawFx(stubCtx(), listB, null);
    eq('勾选：位置继续跟随', [qB.x, qB.y], [300, 400]);
    eq('勾选：角度仍冻结为 0', qB.rot, 0);
  }

  console.log('\n4) drawFx 跟随：勾选 noRotFollow 时，弹珠只有 vx/vy 也不再被速度方向覆盖');
  {
    const follow = { x: 10, y: 10, vx: 100, vy: 0 }; // 速度方向 → 0 度；但冻结时不应被改
    const q = { inst: makeInst(0.8, false), cfg: { loop: true, attach: 'marble', noRotFollow: true }, x: 0, y: 0, rot: 45, follow: follow };
    SE.drawFx(stubCtx(), [q], null);
    eq('速度方向不覆盖冻结角度', q.rot, 45);
    eq('位置仍跟随', [q.x, q.y], [10, 10]);
  }

  console.log(fail ? '\nFAILED ' + fail + ' 项' : '\n全部通过');
  process.exit(fail ? 1 : 0);
})();
