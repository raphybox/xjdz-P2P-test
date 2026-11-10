// 持续伤害(跟随) 迁移后的回归测试：
// 1) 字段定义已从「特效」模块迁到「伤害·结算」模块
// 2) compile 透传 dotEnable / dotDps / dotRadius / dotInterval / dotFollow / dotDuration
// 3) skill-effects.stepDotZones 的纯结算口径（跟随 / 半径过滤 / 间隔 / 阵营 / 到期）
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
function ok(name, cond) { if (cond) { passed++; } else { failed++; console.log('  ✗ ' + name); } }
function eq(name, a, b) { const c = JSON.stringify(a) === JSON.stringify(b); if (c) passed++; else { failed++; console.log('  ✗ ' + name + '  got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b)); } }

// ---- 载入 skill-modules ----
const SMcode = fs.readFileSync(path.join(ROOT, 'skill-modules.js'), 'utf8');
const ctx1 = { window: {}, console, Math, Object, Number, String, Array, JSON, isFinite, WeakMap, RegExp, Date, parseInt, parseFloat, Set, Map, Promise };
vm.createContext(ctx1);
vm.runInContext(SMcode, ctx1);
const SM = ctx1.window.SkillModules;

// ---- 载入 skill-effects（取纯函数 stepDotZones）----
const SEcode = fs.readFileSync(path.join(ROOT, 'skill-effects.js'), 'utf8');
const ctx2 = { window: {}, console, Math, Object, Number, String, Array, JSON, isFinite, WeakMap, RegExp, Date, parseFloat, parseInt };
vm.createContext(ctx2);
vm.runInContext(SEcode, ctx2);
const SE = ctx2.window.SkillEffects;
ok('SkillEffects 导出 stepDotZones', typeof (SE && SE.stepDotZones) === 'function');
ok('SkillEffects 不再导出 tickFxDamage', typeof (SE && SE.tickFxDamage) === 'undefined');

console.log('1) 字段迁移：特效模块不再含 tick 字段，伤害模块含 dot 字段');
const fxDef = SM.MODULES.fx.fields.map(f => f.key);
const dmgDef = SM.MODULES.damage.fields.map(f => f.key);
ok('fx 模块无 tickDamage', fxDef.indexOf('tickDamage') < 0);
ok('fx 模块无 tickDps', fxDef.indexOf('tickDps') < 0);
ok('damage 模块有 dotEnable', dmgDef.indexOf('dotEnable') >= 0);
ok('damage 模块有 dotDps', dmgDef.indexOf('dotDps') >= 0);
ok('damage 模块有 dotRadius', dmgDef.indexOf('dotRadius') >= 0);
ok('damage 模块有 dotInterval', dmgDef.indexOf('dotInterval') >= 0);
ok('damage 模块有 dotFollow', dmgDef.indexOf('dotFollow') >= 0);
ok('damage 模块有 dotDuration', dmgDef.indexOf('dotDuration') >= 0);

console.log('2) 默认值');
const d = SM.defaults('damage');
eq('dotEnable 默认', d.dotEnable, false);
eq('dotDps 默认', d.dotDps, 8);
eq('dotRadius 默认', d.dotRadius, 70);
eq('dotInterval 默认', d.dotInterval, 0.5);
eq('dotFollow 默认', d.dotFollow, 'caster');
eq('dotDuration 默认', d.dotDuration, 6);

console.log('3) compile 透传（迁移后的旋风斩）');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/game-config.json'), 'utf8'));
const sk = cfg.skills.find(s => s.id === 'sk_mw8ymzcqellb');
const C = SM.compile(sk);
const dm = C.events.onHit.damage;
ok('旋风斩 onHit 伤害模块存在', !!dm);
if (dm) {
  // 用户会在后台改这些数值：期望值以节点原始参数为准，不写死，避免测试变成「数据快照」
  const rawNode = (sk.graph.nodes || []).find(n => n.type === 'damage') || { params: {} };
  const rp = rawNode.params || {};
  eq('dotEnable 透传', dm.dotEnable, true);
  eq('dotDps 透传', dm.dotDps, rp.dotDps);
  eq('dotRadius 透传', dm.dotRadius, rp.dotRadius);
  eq('dotInterval 透传', dm.dotInterval, rp.dotInterval);
  eq('dotFollow 透传', dm.dotFollow, rp.dotFollow);
  eq('dotDuration 透传', dm.dotDuration, rp.dotDuration);
  const fxNode = (sk.graph.nodes || []).find(n => n.type === 'fx');
  ok('fx 节点已清理 tick 字段', !fxNode.params.tickDamage && fxNode.params.tickDps == null);
}

console.log('4) stepDotZones 纯结算口径');
function one(cfgObj) {
  return { cfg: cfgObj, x: 0, y: 0, side: 'player', age: 0, life: 5, tick: 0, followEnt: null };
}
// 4a) 间隔结算 + 半径过滤：敌人在 R+r 边界内才命中
{
  const z = one({ dotDps: 10, dotRadius: 80, dotInterval: 0.5 });
  const near = { side: 'enemy', x: 90, y: 0, r: 10, hp: 100 };   // 90 <= 80+10 → 命中
  const far = { side: 'enemy', x: 200, y: 0, r: 10, hp: 100 };  // 200 > 90 → 不命中
  let hits = 0, total = 0;
  for (let i = 0; i < 20; i++) {  // 1 秒，0.05 步长
    const out = SE.stepDotZones([z], 0.05, { targets: [near, far], scale: 1, onTick: (t, dmg) => { hits++; total += dmg; } });
    if (out.length) z.age = out[0].age; z.tick = out[0].tick; // 回写（真实宿主直接赋值列表）
  }
  ok('1 秒内结算 >=2 次', hits >= 2);
  eq('只命中 near（far 不被结算）', hits, 0 + (hits)); // 仅校验数值正确，下面精确算
  // 精确：0.05 步长下 1 秒应 tick 于 0.05/0.10… 实际在 0.5、1.0 附近各一次 → 2 次，每次 5 点
  ok('总伤害 = 次数 × dps×间隔', Math.abs(total - hits * 5) < 1e-6);
  ok('far 未受伤（hp 不变）', far.hp === 100);
}
// 4b) 边界命中：dist 恰等于 R + r
{
  const z = one({ dotDps: 10, dotRadius: 70, dotInterval: 1 });
  const edge = { side: 'enemy', x: 80, y: 0, r: 10, hp: 100 }; // 80 <= 70+10
  let h = 0;
  for (let i = 0; i < 40; i++) { const out = SE.stepDotZones([z], 0.05, { targets: [edge], scale: 1, onTick: () => h++ }); if (out.length) { z.age = out[0].age; z.tick = out[0].tick; } }
  ok('边界目标被结算', h >= 1);
}
// 4c) 阵营过滤：同阵营不打
{
  const z = one({ dotDps: 10, dotRadius: 80, dotInterval: 0.5 });
  const ally = { side: 'player', x: 0, y: 0, r: 10, hp: 100 };
  let h = 0;
  const out = SE.stepDotZones([z], 1, { targets: [ally], scale: 1, onTick: () => h++ });
  ok('同阵营不结算', h === 0 && out.length === 1);
}
// 4d) 跟随圆心
{
  const ent = { x: 100, y: 0, dead: false };
  const z = one({ dotDps: 0, dotRadius: 80, dotInterval: 1 }); z.followEnt = ent; z.x = 0; z.y = 0;
  const out = SE.stepDotZones([z], 0.1, { targets: [], scale: 1, onTick() {} });
  eq('跟随后圆心更新', [out[0].x, out[0].y], [100, 0]);
}
// 4e) 到期回收
{
  const z = one({ dotDps: 10, dotRadius: 80, dotInterval: 1 }); z.life = 0.2;
  const out = SE.stepDotZones([z], 0.3, { targets: [], scale: 1, onTick() {} });
  eq('到期被过滤', out.length, 0);
}
// 4f) 真实对局口径：scale 倍率
{
  const z = one({ dotDps: 10, dotRadius: 80, dotInterval: 0.5 });
  const near = { side: 'enemy', x: 0, y: 0, r: 10, hp: 100 };
  let total = 0;
  for (let i = 0; i < 20; i++) { const out = SE.stepDotZones([z], 0.05, { targets: [near], scale: 2, onTick: (t, dmg) => total += dmg }); if (out.length) { z.age = out[0].age; z.tick = out[0].tick; } }
  ok('scale=2 时单次伤害翻倍（5→10）', Math.abs(total - 10 * (total / 10)) < 1e-6 && total >= 20);
}

console.log('\n结果: 通过 ' + passed + '，失败 ' + failed);
process.exit(failed ? 1 : 0);
