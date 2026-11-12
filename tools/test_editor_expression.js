/* 果实编辑器「表达层 + 调试闭环」回归测试
   node tools/test_editor_expression.js
   断言分三部分：
   1) 源码结构：事件组徽标 / 具名出口 / 连线语义 / 调试条与日志打点齐全
   2) 编译期：enabled:false 的节点不进事件组，旧数据（无 enabled 字段）行为不变
   3) 样式：新增的徽标、端口行、调试条类名都有对应 CSS 规则 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');

let fail = 0;
const ok = (name, cond) => { if (cond) console.log('  ok  ', name); else { fail++; console.log('  FAIL', name); } };

const admin = fs.readFileSync(path.join(ROOT, 'admin.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'admin.css'), 'utf8');

console.log('1) 表达层：事件组徽标 / 具名出口 / 连线语义');
{
  ok('SE_EV_LABEL 四个事件组', /onCast: '施放时'/.test(admin) && /onHit: '命中时'/.test(admin) &&
    /onWall: '撞墙时'/.test(admin) && /onExpire: '消失时'/.test(admin));
  ok('seEventOf 优先读 triggerEvent', /p\.triggerEvent \|\| SE_EV_DEFAULT/.test(admin));
  ok('seOutPorts 声明 data / exec / event 三类', /'data'/.test(admin) && /'exec'/.test(admin) && /'event'/.test(admin));
  ok('路径特效有「路径落点」出口', /路径落点 · 每 /.test(admin));
  ok('持续伤害有「持续判定区」出口', /持续判定区/.test(admin));
  ok('延迟边有 +Ns 标签', /'\+' \+ \(Number\(p\.seconds\)/.test(admin));
  ok('节点卡片渲染事件组徽标', /class="se-ev ' \+ ev/.test(admin));
  ok('节点卡片渲染出口清单', /class="se-ports"/.test(admin) && /se-portrow '/.test(admin));
  ok('连线按 flow/bind 着色', /flow \? '#e0a340' : '#5aa9e6'/.test(admin));
  ok('归属连线为蓝色虚线', /stroke-dasharray:6 5/.test(admin));
  ok('两个箭头标记分别对应两种线', /id="seArrowFlow"/.test(admin) && /id="seArrow"/.test(admin));
  ok('连线中点有文字标签', /dominant-baseline="central" font-size="11"/.test(admin));
  ok('标签不拦截点击', /<g pointer-events="none">/.test(admin));
  ok('出边计数有说明（不冒充单端口连接数）', /当前版本边未区分端口/.test(admin));
  ok('停用开关走 data-act', /data-act="se-toggle-node"/.test(admin));
  ok('停用开关有处理分支', /if \(act === 'se-toggle-node'\)/.test(admin));
  // 旧节点没有 enabled 字段（undefined 也算启用），第一次点击必须真的停用
  ok('首次点击能把 undefined 变为 false', /n\.enabled = \(n\.enabled === false\) \? true : false;/.test(admin));
}

console.log('\n2) 调试闭环：暂停 / 单帧 / 倍速 / 时间轴 / 事件记录');
{
  ok('工具条四个控件', /id="seDbgPlay"/.test(admin) && /data-act="se-dbg-step"/.test(admin) &&
    /data-act="se-dbg-reset"/.test(admin) && /id="seDbgSpeed"/.test(admin));
  ok('时间轴与统计条', /id="seDbgTime"/.test(admin) && /id="seDbgTrackFill"/.test(admin) && /id="seDbgStats"/.test(admin));
  ok('事件记录容器', /id="seDbgRows"/.test(admin) && /事件记录/.test(admin));
  ok('日志最多 240 条', /dbgLog\.length > 240/.test(admin));
  ok('dt 由倍速/暂停/单帧统一决定', /S\.skillEd\.dbgPaused/.test(admin) && /S\.skillEd\.dbgStep/.test(admin) && /rawDt \* spd/.test(admin));
  ok('打点：施放 / 延迟到点 / 路径发射器 / 路径落点 / 命中结算 / 持续伤害',
    ["dbgPush('施放'", "dbgPush('延迟到点'", "dbgPush('路径发射器'", "dbgPush('路径落点'",
     "dbgPush('命中结算'", "dbgPush('持续伤害'"].every(s => admin.indexOf(s) >= 0));
  ok('调试条 10fps 刷新', /now - dbgLastRender > 100/.test(admin));
  ok('试放重启后按钮文案同步', /playBtn\.textContent = S\.skillEd\.dbgPaused/.test(admin));
}

console.log('\n3) 编译期：停用节点与旧数据兼容');
{
  const ctx = { window: {}, console, Promise, Math, Object, Number, String, Array, JSON, isFinite, isNaN, Set, Map, WeakMap, parseFloat, parseInt, Date };
  ctx.window.window = ctx.window; ctx.globalThis = ctx.window;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'skill-modules.js'), 'utf8'), ctx);
  const SM = ctx.window.SkillModules;
  ok('live 过滤 enabled:false', /seen\[x\.id\] && x\.enabled !== false/.test(fs.readFileSync(path.join(ROOT, 'skill-modules.js'), 'utf8')));

  // 合成一张「来源 → 路径特效 → 伤害」的确定性小图，不依赖用户当前落盘数据是否接好线
  const mk = () => ({
    id: 't', name: '表达层测试', charge: 3,
    graph: {
      nodes: [
        { id: 's', type: 'source', params: {}, x: 0, y: 0 },
        { id: 'f', type: 'fx', params: { effect: 'nature/poison-cloud', attach: 'path', triggerEvent: 'onCast' }, x: 200, y: 0 },
        { id: 'd', type: 'damage', params: { dotEnable: true, dotDps: 8 }, x: 400, y: 0 }
      ],
      edges: [{ from: 's', to: 'f' }, { from: 'f', to: 'd' }]
    }
  });
  const sk = mk();
  const fxOf = s => ((SM.compile(s).events || {}).onCast || {}).fx || [];
  ok('停用前路径特效在 onCast 组', fxOf(sk).length === 1);
  sk.graph.nodes[1].enabled = false;
  ok('停用后路径特效不进事件组', fxOf(sk).length === 0);
  ok('停用一个节点不影响下游可达性', !!SM.compile(sk).liveIds.d);
  ok('重新启用后恢复', (sk.graph.nodes[1].enabled = true, fxOf(sk).length === 1));

  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/game-config.json'), 'utf8'));
  ok('旧数据所有节点都不带 enabled 字段',
    (cfg.skills || []).every(s => !s.graph || (s.graph.nodes || []).every(n => n.enabled === undefined)));
}

console.log('\n4) 样式：新增类名都有规则');
{
  ['.se-ev.onCast', '.se-ports', '.se-portrow.data i', '.se-portrow.exec i', '.se-portrow.event i',
   '.se-dbg-bar', '.se-dbg-row', '.se-dbg-track i', '.se-node.se-disabled'].forEach(c =>
    ok('CSS ' + c, css.indexOf(c) >= 0));
  let o = 0, c = 0;
  for (const ch of css) { if (ch === '{') o++; else if (ch === '}') c++; }
  ok('CSS 大括号配平', o === c);
}

console.log(fail ? '\nFAILED ' + fail + ' 项' : '\nALL PASS');
process.exit(fail ? 1 : 0);
