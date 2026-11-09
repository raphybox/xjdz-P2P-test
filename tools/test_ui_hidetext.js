/* 界面编辑器「隐藏文字内容」开关回归
   仅验证编译器层 UI.normalize 对 hideText 字段的保留 / 丢弃行为。
   applyPatch 的 DOM 表现由 _smoke 真实页面验证覆盖。 */
'use strict';
const assert = require('assert');
const path = require('path');

// 最小桩：让 ui-layout.js 的 IIFE 在 Node 下能跑完并挂上 window.WowPinballUI
const noop = () => {};
global.window = {
  location: { search: '' },
  addEventListener: noop,
  getComputedStyle: () => ({ position: 'static', overflow: 'visible' }),
  WOWPINBALL_DATA: undefined,
  WOWPINBALL_DEFAULT: undefined
};
global.document = {
  querySelector: () => null,   // 关键：让 IIFE 早返回，不走游戏端 applyAll 路径
  addEventListener: noop,
  createElement: () => ({ style: {}, setAttribute: noop, appendChild: noop, classList: { add: noop } }),
  head: { appendChild: noop },
  body: { classList: { add: noop } },
  readyState: 'complete'
};
global.getComputedStyle = global.window.getComputedStyle;

const UI = require(path.join(__dirname, '..', 'ui-layout.js')) || global.window.WowPinballUI;
const api = global.window.WowPinballUI;
assert.ok(api && typeof api.normalize === 'function', 'UI.normalize 应可调用');

let passed = 0;
function ok(name, fn) { fn(); passed++; console.log('  ✓ ' + name); }

ok('含文字的元素（按钮）勾选后，hideText 被保留', () => {
  const r = api.normalize({ screens: { start: { startBtn: { hideText: true } } } });
  assert.deepStrictEqual(r.screens.start.startBtn.hideText, true, 'hideText 应为 true');
});

ok('未勾选 / 传非 true：不写入配置（sparse patch）', () => {
  const r = api.normalize({ screens: { start: { startBtn: { hideText: false } } } });
  const got = r.screens.start && r.screens.start.startBtn;
  assert.ok(!got || got.hideText === undefined, 'false 不应保留');
  const r2 = api.normalize({ screens: { start: { startBtn: { hideText: 'yes' } } } });
  const got2 = r2.screens.start && r2.screens.start.startBtn;
  assert.ok(!got2 || got2.hideText === undefined, '非 true 不应保留');
});

ok('从未设置 hideText：配置里不出现该键', () => {
  const r = api.normalize({ screens: { start: { startBtn: { fs: 20, fc: '#ffffff' } } } });
  assert.ok(r.screens.start.startBtn.hideText === undefined, '不应凭空出现 hideText');
});

ok('空配置默认结构不变', () => {
  const r = api.normalize({});
  assert.deepStrictEqual(r, { enabled: true, screens: {} }, '空配置应被规整为默认结构');
});

console.log('\nPASS ' + passed + ' / FAIL 0');
