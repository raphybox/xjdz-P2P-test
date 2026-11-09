/* =============================================================
   选技弹珠 · P2P 快照同步（sync.js）
   房主权威：房主 20Hz 广播战斗快照（不可靠 game 通道），
   客机写入缓冲后以固定延迟插值回放，画面永远比房主慢约 120ms，
   换来平滑：偶发丢包不抖动，乱序不回跳。

   快照为紧凑数组（减少 JSON 体积）：
   [round, clock, p.x,p.y,p.vx,p.vy,hp,shield, maxHp,
            e.x,e.y,e.vx,e.vy,hp,shield, maxHp, roundTime]
   ============================================================= */
(function () {
  'use strict';

  var q = function (v) { return Math.round(v * 100) / 100; };

  /* 房主端：把双方弹珠状态压成一行数组 */
  function encodeSnap(round, clock, p, e, roundTime) {
    return {
      k: 's',
      s: [
        round, q(clock),
        q(p.x), q(p.y), q(p.vx), q(p.vy), q(p.hp), q(p.shield), p.maxHp,
        q(e.x), q(e.y), q(e.vx), q(e.vy), q(e.hp), q(e.shield), e.maxHp,
        q(roundTime)
      ]
    };
  }

  /* 客机端：带插值的快照缓冲 */
  function SnapBuf() {
    this.snaps = [];       // 按到达顺序（房主 clock 单调递增）
    this.renderT = null;   // 客机渲染时钟
    this.delay = 0.12;     // 渲染延迟（秒）
  }

  SnapBuf.prototype.push = function (snap) {
    var s = snap && snap.s;
    if (!s || s.length < 17) return;
    // 乱序丢弃：clock 回退的包直接扔掉
    if (this.snaps.length && s[1] < this.snaps[this.snaps.length - 1].s[1]) return;
    this.snaps.push(snap);
    if (this.snaps.length > 40) this.snaps.shift();
  };

  SnapBuf.prototype.latest = function () {
    return this.snaps.length ? this.snaps[this.snaps.length - 1] : null;
  };

  /* 首包到达时启动渲染时钟；之后逐帧 advance(realDt) */
  SnapBuf.prototype.started = function () { return this.renderT != null; };

  SnapBuf.prototype.advance = function (dt) {
    if (this.renderT == null) return;
    this.renderT += dt;
  };

  SnapBuf.prototype.startAt = function (hostClock) {
    this.renderT = hostClock - this.delay;
  };

  /* 渲染时钟落后太多（长卡顿 / 切后台）→ 追到最新 */
  SnapBuf.prototype.resyncIfNeeded = function () {
    var last = this.latest();
    if (!last || this.renderT == null) return;
    if (this.renderT < last.s[1] - 0.6) this.renderT = last.s[1] - this.delay;
  };

  /* 取 renderT 时刻的插值状态；找不到相邻对时返回 null（沿用上次画面）。
     回调里写入的是模拟侧语义：out.p = 房主弹珠，out.e = 客机弹珠。 */
  SnapBuf.prototype.sample = function () {
    var t = this.renderT;
    if (t == null || !this.snaps.length) return null;
    var snaps = this.snaps;
    if (t <= snaps[0].s[1]) {
      return { p: unpackSide(snaps[0].s, 2), e: unpackSide(snaps[0].s, 9), rt: snaps[0].s[16], snap: snaps[0] };
    }
    var last = snaps[snaps.length - 1];
    if (t >= last.s[1]) {
      return { p: unpackSide(last.s, 2), e: unpackSide(last.s, 9), rt: last.s[16], snap: last };
    }
    for (var i = 0; i < snaps.length - 1; i++) {
      var a = snaps[i].s, b = snaps[i + 1].s;
      if (t >= a[1] && t <= b[1]) {
        var alpha = (b[1] - a[1]) > 0 ? (t - a[1]) / (b[1] - a[1]) : 0;
        return { p: lerpSide(a, b, alpha, 2), e: lerpSide(a, b, alpha, 9), rt: a[16] + (b[16] - a[16]) * alpha, snap: b };
      }
    }
    return null;
  };

  function unpackSide(s, o) {
    return { x: s[o], y: s[o + 1], vx: s[o + 2], vy: s[o + 3], hp: s[o + 4], shield: s[o + 5], maxHp: s[o + 6] };
  }

  function lerpSide(a, b, alpha, o) {
    var L = function (i) { return a[o + i] + (b[o + i] - a[o + i]) * alpha; };
    return { x: L(0), y: L(1), vx: L(2), vy: L(3), hp: L(4), shield: L(5), maxHp: b[o + 6] };
  }

  window.WowPinballSync = {
    encodeSnap: encodeSnap,
    SnapBuf: SnapBuf
  };
})();
