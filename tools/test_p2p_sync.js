/* P2P 快照同步单测：编码 / 乱序丢弃 / 插值 / 追帧 */
const assert = require('assert');
global.window = {};
require('../sync.js');
const S = global.window.WowPinballSync;
assert.ok(S && S.encodeSnap && S.SnapBuf, 'sync 模块未导出');

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

// 2) 缓冲：push + 乱序丢弃
const buf = new S.SnapBuf();
buf.push(snap);
assert.strictEqual(buf.latest().s[1], 3.46);
const older = JSON.parse(JSON.stringify(snap));
older.s[1] = 2.0;
buf.push(older);                       // clock 回退，应被丢弃
assert.strictEqual(buf.snaps.length, 1);
const junk = { k: 's', s: [1] };
buf.push(junk);                        // 长度不足，忽略
assert.strictEqual(buf.snaps.length, 1);

// 3) 插值：两帧之间线性取值（用全新缓冲，避免上面残留帧干扰）
function mk(t, x) {
  const s = [2, t, x, 0, 0, 0, 100, 0, 100, 400 - x, 200, 0, 0, 90, 0, 90, 5];
  return { k: 's', s };
}
const buf2 = new S.SnapBuf();
buf2.push(mk(3.50, 100));
buf2.push(mk(3.60, 120));
assert.strictEqual(buf2.sample(), null, '渲染时钟未启动时 sample 应为 null');
buf2.startAt(3.55);                    // renderT = 3.55 - 0.12 = 3.43
let sm = buf2.sample();
assert.strictEqual(sm.p.x, 100, '渲染时钟早于首帧 → 取首帧');
buf2.advance(0.24);                    // renderT = 3.67
sm = buf2.sample();
assert.ok(sm.p.x >= 120, '渲染时钟晚于末帧 → 取末帧');
buf2.startAt(3.55);
buf2.advance(0.12);                    // renderT = 3.55，正中两帧中点
sm = buf2.sample();
assert.ok(Math.abs(sm.p.x - 110) < 0.01, '中点插值应为 110');
assert.ok(Math.abs(sm.e.x - 290) < 0.01, '对侧弹珠同步插值');
assert.ok(Math.abs(sm.rt - 5) < 0.01, '回合剩余时间同步插值');

// 4) 追帧：落后超过 0.6s 时，渲染时钟应被拉到「最新帧 - 渲染延迟」
buf2.startAt(2.9);                     // 落后最新 3.60 超过 0.6s
buf2.resyncIfNeeded();
assert.ok(Math.abs(buf2.renderT - (3.60 - 0.12)) < 0.001, 'resync 后 renderT 应为 latest - delay');

console.log('test_p2p_sync: 12 assertions passed');
