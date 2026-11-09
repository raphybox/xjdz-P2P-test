/* =============================================================
   选技弹珠 · P2P 快照同步（sync.js）
   房主权威：房主 30Hz 广播战斗快照（不可靠 game 通道），
   客机写入缓冲后插值回放。

   低延迟策略（针对跨网 TURN 中继 ~200ms 单向 + 17% 丢包 + 42ms 抖动）：
   1) 目标缓冲水位仅 50ms（旧版固定 120ms 叠加在网络延迟上，体感慢半拍）
   2) advanceAdaptive 用「缓冲水位」反馈调节渲染时钟速率，自动吸收两端
      时钟差与到达抖动，不再出现「冻结 → 硬跳追帧」的一顿一顿
   3) 缓冲短暂枯竭时按最后一帧速度做上限外推，而不是把画面钉住
   4) 血量 / 护盾 / 倒计时是离散量，取较新帧值，不参与插值
   5) resyncIfNeeded 只在严重落后（>1.5s，切后台等）时硬重置

   快照为紧凑数组（减少 JSON 体积）：
   [round, clock, p.x,p.y,p.vx,p.vy,hp,shield,maxHp,
            e.x,e.y,e.vx,e.vy,hp,shield,maxHp, roundTime]
   ============================================================= */
(function () {
  'use strict';

  var q = function (v) { return Math.round(v * 100) / 100; };
  var clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };

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
    this.snaps = [];        // 按到达顺序（房主 clock 单调递增）
    this.renderT = null;    // 客机渲染时钟（房主时钟域）
    this.delay = 0.05;      // 目标缓冲水位：渲染落后最新帧 50ms
    this.maxExtrap = 0.08;  // 超过最新帧后最多外推 80ms
    this.rate = 1;          // 自适应时钟速率（观测用）
    this.jitter = 0;        // 到达抖动 EWMA
    this._lastArrival = null;
  }

  SnapBuf.prototype.push = function (snap) {
    var s = snap && snap.s;
    if (!s || s.length < 17) return;
    // 乱序丢弃：clock 回退的包直接扔掉
    if (this.snaps.length && s[1] < this.snaps[this.snaps.length - 1].s[1]) return;
    // 抖动观测：到达间隔与房主时钟增量的偏差（EWMA，用于放宽外推窗口）
    var now = Date.now() / 1000;
    if (this._lastArrival != null && this.snaps.length) {
      var aGap = now - this._lastArrival;
      var cGap = s[1] - this.snaps[this.snaps.length - 1].s[1];
      if (aGap > 0 && aGap < 1 && cGap > 0) {
        this.jitter = this.jitter * 0.85 + Math.abs(aGap - cGap) * 0.15;
      }
    }
    this._lastArrival = now;
    this.snaps.push(snap);
    // 首包 / 每回合重置后自动启动渲染时钟：否则 sample() 永远返回 null，
    // 快照堆满缓冲却一帧都显示不出来（历史 bug，务必保留）
    if (this.renderT == null) this.renderT = s[1] - this.delay;
    if (this.snaps.length > 40) this.snaps.shift();
  };

  SnapBuf.prototype.latest = function () {
    return this.snaps.length ? this.snaps[this.snaps.length - 1] : null;
  };

  SnapBuf.prototype.started = function () { return this.renderT != null; };

  /* 纯推进：测试 / 手动控制渲染时钟用 */
  SnapBuf.prototype.advance = function (dt) {
    if (this.renderT == null) return;
    this.renderT += dt;
  };

  /* 自适应推进（对战主循环用）：
     ahead = 最新帧 clock - 渲染时钟，即缓冲里还剩多少「未来」数据。
     ahead 偏大 → 略微加速（把缓冲压回目标，降低延迟）；
     ahead 偏小 → 略微减速（保住缓冲，避免冻结）。
     速率变化连续且幅度受限，画面不会忽快忽慢。 */
  SnapBuf.prototype.advanceAdaptive = function (dt) {
    if (this.renderT == null) return;
    var last = this.latest();
    if (!last) { this.renderT += dt; return; }
    var ahead = last.s[1] - this.renderT;
    var target = Math.min(0.09, this.delay + Math.min(this.jitter, 0.04));
    this.rate = 1 + clamp((ahead - target) * 1.6, -0.20, 0.30);
    this.renderT += dt * this.rate;
  };

  SnapBuf.prototype.startAt = function (hostClock) {
    this.renderT = hostClock - this.delay;
  };

  /* 只有严重落后（切后台 / 长卡顿 >1.5s）才硬重置；一般落后交给速率反馈渐进追 */
  SnapBuf.prototype.resyncIfNeeded = function () {
    var last = this.latest();
    if (!last || this.renderT == null) return;
    if (this.renderT < last.s[1] - 1.5) this.renderT = last.s[1] - this.delay;
  };

  /* 取 renderT 时刻的插值状态；找不到相邻对时返回 null（沿用上次画面）。
     回调里写入的是模拟侧语义：out.p = 房主弹珠，out.e = 客机弹珠。 */
  SnapBuf.prototype.sample = function () {
    var t = this.renderT;
    if (t == null || !this.snaps.length) return null;
    var snaps = this.snaps;
    var first = snaps[0].s, last = snaps[snaps.length - 1].s;
    if (t <= first[1]) {
      return { p: unpackSide(first, 2), e: unpackSide(first, 9), rt: first[16], snap: snaps[0] };
    }
    if (t >= last[1]) {
      var over = t - last[1];
      var lim = Math.min(0.14, this.maxExtrap + Math.min(this.jitter, 0.06));
      if (over > 0 && over <= lim) {
        return {
          p: extrapSide(last, 2, over), e: extrapSide(last, 9, over),
          rt: Math.max(0, last[16] - over), snap: snaps[snaps.length - 1]
        };
      }
      return { p: unpackSide(last, 2), e: unpackSide(last, 9), rt: last[16], snap: snaps[snaps.length - 1] };
    }
    for (var i = 0; i < snaps.length - 1; i++) {
      var a = snaps[i].s, b = snaps[i + 1].s;
      if (t >= a[1] && t <= b[1]) {
        var alpha = (b[1] - a[1]) > 0 ? (t - a[1]) / (b[1] - a[1]) : 0;
        // 位置/速度插值；离散量取较新帧，血条与倒计时不慢半拍
        return { p: lerpSide(a, b, alpha, 2), e: lerpSide(a, b, alpha, 9), rt: b[16], snap: snaps[i + 1] };
      }
    }
    return null;
  };

  function unpackSide(s, o) {
    return { x: s[o], y: s[o + 1], vx: s[o + 2], vy: s[o + 3], hp: s[o + 4], shield: s[o + 5], maxHp: s[o + 6] };
  }

  function lerpSide(a, b, alpha, o) {
    var L = function (i) { return a[o + i] + (b[o + i] - a[o + i]) * alpha; };
    return { x: L(0), y: L(1), vx: L(2), vy: L(3), hp: b[o + 4], shield: b[o + 5], maxHp: b[o + 6] };
  }

  /* 缓冲枯竭时按最后一帧速度线性外推，位移封顶防止速度异常时飞出场地 */
  function extrapSide(s, o, dt) {
    return {
      x: s[o] + clamp(s[o + 2] * dt, -90, 90),
      y: s[o + 1] + clamp(s[o + 3] * dt, -90, 90),
      vx: s[o + 2], vy: s[o + 3], hp: s[o + 4], shield: s[o + 5], maxHp: s[o + 6]
    };
  }

  window.WowPinballSync = {
    encodeSnap: encodeSnap,
    SnapBuf: SnapBuf
  };
})();
