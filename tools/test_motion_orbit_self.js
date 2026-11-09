/* -------------------------------------------------------------
   运动器「环绕自身」回归测试（node tools/test_motion_orbit_self.js）
   -------------------------------------------------------------
   契约：
     1) 轨迹枚举与编辑器面板都出现「环绕自身」，顺序紧跟「环绕对手」
     2) 圆心 = 施法者自身弹珠（origin），逐帧跟随；投射物绑定还叠加圆心速度
     3) 轨迹成圈、半径稳定；arcDeg 正负决定顺 / 逆时针
     4) 作用目标=自身弹珠（圆心就是自己）时退化为绕挂载点，不 NaN、不炸
     5) 其它轨迹（直线 / 环绕对手）不受影响；compile 透传 track
   ------------------------------------------------------------- */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name + (extra ? '  (' + extra + ')' : '')); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  (' + extra + ')' : '')); }
}

/* ---------- 载入引擎与模块表 ---------- */
const engCode = fs.readFileSync(path.join(ROOT, 'motion-engine.js'), 'utf8');
const ctxE = { window: {}, console, Math, Object, Number, String, Array, JSON, isFinite };
vm.createContext(ctxE); vm.runInContext(engCode, ctxE);
const M = ctxE.window.MotionEngine;
const SM = require('../skill-modules.js');

/* ---------- 1. 枚举与面板 ---------- */
console.log('1) 枚举 / 编辑器面板');
const trackKeys = M.TRACKS.map(t => t[0]);
ok('TRACKS 含 orbitSelf', trackKeys.indexOf('orbitSelf') >= 0);
ok('TRACKS 顺序：环绕对手 → 环绕自身 → 追踪对手',
  trackKeys.indexOf('orbit') < trackKeys.indexOf('orbitSelf') &&
  trackKeys.indexOf('orbitSelf') < trackKeys.indexOf('homing'), trackKeys.join(','));
ok('TRACKS 文案为「环绕自身」', (M.TRACKS.find(t => t[0] === 'orbitSelf') || [])[1] === '环绕自身');

const trackField = SM.MODULES.motion.fields.find(f => f.key === 'track');
const optKeys = (trackField.options || []).map(o => o[0]);
ok('编辑器面板含 orbitSelf', optKeys.indexOf('orbitSelf') >= 0);
ok('面板文案为「环绕自身」', (trackField.options.find(o => o[0] === 'orbitSelf') || [])[1] === '环绕自身');
ok('轨迹说明提到环绕自身', /环绕自身/.test(trackField.hint || ''));
const arcField = SM.MODULES.motion.fields.find(f => f.key === 'arcDeg');
ok('弯曲角度说明覆盖环绕自身', /环绕自身/.test(arcField.hint || ''));

/* ---------- 2. 轨迹几何 ---------- */
/* 新版契约：「投射物绑定」(_integrate) 的位移由投射物引擎积分；这里走宿主路径
   （引擎只写 ent.vx/vy，宿主自己按 vx/vy 积分），几何断言口径保持不变。 */
function hostMove(ent, dt) { ent.x += (ent.vx || 0) * dt; ent.y += (ent.vy || 0) * dt; }
function makeScene() {
  const origin = { x: 300, y: 300, r: 16, side: 'player', vx: 0, vy: 0 };
  const opp = { x: 300, y: 520, r: 16, side: 'enemy', vx: 0, vy: 0 };
  const proj = { x: 400, y: 300, r: 8, side: 'player', vx: 0, vy: 0 };
  return { origin: origin, opp: opp, proj: proj };
}
function spawnOrbitSelf(scene, arcDeg, track) {
  return M.spawn([], {
    track: track || 'orbitSelf', dirFrom: 'toTarget', ease: 'linear', arcDeg: arcDeg,
    distance: 160, duration: 3, scope: 'self', _integrate: false
  }, {
    self: scene.proj, opponent: scene.opp, pair: [scene.proj, scene.opp],
    origin: scene.origin, w: 900, h: 700, now: 0
  });
}
function run(scene, movers, frames, moveOrigin) {
  const dt = 1 / 60, rs = [];
  let prevAng = null, turns = 0;
  for (let i = 0; i < frames; i++) {
    if (moveOrigin) scene.origin.vx = i > 54 ? 90 : 0;
    scene.origin.x += scene.origin.vx * dt;
    M.step(movers, dt, {
      w: 900, h: 700, now: i * dt, integrate: false,
      // 环绕对手 / 追踪对手 依赖宿主每帧解析对手；环绕自身用挂载时记录的圆心，不依赖它
      targetOf: function () { return scene.opp; }
    });
    hostMove(scene.proj, dt);
    const dx = scene.proj.x - scene.origin.x, dy = scene.proj.y - scene.origin.y;
    if (!isFinite(scene.proj.x) || !isFinite(scene.proj.y)) return { nan: true, rs: [], turns: 0 };
    const ang = Math.atan2(dy, dx);
    if (prevAng != null) {
      let da = ang - prevAng;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      turns += da;
    }
    prevAng = ang;
    rs.push(Math.hypot(dx, dy));
  }
  return { nan: false, rs: rs, turns: turns };
}

console.log('\n2) 环绕自身：成圈 / 半径 / 方向');
{
  const sc = makeScene();
  const out = run(sc, spawnOrbitSelf(sc, 60), 180, false);
  const minR = Math.min.apply(null, out.rs), maxR = Math.max.apply(null, out.rs);
  ok('无 NaN', !out.nan);
  ok('半径稳定在初始距离附近（90~110）', minR >= 90 && maxR <= 110, 'r=' + minR.toFixed(1) + '~' + maxR.toFixed(1));
  ok('累计转角成圈（|Δθ| >= 1.5rad）', Math.abs(out.turns) >= 1.5, 'Δθ=' + out.turns.toFixed(2));
}
{
  const a = makeScene(), b = makeScene();
  const ta = run(a, spawnOrbitSelf(a, 60), 180, false).turns;
  const tb = run(b, spawnOrbitSelf(b, -60), 180, false).turns;
  ok('arcDeg 正负决定顺 / 逆时针', Math.sign(ta) !== Math.sign(tb), '+' + ta.toFixed(2) + ' / ' + tb.toFixed(2));
}

console.log('\n3) 圆心移动：引擎只交方向，跟随由投射物模块负责');
{
  const sc = makeScene();
  const out = run(sc, spawnOrbitSelf(sc, 60), 180, true);
  const minR = Math.min.apply(null, out.rs), maxR = Math.max.apply(null, out.rs);
  // 纯宿主路径不跟随圆心（跟随是投射物「跟随施法者移动」的职责，见 test_proj_bind_orbit_time.js），
  // 所以半径会被拉开；这里只要求它仍在稳定绕行、不会 NaN。
  ok('圆心移动时半径被拉开（>110，宿主自身不跟随）', maxR > 110, 'r=' + minR.toFixed(1) + '~' + maxR.toFixed(1));
  ok('移动中依旧成圈（|Δθ| >= 1.5rad）', Math.abs(out.turns) >= 1.5, 'Δθ=' + out.turns.toFixed(2));
}

console.log('\n4) 退化：作用目标=自身弹珠（圆心就是自己）');
{
  const self = { x: 300, y: 300, r: 16, side: 'player', vx: 0, vy: 0 };
  const opp = { x: 300, y: 520, r: 16, side: 'enemy', vx: 0, vy: 0 };
  const movers = M.spawn([], {
    track: 'orbitSelf', dirFrom: 'toTarget', ease: 'linear', arcDeg: 60,
    distance: 160, duration: 2, scope: 'self', _integrate: false
  }, { self: self, opponent: opp, pair: [self, opp], origin: self, w: 900, h: 700, now: 0 });
  const dt = 1 / 60;
  let bad = false, maxR = 0;
  for (let i = 0; i < 120; i++) {
    M.step(movers, dt, { w: 900, h: 700, now: i * dt, integrate: false });
    hostMove(self, dt);
    if (!isFinite(self.x) || !isFinite(self.y)) { bad = true; break; }
    maxR = Math.max(maxR, Math.hypot(self.x - 300, self.y - 300));
  }
  ok('不产生 NaN / Infinity', !bad);
  ok('退化为绕挂载点的小圈（半径 < 60，不会乱飞）', maxR < 60, 'maxR=' + maxR.toFixed(1));
}

console.log('\n5) 其它轨迹不受影响');
{
  const sc = makeScene();
  const movers = M.spawn([], {
    track: 'line', dirFrom: 'fixed', angle: 0, ease: 'linear', arcDeg: 0,
    distance: 160, duration: 3, scope: 'self', _integrate: false
  }, { self: sc.proj, opponent: sc.opp, pair: [sc.proj, sc.opp], origin: sc.origin, w: 900, h: 700, now: 0 });
  const dt = 1 / 60;
  for (let i = 0; i < 60; i++) { M.step(movers, dt, { w: 900, h: 700, now: i * dt, integrate: false }); hostMove(sc.proj, dt); }
  ok('直线轨迹仍为直线（固定 0°：y 不变、x 前进）',
    Math.abs(sc.proj.y - 300) < 1e-6 && sc.proj.x > 400,
    'x=' + sc.proj.x.toFixed(1) + ' y=' + sc.proj.y.toFixed(1));
}
{
  const sc = makeScene();
  sc.proj.x = 420; sc.proj.y = 520;   // 对手正右 120px，固定 90° = 切向，最干净的环绕初值
  const movers = M.spawn([], {
    track: 'orbit', dirFrom: 'fixed', angle: 90, ease: 'linear', arcDeg: 60,
    distance: 160, duration: 3, scope: 'self', _integrate: false
  }, { self: sc.proj, opponent: sc.opp, pair: [sc.proj, sc.opp], origin: sc.origin, w: 900, h: 700, now: 0 });
  const dt = 1 / 60, rs = [];
  let prev = null, turns = 0;
  for (let i = 0; i < 180; i++) {
    M.step(movers, dt, {
      w: 900, h: 700, now: i * dt, integrate: false,
      targetOf: function () { return sc.opp; }
    });
    hostMove(sc.proj, dt);
    const dx = sc.proj.x - sc.opp.x, dy = sc.proj.y - sc.opp.y;
    rs.push(Math.hypot(dx, dy));
    const a = Math.atan2(dy, dx);
    if (prev != null) {
      let d = a - prev;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      turns += d;
    }
    prev = a;
  }
  const minR = Math.min.apply(null, rs), maxR = Math.max.apply(null, rs);
  ok('环绕对手仍是绕对手（半径围绕 120 稳定，115~130）', minR >= 115 && maxR <= 130,
    'r=' + minR.toFixed(1) + '~' + maxR.toFixed(1));
  ok('环绕对手仍会绕行（|Δθ| >= 1.0rad）', Math.abs(turns) >= 1.0, 'Δθ=' + turns.toFixed(2));
}

console.log('\n6) compile 透传');
{
  const nodes = [SM.node('motion', 40, 60, {
    triggerEvent: 'onCast', track: 'orbitSelf', scope: 'projectile', distance: 100, duration: 2
  })];
  const C = SM.compile({ name: '环绕自身测试', mods: {}, charge: 3, graph: SM.makeGraph(nodes, []) });
  const ms = (C.events.onCast && C.events.onCast.motion) || [];
  ok('motion 节点进入 onCast 组', ms.length === 1);
  ok('track 透传 orbitSelf', ms[0] && ms[0].track === 'orbitSelf', ms[0] && ms[0].track);
}

console.log('\n结果: 通过 ' + pass + '，失败 ' + fail);
process.exit(fail ? 1 : 0);
