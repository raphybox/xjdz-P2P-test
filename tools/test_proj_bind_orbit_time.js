/* -------------------------------------------------------------
   投射物「绑定施法者」+ 运动器「环绕时间」回归测试
   （node tools/test_proj_bind_orbit_time.js）
   -------------------------------------------------------------
   契约：
     1) 投射物模块新增 绑定施法者单位(bindCaster) / 跟随施法者移动(followCaster)
     2) 绑定 = 施法者死亡时弹体一并消失；跟随 = 逐帧按施法者位移差整体平移
     3) 运动器新增 环绕时间(orbitTime)，0 = 无限，仅环绕类轨迹生效
     4) 环绕全程匀速（不再被 duration / 速度曲线截断），其它轨迹行为不变
     5) 跟随开启时运动器不再叠加速度，避免位移翻倍
   ------------------------------------------------------------- */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name + (extra ? '  (' + extra + ')' : '')); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  (' + extra + ')' : '')); }
}
function load(file) {
  const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const ctx = { window: {}, console, Math, Object, Number, String, Array, JSON, isFinite };
  vm.createContext(ctx); vm.runInContext(code, ctx);
  return ctx.window;
}
const SE = load('skill-effects.js').SkillEffects;
const M = load('motion-engine.js').MotionEngine;
const SM = require('../skill-modules.js');
const dt = 1 / 60;

/* ---------- 1. 模块字段 ---------- */
console.log('1) 模块字段 / 默认值 / 分区');
const projFields = SM.MODULES.projectile.fields;
const bindF = projFields.find(f => f.key === 'bindCaster');
const followF = projFields.find(f => f.key === 'followCaster');
const speedF = projFields.find(f => f.key === 'speed');
const lifeF = projFields.find(f => f.key === 'lifetime');
const offF = projFields.find(f => f.key === 'spawnOffset');
ok('投射物含「绑定施法者单位」', !!bindF && bindF.label === '绑定施法者单位');
ok('绑定施法者默认关闭', !!bindF && bindF.def === false);
ok('投射物含「跟随施法者移动」', !!followF && followF.label === '跟随施法者移动');
ok('跟随施法者默认开启', !!followF && followF.def === true);
ok('绑定 / 跟随紧跟在「出生点偏移」之后',
  projFields.indexOf(bindF) === projFields.indexOf(offF) + 1 &&
  projFields.indexOf(followF) === projFields.indexOf(bindF) + 1,
  'offset=' + projFields.indexOf(offF) + ' bind=' + projFields.indexOf(bindF) + ' follow=' + projFields.indexOf(followF));
ok('飞行速度下限放宽到 0（可做贴身浮游弹）', speedF.min === 0 && /0 = 不自行飞行/.test(speedF.hint || ''));
ok('存活时间 0 = 不自动消失', lifeF.min === 0 && /0 = 不自动消失/.test(lifeF.hint || ''));

const motFields = SM.MODULES.motion.fields;
const orbF = motFields.find(f => f.key === 'orbitTime');
const durF = motFields.find(f => f.key === 'duration');
ok('运动器含「环绕时间(秒)」', !!orbF && orbF.label === '环绕时间(秒)');
ok('环绕时间默认 0（无限）', !!orbF && orbF.def === 0 && orbF.min === 0);
ok('环绕时间上限 >= 20', !!orbF && orbF.max >= 20);
ok('环绕时间归入「速度与节奏」分区', !!orbF && orbF.section === '速度与节奏', orbF && orbF.section);
ok('环绕时间说明写明 0 = 无限 + 匀速', /0 = 无限/.test(orbF.hint || '') && /匀速/.test(orbF.hint || ''));
ok('持续(秒) 说明区分环绕只折算速度', /环绕/.test(durF.hint || ''));
ok('运动器模块描述提到环绕时间', /环绕时间/.test(SM.MODULES.motion.desc || ''));

/* ---------- 2. compile 透传 ---------- */
console.log('\n2) compile 透传');
{
  const nodes = [
    SM.node('projectile', 200, 120, { count: 1, bindCaster: true, followCaster: false, lifetime: 0, speed: 0 }),
    SM.node('motion', 40, 60, { triggerEvent: 'onCast', track: 'orbitSelf', scope: 'projectile', orbitTime: 0, distance: 100, duration: 3 })
  ];
  const C = SM.compile({ name: '绑定+环绕', mods: {}, charge: 3, graph: SM.makeGraph(nodes, []) });
  const P = C.projectile || {};
  ok('compile 透传 bindCaster', P.bindCaster === true, String(P.bindCaster));
  ok('compile 透传 followCaster', P.followCaster === false, String(P.followCaster));
  ok('compile 透传 lifetime=0', Number(P.lifetime) === 0, String(P.lifetime));
  const ms = (C.events.onCast && C.events.onCast.motion) || [];
  ok('compile 透传 orbitTime', ms.length === 1 && Number(ms[0].orbitTime) === 0, ms[0] && String(ms[0].orbitTime));
}

/* ---------- 3. 绑定 / 跟随 / 死亡联动 ---------- */
console.log('\n3) 绑定施法者 / 跟随移动 / 死亡联动');
function mkCaster(x, y) { return { x: x == null ? 100 : x, y: y == null ? 100 : y, r: 16, side: 'player', vx: 0, vy: 0, hp: 100 }; }
function mkTarget() { return { x: 900, y: 100, r: 16, side: 'enemy', hp: 100 }; }
function mkC(extra) {
  return { projectile: Object.assign({ count: 1, spread: 0, speed: 0, size: 8, lifetime: 4, spawnOffset: 0 }, extra || {}) };
}
const WORLD = { w: 4000, h: 4000, targets: [] };

{
  const caster = mkCaster(), shots = SE.spawnProjectiles(mkC(), caster, mkTarget(), 0);
  ok('未勾选绑定时不带 _bindCaster', !shots[0]._bindCaster && shots[0]._casterRef == null);
}
{
  const caster = mkCaster(), shots = SE.spawnProjectiles(mkC({ bindCaster: true }), caster, mkTarget(), 0);
  const q = shots[0];
  ok('勾选后记录 _bindCaster / _followCaster / _casterRef',
    q._bindCaster === true && q._followCaster === true && q._casterRef === caster);
  ok('记录出生瞬间的施法者坐标', q._casterPX === 100 && q._casterPY === 100);
}
{
  const caster = mkCaster(), shots = SE.spawnProjectiles(mkC({ bindCaster: true, followCaster: true }), caster, mkTarget(), 0);
  const q = shots[0], x0 = q.x, y0 = q.y;
  for (let i = 0; i < 10; i++) { caster.x += 5; caster.y += 2; SE.advance(shots, dt, WORLD); }
  ok('跟随开启：施法者位移 (+50,+20) 弹体原样平移',
    Math.abs(q.x - (x0 + 50)) < 1e-6 && Math.abs(q.y - (y0 + 20)) < 1e-6,
    'dx=' + (q.x - x0).toFixed(2) + ' dy=' + (q.y - y0).toFixed(2));
}
{
  const caster = mkCaster(), shots = SE.spawnProjectiles(mkC({ bindCaster: true, followCaster: false }), caster, mkTarget(), 0);
  const q = shots[0], x0 = q.x, y0 = q.y;
  for (let i = 0; i < 10; i++) { caster.x += 5; caster.y += 2; SE.advance(shots, dt, WORLD); }
  ok('跟随关闭：施法者移动不影响弹体', q.x === x0 && q.y === y0, 'dx=' + (q.x - x0) + ' dy=' + (q.y - y0));
}
{
  const caster = mkCaster(), shots = SE.spawnProjectiles(mkC({ bindCaster: true, followCaster: false }), caster, mkTarget(), 0);
  caster.hp = 0;
  let ended = 0;
  SE.advance(shots, dt, { w: 4000, h: 4000, targets: [], onExpire: () => ended++ });
  ok('施法者死亡：绑定弹体一并消失', shots.length === 0 && ended === 1);
}
{
  // 多发间隔：还没轮到发射的弹也要跟着施法者走
  const caster = mkCaster(), shots = SE.spawnProjectiles(mkC({ bindCaster: true, followCaster: true }), caster, mkTarget(), 0);
  const q = shots[0]; q.gap = 0.3;
  const x0 = q.x;
  caster.x += 40;
  SE.advance(shots, dt, WORLD);
  ok('多发间隔（gap）期间仍然跟随', Math.abs(q.x - (x0 + 40)) < 1e-6, 'dx=' + (q.x - x0).toFixed(2));
}
{
  // 存活时间 0 = 不自动消失
  const caster = mkCaster(), shots = SE.spawnProjectiles(mkC({ lifetime: 0, speed: 0 }), caster, mkTarget(), 0);
  for (let i = 0; i < 60 * 12; i++) SE.advance(shots, dt, WORLD);
  ok('存活时间 0：跑 12 秒仍不消失', shots.length === 1, 'len=' + shots.length);
}
{
  const caster = mkCaster(), shots = SE.spawnProjectiles(mkC({ lifetime: 1, speed: 0 }), caster, mkTarget(), 0);
  for (let i = 0; i < 60 * 2; i++) SE.advance(shots, dt, WORLD);
  ok('存活时间 1：2 秒后正常到期', shots.length === 0);
}

/* ---------- 4. 环绕时间 ---------- */
console.log('\n4) 环绕时间：0=无限 / 有限到期 / 匀速');
/* 新版契约：运动器只交「方向」，位移由投射物引擎（SE.advance）积分，
   所以这里每帧都按对局顺序跑：advance → M.step。 */
function mkShot(x, y, params, rt) {
  return Object.assign({
    side: 'player', x: x, y: y, vx: 0, vy: 0, r: 8, age: 0, traveled: 0, bounces: 0,
    pierceLeft: 0, spin: 0, rot: 0, dead: false, hitIds: {}, trail: null,
    params: Object.assign({ speed: 0, size: 8, lifetime: 0, accel: 0, range: 0, wallBounce: 0, homing: 0, gravity: 0 }, params || {})
  }, rt || {});
}
function orbitScene(orbitTime, track, params, rt) {
  const origin = { x: 300, y: 300, r: 16, side: 'player', vx: 0, vy: 0 };
  const opp = { x: 300, y: 620, r: 16, side: 'enemy', vx: 0, vy: 0 };
  const proj = mkShot(400, 300, params, rt);
  proj._motionBound = true;
  const movers = M.spawn([], {
    track: track || 'orbitSelf', dirFrom: 'fixed', angle: 90, ease: 'easeIn', arcDeg: 60,
    distance: 160, duration: 3, orbitTime: orbitTime, scope: 'self', _integrate: true
  }, {
    self: proj, opponent: opp, pair: [proj, opp], origin: origin, w: 900, h: 700, now: 0,
    onEnd: function () { proj._motionBound = false; }
  });
  // 先空推一帧拿到初始方向，避免首帧还在用发射速度（对局里也是绑定后下一帧才接管）
  M.step(movers, 1e-6, { w: 900, h: 700, now: 0, integrate: false, targetOf: () => opp });
  return { origin: origin, opp: opp, proj: proj, movers: movers, shots: [proj] };
}
function runScene(sc, seconds, stopAt) {
  const frames = Math.round(seconds * 60);
  let prev = null, turns = 0, rs = [], speeds = [], lx = sc.proj.x, ly = sc.proj.y;
  let aliveAt = null;
  for (let i = 0; i < frames; i++) {
    if (sc.shots.length) {
      SE.advance(sc.shots, dt, { w: 900, h: 700, targets: [sc.opp], onHit: function () { }, onWall: function () { }, onExpire: function () { } });
      if (!sc.shots.length) { sc.proj = sc.shots[0] || sc.proj; }
    }
    M.step(sc.movers, dt, { w: 900, h: 700, now: i * dt, integrate: false, targetOf: () => sc.opp });
    // 只统计「环绕期间」的转角 / 速度：运动器到期后的直线惯性不算环绕
    if (sc.movers.length) {
      const dx = sc.proj.x - sc.origin.x, dy = sc.proj.y - sc.origin.y;
      rs.push(Math.hypot(dx, dy));
      const a = Math.atan2(dy, dx);
      if (prev != null) { let d = a - prev; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; turns += d; }
      prev = a;
      speeds.push(Math.hypot(sc.proj.x - lx, sc.proj.y - ly) / dt);
      lx = sc.proj.x; ly = sc.proj.y;
    }
    if (stopAt != null && Math.abs(i * dt - stopAt) < dt / 2) aliveAt = sc.movers.length;
  }
  return { turns: turns, rs: rs, speeds: speeds, alive: sc.movers.length, aliveAt: aliveAt };
}
{
  const sc = orbitScene(0), out = runScene(sc, 8);
  ok('orbitTime=0：跑 8 秒运动器仍在（无限环绕）', out.alive > 0, 'len=' + out.alive);
  const minR = Math.min.apply(null, out.rs), maxR = Math.max.apply(null, out.rs);
  ok('无限环绕半径稳定（98~108）', minR >= 98 && maxR <= 108, 'r=' + minR.toFixed(1) + '~' + maxR.toFixed(1));
  ok('无限环绕持续转圈（|Δθ| >= 3.5rad）', Math.abs(out.turns) >= 3.5, 'Δθ=' + out.turns.toFixed(2));
}
{
  const sc = orbitScene(2), out = runScene(sc, 4, 1.9);
  ok('orbitTime=2：到点交还控制权', out.alive === 0 && out.aliveAt === 1, 'len=' + out.alive + ' @1.9s=' + out.aliveAt);
  ok('有限环绕转角对应 2 秒（0.8~1.3rad）', Math.abs(out.turns) >= 0.8 && Math.abs(out.turns) <= 1.3, 'Δθ=' + out.turns.toFixed(2));
}
{
  // easeIn 也不该越绕越慢：全程匀速 160/3 ≈ 53.3px/s
  const sc = orbitScene(0), out = runScene(sc, 6);
  const tail = out.speeds.slice(120).filter(function (v, i) { return i % 30 === 0; });
  const minV = Math.min.apply(null, tail), maxV = Math.max.apply(null, tail);
  ok('环绕全程匀速（53.3±6px/s）', Math.abs(minV - 160 / 3) <= 6 && Math.abs(maxV - 160 / 3) <= 6,
    'v=' + minV.toFixed(1) + '~' + maxV.toFixed(1));
}
{
  // 圆心会跑：跟随开启 → 弹幕被整体带着走，半径稳定；跟随关闭 → 留在世界坐标，半径被拉大
  function runMoving(follow) {
    const origin = { x: 300, y: 300, r: 16, side: 'player', vx: 0, vy: 0 };
    const opp = { x: 300, y: 620, r: 16, side: 'enemy', vx: 0, vy: 0 };
    const proj = mkShot(400, 300, { speed: 0 }, {
      _bindCaster: true, _followCaster: follow, _casterRef: origin, _casterPX: 300, _casterPY: 300
    });
    proj._motionBound = true;
    const movers = M.spawn([], {
      track: 'orbitSelf', dirFrom: 'fixed', angle: 90, ease: 'linear', arcDeg: 60,
      distance: 160, duration: 3, orbitTime: 0, scope: 'self', _integrate: true
    }, {
      self: proj, opponent: opp, pair: [proj, opp], origin: origin, w: 900, h: 700, now: 0,
      onEnd: function () { proj._motionBound = false; }
    });
    const shots = [proj];
    M.step(movers, 1e-6, { w: 900, h: 700, now: 0, integrate: false, targetOf: () => opp });
    let minR = 1e9, maxR = 0;
    for (let i = 0; i < 180; i++) {
      origin.x += 120 * dt;
      SE.advance(shots, dt, { w: 900, h: 700, targets: [opp] });
      M.step(movers, dt, { w: 900, h: 700, now: i * dt, integrate: false, targetOf: () => opp });
      const r = Math.hypot(proj.x - origin.x, proj.y - origin.y);
      if (i > 30) { minR = Math.min(minR, r); maxR = Math.max(maxR, r); }
    }
    return { minR: minR, maxR: maxR };
  }
  const on = runMoving(true), off = runMoving(false);
  ok('跟随开启：圆心移动时半径保持稳定（92~118）', on.minR >= 92 && on.maxR <= 118, 'r=' + on.minR.toFixed(1) + '~' + on.maxR.toFixed(1));
  ok('跟随关闭：圆心跑开，半径被拉大（>150）', off.maxR > 150, 'r=' + off.minR.toFixed(1) + '~' + off.maxR.toFixed(1));
}

/* ---------- 5. 其它轨迹无回退 ---------- */
console.log('\n5) 其它轨迹不受影响');
{
  const origin = { x: 300, y: 300, r: 16, side: 'player', vx: 0, vy: 0 };
  const opp = { x: 300, y: 620, r: 16, side: 'enemy', vx: 0, vy: 0 };
  const proj = mkShot(400, 300, { speed: 0 });
  proj._motionBound = true;
  const movers = M.spawn([], {
    track: 'line', dirFrom: 'fixed', angle: 0, ease: 'linear', arcDeg: 0,
    distance: 160, duration: 1, orbitTime: 0, scope: 'self', _integrate: true
  }, {
    self: proj, opponent: opp, pair: [proj, opp], origin: origin, w: 900, h: 700, now: 0,
    onEnd: function () { proj._motionBound = false; }
  });
  const shots = [proj];
  M.step(movers, 1e-6, { w: 900, h: 700, now: 0, integrate: false });
  for (let i = 0; i < 60; i++) {
    SE.advance(shots, dt, { w: 900, h: 700, targets: [opp] });
    M.step(movers, dt, { w: 900, h: 700, now: i * dt, integrate: false });
  }
  ok('直线：位移精确等于 distance（160）', Math.abs((proj.x - 400) - 160) < 3, 'dx=' + (proj.x - 400).toFixed(2));
  ok('直线：duration=1 后到点收尾（orbitTime 不干扰直线）', movers.length === 0, 'len=' + movers.length);
}
{
  const origin = { x: 300, y: 300, r: 16, side: 'player', vx: 0, vy: 0 };
  const opp = { x: 300, y: 620, r: 16, side: 'enemy', vx: 0, vy: 0 };
  const proj = mkShot(300, 500, { speed: 0 });   // 对手正上方 120px
  proj._motionBound = true;
  const movers = M.spawn([], {
    track: 'orbit', dirFrom: 'fixed', angle: 0, ease: 'linear', arcDeg: 60,
    distance: 160, duration: 3, orbitTime: 0, scope: 'self', _integrate: true
  }, {
    self: proj, opponent: opp, pair: [proj, opp], origin: origin, w: 900, h: 700, now: 0,
    onEnd: function () { proj._motionBound = false; }
  });
  const shots = [proj];
  M.step(movers, 1e-6, { w: 900, h: 700, now: 0, integrate: false, targetOf: () => opp });
  let rs = [];
  for (let i = 0; i < 240; i++) {
    SE.advance(shots, dt, { w: 900, h: 700, targets: [opp] });
    M.step(movers, dt, { w: 900, h: 700, now: i * dt, integrate: false, targetOf: () => opp });
    rs.push(Math.hypot(proj.x - opp.x, proj.y - opp.y));
  }
  const minR = Math.min.apply(null, rs), maxR = Math.max.apply(null, rs);
  ok('环绕对手：orbitTime=0 也无限环绕且半径稳定（115~132）',
    movers.length === 1 && minR >= 115 && maxR <= 132, 'len=' + movers.length + ' r=' + minR.toFixed(1) + '~' + maxR.toFixed(1));
}

console.log('\n结果: 通过 ' + pass + '，失败 ' + fail);
process.exit(fail ? 1 : 0);
