/* 界面编辑器「对齐参考线」回归测试
   忠实复刻 ui-layout.js initEditor 里的三处纯逻辑：
     ① snapTargets：收集同屏其它元素 / 屏幕容器 / 视口中线的 左中右 & 上中下；
     ② snapAxis：三条候选边里挑最近一条，超出 SNAP(6px) 不吸附；
     ③ 位移合成：吸附距离加到 dx/dy 上，最终边必须落在目标线上。
   验证点：阈值边界、最近优先、负方向、排除自己/隐藏/锁定项、中线可用、落位精确。 */
const SNAP = 6;

// —— ① 目标线收集 ——
function snapTargets(items, rootRect, vw, vh, excludeKey) {
  const xs = [], ys = [];
  items.forEach(it => {
    if (it.key === excludeKey || it.locked) return;      // 跳过自己与锁定项
    if (it.w < 1 || it.h < 1) return;                     // 隐藏元素没有参考价值
    xs.push(it.left, it.left + it.w / 2, it.left + it.w);
    ys.push(it.top, it.top + it.h / 2, it.top + it.h);
  });
  if (rootRect) {
    xs.push(rootRect.left, rootRect.left + rootRect.w / 2, rootRect.left + rootRect.w);
    ys.push(rootRect.top, rootRect.top + rootRect.h / 2, rootRect.top + rootRect.h);
  }
  xs.push(vw / 2);
  ys.push(vh / 2);
  return { xs, ys };
}

// —— ② 最近候选 ——
function snapAxis(edges, lines) {
  let best = null, bestAbs = SNAP;
  for (let i = 0; i < edges.length; i++) {
    for (let j = 0; j < lines.length; j++) {
      const d = lines[j] - edges[i], a = Math.abs(d);
      if (a <= bestAbs) { bestAbs = a; best = { at: lines[j], dist: d }; }
    }
  }
  return best;
}

// —— ③ 拖动位移合成（复刻 pointermove 的 move 分支） ——
function moveTo(r0, dx0, dy0, mx, my, snap) {
  let tdx = dx0 + mx, tdy = dy0 + my;
  const L = r0.left + (tdx - dx0), T = r0.top + (tdy - dy0);
  const sx = snapAxis([L, L + r0.w / 2, L + r0.w], snap.xs);
  const sy = snapAxis([T, T + r0.h / 2, T + r0.h], snap.ys);
  if (sx) tdx += sx.dist;
  if (sy) tdy += sy.dist;
  return {
    dx: Math.round(tdx), dy: Math.round(tdy),
    left: r0.left + (Math.round(tdx) - dx0),
    top: r0.top + (Math.round(tdy) - dy0),
    gx: sx ? sx.at : null, gy: sy ? sy.at : null
  };
}

let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + '  得到=' + g + ' 期望=' + w); }
}
function near(name, got, want, tol) {
  if (Math.abs(got - want) <= (tol === undefined ? 0.51 : tol)) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + '  得到=' + got + ' 期望≈' + want); }
}

// ② 阈值与方向
eq('吸附：差 3px → 命中', snapAxis([100], [103]), { at: 103, dist: 3 });
eq('吸附：差 -3px → 命中（往左）', snapAxis([100], [97]), { at: 97, dist: -3 });
eq('吸附：恰好 6px 仍命中', snapAxis([100], [106]), { at: 106, dist: 6 });
eq('吸附：6.1px 不命中', snapAxis([100], [106.1]), null);
eq('吸附：差 0 → 命中且位移 0', snapAxis([100], [100]), { at: 100, dist: 0 });
eq('吸附：多候选取最近（98 优于 103）', snapAxis([100], [98, 103]), { at: 98, dist: -2 });
eq('吸附：三条边取最近（中心命中）',
  snapAxis([100, 150, 200], [149]), { at: 149, dist: -1 });
eq('吸附：全是远线 → null', snapAxis([100, 150, 200], [500, 600]), null);

// ① 目标线收集
const items = [
  { key: 'self', left: 10, top: 10, w: 100, h: 40 },
  { key: 'a', left: 200, top: 100, w: 120, h: 50 },
  { key: 'hidden', left: 300, top: 300, w: 0, h: 0 },
  { key: 'locked', left: 400, top: 400, w: 80, h: 40, locked: true }
];
const t = snapTargets(items, { left: 0, top: 0, w: 1000, h: 800 }, 1000, 800, 'self');
eq('收集：排除自己', t.xs.indexOf(10) < 0 && t.xs.indexOf(110) < 0, true);
eq('收集：包含其它元素的左/中/右', [200, 260, 320].every(v => t.xs.indexOf(v) >= 0), true);
eq('收集：排除 0 尺寸隐藏项', t.xs.indexOf(300) < 0, true);
eq('收集：排除锁定项', t.xs.indexOf(400) < 0, true);
eq('收集：包含屏幕容器中线 500', t.xs.indexOf(500) >= 0, true);
eq('收集：包含视口中线 500', t.ys.indexOf(400) >= 0, true);

// ③ 位移合成：左边吸附
{
  const snap = { xs: [500], ys: [] };
  const r = moveTo({ left: 300, top: 100, w: 100, h: 40 }, 0, 0, 197, 0, snap);
  eq('位移：左边差 3px → dx 补到 200', r.dx, 200);
  near('位移：最终 left = 500', r.left, 500);
  eq('位移：参考线落在 500', r.gx, 500);
}
// ③ 中心吸附（元素宽 100，中心 = left+50）
{
  const snap = { xs: [300], ys: [] };
  const r = moveTo({ left: 100, top: 0, w: 100, h: 40 }, 0, 0, 148, 0, snap);
  eq('位移：中心差 2px → dx 补到 150', r.dx, 150);
  near('位移：中心对齐 300', r.left + 50, 300);
}
// ③ 右边吸附
{
  const snap = { xs: [600], ys: [] };
  const r = moveTo({ left: 100, top: 0, w: 100, h: 40 }, 0, 0, 396, 0, snap);
  eq('位移：右边差 4px → dx 补到 400', r.dx, 400);
  near('位移：最终 right = 600', r.left + 100, 600);
}
// ③ 已有 dx0 时不能重复计入
{
  const snap = { xs: [500], ys: [] };
  const r = moveTo({ left: 480, top: 0, w: 100, h: 20 }, 20, 0, 0, 0, snap);
  eq('位移：有 dx0 时按基准 rect 计算（L=480 差 20 不吸附）', r.gx, null);
  eq('位移：dx 保持 20', r.dx, 20);
}
// ③ 纵向吸附
{
  const snap = { xs: [], ys: [300] };
  const r = moveTo({ left: 0, top: 100, w: 100, h: 60 }, 0, 0, 0, 197, snap);
  eq('位移：上边差 3px → dy 补到 200', r.dy, 200);
  near('位移：最终 top = 300', r.top, 300);
  eq('位移：水平参考线落在 300', r.gy, 300);
}
// ③ 双向同时吸附
{
  const snap = { xs: [500], ys: [300] };
  const r = moveTo({ left: 300, top: 100, w: 100, h: 60 }, 0, 0, 197, 197, snap);
  eq('位移：双向同时吸附 dx', r.dx, 200);
  eq('位移：双向同时吸附 dy', r.dy, 200);
}
// ③ 超出阈值不吸附
{
  const snap = { xs: [500], ys: [] };
  const r = moveTo({ left: 300, top: 0, w: 100, h: 40 }, 0, 0, 193, 0, snap);
  eq('位移：差 7px 不吸附', r.gx, null);
  eq('位移：dx 保持原始值 193', r.dx, 193);
}

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'HAS FAIL') + ' / total ' + (pass + fail));
process.exit(fail === 0 ? 0 : 1);
