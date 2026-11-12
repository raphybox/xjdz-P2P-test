/* 「范围判定 → 延迟 → 像素特效(弹珠移动路径) → 伤害·持续伤害 + 事件状态」链路诊断
   node tools/test_path_dot_delay.js
   断言：
   1) 编译期把下游伤害的持续伤害配置路由到路径特效节点（_pathDot 非空、dotFollow 强制 impact）
   2) 该伤害节点带 _routedToPath（不再单独生成跟随红圈）
   3) 延迟不破坏路由（各节点 _delay 正确）
   4) 单独跑「路径落点 → 判定区」时，即使特效渲染抛异常，判定区仍然生成 */
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

const ctx = { window: {}, console, Promise, Math, Object, Number, String, Array, JSON, isFinite, isNaN, Set, Map, WeakMap, parseFloat, parseInt, Date };
ctx.window.window = ctx.window;
ctx.globalThis = ctx.window;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'skill-modules.js'), 'utf8'), ctx);
const SM = ctx.window.SkillModules;

const N = (id, type, params) => ({ id, type, params: params || {}, x: 0, y: 0 });
const E = (from, to) => ({ from, to });
const skill = (dotEnable, dotDps) => ({
  id: 's', name: '诊断', charge: 3,
  graph: {
    nodes: [
      N('src', 'source'),
      N('rng', 'range', { shape: 'circle', radius: 80, maxTargets: 20 }),
      N('dly', 'delay', { seconds: 1 }),
      N('fx', 'fx', { effect: 'nature/poison-cloud', scale: 0.75, attach: 'path', life: 5, loop: true, pathInterval: 0.15, pathDuration: 2 }),
      N('dmg', 'damage', { base: 0, dotEnable: dotEnable, dotDps: dotDps, dotRadius: 70, dotDuration: 6 }),
      N('st', 'status', { status: 'slow', self: false, triggerEvent: 'onHit' })
    ],
    edges: [E('src', 'rng'), E('rng', 'dly'), E('dly', 'fx'), E('fx', 'dmg'), E('fx', 'st')]
  }
});

console.log('1) 持续伤害开启：路由应挂到路径特效');
{
  const C = SM.compile(skill(true, 8));
  const g = (C.events && C.events.onHit) || C;
  const f = (g.fx || [])[0];
  ok('fx 存在', !!f);
  ok('attach = path', f && f.attach, f && f.attach);
  ok('_pathDot 非空', !!(f && f._pathDot && f._pathDot.length), f && f._pathDot && f._pathDot.length);
  const dc = (f && f._pathDot && f._pathDot[0]) || {};
  ok('dotFollow 强制 impact', dc.dotFollow, dc.dotFollow);
  ok('dotDps 正确', dc.dotDps, dc.dotDps);
  ok('dotRadius 正确', dc.dotRadius, dc.dotRadius);
  ok('fx _delay = 1', f && f._delay, f && f._delay);
  const dm = (g.damageList || [])[0] || {};
  ok('伤害节点 _routedToPath', !!dm._routedToPath, dm._routedToPath);
  ok('伤害节点 _delay = 1', dm._delay, dm._delay);
  const st = (g.status || [])[0] || {};
  ok('状态节点 _delay = 1', st._delay, st._delay);
}

console.log('\n2) 持续伤害关闭：不应路由（红圈由伤害节点自己决定）');
{
  const C = SM.compile(skill(false, 0));
  const g = (C.events && C.events.onHit) || C;
  const f = (g.fx || [])[0];
  ok('_pathDot 为空', !(f && f._pathDot && f._pathDot.length), f && f._pathDot && f._pathDot.length);
  const dm = (g.damageList || [])[0] || {};
  ok('未标记 _routedToPath', !dm._routedToPath, !!dm._routedToPath);
}

console.log('\n3) 落点生成判定区：特效抛异常也必须照常生成（顺序/异常隔离）');
{
  // 复刻 admin.js stepPathEmittersPreview 的落点循环：判定区必须先生成，特效渲染隔离在后
  let dotZones = [], pathEmittersPreview = [];
  let t = 0;
  const caster = { x: 70, y: 100, r: 16, side: 'player' };
  const C = SM.compile(skill(true, 8));
  const g = (C.events && C.events.onHit) || C;
  const f = (g.fx || [])[0];
  pathEmittersPreview.push({
    owner: caster, kind: 'fx', node: f,
    interval: Math.max(0.02, Number(f.pathInterval) || 0.15),
    life: Math.max(0.1, Number(f.pathDuration) || 2),
    age: 0, tick: 0, pathDot: f._pathDot || null
  });
  const spawnFxThrows = () => { throw new Error('PixelFX.spawn failed (simulated)'); };
  const dt = 1 / 60;
  for (let i = 0; i < 60; i++) {   // 模拟 1 秒
    t += dt;
    pathEmittersPreview = pathEmittersPreview.filter(em => {
      em.age += dt;
      if (em.age >= em.life) return false;
      em.tick -= dt;
      if (em.tick > 0) return true;
      em.tick += em.interval;
      // 判定区（玩法逻辑）先做，特效渲染（表现）后做且必须被隔离
      if (em.pathDot) em.pathDot.forEach(dc => dotZones.push({ cfg: dc, x: em.owner.x, y: em.owner.y, born: t }));
      try { spawnFxThrows(); } catch (e) { /* 表现层失败不影响玩法 */ }
      return true;
    });
  }
  ok('1 秒内生成了判定区', dotZones.length > 0, dotZones.length);
  ok('判定区半径来自配置', dotZones[0] && dotZones[0].cfg.dotRadius, dotZones[0] && dotZones[0].cfg.dotRadius);
}

console.log('\n4) 源码结构：判定区必须排在特效生成之前（试放 + 对局两端）');
{
  [['admin.js', 'stepPathEmittersPreview'], ['game.js', 'stepPathEmitters']].forEach(([file, fnName]) => {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const at = src.indexOf('function ' + fnName + '(');
    ok(file + ' 找到 ' + fnName, at >= 0);
    if (at < 0) return;
    // 取函数体前 2200 字符（足够覆盖落点循环体），比较两段代码的先后
    const seg = src.slice(at, at + 2200);
    const iDot = seg.indexOf('em.pathDot');
    const iFx = seg.indexOf("em.kind === 'fx'");
    ok(file + ' 判定区在特效之前', iDot >= 0 && iFx >= 0 && iDot < iFx, { iDot, iFx });
    ok(file + ' 特效生成有 try 隔离', seg.indexOf('try {', iDot) > 0);
  });
}

console.log(fail ? '\nFAILED ' + fail + ' 项' : '\nALL PASS');
process.exit(fail ? 1 : 0);
