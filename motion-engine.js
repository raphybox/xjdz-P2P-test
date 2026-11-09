/* -------------------------------------------------------------
   运动器引擎（对局 / 后台实时试放 / 单测共用）
   -------------------------------------------------------------
   位移不是「某一个冲刺技能」，而是一层底层能力：
   任何模块、任何触发事件都可以往任意弹珠身上「挂一个运动器」。
   运动器在持续时间内接管该弹珠的速度，按配置的
     作用目标 / 轨迹 / 方向来源 / 速度曲线 / 位移距离 / 结束行为
   逐帧推进，到期后把控制权交还给正常物理。

   两种宿主：
   - 对局 game.js 自带物理积分与边界反弹：只取引擎算出的速度，传 integrate=false
   - 后台试放沙盘没有物理：传 integrate=true，由引擎顺带推进坐标与夹边界
   ------------------------------------------------------------- */
(function (root) {
  'use strict';
  var PI = Math.PI;
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var num = function (v, d) { v = Number(v); return isFinite(v) ? v : (d || 0); };
  var hypot = function (x, y) { return Math.sqrt(x * x + y * y); };

  var TRACKS = [
    ['line', '直线'], ['arc', '弧线'], ['orbit', '环绕对手'], ['orbitSelf', '环绕自身'],
    ['homing', '追踪对手'], ['instant', '瞬移（瞬时生效）']
  ];
  var DIRS = [
    ['toTarget', '朝向对手'], ['awayTarget', '背向对手'], ['velocity', '沿当前速度'],
    ['fixed', '固定角度'], ['perp', '对手连线垂直'], ['wallNormal', '墙面法线']
  ];
  var EASES = [
    ['linear', '匀速'], ['easeIn', '加速（越冲越快）'],
    ['easeOut', '减速（起步最快）'], ['easeInOut', '先加速后减速']
  ];
  var SCOPES = [['self', '自身弹珠'], ['opponent', '对手弹珠'], ['both', '双方弹珠']];

  /* 旧配置兼容：以前只有一个 mode（dash/retreat/blink/orbit），
     现在拆成 轨迹 + 方向 + 速度曲线 三个正交维度。 */
  var LEGACY_MODE = {
    dash: { track: 'line', dirFrom: 'toTarget', ease: 'easeIn' },
    retreat: { track: 'line', dirFrom: 'awayTarget', ease: 'easeIn' },
    blink: { track: 'instant', dirFrom: 'toTarget', ease: 'linear' },
    orbit: { track: 'orbit', dirFrom: 'perp', ease: 'linear' }
  };

  /** 把可能是旧格式的 params 归一化；不修改传入对象 */
  function normalize(p, defaults) {
    var out = Object.assign({}, defaults || {}, p || {});
    var legacy = p && p.mode && p.track == null ? LEGACY_MODE[p.mode] : null;
    if (legacy) {
      out.track = legacy.track;
      // 旧 mode 只补「完全缺失」的方向 / 曲线；用户后来显式设置的新字段优先，
      // 否则面板里明明选了「固定角度 / 匀速」，实际却仍按「朝向对手 / 加速」跑。
      if (p.dirFrom == null) out.dirFrom = legacy.dirFrom;
      if (p.ease == null) out.ease = legacy.ease;
    }
    if (out.track == null) out.track = 'line';
    if (out.dirFrom == null) out.dirFrom = 'toTarget';
    if (out.ease == null) out.ease = 'easeIn';
    if (out.scope == null) out.scope = 'self';
    if (out.endSpeed == null) out.endSpeed = 'keep';
    if (out.stackMode == null) out.stackMode = 'replace';
    if (out.duration == null) out.duration = 0.35;
    if (out.distance == null) out.distance = 120;
    if (out.orbitTime == null) out.orbitTime = 0;
    if (out.impulse == null) out.impulse = 0;
    if (out.angle == null) out.angle = 0;
    if (out.arcDeg == null) out.arcDeg = 60;
    /* 碰撞处理：只对「投射物绑定」有意义。
       缺省碰撞对象=单位+障碍物（与改造前口径一致），撞墙行为=触墙反弹 + 撞墙即消失。 */
    if (out.dieOnWall == null) out.dieOnWall = true;
    if (out.wallBounce == null) out.wallBounce = 0;
    if (out.collideTarget == null) out.collideTarget = 'all';
    // 弹幕互撞：默认不参与（旧技能行为完全不变）
    if (out.hitProjectile == null) out.hitProjectile = 'none';
    if (out.wallAction !== 'continue') out.wallAction = 'bounce';
    return out;
  }

  /* 速度曲线：u(s) 是归一化进度，du 是 u 对 s=t/duration 的导数。
     ∫₀¹ du·ds = 1，所以 ∫v·dt 恒等于 displacement，位移量不随曲线变化。 */
  function curve(ease, s) {
    s = clamp(s, 0, 1);
    if (ease === 'easeIn') return { u: s * s, du: 2 * s };
    if (ease === 'easeOut') { var k = 1 - s; return { u: 1 - k * k, du: 2 * k }; }
    if (ease === 'easeInOut') return { u: 3 * s * s - 2 * s * s * s, du: 6 * s * (1 - s) };
    return { u: s, du: 1 };
  }

  function normalizeCtx(ctx) {
    ctx = ctx || {};
    if (!ctx.targetOf) {
      ctx.targetOf = function (ent) {
        var pair = ctx.pair || [ctx.self, ctx.opponent];
        for (var i = 0; i < pair.length; i++) if (pair[i] && pair[i] !== ent) return pair[i];
        return null;
      };
    }
    if (ctx.w == null) ctx.w = 1e6;
    if (ctx.h == null) ctx.h = 1e6;
    if (ctx.now == null) ctx.now = 0;
    // 「环绕自身」的圆心：宿主传入的施法者；缺省退回被挂载弹珠本身（此时退化为绕挂载点）
    if (!ctx.origin) ctx.origin = ctx.self;
    return ctx;
  }

  function targetOf(ctx, ent) { return ctx.targetOf ? ctx.targetOf(ent) : null; }

  function angleTo(ent, tgt, fallback) {
    if (!tgt) return fallback || 0;
    return Math.atan2(num(tgt.y) - num(ent.y), num(tgt.x) - num(ent.x));
  }

  /* 两角之间的最短转角，用于「从面向平滑过渡到轨迹需要的方向」 */
  function shortestDelta(from, to) {
    var d = (to - from) % (PI * 2);
    if (d > PI) d -= PI * 2;
    if (d < -PI) d += PI * 2;
    return d;
  }

  function clampPos(ent, ctx) {
    var r = num(ent.r);
    ent.x = clamp(num(ent.x), r, Math.max(r, ctx.w - r));
    ent.y = clamp(num(ent.y), r, Math.max(r, ctx.h - r));
  }

  /** 「朝向对手」是一条面向指令：不仅决定起步方向，收尾后也不该被施放前的速度方向拐回去 */
  function keepsFacing(m) { return m.faceTarget && m.dirFrom === 'toTarget'; }

  /** 起始方向：由「方向来源」决定，只在挂载这一刻求值一次，整段运动沿用该快照 */
  function baseAngle(m, ent, ctx) {
    // 对手缺席时 m.toAng 已回退为弹珠当前速度方向，避免原地朝 0° 乱冲
    var to = m.toAng;
    switch (m.dirFrom) {
      case 'awayTarget': return to + PI;
      case 'velocity': return Math.atan2(num(ent.vy), num(ent.vx));
      case 'fixed': return num(m.angle) * PI / 180;
      case 'perp': return to + PI / 2;
      case 'wallNormal': return m.contact ? Math.atan2(num(m.contact.ny), num(m.contact.nx)) : to;
      default: return to;
    }
  }

  /** 每帧方向：方向来源 = 一次性采样的「面向」，轨迹只是在这条面向上展开。
      - 直线 / 瞬移：严格沿面向
      - 弧线：从面向开始逐渐偏转（不再是绕面向左右对称摆动的 S 形）
      - 追踪 / 环绕对手 / 环绕自身：轨迹定义本身要参照某颗弹珠，但起步仍从面向出发再平滑过渡，
        这样「技能先面向对手，再按轨迹移动」对所有轨迹都成立。
      直线/弧线/瞬移不会在运动途中被敌方弹珠带走（方向来源 ≠ 每帧重新瞄准）。 */
  function frameAngle(m, ent, ctx, u) {
    var a = m.baseAng, blend = clamp(u * 3, 0, 1);
    if (m.track === 'homing') {
      var ht = targetOf(ctx, ent);
      return ht ? a + shortestDelta(a, angleTo(ent, ht, a)) * blend : a;
    }
    if (m.track === 'arc') return a + num(m.arcDeg) * PI / 180 * u;
    if (m.track === 'orbit') {
      var ot = targetOf(ctx, ent);
      if (ot) {
        var rad = Math.atan2(num(ent.y) - num(ot.y), num(ent.x) - num(ot.x));
        var tangent = rad + (num(m.arcDeg) < 0 ? -1 : 1) * PI / 2;
        // 起步沿面向，随后过渡到以对手为圆心的切向；半径由轨迹几何自然收敛
        return a + shortestDelta(a, tangent) * blend;
      }
    }
    if (m.track === 'orbitSelf') {
      /* 以「自身弹珠（施法者）」为圆心环绕：圆心在挂载时记录（m.originEnt），
         逐帧读它的实时坐标，所以施法者移动时环绕圈会跟着走。
         若运动器就挂在圆心那颗弹珠上（作用目标=自身弹珠），环绕自己等于原地打转，
         退化为绕「挂载瞬间的自身位置」画小圈，避免半径 0 抖动。 */
      var oc = (m.originEnt && m.originEnt.dead !== true) ? m.originEnt : null;
      var cx, cy;
      if (oc && oc !== ent) { cx = num(oc.x); cy = num(oc.y); }
      else if (m.snapSelf) { cx = m.snapSelf.x; cy = m.snapSelf.y; }
      else { cx = num(ent.x); cy = num(ent.y); }
      var dx = num(ent.x) - cx, dy = num(ent.y) - cy;
      // 正好落在圆心上：把当前面向当作半径方向直接给切向，起步不会出现折角
      var srad = (dx === 0 && dy === 0) ? a : Math.atan2(dy, dx);
      var stan = srad + (num(m.arcDeg) < 0 ? -1 : 1) * PI / 2;
      return a + shortestDelta(a, stan) * blend;
    }
    return a;
  }

  function makeMover(ent, cfg, ctx) {
    var m = {
      ent: ent, cfg: cfg,
      track: cfg.track || 'line', dirFrom: cfg.dirFrom || 'toTarget', ease: cfg.ease || 'easeIn',
      scope: cfg.scope || 'self', endSpeed: cfg.endSpeed || 'keep', stackMode: cfg.stackMode || 'replace',
      duration: Math.max(0.02, num(cfg.duration, 0.35)),
      distance: Math.max(0, num(cfg.distance, 0)),
      // 环绕时间：仅环绕类轨迹生效，0 = 无限（一直绕到投射物消失 / 撞墙 / 命中）
      orbitTime: Math.max(0, num(cfg.orbitTime, 0)),
      impulse: Math.max(0, num(cfg.impulse, 0)),
      angle: num(cfg.angle, 0), arcDeg: num(cfg.arcDeg, 60),
      faceTarget: cfg.faceTarget !== false, stopOnWall: cfg.stopOnWall !== false,
      // 碰撞处理（仅投射物绑定）：撞什么 / 撞墙后继续走还是反弹 / 消失与反弹次数，随运动器一起落到弹体上
      collideTarget: cfg.collideTarget || 'all',
      hitProjectile: cfg.hitProjectile || 'none',
      wallAction: cfg.wallAction === 'continue' ? 'continue' : 'bounce',
      dieOnWall: cfg.dieOnWall !== false,
      wallBounce: Math.max(0, Math.round(num(cfg.wallBounce, 0))),
      contact: cfg.contact || ctx.contact || null,
      // 绑定投射物：由引擎自行积分坐标（_integrate），结束时回调交还自身飞行（_onEnd）
      _integrate: cfg._integrate === true, _onEnd: ctx.onEnd || null,
      // 「环绕自身」的圆心实体：挂载时记下施法者，逐帧读它的实时坐标（跟随移动）
      originEnt: ctx.origin || ctx.self || null,
      t: 0, done: false, needSpeed: 0, lastAng: 0, baseAng: 0, toAng: 0,
      v0x: num(ent.vx), v0y: num(ent.vy), ox: num(ent.x), oy: num(ent.y)
    };
    // 方向来源 = 一次性快照：把挂载瞬间的自身 / 对手坐标与「自身→对手」角度冻结下来。
    // 之后方向、轨迹、收尾冲量都只认这份快照，不再读对手此刻在哪。
    var tgt = targetOf(ctx, ent);
    // 宿主给了自定义 targetOf 却解析不到对手时，退回 ctx.opponent / pair，
    // 避免「朝向对手」悄悄退化成沿当前速度方向
    if (!tgt && ctx.opponent && ctx.opponent !== ent) tgt = ctx.opponent;
    if (!tgt && ctx.pair) {
      for (var pi = 0; pi < ctx.pair.length; pi++) {
        if (ctx.pair[pi] && ctx.pair[pi] !== ent) { tgt = ctx.pair[pi]; break; }
      }
    }
    m.snapSelf = { x: num(ent.x), y: num(ent.y) };
    m.snapTgt = tgt ? { x: num(tgt.x), y: num(tgt.y) } : null;
    m.toAng = m.snapTgt
      ? Math.atan2(m.snapTgt.y - m.snapSelf.y, m.snapTgt.x - m.snapSelf.x)
      : Math.atan2(num(ent.vy), num(ent.vx));
    m.baseAng = baseAngle(m, ent, ctx);
    m.faceAng = m.baseAng;      // 「面向」：方向来源采样结果，收尾时仍要认它
    m.lastAng = m.baseAng;
    return m;
  }

  function removeEnt(list, ent, finishThem, ctx) {
    for (var i = list.length - 1; i >= 0; i--) {
      if (list[i].ent !== ent) continue;
      if (finishThem) finish(list, list[i], ctx || {}, 'replace', true);
      else list.splice(i, 1);
    }
  }

  /** 交还控制权：按结束行为处理速度，并施加附加冲量；
      收尾后的速度在短时间内豁免物理速度上限，避免冲量当帧被 cap 吃掉。 */
  function finish(list, m, ctx, reason, preserve) {
    if (m.done) return;
    m.done = true;
    var ent = m.ent, idx = list ? list.indexOf(m) : -1;
    if (idx >= 0) list.splice(idx, 1);
    if (!ent) { var oe = m._onEnd || ctx.onEnd; if (oe) oe(m, ent, reason); return; }
    /* 绑定投射物的运动器收尾：清掉上一帧交出去的方向与加速度累计，
       下一帧起投射物按自己的速度（或这里设置好的结束速度）飞。 */
    if (m._integrate) {
      ent._motionDir = null; ent._motionSpd = 0; ent._motionOrbit = false; ent._spdBoost = 0;
    }
    // distance=0 的运动器只当计时器，从未接管过速度，收尾时也不该改结束速度
    if (!preserve && m.distance > 0) {
      if (m.endSpeed === 'zero') { ent.vx = 0; ent.vy = 0; }
      else if (m.endSpeed === 'restore') {
        if (keepsFacing(m)) {
          // 「朝向对手」是面向指令：只恢复施放前的速率大小，方向继续沿用面向。
          // 否则冲刺一结束就把速度矢量整个还原，弹珠立刻拐回发射方向，
          // 观感上等于「完全没有朝对手移动过」。
          var sp0 = hypot(num(m.v0x), num(m.v0y));
          ent.vx = Math.cos(m.toAng) * sp0;
          ent.vy = Math.sin(m.toAng) * sp0;
        } else { ent.vx = m.v0x; ent.vy = m.v0y; }
      }
      // keep：保留最后一帧的冲刺速度
    }
    if (m.impulse > 0) {
      // 冲量方向同样取自挂载时的快照：faceTarget 用「采样瞬间自身→对手」，
      // 否则沿用运动器最后的方向；收尾时不再按对手实时位置重新瞄准。
      var a = m.faceTarget ? m.toAng : m.lastAng;
      ent.vx = num(ent.vx) + Math.cos(a) * m.impulse;
      ent.vy = num(ent.vy) + Math.sin(a) * m.impulse;
    }
    ent._motionCap = Math.max(num(ent._motionCap), hypot(num(ent.vx), num(ent.vy)));
    ent._motionCapUntil = num(ctx.now) + 0.3;
    var oe2 = m._onEnd || ctx.onEnd; if (oe2) oe2(m, ent, reason);
  }

  /** 瞬时轨迹：一次性改坐标，落点与方向同样取自挂载瞬间的快照 */
  function instantMove(m, ent, ctx) {
    var tgt = m.snapTgt;
    if (tgt) {
      var back = Math.max(m.distance * 0.5, num(ent.r, 10) + 10);
      ent.x = num(tgt.x) - Math.cos(m.baseAng) * back;
      ent.y = num(tgt.y) - Math.sin(m.baseAng) * back;
    } else {
      ent.x += Math.cos(m.baseAng) * m.distance;
      ent.y += Math.sin(m.baseAng) * m.distance;
    }
    clampPos(ent, ctx);
  }

  /**
   * 挂运动器。
   * ctx: { self, opponent, pair?, targetOf?, w, h, now, contact?, onEnd? }
   * 返回同一个 list（原地修改），方便宿主持有。
   */
  function spawn(list, rawCfg, ctx) {
    list = list || [];
    ctx = normalizeCtx(ctx);
    var cfg = normalize(rawCfg);
    var self = ctx.self || (ctx.pair && ctx.pair[0]);
    var opp = ctx.opponent || (ctx.pair && ctx.pair[1]);
    var ents = cfg.scope === 'opponent' ? [opp]
      : cfg.scope === 'both' ? [self, opp] : [self];
    ents.forEach(function (ent) {
      if (!ent) return;
      var exists = list.some(function (m) { return m.ent === ent && !m.done; });
      if (exists && cfg.stackMode === 'ignore') return;
      if (cfg.stackMode !== 'add') removeEnt(list, ent, false, ctx);
      var m = makeMover(ent, cfg, ctx);
      /* 「投射物绑定」：碰撞策略随运动器一起落到弹体上。
         这样运动器到期 / 撞墙交还控制权之后，弹体仍按这套规则走，
         不会因为运动器离场就退回「撞墙即消失」。 */
      if (cfg._integrate) {
        ent._wallDie = m.dieOnWall;
        ent._wallBounce = m.wallBounce;
        ent._wallAction = m.wallAction;
        // 碰撞对象拆成两个开关，投射物引擎只认这两个标记（缺省 true = 照常碰撞）
        ent._hitUnit = (m.collideTarget === 'all' || m.collideTarget === 'unit');
        ent._hitWall = (m.collideTarget === 'all' || m.collideTarget === 'wall');
        // 弹幕互撞：none / enemy / ally / both，由投射物引擎按阵营比对
        ent._hitProj = m.hitProjectile || 'none';
      }
      if (m.track === 'instant') { instantMove(m, ent, ctx); finish(list, m, ctx, 'instant', false); return; }
      list.push(m);
    });
    return list;
  }

  /**
   * 逐帧推进。只负责「算速度」，位置积分可由宿主或引擎完成。
   * ctx.integrate = true 时引擎自己推进坐标并夹在场地内。
   */
  function step(list, dt, ctx) {
    if (!list || !list.length) return list;
    ctx = normalizeCtx(ctx);
    dt = clamp(num(dt), 0, 0.1);
    var acc = [], i, m, ent, b;
    function bucket(e) {
      for (var k = 0; k < acc.length; k++) if (acc[k].ent === e) return acc[k];
      var o = { ent: e, vx: 0, vy: 0, active: false, integrate: false, orbit: false, dir: 0 };
      acc.push(o); return o;
    }
    for (i = list.length - 1; i >= 0; i--) {
      m = list[i];
      if (m.done) { list.splice(i, 1); continue; }
      ent = m.ent;
      // 投射物被标记 dead 后，挂在它身上的运动器一并回收（投射物没有 hp 字段，不能只靠 hp 判断）
      if (!ent || ent.dead === true || (ent.hp != null && ent.hp <= 0)) { list.splice(i, 1); continue; }
      m.t += dt;
      /* 环绕类轨迹与冲刺 / 弧线是两种节奏：
         - 环绕：全程匀速（线速度 = 位移距离 ÷ 持续），起步 0.5 秒内由「面向」平滑过渡到切向；
           何时收尾只由「环绕时间」决定，0 = 无限——不能再用「走完位移距离」当结束条件，
           否则绕两圈就交还控制权，做不出长期卫星弹。
         - 其它轨迹：仍按速度曲线在 duration 内走完 distance。 */
      var isOrbit = (m.track === 'orbit' || m.track === 'orbitSelf');
      var u, v, full;
      if (isOrbit) {
        u = clamp(m.t / 0.5, 0, 1);
        v = m.duration > 0 ? m.distance / m.duration : 0;
        full = m.orbitTime > 0 && m.t >= m.orbitTime;
        m.prevU = null;
      } else {
        var s = clamp(m.t / m.duration, 0, 1);
        var c = curve(m.ease, s);
        // 用「本帧进度差」而非曲线导数算速度：离散积分后累计位移仍精确等于 distance
        var du = c.u - (m.prevU == null ? 0 : m.prevU);
        m.prevU = c.u;
        u = c.u;
        v = m.distance > 0 && dt > 0 ? m.distance * du / dt : 0;
        full = s >= 1;
      }
      var a = frameAngle(m, ent, ctx, u);
      m.lastAng = a;
      m.needSpeed = v;
      /* distance=0 的运动器通常只承载碰撞规则、不接管位移；
         但环绕类（环绕对手 / 环绕自身）的「位移」是绕圈而不是走一段直线，
         半径由出生点与圆心的距离决定、线速度优先取投射物的飞行速度，
         distance 只在投射物速度为 0 时用于折算角速度。
         所以环绕类即使 distance=0 也必须接管方向，否则「环绕自身」会退化成直线飞行。 */
      if (m.distance > 0 || isOrbit) {
        b = bucket(ent); b.active = true; b.orbit = isOrbit; b.dir = a;
        /* 绑定投射物的运动器标记 _integrate：引擎只交「方向」，坐标由投射物引擎自己积分。
           原因：投射物的 飞行速度 / 加速度 / 最大飞行距离 / 撞墙反弹次数 全在它自己的
           advance 里结算，若这里直接积分坐标，那一整块会被跳过，表现为「配了没反应」。
           圆心会跑的问题由投射物模块的「跟随施法者移动」负责，这里不再叠加速度（否则双重位移）。 */
        if (m._integrate) b.integrate = true;
        b.vx += Math.cos(a) * v; b.vy += Math.sin(a) * v;
      }
      m._pending = full;
    }
    for (i = 0; i < acc.length; i++) {
      b = acc[i];
      if (!b.active) continue;
      /* 绑定投射物：只把「方向 + 建议速度」交接给投射物引擎，由它决定实际速度并积分位移。
         这样投射物的 飞行速度 / 加速度 / 最大飞行距离 / 撞墙反弹次数 / 追踪强度 在绑定后依然生效。 */
      if (b.integrate) {
        var bspd = Math.hypot(b.vx, b.vy);
        /* 环绕 + 位移距离=0 时合成速度为 0，atan2(0,0) 会得到 0（正右方）而丢掉切向，
           表现为「环绕弹直线飞出去」。速度为 0 时直接沿用轨迹方向 a。 */
        b.ent._motionDir = bspd > 1e-6 ? Math.atan2(b.vy, b.vx) : b.dir;
        b.ent._motionSpd = bspd;
        b.ent._motionOrbit = b.orbit === true;
        continue;
      }
      b.ent.vx = b.vx; b.ent.vy = b.vy;
      if (ctx.integrate) {
        var r = num(b.ent.r);
        b.ent.x = clamp(num(b.ent.x) + b.vx * dt, r, Math.max(r, ctx.w - r));
        b.ent.y = clamp(num(b.ent.y) + b.vy * dt, r, Math.max(r, ctx.h - r));
        var hit = b.ent.x <= r + 0.01 || b.ent.x >= ctx.w - r - 0.01 ||
                  b.ent.y <= r + 0.01 || b.ent.y >= ctx.h - r - 0.01;
        if (hit) noticeWall(list, b.ent, ctx, true);
      }
    }
    for (i = list.length - 1; i >= 0; i--) {
      if (list[i]._pending) finish(list, list[i], ctx, 'done', false);
    }
    return list;
  }

  function forEnt(list, ent) {
    if (!list) return null;
    for (var i = 0; i < list.length; i++) if (!list[i].done && list[i].ent === ent) return list[i];
    return null;
  }

  /** 该实体运动器本帧需要的速度大小，供宿主放宽物理速度上限 */
  function maxNeed(list, ent) {
    var s = 0;
    (list || []).forEach(function (m) { if (!m.done && m.ent === ent) s += num(m.needSpeed); });
    return s;
  }

  /** 撞墙 / 被打断：立刻交还控制权，默认保留当前（反弹）速度 */
  function noticeWall(list, ent, ctx, preserve) {
    if (!list) return;
    ctx = normalizeCtx(ctx);
    var hit = [];
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (m.ent === ent && !m.done && (m.stopOnWall !== false || preserve === true)) hit.push(m);
    }
    hit.forEach(function (m) { finish(list, m, ctx, 'wall', preserve !== false); });
  }

  function cancelEntity(list, ent, ctx, reason) {
    if (!list) return;
    ctx = normalizeCtx(ctx);
    list.filter(function (m) { return m.ent === ent && !m.done; })
      .forEach(function (m) { finish(list, m, ctx, reason || 'cancel', true); });
  }

  function clear(list, ctx) {
    if (!list) return list;
    ctx = normalizeCtx(ctx);
    list.slice().forEach(function (m) { finish(list, m, ctx, 'clear', true); });
    return list;
  }

  var API = {
    TRACKS: TRACKS, DIRS: DIRS, EASES: EASES, SCOPES: SCOPES, LEGACY_MODE: LEGACY_MODE,
    normalize: normalize, curve: curve, spawn: spawn, step: step, finish: finish,
    forEnt: forEnt, maxNeed: maxNeed, noticeWall: noticeWall,
    cancelEntity: cancelEntity, clear: clear, clampPos: clampPos
  };
  root.MotionEngine = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
