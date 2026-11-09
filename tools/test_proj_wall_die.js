/* -------------------------------------------------------------
   撞墙处理归属运动器 · 回归测试
   （node tools/test_proj_wall_die.js）
   -------------------------------------------------------------
   契约：
     1) 「撞墙后消失 / 撞墙反弹次数」属于运动器，投射物模块不再有这两项
     2) 运动器在「投射物绑定」时把策略写到弹体上（_wallDie / _wallBounce），
        运动器到期或撞墙交还控制权后仍然有效
     3) 勾选 = 撞墙一次即销毁（反弹次数不参与）；取消 + 0 = 无限反弹；取消 + N = 反弹 N 次
     4) 位移距离=0 的绑定运动器只承载撞墙规则，不推动 / 不冻结弹体
     5) 旧存档投射物自带的 wallBounce 仍按旧口径兜底（无运动器时不炸掉老技能）
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

/* ---------- 1. 字段归属 ---------- */
console.log('1) 撞墙处理属于运动器模块');
const mFields = SM.MODULES.motion.fields;
const pFields = SM.MODULES.projectile.fields;
const mDie = mFields.find(f => f.key === 'dieOnWall') || {};
const mBounce = mFields.find(f => f.key === 'wallBounce') || {};
ok('运动器新增「撞墙后消失」布尔，默认勾选', mDie.type === 'bool' && mDie.def === true, 'def=' + mDie.def);
ok('运动器新增「撞墙反弹次数」，默认 0', mBounce.type === 'number' && mBounce.def === 0, 'def=' + mBounce.def);
ok('投射物已移除「撞墙后消失」', !pFields.some(f => f.key === 'dieOnWall'));
ok('投射物已移除「撞墙反弹次数」', !pFields.some(f => f.key === 'wallBounce'));
ok('投影物说明指向运动器「碰撞处理」', /碰撞/.test(SM.MODULES.projectile.desc || '') && /运动器/.test(SM.MODULES.projectile.desc || ''));
ok('运动器说明包含碰撞处理', /碰撞处理/.test(SM.MODULES.motion.desc || ''));
ok('反弹次数说明写明「触墙后行为=触墙反弹 + 取消消失时」生效',
  /触墙后行为/.test(mBounce.hint || '') && /取消/.test(mBounce.hint || ''));
ok('五项碰撞字段归到「碰撞处理」分区',
  ['collideTarget', 'wallAction', 'dieOnWall', 'wallBounce', 'stopOnWall'].every(k => (mFields.find(f => f.key === k) || {}).section === '碰撞处理'));

/* ---------- 2. 运动器把策略写到弹体 ---------- */
console.log('\n2) 绑定时把策略落到弹体上');
function mkShot(params) {
  const p = Object.assign({
    count: 1, spread: 0, speed: 400, size: 8, spawnOffset: 0,
    lifetime: 0, range: 0, accel: 0, pierce: 0, homing: 0, gravity: 0, trail: false
  }, params || {});
  return {
    side: 'player', x: 100, y: 350, vx: -400, vy: 0, r: p.size, age: 0,
    traveled: 0, bounces: 0, pierceLeft: 0, spin: 0, rot: 0, dead: false,
    hitIds: {}, trail: null, params: p
  };
}
function spawnMover(q, cfg, origin) {
  const movers = [];
  const opp = { id: 'e1', x: 450, y: 620, r: 16, side: 'enemy', hp: 100, dead: false };
  q._motionBound = true;
  M.spawn(movers, Object.assign({ scope: 'projectile', track: 'line', dirFrom: 'velocity', duration: 0.35 }, cfg || {}, { _integrate: true }), {
    self: q, opponent: opp, pair: [q, opp], origin: origin || { x: 450, y: 350, r: 16, side: 'player' },
    w: W, h: H, now: 0, targetOf: function () { return opp; },
    onEnd: function () { q._motionBound = false; }
  });
  return movers;
}
{
  const q = mkShot();
  spawnMover(q, { distance: 120, dieOnWall: false, wallBounce: 3 });
  ok('勾选取消 + 反弹 3 次：写到 _wallDie=false / _wallBounce=3',
    q._wallDie === false && q._wallBounce === 3, 'die=' + q._wallDie + ' bounce=' + q._wallBounce);
}
{
  const q = mkShot();
  spawnMover(q, { distance: 120 });
  ok('缺省：_wallDie=true / _wallBounce=0（撞墙即消失）',
    q._wallDie === true && q._wallBounce === 0, 'die=' + q._wallDie + ' bounce=' + q._wallBounce);
}
{
  const ball = { x: 400, y: 300, vx: 0, vy: 0, r: 16, hp: 100, side: 'player', dead: false };
  M.spawn([], { scope: 'self', track: 'line', distance: 120, dieOnWall: false, wallBounce: 3 }, {
    self: ball, opponent: { x: 700, y: 300, side: 'enemy' }, w: W, h: H, now: 0
  });
  ok('作用目标=弹珠时不写撞墙策略（只对投射物绑定生效）', ball._wallDie == null && ball._wallBounce == null);
}
{
  const q = mkShot();
  spawnMover(q, { distance: 120, dieOnWall: false, wallBounce: 2 });
  q.dead = true;
  M.clear([], {});   // 不受影响，仅确认无异常
  ok('运动器离场后策略仍保留在弹体上', q._wallDie === false && q._wallBounce === 2);
}

/* ---------- 3. 引擎行为 ---------- */
console.log('\n3) 撞墙行为');
function run(q, frames, opt) {
  opt = opt || {};
  const list = [q];
  let walls = 0, expires = 0;
  const ctx = {
    w: W, h: H, targets: [],
    onWall: function () { walls++; },
    onExpire: function () { expires++; }
  };
  for (let i = 0; i < frames; i++) {
    if (!list.length) break;
    SE.advance(list, dt, ctx);
  }
  return { alive: list.length === 1, walls: walls, expires: expires, bounces: q.bounces };
}
{
  const r = run(mkShot({ dieOnWall: true, wallBounce: 5 }), 30);
  ok('弹体勾选撞墙消失：一次即销毁（反弹次数不参与）', !r.alive && r.bounces === 1, 'bounces=' + r.bounces);
  ok('销毁触发 onExpire', r.expires === 1, 'n=' + r.expires);
}
{
  const r = run(mkShot({ dieOnWall: false, wallBounce: 0 }), 300);
  ok('取消 + 反弹 0：5 秒后仍存活', r.alive, 'alive=' + r.alive);
  ok('期间多次撞墙（≥3 次）', r.bounces >= 3, 'bounces=' + r.bounces);
  ok('未触发 onExpire', r.expires === 0, 'n=' + r.expires);
}
{
  const r1 = run(mkShot({ dieOnWall: false, wallBounce: 1 }), 700);
  ok('取消 + 反弹 1：撞第 2 次时销毁', !r1.alive && r1.bounces === 2, 'bounces=' + r1.bounces);
  const r2 = run(mkShot({ dieOnWall: false, wallBounce: 2 }), 700);
  ok('取消 + 反弹 2：撞第 3 次时销毁', !r2.alive && r2.bounces === 3, 'bounces=' + r2.bounces);
}
{
  // 旧存档兼容：投射物 params 自带 wallBounce，但没有任何运动器
  const r = run(mkShot({ wallBounce: 2 }), 60);
  ok('旧数据兜底：无 _wallDie 时按投射物旧字段判定（撞 1 次仍存活）', r.alive && r.bounces === 1, 'bounces=' + r.bounces);
}

/* ---------- 4. distance=0 的运动器 ---------- */
console.log('\n4) 位移距离=0：只承载撞墙规则，不推动弹体');
{
  const q = mkShot({ speed: 300 });
  q.vx = 300;   // 向右飞：0.5 秒内不会撞墙，只看运动器会不会把弹体冻住
  const movers = spawnMover(q, { distance: 0, dieOnWall: false, wallBounce: 0 });
  const x0 = q.x, y0 = q.y;
  const ctx = {
    w: W, h: H, targets: [],
    onWall: function (sq) { if (sq._motionBound && movers.length) M.noticeWall(movers, sq, { now: 0, w: W, h: H }, true); },
    onExpire: function () { }
  };
  for (let i = 0; i < 30; i++) {
    if (!q.dead) SE.advance([q], dt, ctx);
    if (movers.length) M.step(movers, dt, { w: W, h: H, now: i * dt, integrate: false });
  }
  const moved = Math.hypot(q.x - x0, q.y - y0);
  ok('0.5 秒内弹体按自身速度前进（≈150px，未被冻结）', Math.abs(moved - 150) < 20, 'Δ=' + moved.toFixed(0));
  ok('位移距离=0 不改变飞行方向', Math.abs(q.y - y0) < 0.01, 'dy=' + (q.y - y0).toFixed(2));
}
{
  // 向左飞，撞左墙：只承载撞墙规则，撞完仍然存活
  const q = mkShot({ speed: 400 });
  const movers = spawnMover(q, { distance: 0, dieOnWall: false, wallBounce: 0 });
  const ctx = {
    w: W, h: H, targets: [],
    onWall: function (sq) { if (sq._motionBound && movers.length) M.noticeWall(movers, sq, { now: 0, w: W, h: H }, true); },
    onExpire: function () { }
  };
  const list = [q];
  for (let i = 0; i < 60; i++) {
    if (list.length) SE.advance(list, dt, ctx);
    if (movers.length) M.step(movers, dt, { w: W, h: H, now: i * dt, integrate: false });
  }
  ok('撞左墙后仍然存活（策略已落到弹体上）', list.length === 1 && q.bounces === 1, 'bounces=' + q.bounces);
  ok('策略字段保留在弹体上', q._wallDie === false && q._wallBounce === 0);
}

console.log('\n结果: 通过 ' + pass + '，失败 ' + fail);
process.exit(fail ? 1 : 0);
