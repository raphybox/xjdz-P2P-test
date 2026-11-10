/* 回归测试：印记「覆盖」叠加方式 + 敌方特效随印记消失 / 同类特效覆盖
   做法：从 admin.js 与 game.js 里把**真实的特效回收过滤块**原样抽出来，在无头 Chrome 里执行。
   - 印记叠加：从 game.js 抽 markCfgOf / applyMarkModule / clearMark / stepMarks 在 vm 里跑
   - 特效回收：真实过滤块 + real skill-effects.js + stub PixelFX
   用法：node tools/test_mark_fx_lifecycle.js */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const seg = (src, a, b) => {
  const i = src.indexOf(a), j = src.indexOf(b);
  if (i < 0 || j < 0 || j <= i) throw new Error('切片失败: ' + a);
  return src.slice(i, j);
};

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : (fail++, console.log('  FAIL ' + name + ' → got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)));
};

/* ---------------- 1. game.js：印记叠加（含新增的 replace） ---------------- */
const g = read('game.js');
const markSrc = [
  seg(g, 'function markCfgOf(', 'function applyMarkModule('),
  seg(g, 'function applyMarkModule(', 'function detonateMark('),
  seg(g, 'function detonateMark(', '  // detonateOnExpire=true'),
  seg(g, 'function clearMark(', '  // 印记逐帧结算'),
  seg(g, 'function stepMarks(', '  function scheduleEchoModule(')
].join('\n');

const G = { clock: 0, trauma: 0, skillParts: [], player: null, enemy: null };
const ctx = { G, EFFECTS: { dmgScale: 1 }, SKILL_RT: null, applyDamage: () => { }, console };
vm.createContext(ctx);
vm.runInContext(markSrc + '\nthis.applyMarkModule = applyMarkModule; this.stepMarks = stepMarks;', ctx);

const att = { side: 'player', hp: 100, maxHp: 100, x: 0, y: 0, r: 16 };
const tgt = { side: 'enemy', hp: 100, maxHp: 100, x: 10, y: 0, r: 20 };
G.player = att; G.enemy = tgt; G.actors = [att, tgt];
const MK = over => Object.assign({
  stacks: 1, maxStacks: 9, duration: 5, stackMode: 'add', damageAmp: 10, dotDps: 0,
  armorBreak: 0, slowPct: 0, detonate: 'none', detonateDamage: 0, detonateRadius: 0,
  detonateSplash: 50, consumeOnHit: false, color: '#e8c85a'
}, over || {});

ctx.applyMarkModule(att, tgt, MK({ stacks: 3 }));
ctx.applyMarkModule(att, tgt, MK({ stacks: 2 }));
eq('累加：层数', tgt._markStacks, 5);
eq('累加：效果取较强', tgt._markCfg.damageAmp, 10);

ctx.applyMarkModule(att, tgt, MK({ stacks: 1, stackMode: 'replace', damageAmp: 4, duration: 2 }));
eq('覆盖：层数重置', tgt._markStacks, 1);
eq('覆盖：效果整份替换', tgt._markCfg.damageAmp, 4);
eq('覆盖：时长重算', tgt._markUntil, 2);
ctx.applyMarkModule(att, tgt, MK({ stacks: 2, stackMode: 'add', damageAmp: 30 }));
eq('覆盖后仍可累加', tgt._markStacks, 3);

G.clock = 20;
ctx.stepMarks(0.1);
eq('到期：层数清零', tgt._markStacks, 0);
eq('到期：快照清空', tgt._markCfg, null);

/* ---------------- 2. 真实回收过滤块（admin.js / game.js） ---------------- */
const adminSrc = read('admin.js');
const ai = adminSrc.indexOf('      fxs = fxs.filter(x => {');
const aj = adminSrc.indexOf('      SE.stepFx(fxs, dt);', ai);
const adminBlock = adminSrc.slice(ai, aj).trim();

const gi = g.indexOf('    G.skillFx = G.skillFx.filter(q => {');
const gj = g.indexOf('    });', gi);
if (ai < 0 || aj < 0 || gi < 0 || gj < 0) throw new Error('未能抽取回收过滤块');
const gameBlock = g.slice(gi, gj + '    });'.length).trim();

const stubFx = `
window.PixelFX = (function () {
  var live = 0;
  return {
    live: function () { return live; },
    spawn: function () {
      live++;
      var inst = { dead: false, kill: function () { if (!this.dead) { this.dead = true; live--; } },
        done: function () { return this.dead; }, update: function () {}, render: function () {} };
      return Promise.resolve(inst);
    }
  };
})();`;

function runFixture(name, body) {
  const html = `<!doctype html><meta charset="utf-8"><body><pre id="out">running</pre>
<script src="../skill-effects.js"></script><script>${stubFx}</script><script>${body}</script>`;
  const file = path.join(root, 'dev_backup', name);
  fs.writeFileSync(file, html, 'utf8');
  const dom = execFileSync('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files',
    '--virtual-time-budget=8000', '--dump-dom', 'file:///' + file.replace(/\\/g, '/')
  ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  fs.unlinkSync(file);
  const m = dom.match(/RESULT ([^<]+)/);
  if (!m) { console.log(dom.slice(0, 1200)); throw new Error(name + ' 未产出结果'); }
  const out = {};
  m[1].split(' | ').forEach(kv => { const p = kv.indexOf('='); out[kv.slice(0, p)] = JSON.parse(kv.slice(p + 1)); });
  return out;
}

/* 2a. 试放沙盘：mark 对象 + fxs 列表 */
const adminBody = `
var SE = window.SkillEffects, out = [];
function log(k, v) { out.push(k + '=' + JSON.stringify(v)); }
var fxs = [], mark = { stacks: 0, until: 0, cfg: null }, t = 0;
function prune() {
${adminBlock.replace(/^/gm, '  ')}
}
function cast(node, dur) {
  mark.stacks = Math.min(9, mark.stacks + 1); mark.until = t + dur;
  return SE.spawnFx([node], 'impact', 300, 100, 0, null, { side: 'player' }, null, [target], dur).then(function (a) {
    a.forEach(function (q) { q.born = t; }); SE.pushFx(fxs, a);
  });
}
var caster = { side: 'player', x: 0, y: 0, r: 16 };
var target = { id: 'e', side: 'enemy', x: 300, y: 100, r: 20 };
function advance(sec, steps) {
  var n = steps || 20, dt = sec / n;
  for (var k = 0; k < n; k++) {
    t += dt;
    if (mark.stacks > 0 && t >= mark.until) { mark = { stacks: 0, until: 0, cfg: null }; }
    SE.stepFx(fxs, dt); prune();
  }
}
var node = { attach: 'enemy', enemyPick: 'nearest', effect: 'fx/ring', loop: true, _nid: 'n1' };
(async function () {
  await cast(node, 5); advance(3); await cast(node, 5); advance(3); await cast(node, 5);
  log('repeat_fx', fxs.length); log('repeat_live', window.PixelFX.live());
  advance(5.2); log('expire_fx', fxs.length); log('expire_live', window.PixelFX.live());
  // 关闭同类覆盖：允许叠三份，但印记到期后仍应全清
  fxs.length = 0; mark = { stacks: 0, until: 0, cfg: null }; t = 0;
  var noRep = { attach: 'enemy', enemyPick: 'nearest', effect: 'fx/ring', loop: true, _nid: 'n1', stackReplace: false };
  await cast(noRep, 5); advance(3); await cast(noRep, 5); advance(3); await cast(noRep, 5);
  log('no_replace_fx', fxs.length); advance(5.2); log('no_replace_expire', fxs.length);
  // 显式存在时长：印记还在也按秒收
  fxs.length = 0; mark = { stacks: 0, until: 0, cfg: null }; t = 0;
  var timed = { attach: 'enemy', enemyPick: 'nearest', effect: 'fx/ring', loop: true, _nid: 'n2', life: 2 };
  await cast(timed, 8); advance(1); log('life2_t1', fxs.length);
  advance(1.5); log('life2_t25', fxs.length); log('life2_mark_on', mark.stacks > 0);
  // 施法者身上的循环特效同样只留一份
  fxs.length = 0;
  var selfNode = { attach: 'marble', effect: 'fx/aura', loop: true, _nid: 'n3' };
  for (var r = 0; r < 4; r++) {
    await SE.spawnFx([selfNode], 'impact', 0, 0, 0, null, caster, null, [target], 0).then(function (a) {
      a.forEach(function (q) { q.born = t; }); SE.pushFx(fxs, a);
    });
    advance(0.5);
  }
  log('self_fx', fxs.length);
  document.getElementById('out').textContent = 'RESULT ' + out.join(' | ');
})();`;

/* 2b. 对局：G.skillFx + 目标身上 _markStacks/_markUntil */
const gameBody = `
var SE = window.SkillEffects, out = [];
function log(k, v) { out.push(k + '=' + JSON.stringify(v)); }
var G = { clock: 0, skillFx: [], trauma: 0 };
function pruneGame(now) {
${gameBlock.replace(/^/gm, '  ')}
}
var caster = { side: 'player', x: 0, y: 0, r: 16 };
var enemy = { id: 'e', side: 'enemy', x: 300, y: 100, r: 20, hp: 100, _markStacks: 0, _markUntil: 0 };
function cast(node, dur) {
  enemy._markStacks = 3; enemy._markUntil = G.clock + dur;
  return SE.spawnFx([node], 'impact', enemy.x, enemy.y, 0, null, caster, null, [enemy], dur).then(function (a) {
    a.forEach(function (q) { q.born = performance.now(); }); SE.pushFx(G.skillFx, a);
  });
}
function advance(sec, steps) {
  var n = steps || 20, dt = sec / n;
  for (var k = 0; k < n; k++) {
    G.clock += dt;
    if (enemy._markStacks > 0 && G.clock >= enemy._markUntil) { enemy._markStacks = 0; enemy._markUntil = 0; }
    SE.stepFx(G.skillFx, dt); pruneGame(performance.now());
  }
}
var node = { attach: 'enemy', enemyPick: 'nearest', effect: 'fx/ring', loop: true, _nid: 'n1' };
var timed = { attach: 'enemy', enemyPick: 'nearest', effect: 'fx/ring', loop: true, _nid: 'n2', life: 2 };
(async function () {
  await cast(node, 5); advance(3); await cast(node, 5); advance(3); await cast(node, 5);
  log('g_repeat', G.skillFx.length); log('g_live', window.PixelFX.live());
  advance(5.2); log('g_expire', G.skillFx.length); log('g_expire_live', window.PixelFX.live());
  G.skillFx.length = 0; G.clock = 0;
  await cast(timed, 8); advance(1); log('g_life2_t1', G.skillFx.length);
  advance(1.5); log('g_life2_t25', G.skillFx.length); log('g_mark_on', enemy._markStacks > 0);
  document.getElementById('out').textContent = 'RESULT ' + out.join(' | ');
})();`;

const r1 = runFixture('_t_markfx_admin.html', adminBody);
eq('试放·重复触发只有一份', r1.repeat_fx, 1);
eq('试放·只有一份存活实例', r1.repeat_live, 1);
eq('试放·印记到期后清空', r1.expire_fx, 0);
eq('试放·到期后实例全回收', r1.expire_live, 0);
// 规则收紧：挂在敌方身上且同组有印记时，一份印记只配一份表现（即便关掉「同类特效覆盖」）
eq('试放·关闭覆盖也只留一份', r1.no_replace_fx, 1);
eq('试放·关闭覆盖也会随印记清空', r1.no_replace_expire, 0);
eq('试放·存在时长 1 秒仍在', r1.life2_t1, 1);
eq('试放·存在时长 2.5 秒已回收', r1.life2_t25, 0);
eq('试放·回收不影响印记', r1.life2_mark_on, true);
eq('试放·施法者身上只留一份', r1.self_fx, 1);

const r2 = runFixture('_t_markfx_game.html', gameBody);
eq('对局·重复触发只有一份', r2.g_repeat, 1);
eq('对局·只有一份存活实例', r2.g_live, 1);
eq('对局·印记到期后清空', r2.g_expire, 0);
eq('对局·到期后实例全回收', r2.g_expire_live, 0);
eq('对局·存在时长 1 秒仍在', r2.g_life2_t1, 1);
eq('对局·存在时长 2.5 秒已回收', r2.g_life2_t25, 0);
eq('对局·回收不影响印记', r2.g_mark_on, true);

console.log((fail ? 'FAILED ' + fail + ' 项 / ' : 'ALL PASS ') + (pass + fail) + ' checks');
process.exit(fail ? 1 : 0);
