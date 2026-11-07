/* =============================================================
   导出静态站配置副本：data/game-config.json -> data/published-config.js

   为什么需要：浏览器不能用 <script src="xxx.json"> 同步读取 JSON，
   而 game.js 启动时就同步读取 window.WOWPINBALL_DATA，异步 fetch 来不及。
   GitHub Pages 又没有 /api/config，所以把已发布的 JSON 包一层 JS 赋值，
   用普通 <script src> 同步载入，静态站就能显示与本地一致的贴图与数值。

   用法：node tools/export-static-config.js
   自动：本地 server.js 每次「发布」成功后也会调用本函数，无需手动执行。
   ============================================================= */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'data', 'game-config.json');
const OUT = path.join(ROOT, 'data', 'published-config.js');

function exportStatic() {
  if (!fs.existsSync(SRC)) throw new Error('找不到 ' + SRC + '，请先在后台发布一次配置');
  const data = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  if (!data || !data.config || !Array.isArray(data.classes)) throw new Error('配置结构不完整');

  // U+2028 / U+2029 在旧 JS 引擎里会截断字符串字面量，统一转义
  const json = JSON.stringify(data, null, 2)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  const body = '/* 由 tools/export-static-config.js 从 data/game-config.json 自动生成，请勿手动编辑。\n' +
    '   纯静态托管（GitHub Pages）没有 /api/config，浏览器用这份副本作为默认配置。 */\n' +
    'window.WOWPINBALL_PUBLISHED = ' + json + ';\n';

  if (!fs.existsSync(path.dirname(OUT))) fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, body, 'utf8');
  return { file: OUT, bytes: Buffer.byteLength(body, 'utf8') };
}

if (require.main === module) {
  try {
    const r = exportStatic();
    console.log('已生成 ' + path.relative(ROOT, r.file) + '（' + (r.bytes / 1024 / 1024).toFixed(2) + ' MB）');
    console.log('提交并推送后，GitHub Pages 上的游戏与后台会使用这份配置。');
  } catch (e) {
    console.error('导出失败：' + e.message);
    process.exit(1);
  }
}

module.exports = exportStatic;
