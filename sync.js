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
   1V1 旧 17 槽（k:'s'）：
   [round, clock, p.x,p.y,p.vx,p.vy,hp,shield,maxHp,
            e.x,e.y,e.vx,e.vy,hp,shield,maxHp, roundTime]
   2V2 N 实体（k:'a'）：
   [round, clock, n, (每实体 7 槽 x,y,vx,vy,hp,shield,maxHp)…, roundTime]
   ============================================================= */
(function () {
  'use strict';

  var q = function (v) { return Math.round(v * 100) / 100; };
  var clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };

  /* 房主端：把双方弹珠状态压成一行数组（1V1 旧 17 槽，保持不变） */
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

  /* 房主端：把 N 个实体（2 或 4 颗弹珠）压成一行数组。
     布局：[round, q(clock), n, (每实体 7 槽 q(x),q(y),q(vx),q(vy),q(hp),q(shield),maxHp)…, q(roundTime)] */
  function encodeActors(round, clock, actors, roundTime) {
    var s = [round, q(clock), actors.length];
    for (var i = 0; i < actors.length; i++) {
      var a = actors[i];
      s.push(q(a.x), q(a.y), q(a.vx), q(a.vy), q(a.hp), q(a.shield), a.maxHp);
    }
    s.push(q(roundTime));
    return { k: 'a', s: s };
  }

  /* 客机端：解出 N 实体快照。参数可传数组 s 或完整快照 {k:'a', s} */
  function decodeActors(s) {
    var arr = Array.isArray(s) ? s : (s && s.s);
    var n = arr[2];
    var actors = [];
    var o = 3;
    for (var i = 0; i < n; i++) {
      actors.push({
        x: arr[o], y: arr[o + 1], vx: arr[o + 2], vy: arr[o + 3],
        hp: arr[o + 4], shield: arr[o + 5], maxHp: arr[o + 6]
      });
      o += 7;
    }
    return { round: arr[0], clock: arr[1], actors: actors, roundTime: arr[o] };
  }

  /* sample().actors 取值：k==='a' 用 decodeActors 解出 N 个实体；
     k==='s'（旧 17 槽双实体）用插值/外推得到的 [p,e] 作为两个实体。 */
  function actorsOf(snapObj, p, e) {
    if (snapObj && snapObj.k === 'a') return decodeActors(snapObj.s).actors;
    return [p, e];
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
    this.frozen = false;    // 房主命中停顿标志：客机渲染时钟同步停住，不再外推乱飞
    this._frozenAt = 0;
  }

  SnapBuf.prototype.push = function (snap) {
    var s = snap && snap.s;
    if (!s || s.length < 17) return;
    var now = Date.now() / 1000;
    /* 房主命中停顿帧：clock 与上一帧完全相同（物理没推进），数据也相同，
       入队毫无意义且会被「重复 clock」检查丢掉。这里只刷新冻结标志与时间戳，
       让客机渲染时钟同步停住；下一帧正常快照自动解冻。 */
    if (snap.f) {
      this.frozen = true;
      this._frozenAt = now;
      this._lastArrival = now;
      return;
    }
    this.frozen = false;
    /* 乱序处理（旧版直接和「队尾 clock」比较后丢弃）：
       无序不可靠通道下，42ms 抖动 > 33ms 帧间隔时，晚发先到是常态，
       旧写法会把随后到达但仍有效的帧误丢约 15%。改为：
       - 已经早于渲染时刻的帧才丢（对回放没价值）；
       - 其余按 clock 有序插入，重复 clock 只留一份。 */
    if (this.renderT != null && s[1] <= this.renderT - 0.05) return;
    if (this.snaps.some(function (x) { return x.s[1] === s[1]; })) return;
    // 抖动观测：到达间隔与房主时钟增量的偏差（EWMA，用于放宽外推窗口）
    if (this._lastArrival != null && this.snaps.length) {
      var aGap = now - this._lastArrival;
      var cGap = s[1] - this.snaps[this.snaps.length - 1].s[1];
      if (aGap > 0 && aGap < 1 && cGap > 0) {
        this.jitter = this.jitter * 0.85 + Math.abs(aGap - cGap) * 0.15;
      }
    }
    this._lastArrival = now;
    var i = this.snaps.length;
    while (i > 0 && this.snaps[i - 1].s[1] > s[1]) i--;
    this.snaps.splice(i, 0, snap);
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
    /* 房主命中停顿（hitStop）时物理与 clock 都冻结，但仍按节拍发带 f:1 的快照。
       客机若继续推进 renderT 就会走外推、让弹珠「继续飞」，下一帧再被硬纠正回来，
       正是命中瞬间那一下窜动。这里把渲染时钟一起停住，两端保持同一画面。 */
    // 冻结标志最多信任 250ms：若后续正常帧全丢（或房主掉线），不能把画面永久钉住
    if (this.frozen && Date.now() / 1000 - this._frozenAt > 0.25) this.frozen = false;
    if (this.frozen) { this.rate = 0; return; }
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
     回调里写入的是模拟侧语义：out.p = 房主弹珠，out.e = 客机弹珠。
     返回值额外带 actors 字段（N 实体快照用），原有 p/e/rt/snap 不变。 */
  /* roundTime 永远是数组最后一个槽：k:'s' 是 index 16，
     k:'a'（N 实体）是 3+7n，写死 s[16] 会把 4 实体的 maxHp 当倒计时。 */
  function rtOf(s) { return s[s.length - 1]; }
  function sideOf(actors, i) {
    return actors[i] || { x: 0, y: 0, vx: 0, vy: 0, hp: 0, shield: 0, maxHp: 1 };
  }
  /* N 实体快照按 alpha 插值（旧版直接取较新帧整帧原值 → 2V2 客机 30Hz 逐帧跳变）。
     连续量插值，血量/护盾/maxHp 取较新帧，与 1V1 口径一致。 */
  function lerpActors(a, b, alpha) {
    var A = decodeActors(a).actors, B = decodeActors(b).actors;
    var n = Math.min(A.length, B.length), out = [];
    for (var i = 0; i < n; i++) {
      var x = A[i], y = B[i];
      out.push({
        x: x.x + (y.x - x.x) * alpha, y: x.y + (y.y - x.y) * alpha,
        vx: x.vx + (y.vx - x.vx) * alpha, vy: x.vy + (y.vy - x.vy) * alpha,
        hp: y.hp, shield: y.shield, maxHp: y.maxHp
      });
    }
    return out;
  }
  function extrapActors(s, dt) {
    return decodeActors(s).actors.map(function (a) {
      return {
        x: a.x + clamp(a.vx * dt, -90, 90), y: a.y + clamp(a.vy * dt, -90, 90),
        vx: a.vx, vy: a.vy, hp: a.hp, shield: a.shield, maxHp: a.maxHp
      };
    });
  }

  function sampleOut(p, e, rt, snapObj, actorsOverride) {
    var actors = actorsOverride || [p, e];
    return { p: p, e: e, rt: rt, snap: snapObj, actors: actors };
  }
  function sampleFrame(snapObj, over) {
    var s = snapObj.s;
    if (snapObj.k === 'a') {
      var ac = over > 0 ? extrapActors(s, over) : decodeActors(s).actors;
      return { p: sideOf(ac, 0), e: sideOf(ac, 1), rt: Math.max(0, rtOf(s) - (over || 0)), actors: ac };
    }
    return {
      p: over > 0 ? extrapSide(s, 2, over) : unpackSide(s, 2),
      e: over > 0 ? extrapSide(s, 9, over) : unpackSide(s, 9),
      rt: Math.max(0, rtOf(s) - (over || 0)), actors: null
    };
  }

  SnapBuf.prototype.sample = function () {
    var t = this.renderT;
    if (t == null || !this.snaps.length) return null;
    var snaps = this.snaps;
    var first = snaps[0].s, last = snaps[snaps.length - 1].s;
    if (t <= first[1]) {
      var f0 = sampleFrame(snaps[0], 0);
      return sampleOut(f0.p, f0.e, f0.rt, snaps[0], f0.actors);
    }
    if (t >= last[1]) {
      var over = t - last[1];
      var lim = Math.min(0.14, this.maxExtrap + Math.min(this.jitter, 0.06));
      var snapLast = snaps[snaps.length - 1];
      var fL = sampleFrame(snapLast, (over > 0 && over <= lim) ? over : 0);
      return sampleOut(fL.p, fL.e, fL.rt, snapLast, fL.actors);
    }
    for (var i = 0; i < snaps.length - 1; i++) {
      var a = snaps[i].s, b = snaps[i + 1].s;
      if (t >= a[1] && t <= b[1]) {
        var alpha = (b[1] - a[1]) > 0 ? (t - a[1]) / (b[1] - a[1]) : 0;
        var snapB = snaps[i + 1];
        // 位置/速度插值；离散量取较新帧，血条与倒计时不慢半拍
        if (snaps[i].k === 'a' && snapB.k === 'a') {
          var ac = lerpActors(a, b, alpha);
          return sampleOut(sideOf(ac, 0), sideOf(ac, 1), rtOf(b), snapB, ac);
        }
        var fB = snapB.k === 'a' ? frameOf(snapB, 0) : null;
        if (fB) return sampleOut(fB.p, fB.e, rtOf(b), snapB, fB.actors);
        return sampleOut(lerpSide(a, b, alpha, 2), lerpSide(a, b, alpha, 9), rtOf(b), snapB);
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
    encodeActors: encodeActors,
    decodeActors: decodeActors,
    SnapBuf: SnapBuf
  };
})();
