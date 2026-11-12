/* P2P 快照同步单测：编码 / 乱序丢弃 / 插值 / 外推 / 自适应时钟 / 追帧 / 回合重置
   另测：N 实体快照 encodeActors/decodeActors 与 SnapBuf.sample().actors */
const assert = require('assert');
global.window = {};
require('../sync.js');
const S = global.window.WowPinballSync;
assert.ok(S && S.encodeSnap && S.SnapBuf && S.encodeActors && S.decodeActors, 'sync 模块未导出');

// 1) 编码：字段齐全且量化
const p = { x: 123.45678, y: 10.11111, vx: -3.789, vy: 4.5678, hp: 88.55, shield: 5.0, maxHp: 100 };
const e = { x: 300.001, y: 200.999, vx: 1.234, vy: -2.345, hp: 60.44, shield: 0, maxHp: 90 };
const snap = S.encodeSnap(2, 3.456789, p, e, 7.8912);
assert.strictEqual(snap.k, 's');
assert.strictEqual(snap.s.length, 17);
assert.strictEqual(snap.s[0], 2);
assert.strictEqual(snap.s[1], 3.46);
assert.strictEqual(snap.s[2], 123.46);
assert.strictEqual(snap.s[6], 88.55);
assert.strictEqual(snap.s[13], 60.44);
assert.strictEqual(snap.s[16], 7.89);

// 2) 缓冲：push + 乱序丢弃 + 首包自动启动渲染时钟
const buf = new S.SnapBuf();
buf.push(snap);
assert.strictEqual(buf.latest().s[1], 3.46);
assert.ok(Math.abs(buf.renderT - (3.46 - buf.delay)) < 0.001, '首包应自动启动渲染时钟');
assert.ok(buf.sample(), '首包后 sample 不应为 null');
const older = JSON.parse(JSON.stringify(snap));
older.s[1] = 2.0;
buf.push(older);                       // clock 回退，应被丢弃
assert.strictEqual(buf.snaps.length, 1);
const junk = { k: 's', s: [1] };
buf.push(junk);                        // 长度不足，忽略
assert.strictEqual(buf.snaps.length, 1);

// 3) 插值：两帧之间线性取值；离散量取较新帧
function mk(t, x, vx, hp, rt) {
  const v = vx || 0;
  const s = [2, t, x, 0, v, 0, hp == null ? 100 : hp, 0, 100,
             400 - x, 200, -v, 0, 90, 0, 90, rt == null ? 5 : rt];
  return { k: 's', s };
}
const buf2 = new S.SnapBuf();
buf2.push(mk(3.50, 100, 0, 100, 5));
buf2.push(mk(3.60, 120, 0, 80, 4.5));
buf2.startAt(3.55);                    // renderT = 3.55 - 0.05 = 3.50
let sm = buf2.sample();
assert.strictEqual(sm.p.x, 100, '渲染时钟早于首帧 → 取首帧');
buf2.advance(0.05);                    // renderT = 3.55，正中两帧中点
sm = buf2.sample();
assert.ok(Math.abs(sm.p.x - 110) < 0.01, '中点插值应为 110');
assert.ok(Math.abs(sm.e.x - 290) < 0.01, '对侧弹珠同步插值');
assert.strictEqual(sm.p.hp, 80, '血量取较新帧值，不慢半拍');
assert.strictEqual(sm.rt, 4.5, '倒计时取较新帧值');

// 4) 外推：缓冲短暂枯竭时按速度继续前进，超过上限则钉住末帧
const buf3 = new S.SnapBuf();
buf3.push(mk(10.00, 100, 300, 100, 5));
buf3.push(mk(10.03, 109, 300, 90, 4.97));
buf3.startAt(10.06);                  // renderT = 10.01
buf3.advance(0.04);                    // renderT = 10.05，超出末帧 0.02s
let ex = buf3.sample();
assert.ok(ex.p.x > 109, '缓冲枯竭时应外推而不是冻结');
assert.ok(Math.abs(ex.p.x - (109 + 300 * 0.02)) < 0.01, '外推位移 = 末帧速度 × 超出时长');
assert.strictEqual(ex.p.hp, 90, '外推时血量仍取末帧');
buf3.advance(0.5);                     // 超出时长远超上限
ex = buf3.sample();
assert.strictEqual(ex.p.x, 109, '超过外推上限后钉住末帧，避免飞出场地');

// 5) 自适应时钟：缓冲堆积加速、枯竭减速
const buf4 = new S.SnapBuf();
buf4.push(mk(20.00, 50));
buf4.push(mk(20.03, 53));
buf4.startAt(19.80);                  // renderT = 19.75，ahead = 0.28
let before = buf4.renderT;
buf4.advanceAdaptive(0.016);
assert.ok(buf4.rate > 1, '缓冲堆积时应加速追赶（降低延迟）');
assert.ok(buf4.renderT - before > 0.016, '加速推进量应大于真实 dt');
buf4.startAt(20.10);                  // renderT = 20.05，ahead = -0.02
buf4.advanceAdaptive(0.016);
assert.ok(buf4.rate < 1, '缓冲枯竭时应减速保住缓冲');

// 6) 追帧：一般落后不硬跳，严重落后才重置
buf4.startAt(19.00);                  // renderT = 18.95，落后 1.08s
const t0 = buf4.renderT;
buf4.resyncIfNeeded();
assert.ok(Math.abs(buf4.renderT - t0) < 1e-9, '落后 1.08s 不应硬跳（交给速率反馈渐进追）');
buf4.startAt(17.00);                  // renderT = 16.95，落后 3.08s
buf4.resyncIfNeeded();
assert.ok(Math.abs(buf4.renderT - (20.03 - buf4.delay)) < 0.001, '严重落后才硬重置到最新帧');

// 7) 回合切换：客机清空缓冲 + renderT=null 后，新回合首包应重启时钟
const buf5 = new S.SnapBuf();
buf5.push(mk(30.0, 60));
buf5.snaps = []; buf5.renderT = null;
assert.strictEqual(buf5.sample(), null, '回合切换重置后应暂无可渲染帧');
buf5.push(mk(40.0, 70));
assert.ok(Math.abs(buf5.renderT - (40.0 - buf5.delay)) < 0.001, '新回合首包应重启渲染时钟');
assert.strictEqual(buf5.sample().p.x, 70, '新回合首包立即可渲染');

// 8) N 实体快照（2V2）：encodeActors / decodeActors
const actors4 = [
  { x: 1.234, y: 2.345, vx: -0.5, vy: 0.25, hp: 100, shield: 0, maxHp: 100 },
  { x: 10.1, y: 20.2, vx: 1.1, vy: -2.2, hp: 88.55, shield: 5, maxHp: 90 },
  { x: 30.3, y: 40.4, vx: 0, vy: 3.3, hp: 70, shield: 2.5, maxHp: 80 },
  { x: 50.5, y: 60.6, vx: -4.4, vy: 4.4, hp: 60, shield: 0, maxHp: 75 }
];
const act = S.encodeActors(3, 5.6789, actors4, 9.8765);
assert.strictEqual(act.k, 'a');
assert.strictEqual(act.s[0], 3, 'round');
assert.strictEqual(act.s[1], 5.68, 'clock 量化');
assert.strictEqual(act.s[2], 4, '实体数 n');
assert.strictEqual(act.s.length, 3 + 7 * 4 + 1, '总槽数 = 3 + 7n + 1');
assert.strictEqual(act.s[3], 1.23, '实体0 x 量化');
assert.strictEqual(act.s[9], 100, '实体0 maxHp 不量化');
assert.strictEqual(act.s[act.s.length - 1], 9.88, 'roundTime 量化');
const dec = S.decodeActors(act.s);
assert.strictEqual(dec.round, 3);
assert.strictEqual(dec.clock, 5.68);
assert.strictEqual(dec.roundTime, 9.88);
assert.strictEqual(dec.actors.length, 4);
assert.strictEqual(dec.actors[1].hp, 88.55);
assert.strictEqual(dec.actors[3].maxHp, 75);
const dec2 = S.decodeActors(act);      // 也接受完整快照对象
assert.strictEqual(dec2.actors.length, 4);
assert.strictEqual(dec2.actors[0].x, 1.23);

// 9) SnapBuf.sample().actors
// 9a) k==='s'（旧 17 槽）→ actors = [p, e]
const bufS = new S.SnapBuf();
bufS.push(mk(3.50, 100, 0, 100, 5));
bufS.push(mk(3.60, 120, 0, 80, 4.5));
bufS.startAt(3.55);
const smS = bufS.sample();
assert.ok(Array.isArray(smS.actors), 'sample 应带 actors 字段');
assert.strictEqual(smS.actors.length, 2, 'k=s 时 actors = [p,e]');
assert.strictEqual(smS.actors[0], smS.p, 'actors[0] 即 p');
assert.strictEqual(smS.actors[1], smS.e, 'actors[1] 即 e');
// 9b) k==='a'（N 实体）→ actors 用 decodeActors 解出，原有 p/e/rt/snap 不变
const bufA = new S.SnapBuf();
bufA.push(act);
const smA = bufA.sample();
assert.ok(Array.isArray(smA.actors), 'k=a 快照 sample 应带 actors');
assert.strictEqual(smA.actors.length, 4, 'k=a 时 actors 为 4 个实体');
assert.strictEqual(smA.actors[1].hp, 88.55);
assert.strictEqual(smA.actors[3].maxHp, 75);
assert.ok(smA.p && smA.e && smA.rt !== undefined && smA.snap === act, '原有 p/e/rt/snap 字段保持不变');

// 10) 2V2（k:'a'）快照必须插值，且 roundTime 取数组末槽
const mkActors = (clock, x0, rt) => S.encodeActors(1, clock, [
  { x: x0, y: 0, vx: 100, vy: 0, hp: 100, shield: 0, maxHp: 100 },
  { x: 500, y: 0, vx: 0, vy: 0, hp: 90, shield: 0, maxHp: 100 },
  { x: 600, y: 0, vx: 0, vy: 0, hp: 80, shield: 0, maxHp: 100 },
  { x: 700, y: 0, vx: 0, vy: 0, hp: 70, shield: 0, maxHp: 100 }
], rt);
const bufN = new S.SnapBuf();
bufN.push(mkActors(1.00, 0, 9.0));
bufN.push(mkActors(1.10, 10, 8.9));
bufN.renderT = 1.05;
const smN = bufN.sample();
assert.ok(Math.abs(smN.actors[0].x - 5) < 0.01, '2V2 中点应插值为 5，而不是整帧原值');
assert.strictEqual(smN.actors.length, 4, '2V2 四个实体都要插值');
assert.strictEqual(smN.actors[1].hp, 90, '离散量取较新帧');
assert.ok(Math.abs(smN.rt - 8.9) < 0.001, '2V2 roundTime 必须取数组末槽，不能读 s[16]');
assert.strictEqual(smN.actors[0], smN.p, 'k=a 时 p 与 actors[0] 同引用');
const smNx = bufN.sample();
assert.ok(smNx, '2V2 sample 不应为 null');
// 2V2 外推分支也应走 N 实体路径
bufN.renderT = 1.12;
const smNe = bufN.sample();
assert.ok(smNe.actors[0].x >= 10, '2V2 缓冲枯竭时应按实体速度外推');

// 11) 乱序到达但仍在渲染时刻之后的帧不能被误丢
const bufR = new S.SnapBuf();
bufR.push(mk(10.00, 100));
bufR.push(mk(10.09, 109));
bufR.push(mk(10.03, 103));                       // 晚到，但仍有效
assert.strictEqual(bufR.snaps.length, 3, '有效乱序帧应保留');
assert.deepStrictEqual(bufR.snaps.map(x => x.s[1]), [10.00, 10.09, 10.03].sort((a, b) => a - b),
  '缓冲必须按 clock 单调递增');
const tooOld = mk(9.00, 1);
bufR.push(tooOld);
assert.strictEqual(bufR.snaps.length, 3, '已经早于渲染时刻的帧才丢弃');

// 12) 房主命中停顿帧：客机渲染时钟同步停住，不外推
const bufF = new S.SnapBuf();
bufF.push(mk(20.00, 100, 300, 100, 5));
const frozenSnap = mk(20.00, 100, 300, 100, 5);   // hitStop 时 clock 不推进
frozenSnap.f = 1;
bufF.push(frozenSnap);
const tF = bufF.renderT;
bufF.advanceAdaptive(0.1);
assert.strictEqual(bufF.rate, 0, '冻结帧时速率为 0');
assert.strictEqual(bufF.renderT, tF, '冻结帧时渲染时钟不推进');
bufF.push(mk(20.06, 118, 300, 80, 4.94));       // 恢复正常帧
bufF.advanceAdaptive(0.016);
assert.ok(bufF.renderT > tF, '非冻结帧恢复后时钟继续推进');

console.log('test_p2p_sync: all assertions passed');
