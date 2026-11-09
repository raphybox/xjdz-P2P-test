/* 界面素材上传「体积预算」回归测试
   复刻 admin.js 的 dataUrlKb / 原图直通判定 / encodeUiImage 的格式与降采样决策，验证：
     ① 原图 ≤500 KB 且长边 ≤4096 时直接内嵌（不重编码，避免 PNG→WebP 反而变大）；
     ② 超预算时才编码：PNG 优先（无损保透明），PNG 超限退 WebP，两者都超才降采样；
     ③ 降到 512px 仍超 1.5 MB 硬上限 → 拒绝；
     ④ dataURL 前缀白名单：png / webp / jpeg 通过，svg / gif 拒绝（防脚本型 SVG 混进配置）。 */
const UI_IMG_MAX_KB = 500;
const UI_IMG_HARD_KB = 1500;
const UI_IMG_MIN_SIDE = 512;
const UI_IMG_DATAURL_RE = /^data:image\/(png|webp|jpeg);base64,/;
const dataUrlKb = src => (src ? Math.round(src.length * 0.75 / 1024) : 0);

// —— 原图直通判定（admin.js uiUploadFile 里的 if） ——
function useRaw(rawKb, rawSide, valid) {
  return !!valid && rawKb <= UI_IMG_MAX_KB && rawSide <= 4096;
}

// —— 复刻 encodeUiImage：encoder(w,h) 返回 { png, webp }（KB，null = 该格式不可用） ——
function encode(w0, h0, maxSide, encoder) {
  let scale = Math.min(1, maxSide / Math.max(w0, h0));
  let last = null;
  for (let pass = 0; pass < 8; pass++) {
    const w = Math.max(1, Math.round(w0 * scale));
    const h = Math.max(1, Math.round(h0 * scale));
    const e = encoder(w, h) || {};
    const cands = [];
    if (e.png !== null && e.png !== undefined) cands.push({ type: 'png', kb: e.png });
    if (e.webp !== null && e.webp !== undefined) cands.push({ type: 'webp', kb: e.webp });
    for (const c of cands) {
      last = { w: w, h: h, type: c.type, kb: c.kb, pass: pass };
      if (c.kb <= UI_IMG_MAX_KB) return last;
    }
    if (Math.max(w, h) <= UI_IMG_MIN_SIDE) break;
    scale *= 0.82;
  }
  return last;
}
const accepted = r => !!r && r.kb <= UI_IMG_HARD_KB;

let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + '  得到=' + g + ' 期望=' + w); }
}

// ① dataUrlKb：base64 字符数 → 二进制 KB（0.75 系数）
eq('体积：683K 字符 ≈ 500 KB', dataUrlKb('x'.repeat(683000)), 500);
eq('体积：空字符串 = 0', dataUrlKb(''), 0);

// ② 原图直通
eq('直通：288 KB / 800px → 直接用原图', useRaw(288, 800, true), true);
eq('直通：500 KB / 800px（边界）→ 直接用', useRaw(500, 800, true), true);
eq('直通：501 KB → 走编码', useRaw(501, 800, true), false);
eq('直通：288 KB 但长边 5000px → 走编码（限制解码开销）', useRaw(288, 5000, true), false);
eq('直通：4096px（边界）→ 直接用', useRaw(288, 4096, true), true);
eq('直通：不是 dataURL → 走编码', useRaw(288, 800, false), false);

// ③ 编码格式选择
eq('编码：PNG 300 / WebP 200 → 选 PNG（无损优先）',
  (({ type, kb }) => ({ type, kb }))(encode(800, 800, 2048, () => ({ png: 300, webp: 200 }))), { type: 'png', kb: 300 });
eq('编码：PNG 700 / WebP 400 → 选 WebP',
  (({ type, kb }) => ({ type, kb }))(encode(800, 800, 2048, () => ({ png: 700, webp: 400 }))), { type: 'webp', kb: 400 });
eq('编码：仅 PNG 可用且超限 → 降采样后命中',
  (({ type, kb, pass }) => ({ type, kb, pass }))(encode(1000, 1000, 2048, (w) => ({ png: w > 800 ? 900 : 300, webp: null }))),
  { type: 'png', kb: 300, pass: 2 });
eq('编码：PNG 与 WebP 都超 → 降采样（第一轮不返回）',
  (({ pass, kb }) => ({ pass, kb }))(encode(1000, 1000, 2048, (w) => ({ png: 900, webp: w > 800 ? 700 : 400 }))),
  { pass: 2, kb: 400 });
eq('编码：长边 2048 上限生效（4000px 原图先缩到 2048）',
  ((r) => r.w)(encode(4000, 2000, 2048, () => ({ png: 600, webp: 450 }))), 2048);
eq('编码：同一轮里 PNG 恰好 500 KB → 命中不降采样',
  (({ kb, pass }) => ({ kb, pass }))(encode(800, 800, 2048, () => ({ png: 500, webp: 200 }))), { kb: 500, pass: 0 });

// ④ 硬上限与拒绝
eq('硬上限：最终 1400 KB → 接受', accepted({ kb: 1400 }), true);
eq('硬上限：最终 1500 KB（边界）→ 接受', accepted({ kb: 1500 }), true);
eq('硬上限：最终 1501 KB → 拒绝', accepted({ kb: 1501 }), false);
eq('降到 512px 仍超 → 停在 512 并返回（交给硬上限拒绝）',
  ((r) => ({ side: r.w, kb: r.kb, pass: r.pass }))(encode(4000, 4000, 2048, () => ({ png: 9000, webp: 8000 }))),
  { side: 511, kb: 8000, pass: 7 });
eq('完全编码不出来 → null', encode(800, 800, 2048, () => ({})), null);

// ⑤ dataURL 前缀白名单
eq('前缀：png 通过', UI_IMG_DATAURL_RE.test('data:image/png;base64,AA'), true);
eq('前缀：webp 通过', UI_IMG_DATAURL_RE.test('data:image/webp;base64,AA'), true);
eq('前缀：jpeg 通过', UI_IMG_DATAURL_RE.test('data:image/jpeg;base64,AA'), true);
eq('前缀：svg+xml 拒绝（防脚本）', UI_IMG_DATAURL_RE.test('data:image/svg+xml;base64,AA'), false);
eq('前缀：gif 拒绝', UI_IMG_DATAURL_RE.test('data:image/gif;base64,AA'), false);

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'HAS FAIL') + ' / total ' + (pass + fail));
process.exit(fail === 0 ? 0 : 1);
