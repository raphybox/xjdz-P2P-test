/* 界面编辑器「图片尺寸 %」（imgZoom）回归测试
   忠实复刻 ui-layout.js 的 keep() 清洗与 applyPatch 的 background-size 选择逻辑，
   验证：① 清洗保留合法值、丢弃空/非法、范围钳制；② 渲染按 imgZoom 选 background-size。 */
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
function num(v, lo, hi) { var n = parseFloat(v); return isFinite(n) ? clamp(n, lo, hi) : null; }

// —— 复刻 ui-layout.js 清洗 keep() ——
function sanitize(p) {
  const q = {};
  function keep(k, lo, hi) {
    if (p[k] === undefined || p[k] === null || p[k] === '') return;
    var n = num(p[k], lo, hi); if (n !== null) q[k] = n;
  }
  keep('imgZoom', 10, 300);
  return q;
}

// —— 复刻 applyPatch 的图片 background-size 选择（含精确宽高 imgW/imgH 分支） ——
function bgSize(p) {
  const fit = p.fit || 'cover';
  const iz = num(p.imgZoom, 10, 300);
  let iw = num(p.imgW, 0, 4000), ih = num(p.imgH, 0, 4000);
  if (iw !== null && iw <= 0) iw = null;
  if (ih !== null && ih <= 0) ih = null;
  if (iw !== null || ih !== null) return (iw !== null ? iw + 'px' : 'auto') + ' ' + (ih !== null ? ih + 'px' : 'auto');
  if (fit === 'stretch') return '100% 100%';
  if (fit === 'tile') return 'auto';
  if (iz !== null && iz !== 100) return iz + '%';
  if (fit === 'contain') return 'contain';
  if (fit === 'center') return 'auto';
  return 'cover';
}

let pass = 0, fail = 0;
function eq(name, got, want) {
  if (got === want) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + '  得到=' + JSON.stringify(got) + ' 期望=' + JSON.stringify(want)); }
}

// ① 清洗
eq('清洗：imgZoom=150 保留', sanitize({ imgZoom: 150 }).imgZoom, 150);
eq('清洗：imgZoom=100 保留(与 zoom 一致)', sanitize({ imgZoom: 100 }).imgZoom, 100);
eq('清洗：imgZoom="" 丢弃', sanitize({ imgZoom: '' }).imgZoom, undefined);
eq('清洗：imgZoom="abc" 丢弃', sanitize({ imgZoom: 'abc' }).imgZoom, undefined);
eq('清洗：未设置 丢弃', sanitize({}).imgZoom, undefined);
eq('清洗：imgZoom=500 钳制到 300', sanitize({ imgZoom: 500 }).imgZoom, 300);
eq('清洗：imgZoom=5 钳制到 10', sanitize({ imgZoom: 5 }).imgZoom, 10);

// ② 渲染 background-size
eq('渲染：cover+150 → 150%', bgSize({ fit: 'cover', imgZoom: 150 }), '150%');
eq('渲染：cover+100 → cover(中性)', bgSize({ fit: 'cover', imgZoom: 100 }), 'cover');
eq('渲染：cover+50  → 50%', bgSize({ fit: 'cover', imgZoom: 50 }), '50%');
eq('渲染：contain+120 → 120%', bgSize({ fit: 'contain', imgZoom: 120 }), '120%');
eq('渲染：center+200 → 200%', bgSize({ fit: 'center', imgZoom: 200 }), '200%');
eq('渲染：stretch+200 → 100% 100%(忽略缩放)', bgSize({ fit: 'stretch', imgZoom: 200 }), '100% 100%');
eq('渲染：tile+200 → auto(忽略缩放)', bgSize({ fit: 'tile', imgZoom: 200 }), 'auto');
eq('渲染：缺省(无 imgZoom) → cover', bgSize({ fit: 'cover' }), 'cover');

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'HAS FAIL') + ' / total ' + (pass + fail));
process.exit(fail === 0 ? 0 : 1);
