'use strict';
/* 像素特效定向样例（10 个）回归：
   1) 预设存在且互不重名；
   2) effect 必须是 pixelfx 244 里真实存在的 id，且不与现有果实/预设重复；
   3) 图能编译，含 source 与表现卡；
   4) 每条边都满足端口类型规则（同端口重复边不算错）。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const SM = require(path.join(ROOT, 'skill-modules.js'));
const K = require(path.join(ROOT, 'skill-ports.js'));

let fail = 0;
const ok = (n, c) => { if (c) console.log('  ok  ', n); else { fail++; console.log('  FAIL', n); } };

const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'data/pixelfx-catalog.js'), 'utf8'), ctx);
const CAT = ctx.window.PIXELFX_CATALOG;
const IDS = new Set(CAT.map(e => e.id));

/* 现有果实与旧预设已经用掉的特效，新样例必须避开 */
const USED = new Set([
  'fire/fireball', 'lightning/chain-lightning', 'ice/frost-nova', 'projectiles/magic-missile',
  'arcane/arcane-missiles', 'ice/frost-breath', 'nature/poison-cloud', 'holy/divine-shield',
  'melee/heavy-cleave', 'status/slowed', 'nature/tornado'
]);

const CASES = [
  ['耀阳圣球', 'holy/sunburst'],
  ['冰棘突刺', 'ice/ice-spikes'],
  ['雷鸣震爆', 'lightning/thunderclap'],
  ['暗影虹吸', 'shadow/life-steal'],
  ['荆棘缠根', 'nature/root-snare'],
  ['水晶棱镜', 'ice/ice-crystal'],
  ['陨星火雨', 'fire/meteor'],
  ['晶盘回旋', 'projectiles/energy-disc'],
  ['涌泉漩涡', 'water/whirlpool'],
  ['大地裂击', 'nature/earth-spike']
];

console.log('1) 预设与特效 id');
{
  const names = new Set();
  CASES.forEach(([name, fx]) => {
    const p = SM.PRESETS.find(x => x.name === name);
    ok('存在预设「' + name + '」', !!p);
    if (p) { ok('「' + name + '」不重名', !names.has(name)); names.add(name); }
    ok('「' + name + '」的特效 ' + fx + ' 在 244 个目录里', IDS.has(fx));
    ok('「' + name + '」没有复用现有特效', !USED.has(fx));
  });
}

console.log('\n2) 图结构 / 编译 / 端口');
CASES.forEach(([name, fx]) => {
  const p = SM.PRESETS.find(x => x.name === name);
  if (!p) return;
  const graph = p.build();
  const sk = { id: 't_' + name, name, graph, tier: p.tier, charge: p.charge };
  const fxNodes = graph.nodes.filter(n => n.type === 'fx' || n.type === 'particles').map(n => n.params && n.params.effect).filter(Boolean);
  ok('「' + name + '」用了目标特效', fxNodes.indexOf(fx) >= 0);
  ok('「' + name + '」的主题特效唯一且未串台', fxNodes.filter(x => x === fx).length === 1);
  ok('「' + name + '」有触发卡', graph.nodes.some(n => n.type === 'source'));
  let C = null, err = '';
  try { C = SM.compile(sk); } catch (e) { err = e && e.message; }
  ok('「' + name + '」可编译' + (err ? '（' + err + '）' : ''), !!C);
  ok('「' + name + '」编译后包含表现卡', !!(C && C.present && (C.present.fx || C.present.particles)));
  let portBad = 0;
  graph.edges.forEach(e => {
    const sk2 = { id: sk.id, name, graph: { nodes: graph.nodes, edges: graph.edges.filter(x => x !== e) } };
    const r = K.canConnect(sk2, e.from, e.fromPort, e.to, e.toPort);
    if (!r.ok) { portBad++; console.log('      端口不合法：' + e.fromPort + ' → ' + e.toPort + ' · ' + r.msg); }
  });
  ok('「' + name + '」' + graph.edges.length + ' 条边端口全部合法', portBad === 0);
});

console.log('\n3) 与现有样例的整体约束');
{
  const presetNames = SM.PRESETS.map(p => p.name);
  ok('10 个新预设全部进入 SM.PRESETS', CASES.every(([n]) => presetNames.indexOf(n) >= 0));
  ok('新预设未占用旧样例名字', CASES.every(([n]) => presetNames.filter(x => x === n).length === 1));
}

console.log(fail ? '\nFAILED ' + fail + ' 项' : '\nALL PASS');
process.exit(fail ? 1 : 0);
