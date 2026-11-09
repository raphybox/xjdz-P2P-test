/* 投射物「多发间隔」与「拖尾」回归测试

   覆盖：
   1) 字段定义（gap 默认 0、拖尾三项默认值与范围）
   2) spawnProjectiles 按 gap 给第 idx 发写延迟
   3) gap>0 期间冻结：不移动、不写拖尾、不结算命中；到期后按顺序逐发出膛
   4) drawShotTrail：时间窗裁剪 / 宽度百分比 / 不透明度 / 关闭 / 老数据兜底
   5) 两端接入（对局 + 试放）与 _skinFx 关系、admin 不再清零 gap */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SM = require(path.join(ROOT, 'skill-modules.js'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  [' + extra + ']' : '')); }
}
function loadEngine() {
  const code = fs.readFileSync(path.join(ROOT, 'skill-effects.js'), 'utf8');
  const ctx = { window: {}, console, Math, Object, Number, String, Array, JSON, isFinite };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return ctx.window.SkillEffects;
}
const SE = loadEngine();
const DT = 1 / 60;
const caster = { x: 100, y: 300, r: 16, side: 'player', hp: 100 };
const target = { x: 800, y: 300, r: 16, side: 'enemy', hp: 100, dead: false };

console.log('\n1) 字段定义');
const fields = SM.MODULES.projectile.fields;
const get = k => fields.find(f => f.key === k) || {};
const fGap = get('gap');
ok('「多发间隔」默认 0（不改老技能的手感）', fGap.def === 0, 'def=' + fGap.def);
ok('范围 0~1 秒，步长 0.01', fGap.min === 0 && fGap.max === 1 && fGap.step === 0.01);
ok('说明写明 0=同时发射 / 第 1 发立即射出', /0 = 全部同时发射/.test(fGap.hint || '') && /第 1 发/.test(fGap.hint || ''));
const iTrail = fields.findIndex(f => f.key === 'trail');
ok('拖尾三项紧跟「拖尾」开关', ['trailLen', 'trailWidth', 'trailAlpha'].every((k, i) => fields.findIndex(f => f.key === k) === iTrail + 1 + i));
ok('拖尾长度默认 0.16 秒（0.02~0.8）', get('trailLen').def === 0.16 && get('trailLen').min === 0.02 && get('trailLen').max === 0.8);
ok('拖尾宽度默认 100%（10~300）', get('trailWidth').def === 100 && get('trailWidth').min === 10 && get('trailWidth').max === 300);
ok('拖尾不透明度默认 32%（0~100）', get('trailAlpha').def === 32 && get('trailAlpha').min === 0 && get('trailAlpha').max === 100);
ok('拖尾开关说明提醒「素材自带的拖影管不到」', /素材/.test(get('trail').hint || '') && /本开关管不到/.test(get('trail').hint || ''));
ok('defaults() 带出三个拖尾参数', SM.defaults('projectile').trailLen === 0.16 &&
  SM.defaults('projectile').trailWidth === 100 && SM.defaults('projectile').trailAlpha === 32);

console.log('\n2) 生成：第 idx 发延迟 idx × gap');
function compileProj(extra) {
  return SM.compile({
    name: 't', graph: {
      nodes: [
        { id: 's', type: 'source', params: { triggerEvent: 'onCast' } },
        { id: 'p', type: 'projectile', params: Object.assign({ count: 5, spread: 30, speed: 300, size: 9, gap: 0.5, trail: true }, extra || {}) }
      ],
      edges: [{ from: 's', to: 'p' }]
    }
  });
}
{
  const C = compileProj();
  const list = SE.spawnProjectiles(C, caster, target);
  ok('5 发弹的初始 gap = 0 / 0.5 / 1 / 1.5 / 2',
    list.map(q => +q.gap.toFixed(2)).join(',') === '0,0.5,1,1.5,2', list.map(q => q.gap).join(','));
  ok('角度仍然按扇形均分（间隔不影响朝向）', list.map(q => Math.round(q.rot)).join(',') === '-15,-7,0,7,15');
}
{
  const C = compileProj({ gap: 0 });
  const list = SE.spawnProjectiles(C, caster, target);
  ok('gap=0 时全部 0 延迟（同时发射，老行为）', list.every(q => q.gap === 0));
}
{
  const C = compileProj({ gap: 0 });
  const list = SE.spawnProjectiles(C, caster, target);
  const x0 = list.map(q => q.x);
  for (let i = 0; i < 12; i++) SE.advance(list, DT, { w: 1200, h: 700, targets: [], walls: [], onHit() { }, onExpire() { }, onWall() { } });
  ok('gap=0：0.2 秒后所有弹都已离开出生点', list.every((q, i) => q.x > x0[i] + 40));
}

console.log('\n3) 推进：逐发延迟、冻结期间不移动 / 不命中 / 不写拖尾');
function step(list, sec, ctx) {
  const n = Math.round(sec / DT);
  for (let i = 0; i < n; i++) SE.advance(list, DT, ctx || { w: 1200, h: 700, targets: [], walls: [], onHit() { }, onExpire() { }, onWall() { } });
}
{
  const C = compileProj();
  const list = SE.spawnProjectiles(C, caster, target);
  const x0 = list.map(q => q.x);
  step(list, 0.4);
  ok('0.4 秒：只有第 1 发在飞', list[0].x > x0[0] + 100, 'x=' + Math.round(list[0].x));
  ok('0.4 秒：第 3~5 发仍在出生点', list.slice(2).every((q, i) => Math.abs(q.x - x0[i + 2]) < 1e-6),
    list.map(q => Math.round(q.x)).join(','));
  ok('待发的弹不写拖尾（不会在出生点堆一条线）', list.slice(2).every(q => q.trail.length === 0),
    list.map(q => q.trail.length).join(','));
  ok('待发的弹 self.age 不增长（存在时长从出膛才计）', list.slice(2).every(q => q.age === 0));
  step(list, 0.4);
  ok('0.8 秒：第 2 发已在飞', list[1].x > x0[1] + 40, 'x=' + Math.round(list[1].x));
  ok('0.8 秒：第 3 发刚开始动、第 4~5 发仍待发',
    Math.abs(list[2].x - x0[2]) < 1e-6 && list.slice(3).every((q, i) => Math.abs(q.x - x0[i + 3]) < 1e-6),
    list.map(q => Math.round(q.x)).join(','));
}
{
  // 出生点上放一个敌方单位：待发的弹不应结算命中
  const C = compileProj({ count: 3, gap: 0.5, speed: 200 });
  const list = SE.spawnProjectiles(C, caster, target);
  let hits = 0;
  const blocker = { id: 'e9', x: caster.x + 28, y: caster.y, r: 20, side: 'enemy', hp: 100, dead: false };
  const ctx = { w: 1200, h: 700, targets: [blocker], walls: [], onHit() { hits++; }, onExpire() { }, onWall() { } };
  step(list, 0.3, ctx);
  ok('待发的弹即使与敌方重叠也不结算命中（0.3 秒内只第 1 发命中一次）', hits === 1, 'hits=' + hits);
  ok('第 1 发已命中消失、第 3 发仍在待发', list.length === 2 && list[1].gap > 0,
    'len=' + list.length + ' gap=' + (list[1] && list[1].gap));
}
{
  // 与施法者绑定时：待发弹跟着施法者平移，但不动
  const C = compileProj({ count: 3, gap: 0.4, bindCaster: true, speed: 200 });
  const cr = { x: 100, y: 300, r: 16, side: 'player', hp: 100, dead: false };
  const list = SE.spawnProjectiles(C, cr, target);
  const x2 = list[2].x;
  cr.x += 60;
  step(list, DT);
  ok('待发弹跟随施法者平移（+60）', Math.abs(list[2].x - (x2 + 60)) < 1e-6, 'Δ=' + (list[2].x - x2).toFixed(1));
}

console.log('\n4) drawShotTrail');
function mkCtx() {
  return {
    moved: [], lines: [], strokes: 0, saves: 0, restores: 0,
    globalAlpha: 1, strokeStyle: '', lineWidth: 1, lineCap: '', lineJoin: '',
    save() { this.saves++; }, restore() { this.restores++; },
    beginPath() { }, moveTo(x, y) { this.moved.push([x, y]); },
    lineTo(x, y) { this.lines.push([x, y]); }, stroke() { this.strokes++; }
  };
}
function mkShot(over) {
  const q = {
    x: 0, y: 0, r: 10, age: 1.0,
    params: { trail: true, trailLen: 0.2, trailWidth: 50, trailAlpha: 50 },
    trail: [
      { x: 0, y: 0, t: 0.1 },
      { x: 10, y: 0, t: 0.9 },
      { x: 20, y: 0, t: 0.95 },
      { x: 30, y: 0, t: 1.0 }
    ]
  };
  return Object.assign(q, over || {});
}
{
  const q = mkShot();
  const cx = mkCtx();
  ok('有轨迹 → 返回 true 并描边一次', SE.drawShotTrail(cx, q, '#00ffcc') === true && cx.strokes === 1);
  ok('时间窗裁剪：只画最近 0.2 秒（3 个点，起点 x=10）',
    cx.moved.length === 1 && cx.moved[0][0] === 10 && cx.lines.length === 2,
    'move=' + JSON.stringify(cx.moved) + ' lines=' + JSON.stringify(cx.lines));
  ok('宽度 = 半径 × 50%', cx.lineWidth === 5, 'lw=' + cx.lineWidth);
  ok('不透明度 = 50%', Math.abs(cx.globalAlpha - 0.5) < 1e-9, 'a=' + cx.globalAlpha);
  ok('颜色按传入值', cx.strokeStyle === '#00ffcc');
  ok('save / restore 成对（不污染后续绘制）', cx.saves === 1 && cx.restores === 1);
}
{
  const cx = mkCtx();
  ok('关闭拖尾 → 不画', SE.drawShotTrail(cx, mkShot({ params: { trail: false } })) === false && cx.strokes === 0);
}
{
  const cx = mkCtx();
  ok('不透明度 0 → 不画', SE.drawShotTrail(cx, mkShot({ params: { trail: true, trailAlpha: 0 } })) === false);
}
{
  const cx = mkCtx();
  ok('轨迹点不足 2 个 → 不画', SE.drawShotTrail(cx, mkShot({ trail: [{ x: 0, y: 0, t: 1 }] })) === false);
}
{
  const cx = mkCtx();
  ok('没有 trail 数组（trail 关）→ 不画', SE.drawShotTrail(cx, mkShot({ trail: null })) === false);
}
{
  // 老数据：轨迹点没有时间戳 → 当作当前帧，不崩且能画
  const cx = mkCtx();
  const q = mkShot({ trail: [{ x: 0, y: 0 }, { x: 5, y: 0 }] });
  ok('老轨迹点无时间戳 → 兜底为当前帧', SE.drawShotTrail(cx, q) === true && cx.lines.length === 1);
}
{
  // 缺省参数（老节点没有 trailLen/Width/Alpha）走默认 0.16s / 100% / 32%
  const cx = mkCtx();
  const q = mkShot({ params: { trail: true }, trail: [{ x: 0, y: 0, t: 0.95 }, { x: 1, y: 0, t: 1 }] });
  ok('缺省参数走默认值（宽=半径、alpha=0.32）',
    SE.drawShotTrail(cx, q) === true && cx.lineWidth === 10 && Math.abs(cx.globalAlpha - 0.32) < 1e-9);
}
{
  // 轨迹点全部超出时间窗 → 只剩 1 点，不画
  const cx = mkCtx();
  const q = mkShot({ age: 5, trail: [{ x: 0, y: 0, t: 0 }, { x: 1, y: 0, t: 0.5 }] });
  ok('所有点都在时间窗外 → 不画', SE.drawShotTrail(cx, q) === false);
}

console.log('\n5) 两端接入与数据流');
const gameSrc = fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8');
const adminSrc = fs.readFileSync(path.join(ROOT, 'admin.js'), 'utf8');
const seSrc = fs.readFileSync(path.join(ROOT, 'skill-effects.js'), 'utf8');
ok('引擎导出 drawShotTrail', /drawShotTrail: drawShotTrail/.test(seSrc));
ok('advance 写入轨迹点带时间戳', /q\.trail\.push\(\{ x: q\.x, y: q\.y, t: q\.age \}\)/.test(seSrc));
ok('对局端调用 drawShotTrail', /SE\.drawShotTrail\(ctx, q, col\)/.test(gameSrc));
ok('对局端先画拖尾再判断 _skinFx（挂特效时也有尾巴）',
  gameSrc.indexOf('drawShotTrail(ctx, q, col)') < gameSrc.indexOf('if (q._skinFx) return;', gameSrc.indexOf('drawShotTrail(ctx, q, col)')));
ok('对局端跳过待发弹的绘制', /if \(q\.gap > 0\) return;/.test(gameSrc));
ok('试放端调用 drawShotTrail', /SE\.drawShotTrail\(cx, q,/.test(adminSrc));
ok('试放端跳过待发弹的绘制', /if \(q\.gap > 0\) return;/.test(adminSrc));
ok('试放不再把 gap 清零（否则永远同时发射）', !/p\.gap = 0/.test(adminSrc));
ok('关掉拖尾时三项参数置灰', /f\.key === 'trailLen' \|\| f\.key === 'trailWidth' \|\| f\.key === 'trailAlpha'/.test(adminSrc));

console.log('\n结果: 通过 ' + pass + '，失败 ' + fail);
process.exit(fail ? 1 : 0);
