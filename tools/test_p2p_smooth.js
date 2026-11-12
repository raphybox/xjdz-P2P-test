/* 联机客机卡顿 A 档正确性修复回归
   node tools/test_p2p_smooth.js
   覆盖：2V2 插值、roundTime 索引、乱序保留、命中停顿冻结帧、
        HUD 节流、发送背压，以及 game/net 三处改动的源码结构。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const ROOT = path.resolve(__dirname, '..');
const src = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const syncSrc = src('sync.js');
const gameSrc = src('game.js');
const netSrc = src('net.js');

const ctx = { window: {}, console, Math, Date, Object, Number, String, Array, JSON, isFinite };
ctx.window.window = ctx.window;
vm.createContext(ctx);
vm.runInContext(syncSrc, ctx);
const S = ctx.window.WowPinballSync;

/* 1) sync.js 内核 */
assert.ok(/s\[s\.length - 1\]/.test(syncSrc), 'roundTime 必须取数组末槽');
assert.ok(/function lerpActors/.test(syncSrc), '必须有 N 实体插值');
assert.ok(/while \(i > 0 && this\.snaps\[i - 1\]\.s\[1\] > s\[1\]\) i--/.test(syncSrc), '必须按 clock 有序插入');
assert.ok(/if \(snap\.f\) \{[\s\S]{0,160}this\.frozen = true;/.test(syncSrc), '必须识别房主冻结标志');
assert.ok(/_frozenAt > 0\.25/.test(syncSrc), '冻结标志必须有超时兜底，防止永久钉住');

const mkA = (c, x, rt) => S.encodeActors(1, c, [
  { x, y: 0, vx: 100, vy: 0, hp: 100, shield: 0, maxHp: 100 },
  { x: 500, y: 0, vx: 0, vy: 0, hp: 90, shield: 0, maxHp: 100 },
  { x: 600, y: 0, vx: 0, vy: 0, hp: 80, shield: 0, maxHp: 100 },
  { x: 700, y: 0, vx: 0, vy: 0, hp: 70, shield: 0, maxHp: 100 }
], rt);
const b1 = new S.SnapBuf();
b1.push(mkA(1.00, 0, 9)); b1.push(mkA(1.10, 10, 8.9));
b1.renderT = 1.05;
const sm = b1.sample();
assert.ok(Math.abs(sm.actors[0].x - 5) < 0.01, '2V2 中点插值');
assert.ok(Math.abs(sm.rt - 8.9) < 0.001, '2V2 倒计时取末槽');
assert.strictEqual(sm.actors.length, 4, '四实体都插值');

const b2 = new S.SnapBuf();
const mkS = (c, x) => ({ k: 's', s: [1, c, x, 0, 100, 0, 100, 0, 100, 900 - x, 0, 0, 0, 100, 0, 100, 5] });
b2.push(mkS(10.00, 100)); b2.push(mkS(10.09, 109)); b2.push(mkS(10.03, 103));
assert.strictEqual(b2.snaps.length, 3, '有效乱序帧保留');
assert.strictEqual(JSON.stringify(Array.from(b2.snaps, x => x.s[1])), JSON.stringify([10.00, 10.03, 10.09]), '按 clock 有序');

const b3 = new S.SnapBuf();
b3.push(mkS(20.00, 100));
const fz = mkS(20.00, 100); fz.f = 1;   // hitStop 时 clock 不推进，与上一帧相同
b3.push(fz);
const t0 = b3.renderT;
const beforeSnaps = b3.snaps.length;
b3.advanceAdaptive(0.1);
assert.strictEqual(b3.renderT, t0, '冻结帧期间渲染时钟不推进');
assert.strictEqual(b3.snaps.length, beforeSnaps, '同 clock 冻结帧不应入队');
b3.push(mkS(20.06, 118));
b3.advanceAdaptive(0.016);
assert.ok(b3.renderT > t0, '恢复帧后继续推进');

/* 2) game.js：命中停顿仍发冻结帧、客机 HUD 节流 */
assert.ok(/function p2pSendSnap\(frozen\)/.test(gameSrc), 'p2pSendSnap 需接受 frozen');
assert.ok(/if \(frozen\) snap\.f = 1;/.test(gameSrc), '冻结快照需带 f:1');
assert.ok(/ts < G\.hitStopUntil\)[\s\S]{0,260}p2pSendSnap\(true\)/.test(gameSrc),
  '命中停顿分支必须继续发快照');
assert.ok(/P2P\.hudAcc >= 0\.08/.test(gameSrc), '客机 HUD 需节流');
assert.ok(/hudAcc: 0/.test(gameSrc), 'P2P 状态需有 hudAcc');
assert.ok(!/p2pGuestHitFx\(foe\.hp, ef, false\);\s*updateHud\(\);/.test(gameSrc),
  '客机不应每帧全量 updateHud');

/* 3) net.js：不可靠通道背压，ctrl 不受影响 */
assert.ok(/kind === 'game' && ch\.bufferedAmount > 4096/.test(netSrc), 'game 通道需有背压');
assert.ok(/ordered: false, maxRetransmits: 0/.test(netSrc), 'game 通道仍须不可靠无序');

console.log('test_p2p_smooth: all assertions passed');
