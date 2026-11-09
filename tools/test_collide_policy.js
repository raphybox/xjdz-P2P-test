/* -------------------------------------------------------------
   碰撞对象 / 触墙后行为 · 回归测试
   （node tools/test_collide_policy.js）
   -------------------------------------------------------------
   契约：
     1) 「碰撞对象」与「触墙后行为」属于运动器「碰撞处理」，投射物模块没有这两项
     2) 碰撞对象四档：单位+障碍物 / 仅单位 / 仅障碍物 / 不碰撞，
        作用目标=投射物绑定时下发到弹体（_hitUnit / _hitWall）
     3) 触墙后行为两档：触墙反弹（交还控制权）/ 继续按运动器移动（穿墙、不消失、不触发撞墙事件）
     4) 碰撞对象收窄后：仅单位 = 穿墙飞行；仅障碍物 = 穿过弹珠不结算命中
     5) 缺省与老配置：单位+障碍物、触墙反弹、撞墙即消失（行为与改造前一致）
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

/* ---------- 1. 字段定义 ---------- */
console.log('1) 字段定义与归属');
const mFields = SM.MODULES.motion.fields;
const pFields = SM.MODULES.projectile.fields;
const fCollide = mFields.find(f => f.key === 'collideTarget') || {};
const fAction = mFields.find(f => f.key === 'wallAction') || {};
ok('运动器新增「碰撞对象」，默认 = 单位 + 障碍物', fCollide.type === 'select' && fCollide.def === 'all', 'def=' + fCollide.def);
ok('碰撞对象四档齐全（all / unit / wall / none）',
  ['all', 'unit', 'wall', 'none'].every(k => (fCollide.options || []).some(o => o[0] === k)),
  'n=' + (fCollide.options || []).length);
ok('运动器新增「触墙后行为」，默认 = 触墙反弹', fAction.type === 'select' && fAction.def === 'bounce', 'def=' + fAction.def);
ok('触墙后行为两档齐全（bounce / continue）',
  ['bounce', 'continue'].every(k => (fAction.options || []).some(o => o[0] === k)));
ok('投射物模块没有「碰撞对象」', !pFields.some(f => f.key === 'collideTarget'));
ok('投射物模块没有「触墙后行为」', !pFields.some(f => f.key === 'wallAction'));
ok('两项都归到「碰撞处理」分区',
  fCollide.section === '碰撞处理' && fAction.section === '碰撞处理',
  fCollide.section + ' / ' + fAction.section);
ok('「触墙后行为」说明区分反弹与继续移动',
  /反弹/.test(fAction.hint || '') && /继续/.test(fAction.hint || ''));
ok('「碰撞对象」说明写明不撞墙时穿墙飞行',
  /穿墙/.test(fCollide.hint || ''));

/* ---------- 2. 绑定下发 ---------- */
console.log('\n2) 绑定时把碰撞策略落到弹体上');
function mkShot(params, opt) {
  const p = Object.assign({
    count: 1, spread: 0, speed: 400, size: 8, spawnOffset: 0,
    lifetime: 0, range: 0, accel: 0, pierce: 0, homing: 0, gravity: 0, trail: false
  }, params || {});
  opt = opt || {};
  return {
    side: 'player', x: opt.x == null ? 100 : opt.x, y: opt.y == null ? 350 : opt.y,
    vx: opt.vx == null ? 400 : opt.vx, vy: opt.vy == null ? 0 : opt.vy,
    r: p.size, age: 0, traveled: 0, bounces: 0, pierceLeft: p.pierce || 0,
    spin: 0, rot: 0, dead: false, hitIds: {}, trail: null, params: p
  };
}
function bindMover(q, cfg, origin) {
  const movers = [];
  const opp = { id: 'e1', x: 450, y: 620, r: 16, side: 'enemy', hp: 100, dead: false };
  q._motionBound = true;
  M.spawn(movers, Object.assign(
    { scope: 'projectile', track: 'line', dirFrom: 'velocity', duration: 0.35, distance: 0 },
    cfg || {}, { _integrate: true }),
    {
      self: q, opponent: opp, pair: [q, opp], origin: origin || { x: 450, y: 350, r: 16, side: 'player' },
      w: W, h: H, now: 0, targetOf: function () { return opp; },
      onEnd: function () { q._motionBound = false; }
    });
  return movers;
}
{
  const q = mkShot();
  bindMover(q, {});
  ok('缺省：_hitUnit=true / _hitWall=true / _wallAction=bounce',
    q._hitUnit === true && q._hitWall === true && q._wallAction === 'bounce',
    [q._hitUnit, q._hitWall, q._wallAction].join(' / '));
}
{
  const q = mkShot(); bindMover(q, { collideTarget: 'unit' });
  ok('仅单位：_hitUnit=true / _hitWall=false', q._hitUnit === true && q._hitWall === false);
}
{
  const q = mkShot(); bindMover(q, { collideTarget: 'wall' });
  ok('仅障碍物：_hitUnit=false / _hitWall=true', q._hitUnit === false && q._hitWall === true);
}
{
  const q = mkShot(); bindMover(q, { collideTarget: 'none' });
  ok('不碰撞：_hitUnit=false / _hitWall=false', q._hitUnit === false && q._hitWall === false);
}
{
  const q = mkShot(); bindMover(q, { wallAction: 'continue' });
  ok('触墙后行为=继续按运动器移动：_wallAction=continue', q._wallAction === 'continue');
}
{
  const ball = { x: 400, y: 300, vx: 0, vy: 0, r: 16, hp: 100, side: 'player', dead: false };
  M.spawn([], { scope: 'self', track: 'line', distance: 0, collideTarget: 'none' }, {
    self: ball, opponent: { x: 700, y: 300, side: 'enemy' }, w: W, h: H, now: 0
  });
  ok('作用目标=弹珠时不写碰撞策略（只对投射物绑定生效）',
    ball._hitUnit == null && ball._hitWall == null && ball._wallAction == null);
}

/* ---------- 3. 行为 ---------- */
console.log('\n3) 引擎行为');
function run(q, frames, opt) {
  opt = opt || {};
  const list = [q];
  let walls = 0, hits = 0, expires = 0;
  const ctx = {
    w: W, h: H, walls: opt.walls || [], targets: opt.targets || [],
    onHit: function () { hits++; },
    onWall: function (sq) {
      walls++;
      // 模拟对局 / 试放：撞墙立刻交还运动器控制权（触墙反弹路径）
      if (sq._motionBound && opt.movers && opt.movers.length) M.noticeWall(opt.movers, sq, { now: 0, w: W, h: H }, true);
    },
    onExpire: function () { expires++; }
  };
  for (let i = 0; i < frames; i++) {
    if (!list.length) break;
    SE.advance(list, dt, ctx);
  }
  return {
    alive: list.length === 1, walls: walls, hits: hits, expires: expires,
    bounces: q.bounces, x: q.x, y: q.y
  };
}
{
  // 仅单位：向左飞，应直接穿出左边界，不触发撞墙、不销毁
  const q = mkShot({ speed: 400 }, { x: 100, vx: -400 });
  bindMover(q, { collideTarget: 'unit', dieOnWall: true });
  const r = run(q, 60);
  ok('仅单位：穿过左边界后仍存活', r.alive, 'alive=' + r.alive);
  ok('仅单位：不触发撞墙事件、不累计反弹次数', r.walls === 0 && r.bounces === 0, 'walls=' + r.walls + ' bounces=' + r.bounces);
  ok('仅单位：坐标已飞出场地（穿墙飞行）', r.x < -100, 'x=' + r.x.toFixed(0));
}
{
  // 仅单位：仍能正常命中敌方弹珠
  const q = mkShot({ speed: 400 }, { x: 100, vx: 400 });
  bindMover(q, { collideTarget: 'unit' });
  const r = run(q, 40, { targets: [{ id: 'e1', x: 300, y: 350, r: 16, side: 'enemy', hp: 100, dead: false }] });
  ok('仅单位：命中照常结算（onHit=1，弹体销毁）', r.hits === 1 && !r.alive, 'hits=' + r.hits);
}
{
  // 仅障碍物：穿过弹珠不结算命中，撞墙照常
  const q = mkShot({ speed: 400 }, { x: 100, vx: 400 });
  bindMover(q, { collideTarget: 'wall', dieOnWall: true });
  const r = run(q, 200, { targets: [{ id: 'e1', x: 300, y: 350, r: 16, side: 'enemy', hp: 100, dead: false }] });
  ok('仅障碍物：穿过弹珠不触发命中', r.hits === 0, 'hits=' + r.hits);
  ok('仅障碍物：撞右墙仍触发撞墙并消失', r.walls === 1 && !r.alive && r.bounces === 1,
    'walls=' + r.walls + ' alive=' + r.alive);
}
{
  // 不碰撞：人和墙都穿过
  const q = mkShot({ speed: 400 }, { x: 100, vx: 400 });
  bindMover(q, { collideTarget: 'none' });
  const r = run(q, 200, { targets: [{ id: 'e1', x: 300, y: 350, r: 16, side: 'enemy', hp: 100, dead: false }] });
  ok('不碰撞：既不命中也不撞墙，直接飞出场地', r.hits === 0 && r.walls === 0 && r.alive && r.x > W,
    'hits=' + r.hits + ' x=' + r.x.toFixed(0));
}
{
  // 触墙后行为=继续按运动器移动：撞墙不消失、不触发撞墙事件、运动器不被打断
  const q = mkShot({ speed: 400 }, { x: 100, vx: -400 });
  const movers = bindMover(q, { wallAction: 'continue', dieOnWall: true });
  const r = run(q, 60, { movers: movers });
  ok('继续按运动器移动：撞墙后不销毁', r.alive, 'alive=' + r.alive);
  ok('继续按运动器移动：不触发撞墙事件、不累计反弹', r.walls === 0 && r.bounces === 0,
    'walls=' + r.walls + ' bounces=' + r.bounces);
  ok('继续按运动器移动：运动器仍挂在弹体上（未交还控制权）',
    movers.length === 1 && q._motionBound === true, 'movers=' + movers.length);
  ok('继续按运动器移动：弹体已穿出左边界', r.x < -100, 'x=' + r.x.toFixed(0));
}
{
  // 对照：触墙反弹（默认）会触发撞墙并交还控制权
  const q = mkShot({ speed: 400 }, { x: 100, vx: -400 });
  const movers = bindMover(q, { wallAction: 'bounce', dieOnWall: true });
  const r = run(q, 30, { movers: movers });
  ok('触墙反弹：撞墙事件触发、弹体消失、运动器交还', r.walls === 1 && !r.alive && movers.length === 0,
    'walls=' + r.walls + ' movers=' + movers.length);
}
{
  // 穿透次数在「仅障碍物」下不应被白白消耗
  const q = mkShot({ speed: 400, pierce: 2 }, { x: 100, vx: 400 });
  bindMover(q, { collideTarget: 'wall' });
  const r = run(q, 60, { targets: [{ id: 'e1', x: 300, y: 350, r: 16, side: 'enemy', hp: 100, dead: false }] });
  ok('仅障碍物：穿透次数原封不动', q.pierceLeft === 2 && r.hits === 0, 'pierceLeft=' + q.pierceLeft);
}
{
  // 环绕 + 「继续按运动器移动」：撞出边界后沿圆继续绕，最后自己绕回场内
  const q = mkShot({ speed: 300 }, { x: 150, y: 100, vx: 0, vy: 0 });
  const movers = bindMover(q,
    { track: 'orbitSelf', dirFrom: 'velocity', distance: 300, duration: 1, orbitTime: 0, wallAction: 'continue', dieOnWall: true },
    { x: 450, y: 100, r: 16, side: 'player' });
  let walls = 0, minY = 1e9, cameBack = false;
  const list = [q];
  const ctx = {
    w: W, h: H, targets: [],
    onWall: function (sq) { walls++; if (movers.length) M.noticeWall(movers, sq, { now: 0, w: W, h: H }, true); },
    onExpire: function () { }
  };
  for (let i = 0; i < 400; i++) {
    if (!list.length) break;
    M.step(movers, dt, { w: W, h: H, now: i * dt, integrate: false });
    SE.advance(list, dt, ctx);
    minY = Math.min(minY, q.y);
    if (minY < -50 && q.y > 40) cameBack = true;
  }
  ok('环绕 + 继续按运动器移动：会绕出上边界', minY < -50, 'minY=' + minY.toFixed(0));
  ok('环绕 + 继续按运动器移动：随后自己绕回场内', cameBack, 'returned=' + cameBack);
  ok('环绕 + 继续按运动器移动：全程不销毁、不触发撞墙', list.length === 1 && walls === 0,
    'alive=' + (list.length === 1) + ' walls=' + walls);
}
{
  /* 环绕 + 位移距离=0：位移距离不参与环绕半径，只用于「投射物速度为 0」时折算角速度。
     即使填 0 也必须接管方向，否则会退化成直线飞行（穿墙后尤其明显）。 */
  const q = mkShot({ speed: 300 }, { x: 150, y: 100, vx: 0, vy: 0 });
  const movers = bindMover(q,
    { track: 'orbitSelf', dirFrom: 'velocity', distance: 0, duration: 1, orbitTime: 0, wallAction: 'continue', dieOnWall: true },
    { x: 450, y: 100, r: 16, side: 'player' });
  let minY = 1e9, maxY = -1e9, maxX = -1e9;
  const list = [q];
  const ctx = { w: W, h: H, targets: [], onWall: function () { }, onExpire: function () { } };
  for (let i = 0; i < 400; i++) {
    if (!list.length) break;
    M.step(movers, dt, { w: W, h: H, now: i * dt, integrate: false });
    SE.advance(list, dt, ctx);
    minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y); maxX = Math.max(maxX, q.x);
  }
  ok('环绕 + 位移距离=0：仍然绕圈（y 来回、x 越过圆心）',
    minY < -50 && maxY > 150 && maxX > 500,
    'minY=' + minY.toFixed(0) + ' maxY=' + maxY.toFixed(0) + ' maxX=' + maxX.toFixed(0));
  ok('环绕 + 位移距离=0：方向不是固定「正右方」', list.length === 1 && q._motionDir != null && Math.abs(q._motionDir) > 0.01,
    'dir=' + (q._motionDir == null ? 'null' : q._motionDir.toFixed(2)));
}
{
  // 对照：环绕 + 位移距离=0 + 触墙反弹，撞墙后运动器交还、弹体消失
  const q = mkShot({ speed: 300 }, { x: 150, y: 100, vx: 0, vy: 0 });
  const movers = bindMover(q,
    { track: 'orbitSelf', dirFrom: 'velocity', distance: 0, duration: 1, orbitTime: 0, wallAction: 'bounce', dieOnWall: true },
    { x: 450, y: 100, r: 16, side: 'player' });
  let walls = 0;
  const list = [q];
  const ctx = {
    w: W, h: H, targets: [],
    onWall: function (sq) { walls++; if (movers.length) M.noticeWall(movers, sq, { now: 0, w: W, h: H }, true); },
    onExpire: function () { }
  };
  for (let i = 0; i < 300; i++) {
    if (!list.length) break;
    M.step(movers, dt, { w: W, h: H, now: i * dt, integrate: false });
    SE.advance(list, dt, ctx);
  }
  ok('环绕 + 位移距离=0 + 触墙反弹：撞墙即交还并消失', walls === 1 && movers.length === 0 && list.length === 0,
    'walls=' + walls + ' movers=' + movers.length);
}
{
  // 试放沙盘内墙：交还控制权必须跳过「不撞墙 / 继续按运动器移动」的弹
  const src = fs.readFileSync(path.join(ROOT, 'admin.js'), 'utf8');
  ok('试放内墙只在「会撞墙 + 撞墙即结束」时才交还运动器',
    /if \(mv\.ent\._hitWall !== false && mv\.ent\._wallAction !== 'continue'/.test(src));
}

/* ---------- 4. 缺省与编译透传 ---------- */
console.log('\n4) 缺省值与编译透传');
{
  const n = M.normalize({ track: 'line' });
  ok('旧配置补齐：collideTarget=all / wallAction=bounce',
    n.collideTarget === 'all' && n.wallAction === 'bounce', n.collideTarget + ' / ' + n.wallAction);
}
{
  const graph = {
    nodes: [
      { id: 's', type: 'source', params: { triggerEvent: 'onCast' } },
      { id: 'p', type: 'projectile', params: { count: 1, speed: 300 } },
      { id: 'm', type: 'motion', params: { scope: 'projectile', track: 'line', distance: 0, collideTarget: 'unit', wallAction: 'continue' } }
    ],
    edges: [{ from: 's', to: 'p' }, { from: 'p', to: 'm' }]
  };
  const C = SM.compile({ name: 't', graph: graph });
  const mv = (C.events.onCast.motion || [])[0] || {};
  ok('编译结果透传 collideTarget=unit', mv.collideTarget === 'unit', 'value=' + mv.collideTarget);
  ok('编译结果透传 wallAction=continue', mv.wallAction === 'continue', 'value=' + mv.wallAction);
}

console.log('\n结果: 通过 ' + pass + '，失败 ' + fail);
process.exit(fail ? 1 : 0);
