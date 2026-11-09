#!/usr/bin/env node
// 从 vendor/pixelfx 的 244 个特效模块里读取 meta，生成后台/游戏共用的目录文件。
// 每个特效的 meta.options 会自动推导成可编辑控件（调色板 ramp / 数值 / 布尔 / 颜色），
// 这样后台无需为每个特效手写表单，新特效加进来重跑本脚本即可。
// 运行：node tools/build-pixelfx-catalog.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as FX from '../vendor/pixelfx/src/fx/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HEX = /^#[0-9a-f]{3,8}$/i;

function inferField(key, v) {
  if (Array.isArray(v)) {
    if (v.length && v.every(x => typeof x === 'string' && HEX.test(x))) {
      return { key, type: 'ramp', default: v.slice(), label: key === 'palette' ? '主调色板' : key };
    }
    if (v.length && v.every(x => typeof x === 'number')) {
      return { key, type: 'numlist', default: v.slice(), label: key };
    }
    return { key, type: 'json', default: v, label: key };
  }
  if (typeof v === 'boolean') return { key, type: 'bool', default: v, label: key };
  if (typeof v === 'number') {
    const dec = !Number.isInteger(v);
    let max;
    if (key === 'seed') max = 999;
    else if (dec && v <= 1) max = 1;
    else if (dec && v <= 2) max = 4;
    else max = Math.max(10, Math.ceil(Math.abs(v) * 4));
    return {
      key, type: 'number', default: v, label: key,
      min: 0, max, step: dec ? 0.01 : 1
    };
  }
  if (typeof v === 'string' && HEX.test(v)) return { key, type: 'color', default: v, label: key };
  if (typeof v === 'string') return { key, type: 'text', default: v, label: key };
  return { key, type: 'json', default: v, label: key };
}

const cats = Object.fromEntries((FX.categories || []).map(c => [c.id, c]));
const out = [];
for (const [id, mod] of Object.entries(FX.effects || {})) {
  const m = mod.meta || {};
  const cat = id.split('/')[0];
  out.push({
    id,
    name: m.name || id.split('/')[1],
    desc: m.desc || '',
    tags: m.tags || [],
    category: cat,
    categoryName: (cats[cat] && cats[cat].name) || cat,
    size: m.size || [64, 64],
    origin: m.origin || [(m.size || [64, 64])[0] / 2, (m.size || [64, 64])[1] / 2],
    duration: m.duration || 1,
    loop: !!m.loop,
    fps: m.fps || 30,
    actor: m.actor || 0,
    bg: m.bg || null,
    hasAct: !!mod.act,
    fields: Object.entries(m.options || {}).map(([k, v]) => inferField(k, v))
  });
}
out.sort((a, b) => a.id.localeCompare(b.id));

const body = '/* 自动生成，勿手改。运行 node tools/build-pixelfx-catalog.mjs 重新生成。\n' +
  '   来源：github.com/patch-gg/pixelfx (MIT)，244 个代码驱动像素特效。 */\n' +
  'window.PIXELFX_CATALOG = ' + JSON.stringify(out) + ';\n';
writeFileSync(join(ROOT, 'data', 'pixelfx-catalog.js'), body);

const kinds = {};
out.forEach(e => e.fields.forEach(f => { kinds[f.type] = (kinds[f.type] || 0) + 1; }));
console.log('effects:', out.length, ' categories:', Object.keys(cats).length,
  ' fields:', out.reduce((n, e) => n + e.fields.length, 0), JSON.stringify(kinds),
  ' bytes:', body.length);
