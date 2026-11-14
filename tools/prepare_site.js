#!/usr/bin/env node
/**
 * 准备 wrangler 部署用的静态资产目录 dist-site/
 * 以 git 跟踪的文件为准（天然排除 dev_backup、tools、.workbuddy 等开发目录），
 * 并额外排除 _worker.js / cf-worker.js / wrangler.jsonc（它们不是站点资产）。
 *
 * 运行：node tools/prepare_site.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEST = path.join(ROOT, 'dist-site');

// 每次全量重建，保证与仓库状态一致
fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(DEST, { recursive: true });

const EXCLUDE = new Set(['_worker.js', 'cf-worker.js', 'wrangler.jsonc', 'CNAME']);

/* 用 -z（NUL 分隔）而不是默认换行输出：默认模式下 git 会把中文/特殊字符路径
   按 core.quotepath 转义成 "docs/\346\236\234..."，后续 fs.statSync 找不到该文件，
   校验环节会抛 ENOENT 并让整个部署脚本以失败告终。 */
const files = execSync('git ls-files -z', { cwd: ROOT, encoding: 'utf8' })
  .split('\0')
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((f) => !EXCLUDE.has(f));

let total = 0;
for (const f of files) {
  const src = path.join(ROOT, f);
  const dst = path.join(DEST, f);
  if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  total += fs.statSync(dst).size;
}

console.log('dist-site 就绪：' + files.length + ' 个文件，共 ' + (total / 1024 / 1024).toFixed(2) + ' MB');
const big = files.filter((f) => fs.statSync(path.join(ROOT, f)).size > 20 * 1024 * 1024);
if (big.length) {
  console.error('超过单文件 25MB 限制的文件：' + big.join(', '));
  process.exit(1);
}
