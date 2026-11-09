/* -------------------------------------------------------------
   投射物数值参数 × 运动器绑定 回归测试
   （node tools/test_proj_params_under_motion.js）
   -------------------------------------------------------------
   背景：此前运动器一旦绑定投射物，就整块跳过投射物自己的 advance 逻辑，
        导致「飞行速度 / 加速度 / 最大飞行距离 / 撞墙反弹次数 / 追踪强度」
        配了完全没有反应。
   契约：
     1) 运动器绑定投射物时只交「方向」（_motionDir/_motionSpd/_motionOrbit），
        不再自己积分坐标
     2) 位移、撞墙反弹、飞行距离累计由投射物引擎（SE.advance）统一结算
     3) 环绕类轨迹的环绕线速度 = 投射物「飞行速度」，为 0 才回退 位移距离÷持续
     4) 加速度 / 最大飞行距离 / 撞墙反弹次数 / 追踪强度 在绑定后依然生效
     5) 运动器到期后清空交接字段，投射物按自己的速度继续飞
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
const dt = 1 / 60, W = 900, H = 700;

/* ---------- 1. 模块文案 ---------- */
console.log('1) 模块文案把「绑定后仍按投射物数值结算」说清楚');
const projDesc = SM.MODULES.projectile.desc || '';
const speedHint = (SM.MODULES.projectile.fields.find(f => f.key === 'speed') || {}).hint || '';
const accelHint = (SM.MODULES.projectile.fields.find(f => f.key === 'accel') || {}).hint || '';
const rangeHint = (SM.MODULES.projectile.fields.find(f => f.key === 'range') || {}).hint || '';
const bounceHint = (SM.MODULES.motion.fields.find(f => f.key === 'wallBounce') || {}).hint || '';
const motionDesc = SM.MODULES.motion.desc || '';
const scopeHint = (SM.MODULES.motion.fields.find(f => f.key === 'scope') || {}).hint || '';
ok('投射物模块说明：绑定后参数仍照常结算', /运动器.*方向/.test(projDesc) && /依然/.test(projDesc));
ok('飞行速度说明：环绕线速度由它决定', /环绕线速度/.test(speedHint));
ok('加速度说明：绑定后同样生效', /被运动器接管时同样生效/.test(accelHint));
ok('最大飞行距离说明：按实际轨迹累计', /实际飞行轨迹累计/.test(rangeHint));
ok('撞墙反弹说明：指向运动器「触墙后行为」', /触墙后行为/.test(bounceHint) && /反弹/.test(bounceHint));
ok('运动器说明：只提供方向', /只提供方向/.test(motionDesc));
ok('作用目标说明：只接管飞行方向', /只接管它的飞行方向/.test(scopeHint));

/* ---------- 2. 运动器只交方向 ---------- */
console.log('\n2) 运动器不再自己积分坐标');
function mkShot(x, y, params) {
  const p = Object.assign({
    speed: 300, size: 8, lifetime: 0, accel: 0, range: 0, wallBounce: 0,
    pierce: 0, homing: 0, gravity: 0, count: 1, spread: 0, spawnOffset: 100
  }, params || {});
  return {
    side: 'player', x: x, y: y, vx: 0, vy: 0, r: p.size, age: 0, traveled: 0, bounces: 0,
    pierceLeft: p.pierce || 0, spin: 0, rot: 0, dead: false, hitIds: {}, trail: null,
    params: p
  };
}
function mkCtx(origin, opp) {
  const movers = [];
  return {
    movers: movers,
    spawn: function (shot, cfg) {
      shot._motionBound = true;
      M.spawn(movers, Object.assign({
        track: 'orbitSelf', dirFrom: 'fixed', angle: 90, ease: 'linear', arcDeg: 60,
        distance: 120, duration: 0.35, orbitTime: 0, scope: 'self', _integrate: true
      }, cfg || {}), {
        self: shot, opponent: opp, pair: [shot, opp], origin: origin, w: W, h: H, now: 0,
        targetOf: function () { return opp; },
        onEnd: function () { shot._motionBound = false; }
      });
      return movers;
    }
  };
}
function mkScene(params, cfg, opt) {
  opt = opt || {};
  const origin = opt.origin || { x: 450, y: 350, r: 16, side: 'player', vx: 0, vy: 0, hp: 100, dead: false };
  const opp = opt.opp || { id: 'e1', x: 450, y: 620, r: 16, side: 'enemy', hp: 100, dead: false };
  const shot = mkShot(opt.x == null ? 550 : opt.x, opt.y == null ? 350 : opt.y, params);
  const c = mkCtx(origin, opp);
  c.spawn(shot, cfg);
  return { origin: origin, targets: opt.targets || [opp], shots: [shot], movers: c.movers, q: shot };
}
function step(sc, frames, opt) {
  opt = opt || {};
  const userWall = opt.onWall;
  const ctx = {
    w: W, h: H, targets: sc.targets,
    onHit: opt.onHit || function () { },
    onWall: function (q, ct) {
      // 与对局 game.js / 试放 admin.js 一致：绑定弹撞墙即交还控制权
      if (q._motionBound && sc.movers.length) M.noticeWall(sc.movers, q, { now: 0, w: W, h: H }, true);
      if (userWall) userWall(q, ct);
    },
    onExpire: opt.onExpire || function () { }
  };
  for (let i = 0; i < frames; i++) {
    if (sc.shots.length) SE.advance(sc.shots, dt, ctx);
    if (sc.movers.length) M.step(sc.movers, dt, { w: W, h: H, now: i * dt, integrate: false, targetOf: () => sc.targets[0] });
  }
  return sc;
}
{
  const sc = mkScene({ speed: 300 });
  const x0 = sc.q.x, y0 = sc.q.y;
  M.step(sc.movers, dt, { w: W, h: H, now: 0, integrate: false, targetOf: () => sc.targets[0] });
  ok('单跑 M.step 不移动投射物（引擎不再自己积分）',
    Math.hypot(sc.q.x - x0, sc.q.y - y0) < 1e-9);
  ok('交接了方向 / 建议速度 / 环绕标记',
    sc.q._motionDir != null && sc.q._motionSpd > 0 && sc.q._motionOrbit === true,
    'dir=' + (sc.q._motionDir || 0).toFixed(2) + ' spd=' + (sc.q._motionSpd || 0).toFixed(1));
}

/* ---------- 3. 飞行速度 ---------- */
console.log('\n3) 飞行速度：环绕线速度由它决定');
function orbitRun(speed, seconds, extra) {
  const sc = mkScene(Object.assign({ speed: speed }, extra || {}));
  step(sc, Math.round(seconds * 60));
  return sc;
}
{
  const s200 = orbitRun(200, 2), s400 = orbitRun(400, 2);
  ok('速度 200 → 2 秒飞行距离≈400', Math.abs(s200.q.traveled - 400) < 15, 'traveled=' + s200.q.traveled.toFixed(0));
  ok('速度 400 → 2 秒飞行距离≈800（翻倍）', Math.abs(s400.q.traveled - 800) < 25, 'traveled=' + s400.q.traveled.toFixed(0));
  ok('速度翻倍后飞行距离同步翻倍', s400.q.traveled / Math.max(1, s200.q.traveled) > 1.9);
}
{
  // 速度 0 = 不自行飞行，回退到运动器的 位移距离 ÷ 持续（120/0.35 ≈ 342.9）
  const sc = mkScene({ speed: 0 });
  step(sc, 120);
  const perSec = sc.q.traveled / 2;
  ok('速度 0 回退到 位移距离÷持续（≈342.9px/s）', Math.abs(perSec - 120 / 0.35) < 8, 'v=' + perSec.toFixed(1));
  ok('速度 0 仍在环绕（不是站着不动）', Math.hypot(sc.q.x - sc.origin.x, sc.q.y - sc.origin.y) > 50);
}

/* ---------- 4. 加速度 ---------- */
console.log('\n4) 加速度');
{
  const a0 = orbitRun(300, 2, { accel: 0 });
  const a1 = orbitRun(300, 2, { accel: 300 });
  ok('加速度 0：2 秒≈600', Math.abs(a0.q.traveled - 600) < 15, 'traveled=' + a0.q.traveled.toFixed(0));
  ok('加速度 300：越转越快（明显大于匀速）', a1.q.traveled > a0.q.traveled * 1.5, 'traveled=' + a1.q.traveled.toFixed(0));
}

/* ---------- 5. 最大飞行距离 ---------- */
console.log('\n5) 最大飞行距离');
{
  let expired = 0;
  const sc = mkScene({ speed: 300, range: 200 });
  step(sc, 180, { onExpire: () => expired++ });
  ok('range=200：按飞行距离回收', sc.shots.length === 0 && sc.q.traveled <= 210,
    'len=' + sc.shots.length + ' traveled=' + sc.q.traveled.toFixed(0));
  ok('range 回收时触发 onExpire', expired === 1, 'n=' + expired);
}
{
  const sc = mkScene({ speed: 300, range: 0 });
  step(sc, 180);
  ok('range=0：不按距离回收', sc.shots.length === 1, 'len=' + sc.shots.length);
}

/* ---------- 6. 撞墙处理（是否消失 / 反弹次数） ---------- */
console.log('\n6) 撞墙处理：是否消失 / 反弹次数');
function wallScene(bounce, dieOnWall) {
  // 从 (800,300) 向右 400px/s 直线飞：第一个撞墙点在 x≈892，撞完运动器交还控制权后继续往左飞
  // 撞墙处理已归运动器：策略通过运动器 cfg 下发，绑定时写到弹体上
  const sc = mkScene({ speed: 400 },
    {
      track: 'line', dirFrom: 'fixed', angle: 0, arcDeg: 0, distance: 400, duration: 1,
      dieOnWall: dieOnWall !== false, wallBounce: bounce
    },
    { x: 800, y: 300 });
  sc.targets = [{ id: 'e1', x: 100, y: 640, r: 16, side: 'enemy', hp: 100, dead: false }];
  return sc;
}
{
  let walls = 0;
  const b0 = wallScene(0);   // dieOnWall 缺省 = 勾选
  step(b0, 90, { onWall: () => walls++ });
  ok('dieOnWall 缺省：撞墙一次即消失', b0.shots.length === 0 && b0.q.bounces === 1, 'bounces=' + b0.q.bounces);
  ok('撞墙回调被触发', walls === 1, 'onWall=' + walls);
}
{
  const b2 = wallScene(2, false);
  step(b2, 90);
  ok('撞墙不消失 + 反弹 2 次：撞一次后仍存活（额度未用尽）', b2.shots.length === 1 && b2.q.bounces === 1,
    'len=' + b2.shots.length + ' bounces=' + b2.q.bounces);
  ok('撞墙时运动器已交还控制权', b2.movers.length === 0 && b2.q._motionBound === false, 'len=' + b2.movers.length);
}
{
  const b6 = wallScene(6, false);
  step(b6, 90);
  ok('撞墙不消失 + 反弹 6 次：同样只弹 1 次，未被误判消失', b6.shots.length === 1 && b6.q.bounces === 1, 'bounces=' + b6.q.bounces);
}
{
  const bInf = wallScene(0, false);
  step(bInf, 240);
  ok('撞墙不消失 + 反弹 0 次：无限反弹，4 秒后仍存活', bInf.shots.length === 1 && bInf.q.bounces >= 2,
    'bounces=' + bInf.q.bounces);
}

/* ---------- 7. 追踪强度 ---------- */
console.log('\n7) 追踪强度');
{
  function homingRun(h) {
    const sc = mkScene({ speed: 300, homing: h }, { track: 'line', dirFrom: 'fixed', angle: 0, arcDeg: 0, distance: 300, duration: 1 }, { x: 200, y: 200 });
    sc.targets = [{ id: 'e1', x: 700, y: 600, r: 16, side: 'enemy', hp: 100, dead: false }];
    step(sc, 72);
    return sc;
  }
  const h0 = homingRun(0), h1 = homingRun(1);
  const delta = Math.hypot(h1.q.x - h0.q.x, h1.q.y - h0.q.y);
  ok('homing=0：沿直线不偏转', Math.abs(h0.q.y - 200) < 2, 'y=' + h0.q.y.toFixed(0));
  ok('homing=1：方向被拉向敌人（落点明显偏移）', delta > 20, 'Δ=' + delta.toFixed(0));
}

/* ---------- 8. 半径 / 穿透 / 数量 ---------- */
console.log('\n8) 半径 / 穿透 / 数量');
{
  // 半径决定命中判定：目标偏离 22px，半径 9 打不中，半径 30 打得中
  function radiusHit(size) {
    let hits = 0;
    const sc = mkScene({ speed: 300, size: size }, { track: 'line', dirFrom: 'fixed', angle: 0, arcDeg: 0, distance: 200, duration: 1 }, { x: 200, y: 300 });
    sc.targets = [{ id: 'e1', x: 400, y: 322, r: 2, side: 'enemy', hp: 100, dead: false }];
    step(sc, 60, { onHit: () => hits++ });
    return hits;
  }
  ok('半径 9：偏离 22px 不命中', radiusHit(9) === 0);
  ok('半径 30：同样偏离仍命中', radiusHit(30) === 1);
}
{
  // 穿透：命中 2 个目标后仍在（pierce=1 只放行 1 次额外命中）
  function pierceRun(pierce) {
    let hits = 0;
    const sc = mkScene({ speed: 300, pierce: pierce, size: 10 }, { track: 'line', dirFrom: 'fixed', angle: 0, arcDeg: 0, distance: 320, duration: 1 }, { x: 200, y: 300 });
    sc.targets = [
      { id: 'e1', x: 300, y: 300, r: 10, side: 'enemy', hp: 100, dead: false },
      { id: 'e2', x: 400, y: 300, r: 10, side: 'enemy', hp: 100, dead: false }
    ];
    step(sc, 60, { onHit: () => hits++ });
    return { hits: hits, alive: sc.shots.length };
  }
  const p0 = pierceRun(0), p1 = pierceRun(1);
  ok('pierce=0：命中第一个目标即消失', p0.hits === 1 && p0.alive === 0, 'hits=' + p0.hits + ' alive=' + p0.alive);
  ok('pierce=1：多打穿一个目标', p1.hits === 2 && p1.alive === 0, 'hits=' + p1.hits + ' alive=' + p1.alive);
}
{
  // 数量：3 颗弹幕各自绑定运动器，都绕着施法者转
  const origin = { x: 450, y: 350, r: 16, side: 'player', vx: 0, vy: 0, hp: 100, dead: false };
  const opp = { id: 'e1', x: 450, y: 620, r: 16, side: 'enemy', hp: 100, dead: false };
  const C = { name: 't', projectile: { count: 3, spread: 90, speed: 300, size: 8, lifetime: 0, spawnOffset: 80 } };
  const shots = SE.spawnProjectiles(C, origin, opp, 0);
  const movers = [];
  shots.forEach(q => {
    q._motionBound = true;
    M.spawn(movers, { track: 'orbitSelf', dirFrom: 'fixed', angle: 90, ease: 'linear', arcDeg: 60, distance: 120, duration: 0.35, orbitTime: 0, scope: 'self', _integrate: true },
      { self: q, opponent: opp, pair: [q, opp], origin: origin, w: W, h: H, now: 0, targetOf: function () { return opp; }, onEnd: function () { q._motionBound = false; } });
  });
  for (let i = 0; i < 60; i++) {
    SE.advance(shots, dt, { w: W, h: H, targets: [opp] });
    M.step(movers, dt, { w: W, h: H, now: i * dt, integrate: false, targetOf: () => opp });
  }
  const rs = shots.map(q => Math.hypot(q.x - origin.x, q.y - origin.y));
  const okAll = shots.length === 3 && rs.every(r => r > 55 && r < 130);
  ok('数量 3：三颗都存活且都在绕（半径 55~130）', okAll, 'r=' + rs.map(r => r.toFixed(0)).join('/'));
}

/* ---------- 9. 运动器到期后恢复自身飞行 ---------- */
console.log('\n9) 运动器到期：清空交接字段，投射物继续飞');
{
  const sc = mkScene({ speed: 250 }, { orbitTime: 1 });
  step(sc, 90);   // 1.5s：1s 时运动器已到期
  ok('运动器到期后已解绑', sc.movers.length === 0 && sc.q._motionBound === false, 'len=' + sc.movers.length);
  ok('交接字段被清空', sc.q._motionDir == null && !sc.q._motionSpd && !sc.q._motionOrbit);
  const t0 = sc.q.traveled;
  step(sc, 30);
  ok('解绑后按自身速度继续飞（0.5 秒≈125）', Math.abs((sc.q.traveled - t0) - 125) < 20,
    'Δ=' + (sc.q.traveled - t0).toFixed(0));
}

console.log('\n结果: 通过 ' + pass + '，失败 ' + fail);
process.exit(fail ? 1 : 0);
