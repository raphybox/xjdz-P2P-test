/* 伤害路由回归：编译期「命中判定」自动解析 + 「伤害对象」分流 + 两端消费口径
   背景：冲锋技能（来源 → 自身位移 → 伤害·命中时）没有投射物 / 范围载体，
   旧实现走「直接命中对手」，导致弹珠没碰到敌人也扣血。
   现在：编译期把 auto 落成 body，需要真实接触才结算；施放瞬间不扣血。 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const SM = require(path.join(ROOT, 'skill-modules.js'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' → ' + extra : '')); }
}
function eq(name, got, want) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  ok(name, a === b, 'got=' + a + ' want=' + b);
}
const adminSrc = fs.readFileSync(path.join(ROOT, 'admin.js'), 'utf8');
const gameSrc = fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8');

function compileGraph(nodes, edges) {
  return SM.compile({ name: 't', mods: {}, charge: 3, graph: SM.makeGraph(nodes, edges) });
}
function chain(spec) {
  // spec: [{type, params}...] 线性串联
  const nodes = spec.map((s, i) => SM.node(s.type, 40 + i * 200, 90, s.params || {}));
  const edges = nodes.slice(1).map((n, i) => ({ from: nodes[i].id, to: n.id }));
  return compileGraph(nodes, edges);
}

console.log('1) 命中判定 auto 解析（编译期定死，两端只认 _hitKind）');
const chargeSkill = chain([
  { type: 'source', params: { trigger: 'onCharge' } },
  { type: 'motion', params: { triggerEvent: 'onCast', scope: 'self', track: 'line', distance: 120, duration: 0.35 } },
  { type: 'damage', params: { triggerEvent: 'onHit', base: 20 } }
]);
eq('冲锋（只有自身位移）→ 弹珠碰撞', chargeSkill.events.onHit.damageList[0]._hitKind, 'body');
ok('冲锋 onHit 需要真实接触', SM.onHitNeedsContact(chargeSkill.events.onHit) === true);

const projSkill = chain([
  { type: 'source', params: { trigger: 'onCharge' } },
  { type: 'projectile', params: {} },
  { type: 'damage', params: { triggerEvent: 'onHit', base: 12 } }
]);
eq('有投射物 → 投射物命中', projSkill.events.onHit.damageList[0]._hitKind, 'projectile');
ok('投射物技能同样要求真实命中（有载体会走投射物分支）', SM.onHitNeedsContact(projSkill.events.onHit) === true);

const rangeSkill = chain([
  { type: 'source', params: { trigger: 'onCharge' } },
  { type: 'range', params: { shape: 'circle', radius: 70, origin: 'caster' } },
  { type: 'damage', params: { triggerEvent: 'onHit', base: 15 } }
]);
eq('有范围判定 → 范围命中', rangeSkill.events.onHit.damageList[0]._hitKind, 'area');

const plainSkill = chain([
  { type: 'source', params: { trigger: 'onCharge' } },
  { type: 'damage', params: { triggerEvent: 'onHit', base: 15 } }
]);
eq('什么都没有 → 必中直击（旧行为）', plainSkill.events.onHit.damageList[0]._hitKind, 'direct');

const explicit = chain([
  { type: 'source', params: { trigger: 'onCharge' } },
  { type: 'motion', params: { triggerEvent: 'onCast', scope: 'self', distance: 120, duration: 0.35 } },
  { type: 'damage', params: { triggerEvent: 'onHit', base: 20, hitKind: 'direct' } }
]);
eq('显式选「直接命中」覆盖 auto', explicit.events.onHit.damageList[0]._hitKind, 'direct');
ok('显式 direct 不再要求接触', SM.onHitNeedsContact(explicit.events.onHit) === false);

const oppMotion = chain([
  { type: 'source', params: { trigger: 'onCharge' } },
  { type: 'motion', params: { triggerEvent: 'onCast', scope: 'opponent', distance: 80, duration: 0.3 } },
  { type: 'damage', params: { triggerEvent: 'onHit', base: 10 } }
]);
eq('只推对手（非自身位移）不改变命中口径', oppMotion.events.onHit.damageList[0]._hitKind, 'direct');

console.log('2) 伤害对象分流（敌方 / 自身 / 双方）');
const selfSkill = chain([
  { type: 'source', params: { trigger: 'onCharge' } },
  { type: 'damage', params: { triggerEvent: 'onHit', base: 30, affect: 'self' } }
]);
const sg = selfSkill.events.onHit;
eq('self 节点 _affect', sg.damageList[0]._affect, 'self');
eq('敌方结算取不到 self 节点', SM.damageNodesFor(sg, 'direct', 'enemy').length, 0);
eq('自身结算取到 self 节点', SM.damageNodesFor(sg, 'direct', 'self').length, 1);
const bothSkill = chain([
  { type: 'source', params: { trigger: 'onCharge' } },
  { type: 'damage', params: { triggerEvent: 'onHit', base: 10, affect: 'both' } }
]);
eq('both 节点参与敌方结算', SM.damageNodesFor(bothSkill.events.onHit, 'direct', 'enemy').length, 1);
eq('both 节点参与自身结算', SM.damageNodesFor(bothSkill.events.onHit, 'direct', 'self').length, 1);
eq('默认伤害对象是敌方', plainSkill.events.onHit.damageList[0]._affect, 'enemy');

console.log('3) 命中来源过滤口径');
const bodyNode = chargeSkill.events.onHit.damageList[0];
ok('body 节点接受 body', SM.damageAcceptsKind(bodyNode, 'body') === true);
ok('body 节点拒绝 projectile', SM.damageAcceptsKind(bodyNode, 'projectile') === false);
ok('body 节点拒绝 area', SM.damageAcceptsKind(bodyNode, 'area') === false);
ok('未知来源（DoT / tick）不过滤', SM.damageAcceptsKind(bodyNode, null) === true);
eq('命中来源过滤同时作用于敌方 / 自身', SM.damageNodesFor(chargeSkill.events.onHit, 'projectile', 'enemy').length, 0);

console.log('4) 用户真实技能（data/game-config.json 里的冲锋）');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/game-config.json'), 'utf8'));
const rush = (cfg.skills || []).find(s => /冲锋/.test(s.name || ''));
if (rush) {
  const C = SM.compile(rush);
  const dm = C.events.onHit.damageList[0];
  eq('冲锋伤害判定 = 弹珠碰撞', dm && dm._hitKind, 'body');
  ok('冲锋不再走必中直击', SM.onHitNeedsContact(C.events.onHit) === true);
} else {
  console.log('  - 数据里没有「冲锋」技能，跳过');
}

console.log('5) 两端消费口径（源码断言）');
ok('对局：无载体分支按 skillNeedsContact 拦掉隔空结算',
  /needsContact\s*=\s*\(SM && SM\.skillNeedsContact\)/.test(gameSrc));
ok('对局：只在真实碰撞时带 kind 结算', /if \(hitKind\) directHit\(PUB, f, opp, hitKind\)/.test(gameSrc));
ok('对局：物理碰撞传 body 来源',
  /triggerSkillEvent\(p, 'onHit', null, \{ kind: 'body' \}\)/.test(gameSrc));
ok('对局：本体碰撞窗口（充能已清零也能结算这一发）',
  /armBodyWindow/.test(gameSrc) && /resolveBodyHit/.test(gameSrc) && /caster\.bodyUntil/.test(gameSrc));
ok('对局：投射物命中标记 projectile', /ctx\.kind = 'projectile'/.test(gameSrc));
ok('对局：即时形态标记 area', /'onHit', ctx\.targets, undefined, ctx, 'area'\)/.test(gameSrc));
ok('对局：反噬走自身结算', /computeSkillDamage\(grp, att, att, sc, rctx, 'self'\)/.test(gameSrc));

ok('试放：命中结算接收 kind 并按节点过滤', /function hitPreview\(gHit, x, y, parent, dmgScale, view, ctx, kind\)/.test(adminSrc)
  && /SM\.damageNodesFor\(g, kind, side\)/.test(adminSrc));
ok('试放：无载体 + 需要接触时不结算', /SM\.skillNeedsContact \? SM\.skillNeedsContact\(PUB\)/.test(adminSrc));
ok('试放：两颗弹珠有本体碰撞', /function stepBalls\(\)/.test(adminSrc) && /function bodyHitPreview\(\)/.test(adminSrc));
ok('试放：本体碰撞按 body 来源结算', /SM\.damageNodesFor\(gHit, 'body', 'enemy'\)/.test(adminSrc));
ok('试放：反噬跳红字', /反噬 -/.test(adminSrc));
ok('属性面板展示命中判定 / 伤害目标', /命中判定：/.test(adminSrc) && /伤害目标：/.test(adminSrc));

console.log('6) 目标·锁定模块');
const selDef = SM.MODULES.select;
ok('模块已注册', !!selDef);
ok('字段齐全（含通用绑定字段）', ['side', 'pick', 'count'].every(k => selDef.fields.some(f => f.key === k)), JSON.stringify(selDef.fields.map(f => f.key)));
eq('默认选择自身', SM.defaults('select').side, 'self');
eq('默认挑选最近', SM.defaults('select').pick, 'nearest');
const selSkill = (cfg, nodes) => {
  const ns = [
    SM.node('source', 40, 90, { trigger: 'onCharge' }),
    SM.node('select', 220, 90, cfg || {}),
    SM.node('damage', 420, 90, { triggerEvent: 'onCast', base: 12 })
  ].concat(nodes || []);
  return compileGraph(ns, [
    { from: ns[0].id, to: ns[1].id },
    { from: ns[1].id, to: ns[2].id }
  ]);
};
const cSel = selSkill({ side: 'enemyOne', pick: 'nearest' });
ok('编译结果带 select 配置', !!cSel.select && cSel.select.side === 'enemyOne');
ok('present.select = true', cSel.present.select === true);
const hero = { x: 0, y: 0, hp: 100, side: 'player' };
const e1 = { x: 100, y: 0, hp: 80, side: 'enemy' };
const e2 = { x: 300, y: 0, hp: 50, side: 'enemy' };
const e3 = { x: 200, y: 0, hp: 90, side: 'enemy', dead: true };
const ally = { x: 50, y: 0, hp: 70, side: 'player' };
const pool = [hero, e1, e2, e3, ally];
eq('单个敌人（最近）', SM.selectTargets(cSel, hero, pool).map(e => e.x), [100]);
eq('单个敌人（最远）', SM.selectTargets(selSkill({ side: 'enemyOne', pick: 'farthest' }), hero, pool).map(e => e.x), [300]);
const cMany = selSkill({ side: 'enemyMany', pick: 'nearest', count: 2 });
eq('多个敌人取最近 2 个（跳过死亡）', SM.selectTargets(cMany, hero, pool).map(e => e.x), [100, 300]);
const cLow = selSkill({ side: 'enemyMany', pick: 'lowestHp', count: 2 });
eq('多个敌人按血量升序', SM.selectTargets(cLow, hero, pool).map(e => e.x), [300, 100]);
eq('自身目标', SM.selectTargets(selSkill({ side: 'self' }), hero, pool).map(e => e.x), [0]);
eq('队友目标', SM.selectTargets(selSkill({ side: 'allyOne' }), hero, pool).map(e => e.x), [50]);
eq('数量上限 4', SM.selectTargets(selSkill({ side: 'enemyMany', count: 9 }), hero, pool).length, 2);

console.log('7) 触发事件与命中来源的对应');
const castDmg = chain([
  { type: 'source', params: { trigger: 'onCharge' } },
  { type: 'damage', params: { triggerEvent: 'onCast', base: 10 } }
]);
eq('施放时伤害标记 cast', castDmg.events.onCast.damageList[0]._hitKind, 'cast');
ok('cast 节点只被施放结算取用', SM.damageNodesFor(castDmg.events.onCast, 'cast', 'enemy').length === 1 &&
  SM.damageNodesFor(castDmg.events.onCast, 'body', 'enemy').length === 0);
const wallDmg = chain([
  { type: 'source', params: { trigger: 'onCharge' } },
  { type: 'damage', params: { triggerEvent: 'onWall', base: 15 } }
]);
eq('撞墙时伤害标记 wall', wallDmg.events.onWall.damageList[0]._hitKind, 'wall');
ok('wall 节点只被撞墙结算取用', SM.damageNodesFor(wallDmg.events.onWall, 'wall', 'enemy').length === 1);

console.log('8) 击退与击飞撞墙（两端源码断言）');
ok('对局：伤害结果带击退', /return \{ amount: Math\.max\(0, amount\), crit: crit, knockback: knockback \}/.test(gameSrc));
ok('对局：击退沿施法者方向给冲量并放宽速度上限', /function applyKnockback\(target, att, kb\)/.test(gameSrc) && /_motionCapUntil/.test(gameSrc));
ok('对局：命中结算调用击退 + 撞墙标记', /applyKnockback\(t, att, Math\.max\(d\.knockback, \(SM && SM\.skillKnockback\)/.test(gameSrc));
ok('对局：物理撞墙/障碍后结算击飞伤害', /if \(wb \|\| obHit\) resolveSlamDamage\(f, wallContact\)/.test(gameSrc));
ok('对局：撞墙伤害只认 wall 来源', /damageNodesFor\(grp, 'wall', 'enemy'\)/.test(gameSrc));
ok('对局：施放时伤害入口存在且按 cast 过滤', /function applyEventCastDamage/.test(gameSrc) && /damageNodesFor\(grp, 'cast', 'enemy'\)/.test(gameSrc));
ok('对局：施放时目标走锁定模块', /function castTargetsOf/.test(gameSrc) && /SM\.selectTargets\(C, att, ents\)/.test(gameSrc));
ok('试放：施放伤害 / 击退 / 撞墙三件套', /function groupDamagePreview/.test(adminSrc) &&
  /function knockPreview/.test(adminSrc) && /function resolveSlamPreview/.test(adminSrc));
ok('试放：弹珠撞沙盘墙体也结算击飞伤害', /resolveSlamPreview\(b\)/.test(adminSrc) && /circleHitsWall\(b, wl\)/.test(adminSrc));
ok('属性面板：施放/撞墙显示对应结算时机', /结算时机：<strong>施放瞬间/.test(adminSrc) && /受击者被本技能击退撞墙/.test(adminSrc));

console.log('\n' + (fail ? 'FAILED ' + fail + ' 项' : 'ALL PASS ' + pass + ' 项'));
process.exit(fail ? 1 : 0);
