/* 界面编辑器「图片精确宽高」（imgW / imgH）回归测试
   忠实复刻 ui-layout.js 的 keep() 清洗与 applyPatch 的 background-size 选择，验证：
     ① 清洗：有效值保留、0 / 空 / 非法丢弃、超上限钳制（0 = 不指定，绝不能被钳成下限）；
     ② 渲染：宽高都填 → "Wpx Hpx"、只填一边 → 另一边 auto、px 优先于 stretch / tile / 百分比；
     ③ 回退：宽高都为 0 时仍走原有百分比 / 填充方式逻辑；
     ④ 下限 8px：1~7px 会把图压成一条线（视觉上等于素材消失），一律按「不指定」处理，
        确保调参时不会把素材「调没」，历史坏配置（imgH=1）读入也能自动回退。 */
const IMG_PX_MIN = 8;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
function num(v, lo, hi) { var n = parseFloat(v); return isFinite(n) ? clamp(n, lo, hi) : null; }

// —— ① 复刻 ui-layout.js 清洗中的精确宽高 ——
function sanitize(p) {
  const q = {};
  function keep(k, lo, hi) {
    if (p[k] === undefined || p[k] === null || p[k] === '') return;
    var n = num(p[k], lo, hi); if (n !== null) q[k] = n;
  }
  keep('imgZoom', 10, 300);
  var _iw = num(p.imgW, 0, 4000); if (_iw !== null && _iw >= IMG_PX_MIN) q.imgW = _iw;
  var _ih = num(p.imgH, 0, 4000); if (_ih !== null && _ih >= IMG_PX_MIN) q.imgH = _ih;
  return q;
}

// —— ② 复刻 applyPatch：返回 { size, repeat } ——
function render(p) {
  const fit = p.fit || 'cover';
  const iz = num(p.imgZoom, 10, 300);
  let iw = num(p.imgW, 0, 4000), ih = num(p.imgH, 0, 4000);
  if (iw !== null && iw < IMG_PX_MIN) iw = null;
  if (ih !== null && ih < IMG_PX_MIN) ih = null;
  if (iw !== null || ih !== null) {
    return {
      size: (iw !== null ? iw + 'px' : 'auto') + ' ' + (ih !== null ? ih + 'px' : 'auto'),
      repeat: fit === 'tile' ? 'repeat' : 'no-repeat'
    };
  }
  if (fit === 'stretch') return { size: '100% 100%', repeat: 'no-repeat' };
  if (fit === 'tile') return { size: 'auto', repeat: 'repeat' };
  if (iz !== null && iz !== 100) return { size: iz + '%', repeat: 'no-repeat' };
  if (fit === 'contain') return { size: 'contain', repeat: 'no-repeat' };
  if (fit === 'center') return { size: 'auto', repeat: 'no-repeat' };
  return { size: 'cover', repeat: 'no-repeat' };
}
const size = p => render(p).size;
const rep = p => render(p).repeat;

let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + '  得到=' + g + ' 期望=' + w); }
}

// ① 清洗
eq('清洗：imgW=300 保留', sanitize({ imgW: 300 }).imgW, 300);
eq('清洗：imgH=1200 保留', sanitize({ imgH: 1200 }).imgH, 1200);
eq('清洗：imgW=0 丢弃（=不指定）', sanitize({ imgW: 0 }).imgW, undefined);
eq('清洗：imgH=0 丢弃', sanitize({ imgH: 0 }).imgH, undefined);
eq('清洗：imgW="" 丢弃', sanitize({ imgW: '' }).imgW, undefined);
eq('清洗：imgW="abc" 丢弃', sanitize({ imgW: 'abc' }).imgW, undefined);
eq('清洗：imgW=5000 钳制到 4000', sanitize({ imgW: 5000 }).imgW, 4000);
eq('清洗：imgH=-30 钳制到 0 后丢弃', sanitize({ imgH: -30 }).imgH, undefined);
eq('清洗：宽高与百分比共存', sanitize({ imgZoom: 120, imgW: 300, imgH: 200 }), { imgZoom: 120, imgW: 300, imgH: 200 });

// ② 渲染：精确宽高
eq('渲染：宽高都填 → 300px 200px', size({ imgW: 300, imgH: 200 }), '300px 200px');
eq('渲染：只填宽 → 300px auto', size({ imgW: 300 }), '300px auto');
eq('渲染：只填高 → auto 200px', size({ imgH: 200 }), 'auto 200px');
eq('渲染：px 优先于 stretch', size({ imgW: 300, imgH: 200, fit: 'stretch' }), '300px 200px');
eq('渲染：px 优先于百分比', size({ imgW: 300, imgH: 200, imgZoom: 150 }), '300px 200px');
eq('渲染：tile + 宽高 → 该尺寸平铺', rep({ imgW: 300, imgH: 200, fit: 'tile' }), 'repeat');
eq('渲染：非 tile + 宽高 → 不重复', rep({ imgW: 300, imgH: 200, fit: 'cover' }), 'no-repeat');

// ③ 回退：宽高为 0 时保持原逻辑
eq('回退：宽高都为 0 + 百分比 150 → 150%', size({ imgW: 0, imgH: 0, imgZoom: 150 }), '150%');
eq('回退：宽高都为 0 → cover', size({ imgW: 0, imgH: 0 }), 'cover');
eq('回退：宽高都为 0 + contain → contain', size({ imgW: 0, imgH: 0, fit: 'contain' }), 'contain');
eq('回退：未设置宽高 + 百分比 100 → cover', size({}), 'cover');

// ④ 下限 8px：调参时「稍微一动」不会把素材调没
eq('下限：imgH=1 清洗丢弃（截图里的坏配置）', sanitize({ imgH: 1 }).imgH, undefined);
eq('下限：imgW=7 清洗丢弃', sanitize({ imgW: 7 }).imgW, undefined);
eq('下限：imgH=8 清洗保留（边界值）', sanitize({ imgH: 8 }).imgH, 8);
eq('下限：渲染 imgH=1 → 回退 cover（图不消失）', size({ imgH: 1 }), 'cover');
eq('下限：渲染 imgH=7 + 百分比 150 → 回退 150%', size({ imgH: 7, imgZoom: 150 }), '150%');
eq('下限：渲染 imgW=8 → 8px auto（最小值仍生效）', size({ imgW: 8 }), '8px auto');
eq('下限：渲染 imgH=8 + imgW=1 → 只有宽失效', size({ imgW: 1, imgH: 8 }), 'auto 8px');
eq('下限：宽高都 <8 → 完全回退 contain', size({ imgW: 2, imgH: 3, fit: 'contain' }), 'contain');

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'HAS FAIL') + ' / total ' + (pass + fail));
process.exit(fail === 0 ? 0 : 1);
