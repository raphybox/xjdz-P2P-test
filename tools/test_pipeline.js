/* 固定七段流水线（skill-pipeline.js）回归测试
   node tools/test_pipeline.js
   重点：七段固定拓扑、旧图回收不丢参数、翻译出的 graph 能被现有编译器正确编译、
        事件出口映射到事件组、切换槽类型后旧数值可恢复。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');

let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) console.log('  ok  ', name, extra === undefined ? '' : '=', JSON.stringify(extra));
  else { fail++; console.log('  FAIL', name, extra === undefined ? '' : '= ' + JSON.stringify(extra)); }
};

const ctx = {
  window: {}, console, Promise, Math, Object, Number, String, Array, JSON,
  isFinite, isNaN, Set, Map, WeakMap, parseFloat, parseInt, Date
};
ctx.window.window = ctx.window;
ctx.globalThis = ctx.window;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'skill-modules.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'skill-pipeline.js'), 'utf8'), ctx);
const SM = ctx.window.SkillModules;
const SP = ctx.window.SkillPipeline;

console.log('1) 七段固定拓扑');
{
  ok('恰好 7 段', SP.STAGES.length === 7, SP.STAGES.length);
  ok('顺序与参考图一致', SP.STAGES.map(s => s.id).join(',') ===
    'target,cast,behavior,transfer,settle1,events,settle2', SP.STAGES.map(s => s.id));
  ok('命中行为 / 技能事件是并行段',
    SP.STAGES.filter(s => s.parallel).map(s => s.id).join(',') === 'behavior,events');
  ok('事件出口 7 个', SP.EVENT_PORTS.length === 7, SP.EVENT_PORTS.length);
  ok('每个出口都映射到四个事件组之一',
    SP.EVENT_PORTS.every(p => ['onCast', 'onHit', 'onWall', 'onExpire'].indexOf(p.ev) >= 0));
  ok('20 个模块类型都能被某段接纳',
    SM.TYPES.every(t => t === 'source' || SP.stageOf(t) !== null),
    SM.TYPES.filter(t => t !== 'source' && !SP.stageOf(t)));
}

console.log('\n2) 空白流水线 → graph 可编译');
{
  const pl = SP.blankPipeline();
  ok('七段都有 stage 数据', SP.STAGES.every(s => !!pl.stages[s.id]));
  const g = SP.toGraph(pl);
  ok('有节点', g.nodes.length > 0, g.nodes.length);
  ok('根是 source', g.nodes[0].type === 'source', g.nodes[0].type);
  ok('边数 = 节点数 - 1（单链）', g.edges.length === g.nodes.length - 1, g.edges.length);
  ok('全部是因果连线', g.edges.every(e => e.kind === 'flow'));
  let threw = null, C = null;
  try { C = SM.compile({ id: 't', name: 't', charge: 3, graph: g }); } catch (e) { threw = e; }
  ok('现有编译器可直接编译（零改动）', !threw, threw && threw.message);
  ok('所有节点都可达', C && Object.keys(C.liveIds || {}).length === g.nodes.length);
}

console.log('\n3) 旧图 → 七段：参数与节点 id 都不丢');
{
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/game-config.json'), 'utf8'));
  const raw = (cfg.skills || []).find(s => s.graph && (s.graph.nodes || []).some(n => n.type === 'fx' && n.params && n.params.attach === 'path'));
  ok('找到含路径特效的真实技能', !!raw);
  if (raw) {
    const pl = SP.fromGraph(raw.graph);
    const all = [];
    SP.STAGES.forEach(s => (pl.stages[s.id].slots || []).forEach(x => all.push(x)));
    ok('节点全部回收', all.length === raw.graph.nodes.length, { got: all.length, want: raw.graph.nodes.length });
    ok('原节点 id 保留', all.every(x => raw.graph.nodes.some(n => n.id === x.id)));
    const fx = all.find(x => x.type === 'fx' && x.params.attach === 'path');
    ok('毒云特效参数保留', fx && fx.params.effect === 'nature/poison-cloud', fx && fx.params.effect);
    ok('路径间隔保留', fx && fx.params.pathInterval === 1, fx && fx.params.pathInterval);
    const dmg = all.find(x => x.type === 'damage' && x.params.dotEnable);
    ok('持续伤害参数保留', dmg && dmg.params.dotDps === 8, dmg && dmg.params.dotDps);
    ok('target 段以 source 打头', pl.stages.target.slots[0].type === 'source');
    const g2 = SP.toGraph(pl);
    let threw = null;
    try { SM.compile({ id: raw.id, name: raw.name, charge: raw.charge, graph: g2 }); } catch (e) { threw = e; }
    ok('回译后的图可编译', !threw, threw && threw.message);
    ok('回译节点数与旧图一致', g2.nodes.length === raw.graph.nodes.length, g2.nodes.length);
  }
}

console.log('\n4) 槽类型切换 / 停用 / 事件出口');
{
  const pl = SP.blankPipeline();
  const slot = pl.stages.settle1.slots[0];
  const before = slot.params.base;
  slot.params.base = 123;
  ok('切换类型成功', SP.switchSlotType(pl, 'settle1', slot.id, 'status'));
  ok('字段整体换掉', slot.type === 'status' && slot.params.base === undefined);
  ok('切回时旧数值恢复', SP.switchSlotType(pl, 'settle1', slot.id, 'damage') && slot.params.base === 123, slot.params.base);
  ok('before 默认值存在', before !== undefined);

  slot.enabled = false;
  const g = SP.toGraph(pl);
  const nd = g.nodes.find(n => n.id === slot.id);
  ok('停用槽写进 graph', nd && nd.enabled === false);
  const C = SM.compile({ id: 't', name: 't', charge: 3, graph: g });
  ok('停用槽不进事件组', !Object.keys(C.events || {}).some(ev =>
    ((C.events[ev].damageList) || []).some(d => d.base === 123)));

  const pl2 = SP.blankPipeline();
  pl2.stages.events.ports.wall.enabled = true;
  pl2.stages.events.ports.wall.type = 'damage';
  pl2.stages.events.ports.wall.params = Object.assign(SP.defaultParams('damage'), { base: 77 });
  const g2 = SP.toGraph(pl2);
  const wallNode = g2.nodes.find(n => n.params && n.params.base === 77);
  ok('事件出口生成结算节点', !!wallNode);
  ok('撞墙出口写入 onWall', wallNode && wallNode.params.triggerEvent === 'onWall',
    wallNode && wallNode.params.triggerEvent);
}

console.log('\n5) 与既有测试口径兼容');
{
  const css = fs.readFileSync(path.join(ROOT, 'admin.css'), 'utf8');
  let o = 0, c = 0; for (const ch of css) { if (ch === '{') o++; else if (ch === '}') c++; }
  ok('CSS 配平', o === c);
  const html = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  ok('admin.html 在 skill-modules.js 之后加载 skill-pipeline.js',
    html.indexOf('skill-modules.js') < html.indexOf('skill-pipeline.js') &&
    html.indexOf('skill-pipeline.js') < html.indexOf('admin.js'));
  const admin = fs.readFileSync(path.join(ROOT, 'admin.js'), 'utf8');
  ok('视图切换与流水线动作齐全',
    ['se-view', 'se-p-add-slot', 'se-p-del-slot', 'se-p-toggle-slot', 'se-p-toggle-stage', 'se-p-toggle-port']
      .every(k => admin.indexOf(k) >= 0));
  ok('改数值会翻译回 graph', /function seApplyPipeline\(\)[\s\S]{0,300}toGraph\(pl\)/.test(admin));
}

console.log(fail ? '\nFAILED ' + fail + ' 项' : '\nALL PASS');
process.exit(fail ? 1 : 0);
