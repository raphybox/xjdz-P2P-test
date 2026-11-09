/* -------------------------------------------------------------
   碰撞处理 · 碰撞投射物（弹幕互撞）· 回归测试
   （node tools/test_proj_clash.js）
   -------------------------------------------------------------
   契约：
     1) 「碰撞投射物」属于运动器「碰撞处理」，与「碰撞对象（单位/障碍物）」互相独立
     2) 四档：不碰撞 / 仅敌方 / 仅己方 / 双方；缺省 = 不碰撞（旧技能行为不变）
     3) 绑定运动器时下发到弹体 _hitProj
     4) 相撞 = 双方一并销毁，各自结算一次「消失时」（reason='proj'）
     5) 单向声明即生效：只有一方配了「碰敌方」，撞上没配过的敌方弹一样双方销毁
     6) 同一次发射的多发弹（散弹）不互撞
     7) 出生 0.12 秒内的弹不参与互撞（分裂弹 / 贴身弹幕不会一出生就湮灭）
     8) 与撞墙 / 撞单位完全解耦
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
const fHit = mFields.find(f => f.key === 'hitProjectile') || {};
ok('运动器新增「碰撞投射物」，默认 = 不碰撞', fHit.type === 'select' && fHit.def === 'none', 'def=' + fHit.def);
ok('四档齐全（none / enemy / ally / both）',
  ['none', 'enemy', 'ally', 'both'].every(k => (fHit.options || []).some(o => o[0] === k)),
  'n=' + (fHit.options || []).length);
ok('「碰撞投射物」归到「碰撞处理」分区', fHit.section === '碰撞处理', fHit.section);
ok('位于「碰撞对象」之后、「触墙后行为」之前',
  mFields.findIndex(f => f.key === 'hitProjectile') === mFields.findIndex(f => f.key === 'collideTarget') + 1 &&
  mFields.findIndex(f => f.key === 'hitProjectile') === mFields.findIndex(f => f.key === 'wallAction') - 1);
ok('投射物模块没有「碰撞投射物」', !pFields.some(f => f.key === 'hitProjectile'));
ok('说明里点明「任一方声明即生效」', /只要有一方声明可撞/.test(fHit.hint || ''));
ok('说明里点明同批不互撞', /同一批/.test(fHit.hint || ''));
ok('运动器模块说明包含弹幕碰撞', /弹幕/.test(SM.MODULES.motion.desc || ''));

/* ---------- 2. 绑定时下发 ---------- */
console.log('\n2) 绑定时把弹幕碰撞策略落到弹体上');
function mkShot(side, x, y, opt) {
  const p = Object.assign({
    count: 1, spread: 0, speed: 0, size: 9, spawnOffset: 0,
    lifetime: 0, range: 0, accel: 0, pierce: 0, homing: 0, gravity: 0, trail: false
  }, opt || {});
  const caster = { x: x, y: y, r: 16, side: side || 'player' };
  const tgt = { x: x + 120, y: y, r: 16, side: (side === 'enemy') ? 'player' : 'enemy' };
  return SE.spawnProjectiles({ projectile: p }, caster, tgt, 0)[0];
}
function bindMover(q, cfg) {
  const movers = [];
  const opp = { id: 'e1', x: 450, y: 620, r: 16, side: (q.side === 'enemy' ? 'player' : 'enemy'), hp: 100, dead: false };
  q._motionBound = true;
  M.spawn(movers, Object.assign(
    { scope: 'projectile', track: 'line', dirFrom: 'velocity', duration: 0.35, distance: 0 },
    cfg || {}, { _integrate: true }),
    {
      self: q, opponent: opp, pair: [q, opp], origin: { x: 450, y: 350, r: 16, side: q.side },
      w: W, h: H, now: 0, targetOf: function () { return opp; },
      onEnd: function () { q._motionBound = false; }
    });
  return movers;
}
{
  const q = mkShot('player', 400, 350); bindMover(q, {});
  ok('缺省：_hitProj = none（旧技能不参与互撞）', q._hitProj === 'none', 'value=' + q._hitProj);
}
{
  const q = mkShot('player', 400, 350); bindMover(q, { hitProjectile: 'enemy' });
  ok('仅敌方投射物：_hitProj = enemy', q._hitProj === 'enemy', 'value=' + q._hitProj);
}
{
  const q = mkShot('player', 400, 350); bindMover(q, { hitProjectile: 'ally' });
  ok('仅己方投射物：_hitProj = ally', q._hitProj === 'ally', 'value=' + q._hitProj);
}
{
  const q = mkShot('player', 400, 350); bindMover(q, { hitProjectile: 'both' });
  ok('双方投射物：_hitProj = both', q._hitProj === 'both', 'value=' + q._hitProj);
}
{
  const ball = { x: 400, y: 300, vx: 0, vy: 0, r: 16, hp: 100, side: 'player', dead: false };
  M.spawn([], { scope: 'self', track: 'line', distance: 0, hitProjectile: 'both' }, {
    self: ball, opponent: { x: 700, y: 300, side: 'enemy' }, w: W, h: H, now: 0
  });
  ok('作用目标=弹珠时不写 _hitProj（只对投射物绑定生效）', ball._hitProj == null);
}

/* ---------- 3. 行为 ---------- */
console.log('\n3) 引擎行为');
function step(list, frames) {
  const exps = [];
  const ctx = {
    w: W, h: H, targets: [], walls: [],
    onHit: function () { },
    onWall: function () { },
    onExpire: function (q, why) { exps.push({ q: q, why: why }); }
  };
  for (let i = 0; i < frames; i++) {
    if (!list.length) break;
    SE.advance(list, dt, ctx);
  }
  return exps;
}
/* 过出生免疫窗口：单独推进一颗弹（list 里没有别人，不可能触发互撞） */
function arm(list) { step(list, 12); }

{
  // 不碰撞（缺省）：两颗弹完全重叠也互不干扰
  const a = mkShot('player', 400, 350), b = mkShot('enemy', 400, 350);
  a._hitProj = 'none';
  arm([a]); arm([b]);
  const list = [a, b];
  const exps = step(list, 30);
  ok('缺省不碰撞：敌我弹幕重叠 30 帧都存活', list.length === 2 && exps.length === 0,
    'alive=' + list.length + ' expire=' + exps.length);
}
{
  // 仅敌方：撞到敌方弹 → 双方销毁，各自结算一次消失
  const a = mkShot('player', 400, 350), b = mkShot('enemy', 400, 350);
  a._hitProj = 'enemy';
  arm([a]); arm([b]);
  const list = [a, b];
  const exps = step(list, 4);
  ok('碰敌方投射物：与敌方弹相撞 → 双方销毁', list.length === 0, 'alive=' + list.length);
  ok('双方各结算一次「消失时」', exps.length === 2, 'expire=' + exps.length);
  ok('销毁原因标记为 proj（对局 / 试放据此播放消失表现）',
    exps.every(e => e.why === 'proj'), exps.map(e => e.why).join(','));
}
{
  // 关键语义：敌方弹完全没配互撞，己方主动声明也能撞掉它（拦截玩法）
  const a = mkShot('player', 400, 350), b = mkShot('enemy', 400, 350);
  a._hitProj = 'enemy';   // b._hitProj 保持 undefined
  ok('对手弹没有 _hitProj（从未配置）', b._hitProj == null);
  arm([a]); arm([b]);
  const list = [a, b];
  step(list, 4);
  ok('单向声明即生效：未配置的敌方弹一样被撞掉', list.length === 0, 'alive=' + list.length);
}
{
  // 仅敌方：己方弹（不同批次）不碰撞
  const a = mkShot('player', 400, 350), b = mkShot('player', 400, 350);
  a._hitProj = 'enemy';
  arm([a]); arm([b]);
  const list = [a, b];
  step(list, 30);
  ok('碰敌方投射物：己方弹幕重叠不销毁', list.length === 2, 'alive=' + list.length);
}
{
  // 仅己方：撞己方销毁，撞敌方不销毁
  const a = mkShot('player', 400, 350), b = mkShot('player', 400, 350);
  a._hitProj = 'ally';
  arm([a]); arm([b]);
  const list = [a, b];
  step(list, 4);
  ok('碰己方投射物：与己方弹相撞 → 双方销毁', list.length === 0, 'alive=' + list.length);

  const c = mkShot('player', 400, 350), d = mkShot('enemy', 400, 350);
  c._hitProj = 'ally';
  arm([c]); arm([d]);
  const list2 = [c, d];
  step(list2, 30);
  ok('碰己方投射物：敌方弹幕穿过不销毁', list2.length === 2, 'alive=' + list2.length);
}
{
  // 双方投射物：两种都撞
  const a = mkShot('player', 400, 350), b = mkShot('enemy', 400, 350);
  a._hitProj = 'both';
  arm([a]); arm([b]);
  const list = [a, b];
  step(list, 4);
  ok('碰双方投射物：与敌方弹相撞销毁', list.length === 0);

  const c = mkShot('player', 400, 350), d = mkShot('player', 400, 350);
  c._hitProj = 'both';
  arm([c]); arm([d]);
  const list2 = [c, d];
  step(list2, 4);
  ok('碰双方投射物：与己方弹相撞销毁', list2.length === 0);
}
{
  // 同一次发射的散弹：4 颗完全重叠也不互撞
  const caster = { x: 400, y: 350, r: 16, side: 'player' };
  const tgt = { x: 520, y: 350, r: 16, side: 'enemy' };
  const arr = SE.spawnProjectiles({
    projectile: {
      count: 4, spread: 0, speed: 0, size: 9, spawnOffset: 0,
      lifetime: 0, range: 0, accel: 0, pierce: 0, homing: 0, gravity: 0, trail: false
    }
  }, caster, tgt, 0);
  arr.forEach(q => { q._hitProj = 'both'; });
  ok('散弹批次号相同', arr.length === 4 && arr.every(q => q._batch === arr[0]._batch));
  step(arr, 40);
  ok('同一次发射的多发弹不互撞（4 颗重叠仍全存活）', arr.length === 4, 'alive=' + arr.length);
}
{
  // 出生免疫：新弹不参与互撞，等过了 0.12 秒才生效
  const a = mkShot('player', 400, 350), b = mkShot('player', 400, 350);
  a._hitProj = 'both'; b._hitProj = 'both';
  arm([a]);                 // 只有 a 过了免疫期，b 的 age 仍是 0
  const list = [a, b];
  step(list, 1);
  ok('出生 0.12 秒内的弹不参与互撞', list.length === 2, 'alive=' + list.length + ' b.age=' + b.age.toFixed(3));
  step(list, 10);           // b 也过了 0.12 秒
  ok('免疫期结束后正常互撞销毁', list.length === 0, 'alive=' + list.length + ' b.age=' + b.age.toFixed(3));
}
{
  // 与撞墙 / 撞单位解耦：仅障碍物（_hitUnit=false）照样能撞弹幕
  const a = mkShot('player', 400, 350), b = mkShot('enemy', 400, 350);
  a._hitUnit = false; a._hitWall = true; a._hitProj = 'enemy';
  arm([a]); arm([b]);
  const list = [a, b];
  const exps = step(list, 4);
  ok('碰撞对象=仅障碍物 时，弹幕互撞照常生效', list.length === 0 && exps.length === 2,
    'alive=' + list.length + ' expire=' + exps.length);
}
{
  // 撞墙不干扰：撞墙后弹体仍在，随后与敌弹相撞
  const a = mkShot('player', 100, 40, { speed: 0 }), b = mkShot('enemy', 100, 40);
  a._hitProj = 'enemy'; a._wallDie = false; a._wallBounce = 0;
  a.x = 5; a.vx = -200; a.vy = -200;   // 顶到左上角触发撞墙
  arm([a]); arm([b]);
  ok('撞墙后弹体仍存活（撞墙不消失）', !a.dead, 'dead=' + a.dead);
  // 撞完墙 a 已经跑离原点，把 b 放到 a 当前坐标上制造确定的重叠
  b.x = a.x; b.y = a.y;
  const list = [a, b];
  step(list, 4);
  ok('撞墙之后仍然参与弹幕互撞', list.length === 0, 'alive=' + list.length);
}
{
  // 弹幕互撞不消耗穿透次数（穿透只对「单位」有意义）
  const a = mkShot('player', 400, 350, { pierce: 3 }), b = mkShot('enemy', 400, 350);
  a._hitProj = 'enemy';
  arm([a]); arm([b]);
  const list = [a, b];
  step(list, 4);
  ok('弹幕互撞不消耗穿透次数', a.pierceLeft === 3, 'pierceLeft=' + a.pierceLeft);
}

/* ---------- 4. 缺省与编译透传 ---------- */
console.log('\n4) 缺省值与编译透传');
{
  const n = M.normalize({ track: 'line' });
  ok('旧配置补齐：hitProjectile=none', n.hitProjectile === 'none', 'value=' + n.hitProjectile);
}
{
  const graph = {
    nodes: [
      { id: 's', type: 'source', params: { triggerEvent: 'onCast' } },
      { id: 'p', type: 'projectile', params: { count: 1, speed: 300 } },
      { id: 'm', type: 'motion', params: { scope: 'projectile', track: 'line', distance: 0, hitProjectile: 'both' } }
    ],
    edges: [{ from: 's', to: 'p' }, { from: 'p', to: 'm' }]
  };
  const C = SM.compile({ name: 't', graph: graph });
  const mv = (C.events.onCast.motion || [])[0] || {};
  ok('编译结果透传 hitProjectile=both', mv.hitProjectile === 'both', 'value=' + mv.hitProjectile);
}
{
  // 后台试放：靶弹标记位与三处回调守卫都要在
  const src = fs.readFileSync(path.join(ROOT, 'admin.js'), 'utf8');
  ok('试放沙盘有「敌弹」开关', /id="seFoeShotToggle"/.test(src));
  ok('靶弹带 _foeTest 标记', /_foeTest: true/.test(src));
  ok('靶弹不会被运动器误绑', /!q\._foeTest &&/.test(src));
  ok('试放 onExpire 接受 proj 销毁原因', /why !== 'expire' && why !== 'proj'/.test(src));
  ok('对局 advance 传入完整弹幕数组（双方共用 G.skillShots）', /SE\.advance\(G\.skillShots/.test(fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8')));
}

/* ---------- 5. 端到端：编译 → 发射 → 绑定 → 互撞 ---------- */
console.log('\n5) 端到端链路');
{
  const mkC = hitProj => SM.compile({
    name: 't', graph: {
      nodes: [
        { id: 's', type: 'source', params: { triggerEvent: 'onCast' } },
        { id: 'p', type: 'projectile', params: { count: 1, speed: 300, size: 10, lifetime: 6, spawnOffset: 0, trail: false } }
      ].concat(hitProj ? [{ id: 'm', type: 'motion', params: { scope: 'projectile', distance: 0, duration: 0.3, hitProjectile: hitProj } }] : []),
      edges: hitProj ? [{ from: 's', to: 'p' }, { from: 'p', to: 'm' }] : [{ from: 's', to: 'p' }]
    }
  });
  const CA = mkC('enemy'), CB = mkC(null);
  const pA = { x: 120, y: 350, r: 16, side: 'player' };
  const pB = { x: 780, y: 350, r: 16, side: 'enemy' };
  const a = SE.spawnProjectiles(CA, pA, pB, 0)[0];
  const b = SE.spawnProjectiles(CB, pB, pA, Math.PI)[0];
  const movers = [];
  const mA = (CA.events.onCast.motion || [])[0];
  a._motionBound = true;
  M.spawn(movers, Object.assign({}, mA, { contact: null, _integrate: true }), {
    self: a, opponent: pB, pair: [a, pB], origin: pA, w: W, h: H, now: 0,
    targetOf: function () { return pB; }, onEnd: function () { a._motionBound = false; }
  });
  ok('端到端：运动器把 _hitProj 下发到弹体', a._hitProj === 'enemy', 'value=' + a._hitProj);
  const shots = [a, b];
  const ctx = {
    w: W, h: H, targets: [], walls: [],
    onHit: function () { }, onWall: function () { }, onExpire: function () { }
  };
  let frames = 0;
  for (; frames < 300; frames++) {
    if (!shots.length) break;
    SE.advance(shots, dt, ctx);
    if (movers.length) M.step(movers, dt, { w: W, h: H, now: frames * dt, integrate: false, targetOf: function () { return pB; } });
  }
  ok('端到端：己方弹撞掉敌方弹（双方清空）', shots.length === 0, 'alive=' + shots.length + ' frames=' + frames);
  ok('端到端：中途相遇（不是飞满全程才回收）', frames < 240, 'frames=' + frames);
}

console.log('\n结果: 通过 ' + pass + '，失败 ' + fail);
process.exit(fail ? 1 : 0);
