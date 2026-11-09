/* 回归：对局 BUFF/DEBUFF 图标栏（node tools/test_status_bar.js）
   从 game.js 原样抽出状态目录 / 采集 / 渲染代码块，在 vm 里用假 DOM 跑，
   验证：自动采集真实生效状态、自定义标签、上传图标与内置矢量图标切换、签名缓存不每帧重排。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ok  ', name, '=', JSON.stringify(got)); }
  else { fail++; console.log('  FAIL', name, 'got', JSON.stringify(got), 'want', JSON.stringify(want)); }
}
function ok(name, cond) { eq(name, !!cond, true); }

/* 真实默认配置 */
const defCtx = { window: {}, console };
vm.createContext(defCtx);
vm.runInContext(read('game-data.js'), defCtx);
const STATUSES = JSON.parse(JSON.stringify(defCtx.window.WOWPINBALL_DEFAULT.statuses));

/* 抽 game.js 的状态栏代码块 */
const g = read('game.js');
const a = g.indexOf('  const STATUS_GLYPHS = {');
const b = g.indexOf('  function updateHud() {', a);
if (a < 0 || b <= a) throw new Error('状态栏代码块切片失败');
const block = g.slice(a, b);

function makeHost() {
  const writes = [];
  const el = {};
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html || ''; },
    set(v) { el._html = v; writes.push(v); }
  });
  return { el, writes };
}
const PH = makeHost(), EH = makeHost();
const G = { clock: 10, skillAuras: [] };
const ctx = {
  window: { WOWPINBALL_DEFAULT: { statuses: STATUSES } },
  DATA: { statuses: STATUSES }, G, console,
  dom: { pBuffs: PH.el, eBuffs: EH.el },
  parseHex(hex) {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  },
  escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
};
vm.createContext(ctx);
vm.runInContext(block + '\nthis.collectStatuses = collectStatuses; this.renderBuffBar = renderBuffBar; this.STATUS_DEFS = STATUS_DEFS;', ctx);
const collect = ctx.collectStatuses, render = ctx.renderBuffBar;

console.log('\n1) 状态目录');
eq('内置 8 条全部载入', ctx.STATUS_DEFS.length, 8);
eq('护盾判为增益', ctx.STATUS_DEFS.find(s => s.source === 'shield').kind, 'buff');
eq('印记判为减益', ctx.STATUS_DEFS.find(s => s.source === 'mark').kind, 'debuff');

console.log('\n2) 自动采集真实生效的状态');
function sources(f) { return collect(f).map(x => x.def.source); }
eq('空弹珠不显示任何图标', sources({ shield: 0, combo: 0, slowUntil: -1, slowFactor: 1, dotDps: 0, dotUntil: -1 }), []);
eq('护盾', sources({ shield: 40 }), ['shield']);
eq('连击 + 护盾（按 order 排序）', sources({ shield: 40, combo: 3 }), ['shield', 'combo']);
eq('印记带层数与剩余秒', (function () {
  const x = collect({ _markStacks: 4, _markUntil: 15, _markCfg: { slowPct: 0 } }).find(y => y.def.source === 'mark');
  return [x.stacks, x.remain];
})(), [4, 5]);
eq('印记迟滞同时显示印记与迟滞', sources({ _markStacks: 2, _markUntil: 14, _markCfg: { slowPct: 0.7 } }), ['mark', 'slow']);
eq('眩晕优先于迟滞', sources({ slowUntil: 13, slowFactor: 0.05 }), ['stun']);
eq('普通减速', sources({ slowUntil: 13, slowFactor: 0.4 }), ['slow']);
eq('持续伤害 + 易伤', sources({ dotDps: 5, dotUntil: 14, _weakUntil: 12, _weak: 0.2 }), ['dot', 'weaken']);
eq('过期状态不显示', sources({ shield: 0, dotDps: 5, dotUntil: 8, _markStacks: 3, _markUntil: 9 }), []);
eq('增益型光环', (function () {
  G.skillAuras = [{ side: 'player', cfg: { auraType: 'buff' }, born: 5, life: 10 }];
  const r = sources({ side: 'player', shield: 0 });
  G.skillAuras = [];
  return r;
})(), ['aura']);

console.log('\n3) 自定义标签（技能「事件状态」模块驱动）');
STATUSES.push({ id: 'st_custom', name: '灼魂', kind: 'debuff', source: 'custom', tag: '灼魂', color: '#ff8a3c', icon: '', desc: '', enabled: true, order: 9 });
const ctx2 = Object.assign({}, ctx);
// 重新执行代码块，让它读到新增的自定义条目
const c2 = {
  window: { WOWPINBALL_DEFAULT: { statuses: STATUSES } },
  DATA: { statuses: STATUSES }, G, console,
  dom: { pBuffs: PH.el, eBuffs: EH.el },
  parseHex: ctx.parseHex, escHtml: ctx.escHtml
};
vm.createContext(c2);
vm.runInContext(block + '\nthis.collectStatuses = collectStatuses; this.renderBuffBar = renderBuffBar;', c2);
eq('同名标签命中', c2.collectStatuses({ _statusTags: { '灼魂': 14 } }).map(x => x.def.name), ['灼魂']);
eq('不同标签不命中', c2.collectStatuses({ _statusTags: { '冰封': 14 } }).map(x => x.def.name), []);
eq('标签过期不显示', c2.collectStatuses({ _statusTags: { '灼魂': 8 } }).map(x => x.def.name), []);

console.log('\n4) 渲染（图标 / 类型 / 角标 / 签名缓存）');
PH.writes.length = 0;
c2.renderBuffBar('player', { shield: 40, combo: 3, _statusTags: { '灼魂': 14 } });
const html = PH.el.innerHTML;
eq('渲染 3 个徽章', (html.match(/class="buff-chip"/g) || []).length, 3);
ok('护盾为增益', html.indexOf('data-kind="buff"') >= 0);
ok('自定义条目为减益', html.indexOf('data-kind="debuff"') >= 0);
ok('内置矢量图标（无 emoji）', html.indexOf('<svg class="st-glyph"') >= 0);
ok('连击显示层数角标', html.indexOf('×3') >= 0);
ok('悬停说明写入 title', html.indexOf('title="') >= 0);
eq('首次渲染写 1 次 DOM', PH.writes.length, 1);
c2.renderBuffBar('player', { shield: 40, combo: 3, _statusTags: { '灼魂': 14 } });
eq('状态不变不重复重排', PH.writes.length, 1);
G.clock = 11;
c2.renderBuffBar('player', { shield: 40, combo: 3, _statusTags: { '灼魂': 14 } });
eq('剩余秒变化才重排', PH.writes.length, 2);
G.clock = 10;
STATUSES[0].icon = 'data:image/png;base64,AAAA';
c2.renderBuffBar('player', { shield: 40, combo: 3 });   // 护盾已上传图标，连击仍用内置矢量
ok('上传 PNG 后改用 img', PH.el.innerHTML.indexOf('<img class="st-icon"') >= 0);
ok('未上传的条目仍用 SVG', PH.el.innerHTML.indexOf('<svg class="st-glyph"') >= 0);

console.log('\n5) 配置迁移与校验钩子');
const loader = read('config-loader.js');
ok('config-loader 迁移补 statuses', /if \(!Array\.isArray\(d\.statuses\)\)/.test(loader));
const admin = read('admin.js');
ok('admin normalize 补 statuses', /if \(!Array\.isArray\(d\.statuses\)\)/.test(admin));
ok('admin 快照剥离图标', /c\.statuses \|\| \[\]\)\.forEach\(x => \{ if \(x\.icon\) delete x\.icon;/.test(admin));
ok('admin 校验图标格式', /状态图标「/.test(admin));
ok('skill-modules 有 statusTag 字段', /t\('statusTag'/.test(read('skill-modules.js')));
ok('game.js 写入自定义标签', /_statusTags\[tag\]/.test(g));
ok('ui-layout 收录状态栏', /\['pBuffs', '我方状态图标栏'/.test(read('ui-layout.js')));

console.log('\n' + (fail ? 'FAILED ' + fail + ' 项' : '全部通过 ' + pass + ' 项'));
process.exit(fail ? 1 : 0);
