/* 界面编辑器「原边框隐藏」（bwOff）回归测试
   忠实复刻三处逻辑，验证「自带 CSS 描边」的元素（含非按钮）都能被干净覆盖，且不影响自定义边框：
     ① ui-layout.js keep() 白名单：bwOff=true 保留，false/未设丢弃；
     ② ui-layout.js applyPatch 盒模型分支：自定义 bw>0 优先，否则 bwOff 写 borderStyle:none；
     ③ admin.js uiMeasure：nativeBw 判定（真实 <button> 或 CSS 类自带 border），
        关键约束——勾上 bwOff 后（内联 borderStyle:none）判定必须仍为 true，否则开关自己消失、
        用户无法取消。 */
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
function num(v, lo, hi) { var n = parseFloat(v); return isFinite(n) ? clamp(n, lo, hi) : null; }

// —— ① 复刻 ui-layout.js 清洗中的布尔字段保留 ——
function sanitize(p) {
  const q = {};
  function keep(k, lo, hi) {
    if (p[k] === undefined || p[k] === null || p[k] === '') return;
    var n = num(p[k], lo, hi); if (n !== null) q[k] = n;
  }
  keep('bw', 0, 20);
  if (p.hideText === true) q.hideText = true;
  if (p.bwOff === true) q.bwOff = true;
  return q;
}

// —— ② 复刻 applyPatch 的边框决策（返回将要设置的内联样式） ——
function border(p) {
  const out = {};
  const bw = num(p.bw, 0, 20);
  if (bw !== null && bw > 0) {
    out.borderStyle = 'solid';
    out.borderWidth = bw + 'px';
    out.borderColor = p.bc || '#2b3648';
  } else if (p.bwOff === true) {
    out.borderStyle = 'none';
  } else if (p.bc) {
    out.borderColor = p.bc;
  }
  return out;
}

// —— ③ 复刻 uiMeasure 的 nativeBw 判定 ——
// 假元素：style 为内联（空串 = 未设置），类型 CSS 由参数模拟类规则。
function fakeEl(tag, cssStyle, cssWidth, inline) {
  return { tagName: tag, style: Object.assign({ borderStyle: '', borderWidth: '' }, inline || {}), __cssStyle: cssStyle, __cssWidth: cssWidth };
}
// 模拟 getComputedStyle：内联有值优先，否则回落到 CSS 类
function fakeWin(el) {
  return {
    getComputedStyle: e => ({
      borderTopStyle: e.style.borderStyle || e.__cssStyle,
      borderTopWidth: e.style.borderWidth || e.__cssWidth
    })
  };
}
function hasNativeBw(el, win) {
  const bs = el.style.borderStyle, bw = el.style.borderWidth;
  let hit = false;
  try {
    el.style.borderStyle = ''; el.style.borderWidth = '';
    const cs = win.getComputedStyle(el);
    hit = (parseFloat(cs.borderTopWidth) || 0) > 0 &&
      cs.borderTopStyle !== 'none' && cs.borderTopStyle !== 'hidden';
  } catch (x) {}
  el.style.borderStyle = bs;
  el.style.borderWidth = bw;
  return hit;
}
function nativeBwFlag(tag, cssStyle, cssWidth, inline) {
  const el = fakeEl(tag, cssStyle, cssWidth, inline);
  return { val: tag === 'BUTTON' || hasNativeBw(el, fakeWin(el)), el: el };
}

let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + '  得到=' + g + ' 期望=' + w); }
}

// ① 清洗
eq('清洗：bwOff=true 保留', sanitize({ bwOff: true }), { bwOff: true });
eq('清洗：bwOff=false 丢弃', sanitize({ bwOff: false }), {});
eq('清洗：未设置 丢弃', sanitize({}), {});
eq('清洗：bwOff=1 非严格 true 丢弃', sanitize({ bwOff: 1 }), {});
eq('清洗：bwOff 与 bw 共存', sanitize({ bw: 3, bwOff: true }), { bw: 3, bwOff: true });

// ② 边框决策
eq('渲染：仅 bwOff → borderStyle none（覆盖 CSS 描边）', border({ bwOff: true }), { borderStyle: 'none' });
eq('渲染：bwOff + 未设 bw → none', border({ bwOff: true, bw: 0 }), { borderStyle: 'none' });
eq('渲染：全空 → 不写任何内联（保留 CSS 默认）', border({}), {});
eq('渲染：bw=3 优先于 bwOff（自定义边框生效）', border({ bw: 3, bwOff: true }), { borderStyle: 'solid', borderWidth: '3px', borderColor: '#2b3648' });
eq('渲染：bw=3 + bc 用自定义色', border({ bw: 3, bc: '#ff0000', bwOff: true }), { borderStyle: 'solid', borderWidth: '3px', borderColor: '#ff0000' });
eq('渲染：bwOff=false 不影响原边框', border({ bwOff: false }), {});
eq('渲染：仅 bc → 只改颜色，不碰线宽', border({ bc: '#ff0000' }), { borderColor: '#ff0000' });
eq('渲染：bw=0 且无 bwOff → 不改边框（CSS 描边仍在）', border({ bw: 0 }), {});

// ③ nativeBw 判定
eq('判定：<button> 无 CSS 也显示（兜底）', nativeBwFlag('BUTTON', 'none', '0px').val, true);
eq('判定：.coin-chip（span 自带 1px solid）→ 显示', nativeBwFlag('SPAN', 'solid', '1px').val, true);
eq('判定：自定义色边框的 div → 显示', nativeBwFlag('DIV', 'dashed', '2px').val, true);
eq('判定：无边框 div → 不显示', nativeBwFlag('DIV', 'none', '0px').val, false);
eq('判定：borderStyle solid 但宽度 0 → 不显示', nativeBwFlag('DIV', 'solid', '0px').val, false);
eq('判定：hidden 边 → 不显示', nativeBwFlag('DIV', 'hidden', '1px').val, false);
// 关键回归：勾上 bwOff 后 borderStyle 被写成 none，判定仍要为 true，否则开关消失无法取消
eq('判定：勾了 bwOff（内联 none）后仍然显示', nativeBwFlag('SPAN', 'solid', '1px', { borderStyle: 'none' }).val, true);
// 无原生边框的 div 设了自定义 bw=3：摘掉内联后无边框 → 不显示开关（避免无意义开关）
eq('判定：无原生边框 + 自定义 bw=3 → 不显示', nativeBwFlag('DIV', 'none', '0px', { borderStyle: 'solid', borderWidth: '3px' }).val, false);
// 有原生边框 + 自定义 bw=3：仍显示（自定义优先，开关可见但不生效，属预期）
eq('判定：原生边框 + 自定义 bw=3 → 仍显示', nativeBwFlag('SPAN', 'solid', '1px', { borderStyle: 'solid', borderWidth: '3px' }).val, true);
// 副作用：检测后内联样式必须原样写回
eq('判定：检测不改动内联样式', nativeBwFlag('SPAN', 'solid', '1px', { borderStyle: 'none' }).el.style.borderStyle, 'none');
eq('判定：检测不改动内联宽度', nativeBwFlag('SPAN', 'solid', '1px', { borderStyle: 'none' }).el.style.borderWidth, '');

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'HAS FAIL') + ' / total ' + (pass + fail));
process.exit(fail === 0 ? 0 : 1);
