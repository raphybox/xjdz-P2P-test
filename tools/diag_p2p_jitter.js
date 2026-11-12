/* 联机客机卡顿量化诊断（只读，不改运行时）
   node tools/diag_p2p_jitter.js

   按 sync.js 注释里的真实弱网条件模拟：房主 30Hz 快照、单向 200ms、
   抖动 ±42ms、17% 丢包、无序不可靠通道；客机 60fps 消费 SnapBuf。
   统计「相邻渲染帧位移」的冻结比例与跳变幅度，对比几种缓冲策略。
   目的是给出数据，而不是凭感觉调参。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');

const ctx = { window: {}, console, Math, Date, Object, Number, String, Array, JSON, isFinite };
ctx.window.window = ctx.window;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'sync.js'), 'utf8'), ctx);
const SYNC = ctx.window.WowPinballSync;

const HZ = 30, FPS = 60, T = 20, LOSS = 0.17, JITTER = 0.042, RTT = 0.20;
const q = v => Math.round(v * 100) / 100;
const posAt = c => 450 + 300 * Math.sin(c * 2);   // 平滑正弦运动，理想情况下每帧位移应连续

function makePackets(seed) {
  let s = seed || 1;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const out = [];
  for (let i = 0; i < T * HZ; i++) {
    const clock = i / HZ;
    if (rnd() < LOSS) continue;                       // 丢包
    const j = (rnd() * 2 - 1) * JITTER;              // 抖动（可正可负）
    const arrive = clock + RTT + j;
    const x = posAt(clock), vx = 600 * Math.cos(clock * 2);
    const s17 = [1, q(clock), q(x), 100, q(vx), 0, 100, 0, 100, 0, 100, 0,
      600 - q(x), 100, 0, 100, q(T - clock)];
    out.push({ arrive, snap: { k: 's', s: s17 } });
  }
  out.sort((a, b) => a.arrive - b.arrive);          // 无序通道：按到达时间排序
  return out;
}

function run(label, opts) {
  const packets = makePackets(7);
  const buf = new SYNC.SnapBuf();
  if (opts.delay != null) buf.delay = opts.delay;
  if (opts.maxExtrap != null) buf.maxExtrap = opts.maxExtrap;
  // 策略 R：模拟「修复乱序丢弃」——按 clock 有序插入，只丢真正重复/过旧的包
  if (opts.reorder) {
    buf.push = function (snap) {
      const s = snap && snap.s;
      if (!s || s.length < 17) return;
      if (this.snaps.some(x => x.s[1] === s[1])) return;
      this.snaps.push(snap);
      this.snaps.sort((a, b) => a.s[1] - b.s[1]);
      if (this.renderT == null) this.renderT = s[1] - this.delay;
      if (this.snaps.length > 40) this.snaps.shift();
    };
  }
  const xs = [], frozen = [];
  let pi = 0, discarded = 0, arrived = 0, kept = 0;
  const dt = 1 / FPS;
  for (let f = 0; f < T * FPS; f++) {
    const now = f * dt;
    while (pi < packets.length && packets[pi].arrive <= now) {
      const clock = packets[pi].snap.s[1];
      arrived++;
      buf.push(packets[pi].snap);
      // 用 clock 是否真的进了缓冲判定，避免「缓冲满 40 后 shift」被误算成丢弃
      if (buf.snaps.some(x => x.s[1] === clock)) kept++; else discarded++;
      pi++;
    }
    buf.advanceAdaptive(dt);
    buf.resyncIfNeeded();
    const sm = buf.sample();
    if (!sm) { xs.push(null); continue; }
    let v = sm.p.x;
    if (opts.keepExtrap && v === xs[xs.length - 1] && buf.renderT != null) {
      // 策略 C：缓冲枯竭时按最后速度继续外推（这里只做上界演示，不修改 sync.js）
      const last = buf.latest();
      if (last) v = q(v + Math.max(-90, Math.min(90, last.s[4] * dt)));
    }
    xs.push(v);
  }
  const diffs = [];
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] == null || xs[i - 1] == null) continue;
    diffs.push(Math.abs(xs[i] - xs[i - 1]));
  }
  const sorted = diffs.slice().sort((a, b) => a - b);
  const pct = p => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0;
  const still = diffs.filter(d => d < 0.05).length / (diffs.length || 1);
  const med = pct(0.5) || 1;
  const jump = diffs.filter(d => d > med * 3 + 1).length / (diffs.length || 1);
  console.log(label.padEnd(30),
    '冻结帧', (still * 100).toFixed(1) + '%',
    '| 跳变帧', (jump * 100).toFixed(1) + '%',
    '| 位移 p50', med.toFixed(2), 'p95', pct(0.95).toFixed(2), 'max', (sorted[sorted.length - 1] || 0).toFixed(2),
    '| 入队', kept + '/' + arrived, '丢弃', discarded);
  return { still, jump, p95: pct(0.95) };
}

console.log('弱网模拟：30Hz 快照 / 单向 200ms / 抖动 ±42ms / 丢包 17% / 客机 60fps\n');
run('现状 delay=50ms 外推80ms', { delay: 0.05, maxExtrap: 0.08 });
run('水位 90ms 外推80ms', { delay: 0.09, maxExtrap: 0.08 });
run('水位 120ms 外推80ms', { delay: 0.12, maxExtrap: 0.08 });
run('水位 90ms 外推200ms', { delay: 0.09, maxExtrap: 0.20 });
run('水位 90ms + 枯竭续推', { delay: 0.09, maxExtrap: 0.20, keepExtrap: true });
run('修复乱序丢弃 + 90ms', { delay: 0.09, maxExtrap: 0.20, reorder: true });

console.log('\n=== N 实体（2V2）快照是否插值 ===');
{
  const a = SYNC.encodeActors(1, 1.00, [
    { x: 0, y: 0, vx: 100, vy: 0, hp: 100, shield: 0, maxHp: 100 },
    { x: 10, y: 0, vx: 0, vy: 0, hp: 100, shield: 0, maxHp: 100 },
    { x: 20, y: 0, vx: 0, vy: 0, hp: 100, shield: 0, maxHp: 100 },
    { x: 30, y: 0, vx: 0, vy: 0, hp: 100, shield: 0, maxHp: 100 }
  ], 9);
  const b = SYNC.encodeActors(1, 1.033, [
    { x: 10, y: 0, vx: 100, vy: 0, hp: 90, shield: 0, maxHp: 100 },
    { x: 10, y: 0, vx: 0, vy: 0, hp: 100, shield: 0, maxHp: 100 },
    { x: 20, y: 0, vx: 0, vy: 0, hp: 100, shield: 0, maxHp: 100 },
    { x: 30, y: 0, vx: 0, vy: 0, hp: 100, shield: 0, maxHp: 100 }
  ], 9);
  const buf = new SYNC.SnapBuf();
  buf.push(a); buf.push(b);
  buf.renderT = 1.0165;   // 正好在两帧中间
  const sm = buf.sample();
  const interpOK = sm.actors[0].x > 1 && sm.actors[0].x < 9;
  const rtOK = Math.abs(sm.rt - 9) < 0.2;
  console.log('中间时刻 actors[0].x =', sm.actors[0].x.toFixed(2),
    '（两帧 0→10，应落在中间）', interpOK ? 'PASS 已插值' : 'FAIL 仍是整帧原值');
  console.log('中间时刻 rt =', sm.rt,
    '（k=a 长度', b.s.length, '，roundTime 在索引', b.s.length - 1, '，应为 9）', rtOK ? 'PASS' : 'FAIL');
  if (!interpOK || !rtOK) process.exitCode = 1;
}
