/* -------------------------------------------------------------
   模块化技能的执行内核（后台实时预览与游戏端共用）
   - 投射物：数量/扇形/速度/射程/反弹/穿透/追踪/重力/拖尾
   - 粒子：形状/颜色/散射/重力/阻力/渐隐/叠加发光
   - pixelfx：按 fx 节点参数生成实时特效实例
   ------------------------------------------------------------- */
(function (root) {
  'use strict';
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var rnd = function (a, b) { return a + Math.random() * (b - a); };

  function angles(p, base) {
    var n = Math.max(1, Math.round(p.count || 1));
    var spread = (p.spread || 0) * Math.PI / 180;
    var out = [];
    for (var i = 0; i < n; i++) {
      var t = n === 1 ? 0 : (i / (n - 1) - 0.5);
      if (spread >= Math.PI * 1.999) t = i / n - 0.5;
      out.push(base + t * spread + rnd(-1, 1) * (p.jitter || 0) * Math.PI / 180);
    }
    return out;
  }

  /* 弹幕发射批次号：一次 spawnProjectiles = 一个批次，同批次的多发弹互不碰撞 */
  var shotBatchSeq = 0;
  /* 弹幕互撞的出生免疫窗口（秒）：刚出生的弹先飞出去，避免分裂弹 / 贴身弹幕一出来就自我湮灭 */
  var PROJ_CLASH_ARM = 0.12;

  /** 由编译结果生成一组投射物。caster/target 为 {x,y,r,side} */
  function spawnProjectiles(C, caster, target, baseAngle) {
    var p = C.projectile, out = [];
    /* 发射批次：同一次发射（含散弹 / 多发）共用一个批次号，互撞判定里互相跳过，
       否则一次射出的多颗散弹会当场自我抵消。分裂弹各自是新批次，靠出生免疫窗口区分。 */
    var batch = ++shotBatchSeq;
    // 「绑定施法者单位」是一批弹共同的属性：勾了才记录施法者引用，之后逐帧按它的位移差平移
    var bind = p.bindCaster === true;
    var follow = bind && p.followCaster !== false;
    angles(p, baseAngle == null ? Math.atan2(target.y - caster.y, target.x - caster.x) : baseAngle)
      .forEach(function (a, idx) {
        var off = p.spawnOffset || 0;
        var q = {
          side: caster.side, x: caster.x + Math.cos(a) * off, y: caster.y + Math.sin(a) * off,
          vx: Math.cos(a) * p.speed, vy: Math.sin(a) * p.speed,
          r: p.size, age: 0, traveled: 0, bounces: 0, pierceLeft: p.pierce || 0,
          /* 「贴图不跟随发射方向旋转」勾选时贴图角度固定为素材原始朝向（0）；
             自转 q.spin 仍然逐帧叠加，所以要完全不转就把自转速度填 0。 */
          spin: p.spin || 0, rot: p.noRotFollow ? 0 : a * 180 / Math.PI, dead: false, hitIds: {},
          trail: p.trail ? [] : null, fx: [], particles: [], params: p,
          /* 多发间隔：第 idx 发延迟 idx × gap 秒再出发（第 1 发立即射出）。
             gap > 0 时 advance 会冻住它：不移动、不结算命中、不写拖尾，
             但仍跟着施法者平移；绘制端同样跳过，所以视觉上是「逐发喷出」而不是堆在出生点。 */
          gap: Math.max(0, (Number(p.gap) || 0) * idx),
          _batch: batch
        };
        if (bind) {
          /* 绑定瞬间冻结施法者坐标：跟随用的是「位移差」而不是「相对偏移」，
             这样弹体自己的飞行 / 运动器轨迹不会被跟随覆盖掉，只是整体跟着施法者平移。 */
          q._bindCaster = true;
          q._followCaster = follow;
          q._casterRef = caster || null;
          q._casterPX = caster ? (Number(caster.x) || 0) : q.x;
          q._casterPY = caster ? (Number(caster.y) || 0) : q.y;
        }
        out.push(q);
      });
    return out;
  }

  /** 圆与矩形墙的接触面：返回 {x,y,nx,ny}，法线指向球所在的一侧（场内侧）。
   *  用于「贴合墙面」特效 / 粒子定位，后台试放拖拽与运行时碰撞共用同一份算法。 */
  function wallContactOf(b, wl) {
    var px = clamp(b.x, wl.x, wl.x + wl.w), py = clamp(b.y, wl.y, wl.y + wl.h);
    var nx = b.x - px, ny = b.y - py, d = Math.hypot(nx, ny);
    if (d > 1e-4) return { x: px, y: py, nx: nx / d, ny: ny / d };
    // 球心已落在矩形内部：按最近的面取接触点与法线
    var dl = b.x - wl.x, dr = wl.x + wl.w - b.x, dt = b.y - wl.y, db = wl.y + wl.h - b.y;
    var m = Math.min(dl, dr, dt, db);
    if (m === dl) return { x: wl.x, y: b.y, nx: -1, ny: 0 };
    if (m === dr) return { x: wl.x + wl.w, y: b.y, nx: 1, ny: 0 };
    if (m === dt) return { x: b.x, y: wl.y, nx: 0, ny: -1 };
    return { x: b.x, y: wl.y + wl.h, nx: 0, ny: 1 };
  }
  /** 墙面切向角度（度，归一化到 [-180,180)）：法线旋转 90°，让特效「躺」在墙面上而不是横穿墙体 */
  function wallFaceRotation(c) {
    if (!c) return 0;
    var a = Math.atan2(c.ny, c.nx) * 180 / Math.PI + 90;
    return ((a + 180) % 360 + 360) % 360 - 180;
  }

  /** 追踪：把速度矢量朝最近的敌方目标缓慢旋转（自身飞行与被运动器接管两条路径共用） */
  function steerHoming(q, dt, targets) {
    var p = q.params;
    if (!(p.homing > 0)) return;
    var best = null, bd = 1e9;
    targets.forEach(function (t) {
      if (t.side === q.side) return;
      var d = Math.hypot(t.x - q.x, t.y - q.y);
      if (d < bd) { bd = d; best = t; }
    });
    if (!best) return;
    var want = Math.atan2(best.y - q.y, best.x - q.x);
    var cur = Math.atan2(q.vy, q.vx);
    var diff = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
    var na = cur + diff * Math.min(1, p.homing * dt * 6);
    var sp = Math.hypot(q.vx, q.vy);
    q.vx = Math.cos(na) * sp; q.vy = Math.sin(na) * sp;
  }

  /** 位移积分 + 撞墙反弹 + 飞行距离累计。
      自身飞行与「被运动器接管」共用这一套口径，所以「最大飞行距离」在绑定运动器之后同样生效；
      碰撞对象（打不打单位 / 撞不撞墙）与撞墙后行为（继续按运动器移动 / 反弹 / 消失 / 反弹次数）
      由运动器的「碰撞处理」在绑定时写到弹体上（_hitUnit / _hitWall / _wallAction / _wallDie / _wallBounce）。
      返回 true = 本帧因撞墙销毁（调用方回收并触发 onExpire）。 */
  function integrateShot(q, dt, ctx) {
    var w = ctx.w, h = ctx.h, p = q.params;
    var dx = q.vx * dt, dy = q.vy * dt;
    q.x += dx; q.y += dy; q.traveled += Math.hypot(dx, dy);
    if (q.trail) {
      // 带时间戳：绘制端按「拖尾长度(秒)」的时间窗裁剪，速度越快尾巴自然越长
      q.trail.push({ x: q.x, y: q.y, t: q.age });
      if (q.trail.length > 64) q.trail.shift();
    }

    /* 碰撞对象过滤（运动器「碰撞对象」在绑定时下发到弹体）：
       - _hitWall === false：碰撞对象不含障碍物，无视场地边界与障碍墙，直接穿墙飞行
       - _wallAction === 'continue'：触墙后继续按运动器移动，墙体不阻挡、不反弹、不销毁
       两者都不做墙体检测，靠「最大飞行距离 / 存活时间」回收。 */
    if (q._hitWall === false || q._wallAction === 'continue') return false;

    // 墙反弹（画布边界）：同时记录接触点与法线（法线指向场内 = 球所在一侧）
    var hitWall = false, contact = null;
    if (q.x - q.r < 0) { q.x = q.r; q.vx = Math.abs(q.vx); hitWall = true; contact = { x: 0, y: q.y, nx: 1, ny: 0 }; }
    else if (q.x + q.r > w) { q.x = w - q.r; q.vx = -Math.abs(q.vx); hitWall = true; contact = { x: w, y: q.y, nx: -1, ny: 0 }; }
    if (q.y - q.r < 0) { q.y = q.r; q.vy = Math.abs(q.vy); hitWall = true; contact = { x: q.x, y: 0, nx: 0, ny: 1 }; }
    else if (q.y + q.r > h) { q.y = h - q.r; q.vy = -Math.abs(q.vy); hitWall = true; contact = { x: q.x, y: h, nx: 0, ny: -1 }; }
    // 内墙（可选障碍，如试放沙盘里的墙体）：矩形 AABB，按最小穿透轴反弹
    var walls = ctx.walls;
    if (walls && walls.length) {
      for (var wi = 0; wi < walls.length; wi++) {
        var wl = walls[wi];
        var rcx = wl.x + wl.w / 2, rcy = wl.y + wl.h / 2;
        var dxc = q.x - rcx, dyc = q.y - rcy;
        var ox = (wl.w / 2 + q.r) - Math.abs(dxc);
        var oy = (wl.h / 2 + q.r) - Math.abs(dyc);
        if (ox > 0 && oy > 0) {
          if (ox < oy) {
            var right = dxc >= 0;
            q.x += (right ? 1 : -1) * ox; q.vx = Math.abs(q.vx) * (right ? 1 : -1);
            contact = { x: right ? wl.x + wl.w : wl.x, y: clamp(q.y, wl.y, wl.y + wl.h), nx: right ? 1 : -1, ny: 0 };
          } else {
            var bottom = dyc >= 0;
            q.y += (bottom ? 1 : -1) * oy; q.vy = Math.abs(q.vy) * (bottom ? 1 : -1);
            contact = { x: clamp(q.x, wl.x, wl.x + wl.w), y: bottom ? wl.y + wl.h : wl.y, nx: 0, ny: bottom ? 1 : -1 };
          }
          hitWall = true;
        }
      }
    }
    if (hitWall) {
      q.wallContact = contact || { x: q.x, y: q.y, nx: 0, ny: -1 };
      if (ctx.onWall) ctx.onWall(q, q.wallContact);
      q.bounces += 1;
      /* 撞墙后是否消失：优先用运动器下发的策略（_wallDie / _wallBounce）。
         没有绑定运动器时回落旧投射物字段：
           - 旧数据有 dieOnWall：按它
           - 旧数据没有 dieOnWall：保持「撞墙反弹次数」的旧口径（0 次 = 撞墙即消失）
           - 新数据（字段已迁到运动器）：默认撞墙即消失 */
      var dieOnWall;
      if (q._wallDie != null) dieOnWall = q._wallDie;
      else if (p.dieOnWall != null) dieOnWall = p.dieOnWall !== false;
      else dieOnWall = !(Number(p.wallBounce) > 0);
      if (dieOnWall) { q.dead = true; return true; }
      var maxBounce = (q._wallBounce != null) ? q._wallBounce : Math.max(0, Math.round(Number(p.wallBounce) || 0));
      if (maxBounce > 0 && q.bounces > maxBounce) { q.dead = true; return true; }
    }
    return false;
  }

  /**
   * 弹幕互撞：返回与 q 相撞的那颗对方弹（没有则 null）。
   * 规则（运动器「碰撞处理 · 碰撞投射物」，缺省 none = 完全不参与）：
   *   - 只比对自己声明允许的那一侧阵营：enemy / ally / both
   *   - 同一次发射的多发弹不互撞（_batch 相同），否则散弹会当场自我抵消
   *   - 出生不足 PROJ_CLASH_ARM 秒的弹不参与，避免分裂弹与母弹重叠瞬间湮灭
   *   - 只要有一方声明可撞，接触即双方销毁：对手弹幕不需要同样配置，
   *     否则「用己方弹幕拦截敌弹」永远拦不到没配过互撞的敌方技能
   * list 是当前全部存活弹幕（对局与试放传的是同一个数组）。
   */
  function shotClash(q, list) {
    var mode = q._hitProj;
    if (!mode || mode === 'none') return null;
    if (!(q.age >= PROJ_CLASH_ARM)) return null;
    var allowAlly = (mode === 'ally' || mode === 'both');
    var allowFoe = (mode === 'enemy' || mode === 'both');
    for (var k = 0; k < list.length; k++) {
      var o = list[k];
      if (!o || o === q || o.dead) continue;
      if (o._batch === q._batch) continue;
      if (!(o.age >= PROJ_CLASH_ARM)) continue;
      if (o.side === q.side ? !allowAlly : !allowFoe) continue;
      if (Math.hypot(o.x - q.x, o.y - q.y) > q.r + o.r) continue;
      return o;
    }
    return null;
  }

  /**
   * 推进投射物；ctx = { w,h, targets:[{id,x,y,r,side}], walls:[{x,y,w,h}],
   *  onHit(proj,t), onWall(proj,contact), onExpire(proj), events:[] }
   *  contact = {x,y,nx,ny} 为球与墙的接触点与法线，供「贴合墙面」特效使用。
   * 返回仍存活的投射物（原地过滤 list）。
   */
  function advance(list, dt, ctx) {
    var w = ctx.w, h = ctx.h, targets = ctx.targets || [];
    for (var i = list.length - 1; i >= 0; i--) {
      var q = list[i]; if (q.dead) { list.splice(i, 1); continue; }
      var p = q.params;
      /* 绑定施法者单位：施法者没了弹体一并消失；开启「跟随」时按施法者本帧位移整体平移。
         放在多发间隔（gap）之前——还没轮到的弹也要跟着施法者走，否则会留在出生点。 */
      if (q._bindCaster) {
        var cr = q._casterRef;
        if (!cr || cr.dead === true || (cr.hp != null && cr.hp <= 0)) {
          q.dead = true; onEnd(q, ctx, 'expire'); list.splice(i, 1); continue;
        }
        if (q._followCaster) {
          var cdx = (Number(cr.x) || 0) - q._casterPX, cdy = (Number(cr.y) || 0) - q._casterPY;
          if (cdx !== 0 || cdy !== 0) { q.x += cdx; q.y += cdy; }
        }
        q._casterPX = Number(cr.x) || 0; q._casterPY = Number(cr.y) || 0;
      }
      if (q.gap > 0) { q.gap -= dt; continue; }
      /* 两条速度来源，位移 / 撞墙 / 飞行距离口径完全一致：
         - 自身飞行（默认）：追踪 → 加速度 → 重力 → 位移积分
         - 被运动器接管（_motionBound 且本帧已拿到方向）：运动器只给「方向」，
           速度大小仍由投射物的「飞行速度 / 加速度」决定。
           这样飞行速度、加速度、最大飞行距离、撞墙反弹次数、追踪强度在绑定后依然生效
           （此前这一整块被跳过，表现为「参数配了完全没反应」）。 */
      if (q._motionBound && q._motionDir != null) {
        var selfSpd = Math.max(0, Number(p.speed) || 0);
        var mvSpd = Math.max(0, Number(q._motionSpd) || 0);
        // 环绕类没有「走完一段位移」的概念：线速度交给「飞行速度」，为 0 时回退到运动器自身速度
        var baseSpd = (q._motionOrbit && selfSpd > 0) ? selfSpd : mvSpd;
        if (p.accel) q._spdBoost = (q._spdBoost || 0) + p.accel * dt;
        var mspd = Math.max(0, baseSpd + (q._spdBoost || 0));
        q.vx = Math.cos(q._motionDir) * mspd;
        q.vy = Math.sin(q._motionDir) * mspd;
        steerHoming(q, dt, targets);
        if (p.gravity) q.vy += p.gravity * dt;
        if (integrateShot(q, dt, ctx)) { onEnd(q, ctx, 'expire'); list.splice(i, 1); continue; }
      } else {
        // 追踪：把速度方向朝最近敌方目标缓慢旋转
        steerHoming(q, dt, targets);
        if (p.accel) {
          var s = Math.hypot(q.vx, q.vy) || 1;
          var ns = Math.max(20, s + p.accel * dt);
          q.vx = q.vx / s * ns; q.vy = q.vy / s * ns;
        }
        if (p.gravity) q.vy += p.gravity * dt;
        if (integrateShot(q, dt, ctx)) { onEnd(q, ctx, 'expire'); list.splice(i, 1); continue; }
      }
      q.age += dt; q.rot += q.spin * dt;
      // 目标命中（碰撞对象不含「单位」时整段跳过：穿人弹幕不结算命中、不消耗穿透）
      var hit = false;
      if (q._hitUnit !== false) {
        for (var j = 0; j < targets.length; j++) {
          var t = targets[j];
          if (t.side === q.side || q.hitIds[t.id]) continue;
          if (Math.hypot(t.x - q.x, t.y - q.y) > q.r + t.r) continue;
          q.hitIds[t.id] = 1;
          if (ctx.onHit) ctx.onHit(q, t);
          hit = true;
          if (q.pierceLeft > 0) q.pierceLeft -= 1; else q.dead = true;
          break;
        }
      }
      /* 弹幕互撞：与符合条件的其他弹幕接触 → 双方一并销毁，各自结算自己的「消失时」组。
         对方弹若还没轮到本帧处理（索引更小）或已经处理过（索引更大），
         这里手动触发它的消失回调；它下一帧会因 dead 被静默移除，不会重复结算。 */
      if (!q.dead) {
        var foe = shotClash(q, list);
        if (foe) {
          q.dead = true; foe.dead = true;
          if (ctx.onExpire) { ctx.onExpire(q, 'proj'); ctx.onExpire(foe, 'proj'); }
          list.splice(i, 1);
          continue;
        }
      }
      if (q.dead) { onEnd(q, ctx, hit ? 'hit' : 'expire'); list.splice(i, 1); continue; }
      if ((p.range > 0 && q.traveled > p.range) || (Number(p.lifetime) > 0 && q.age > Number(p.lifetime))) {
        q.dead = true; onEnd(q, ctx, 'expire'); list.splice(i, 1); continue;
      }
    }
    return list;
  }

  function onEnd(q, ctx, why) {
    if (ctx.onExpire) ctx.onExpire(q, why);
  }

  /* ---------------- 粒子 ---------------- */
  /* 多个敌人时的选靶规则（仅挂载位置=敌方弹珠身上 时使用）
       nearest 距离施法者最近的一个 / random 随机一个 / all 全部各挂一份
     目前对局是 1v1，敌人列表由调用方传入；后续多敌人玩法把额外敌人塞进列表即可自动生效。 */
  function pickEnemyTargets(cfg, enemies, fromEnt) {
    var list = (enemies || []).filter(function (e) {
      if (!e || e.dead || (e.hp != null && e.hp <= 0)) return false;
      // 防御性过滤：混入的友方实体不会被当成敌人（敌人列表本身通常已由调用方过滤）
      if (fromEnt && fromEnt.side && e.side && e.side === fromEnt.side) return false;
      return true;
    });
    if (!list.length) return [];
    var pick = (cfg && cfg.enemyPick) || 'nearest';
    if (pick === 'all') return list.slice();
    if (pick === 'random') return [list[Math.floor(Math.random() * list.length)]];
    var ox = (fromEnt && fromEnt.x != null) ? fromEnt.x : 0;
    var oy = (fromEnt && fromEnt.y != null) ? fromEnt.y : 0;
    var best = null, bd = Infinity;
    for (var i = 0; i < list.length; i++) {
      var dx = list[i].x - ox, dy = list[i].y - oy, d = Math.sqrt(dx * dx + dy * dy);
      if (d < bd) { bd = d; best = list[i]; }
    }
    return best ? [best] : [];
  }
  function burstParticles(cfg, x, y, angle, followEnt, contact, enemies) {
    if (!cfg || cfg.enabled === false) return [];
    var out = [];
    // 敌方弹珠身上：事件发生的那一刻按选靶规则决定挂到哪几名敌人身上
    if (cfg.attach === 'enemy') {
      var tgts = pickEnemyTargets(cfg, enemies, followEnt);
      if (!tgts.length) { emitParticles(out, cfg, x, y, angle, null, contact); return out; }
      tgts.forEach(function (en) { emitParticles(out, cfg, en.x, en.y, angle, en, null); });
      return out;
    }
    var follow = ((cfg.attach === 'marble' || cfg.attach === 'caster') && followEnt) ? followEnt : null;
    emitParticles(out, cfg, x, y, angle, follow, contact);
    return out;
  }
  function emitParticles(out, cfg, x, y, angle, follow, contact) {
    var n = Math.round(cfg.count || 0);
    // 贴合墙面：粒子从墙面接触点喷出，方向以墙面法线为中心（不往墙里喷）
    var onWall = cfg.attach === 'wallFace' && contact;
    var sx = follow ? follow.x : (onWall ? contact.x : x);
    var sy = follow ? follow.y : (onWall ? contact.y : y);
    var spread = (cfg.spread == null ? 360 : cfg.spread) * Math.PI / 180;
    if (onWall) spread = Math.min(spread, Math.PI);
    var base = onWall ? Math.atan2(contact.ny, contact.nx) : angle;
    for (var i = 0; i < n; i++) {
      var a = base + rnd(-spread / 2, spread / 2);
      var sp = Math.max(0, cfg.speed + rnd(-1, 1) * cfg.speedVar);
      var life = Math.max(0.05, cfg.life + rnd(-1, 1) * cfg.lifeVar);
      out.push({
        x: sx, y: sy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        size: Math.max(0.3, cfg.size + rnd(-1, 1) * cfg.sizeVar),
        life: life, maxLife: life, color: cfg.color, color2: cfg.color2,
        shape: cfg.shape, spin: cfg.spin || 0, rot: rnd(0, 360),
        gravity: cfg.gravity, drag: clamp(cfg.drag == null ? 0.9 : cfg.drag, 0, 1),
        fade: cfg.fade !== false, additive: cfg.additive !== false,
        follow: follow, bx: 0, by: 0
      });
    }
  }
  function updateParticles(list, dt) {
    for (var i = list.length - 1; i >= 0; i--) {
      var p = list[i];
      p.life -= dt;
      if (p.life <= 0) { list.splice(i, 1); continue; }
      p.vx *= Math.pow(p.drag, dt * 60);
      p.vy = p.vy * Math.pow(p.drag, dt * 60) + p.gravity * dt;
      if (p.follow) { p.bx += p.vx * dt; p.by += p.vy * dt; p.x = p.follow.x + p.bx; p.y = p.follow.y + p.by; }
      else { p.x += p.vx * dt; p.y += p.vy * dt; }
      p.rot += p.spin * dt;
    }
    return list;
  }
  function drawParticles(ctx, list) {
    list.forEach(function (p) {
      var a = p.fade ? clamp(p.life / p.maxLife, 0, 1) : 1;
      ctx.save();
      ctx.globalAlpha = a;
      if (p.additive) ctx.globalCompositeOperation = 'lighter';
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot * Math.PI / 180);
      ctx.fillStyle = (a > 0.55 || !p.color2) ? p.color : p.color2;
      var s = p.size;
      if (p.shape === 'circle' || p.shape === 'ring') {
        ctx.beginPath(); ctx.arc(0, 0, s, 0, Math.PI * 2);
        if (p.shape === 'ring') ctx.stroke(), ctx.lineWidth = 1; else ctx.fill();
      } else if (p.shape === 'star') {
        ctx.beginPath();
        for (var k = 0; k < 8; k++) {
          var rr = k % 2 ? s * 0.4 : s, aa = k * Math.PI / 4;
          ctx.lineTo(Math.cos(aa) * rr, Math.sin(aa) * rr);
        }
        ctx.closePath(); ctx.fill();
      } else if (p.shape === 'spark') {
        ctx.fillRect(-s * 0.35, -s * 1.4, s * 0.7, s * 2.8);
      } else ctx.fillRect(-s / 2, -s / 2, s, s);
      ctx.restore();
    });
  }

  /* ---------------- pixelfx 实例 ---------------- */
  function fxOpts(node, extra) {
    var o = Object.assign({}, node.fxOptions || {});
    /* 旧存档 / 直接导入的配置可能带 0：目录里 min=0 的尺寸、种子参数
       送进素材核心会除零或生成异常（表现为触发特效后整个渲染循环停住）。
       统一夹到 >=1，后台属性面板也用同一口径。 */
    var PF = root.PixelFX;
    var meta = PF && PF.get && PF.get(node.effect);
    if (meta && meta.fields) meta.fields.forEach(function (f) {
      if (f.type !== 'number' || Number(f.min) !== 0) return;
      var v = Number(o[f.key]);
      if (!isFinite(v) || v <= 0) o[f.key] = 1;
    });
    if (node.seed == null) o.seed = 1;
    Object.assign(o, extra || {});
    return o;
  }
  /* 实体身份：给每个被挂载的实体发一个稳定编号，用于「同一目标上的同类特效只保留一份」。
     用 WeakMap 记录，不往实体上写字段（避免污染实体、也避免浅拷贝把编号带过去造成误覆盖）。 */
  var FX_HOST_UID = 0;
  /* 挂在敌方身上、又没有印记可跟的循环特效，兜底活这么久就回收。
     没有它的话：循环特效 + 跟随实体 = 三条回收规则全不满足，会一直留着（越叠越多）。 */
  var ENEMY_FX_FALLBACK_LIFE = 4;
  var FX_HOST_IDS = (typeof WeakMap === 'function') ? new WeakMap() : null;
  function hostTag(ent) {
    if (!ent || typeof ent !== 'object') return '';
    if (FX_HOST_IDS) {
      var v = FX_HOST_IDS.get(ent);
      if (v == null) { v = ++FX_HOST_UID; FX_HOST_IDS.set(ent, v); }
      return v;
    }
    // 极老环境兜底：实体上挂不可枚举属性
    if (ent.__fxUid == null) {
      var uid = ++FX_HOST_UID;
      try { Object.defineProperty(ent, '__fxUid', { value: uid, enumerable: false, configurable: true }); }
      catch (e) { try { ent.__fxUid = uid; } catch (e2) { return ''; } }
    }
    return ent.__fxUid;
  }
  /** 按挂载点筛选并创建特效实例，返回 Promise<instance[]>
   *  followEnt: 挂载位置=跟随弹珠 时传入施法弹珠实体({x,y,vx,vy})作为跟随目标
   *  contact:   挂载位置=贴合墙面 时传入 {x,y,nx,ny}（球与墙的接触点与法线），
   *             特效生成在接触面上、沿墙面切向渲染，并标记 wallFace 供 drawFx / 生命周期使用
   *  enemies:   挂载位置=敌方弹珠身上 时用于选靶的敌人列表（按 enemyPick 取最近/随机/全部）
   *  groupMarkLife: 同事件组里「标记·印记」的持续秒数，>0 表示这次触发同时挂了印记：
   *             挂在敌方身上的循环特效据此跟随印记一起结束（到期 / 被消耗 / 被引爆都会回收） */
  function spawnFx(nodes, where, x, y, rot, extra, followEnt, contact, enemies, groupMarkLife) {
    if (!window.PixelFX || !nodes || !nodes.length) return Promise.resolve([]);
    var markLife = Math.max(0, Number(groupMarkLife) || 0);
    // 注意：fx 已在编译期按 triggerEvent 归入对应事件组（events[ev].fx），
    // 此处只负责「生成」整组特效，attach 仅决定视觉锚点，不再二次过滤，
    // 否则默认 attach='projectile' 的特效在 onCast/onHit 等事件中会被整组滤掉而不生效。
    var jobs = [];
    nodes.forEach(function (f) {
      // 敌方弹珠身上：一名敌人一个实例（enemyPick=all 时逐个生成，其余只取一个）
      if (f.attach === 'enemy') {
        var tgts = pickEnemyTargets(f, enemies, followEnt);
        if (!tgts.length) { jobs.push(makeFxJob(f, where, x, y, rot, extra, followEnt, contact, null, markLife)); return; }
        tgts.forEach(function (en) { jobs.push(makeFxJob(f, where, en.x, en.y, rot, extra, followEnt, null, en, markLife)); });
        return;
      }
      jobs.push(makeFxJob(f, where, x, y, rot, extra, followEnt, contact, null, markLife));
    });
    return Promise.all(jobs).then(function (a) { return a.filter(Boolean); });
  }
  function makeFxJob(f, where, x, y, rot, extra, followEnt, contact, enemyEnt, groupMarkLife) {
    // 跟随弹珠 / 施法者身上：特效锚定施法弹珠实体，随其移动（避免释放后特效与弹珠脱离）
    // 敌方弹珠身上：锚定被选中的那名敌人
    var centerAlign = f.attach === 'marbleCenter';
    var isFollow = enemyEnt ? true : ((f.attach === 'marble' || f.attach === 'caster' || centerAlign) && followEnt);
    var onWall = !enemyEnt && f.attach === 'wallFace' && contact ? contact : null;
    var follow = enemyEnt || (isFollow ? followEnt : (onWall ? false : (where === 'projectile')));
    var sx = isFollow ? (enemyEnt || followEnt).x : (onWall ? onWall.x : x);
    var sy = isFollow ? (enemyEnt || followEnt).y : (onWall ? onWall.y : y);
    // 贴合墙面时，「横向偏移」=沿墙面切向，「纵向偏移」=沿法线离开墙面
    var ox = f.offsetX || 0, oy = f.offsetY || 0, px = sx + ox, py = sy + oy;
    if (onWall) {
      px = onWall.x + (-onWall.ny) * ox + onWall.nx * oy;
      py = onWall.y + ( onWall.nx) * ox + onWall.ny * oy;
    }
    var wallRot = onWall ? wallFaceRotation(onWall) : null;
    return window.PixelFX.spawn(f.effect, fxOpts(f, extra)).then(function (inst) {
      /* 动画播放区间（相对素材自身时间轴，单位秒）：
         clipStart=3 / clipEnd=6 → 跳过前 3 秒、只播 3→6 秒这一段。 */
      var cFrom = Math.max(0, Number(f.clipStart) || 0);
      var cTo = Math.max(0, Number(f.clipEnd) || 0);
      if (cTo > 0 && cTo <= cFrom) cTo = cFrom + 0.05;   // 结束必须晚于起始
      if (cFrom > 0 && inst.seek) inst.seek(cFrom);
      var q = {
        inst: inst, cfg: f, x: px, y: py, centerAlign: centerAlign,
        clipStart: cFrom, clipEnd: cTo,
        tailMode: f.tailMode || 'freeze', frozen: false,
        rot: wallRot == null ? rot : wallRot, follow: follow,
        wallFace: !!onWall, wallRot: wallRot, wall: onWall, age: 0,
        /* 归属：施法者实体（有 side），持续伤害区（game.js）据此判断打谁 */
        owner: followEnt || null, side: (followEnt && followEnt.side) || ''
      };
      /* 生命周期（三条兜底，按优先级）：
         1. 显式「存在时长」> 0：按秒数强制回收；
         2. 挂在敌方身上 + 本次同组挂了印记：寿命 = 这份印记自己的持续秒数（不是「当前印记还剩多久」）。
            这样即便印记一直被刷新，也不会让最早那份特效长生不老；印记被提前消耗 / 引爆时，
            markFx 还会让它当场消失。
         3. 挂在敌方身上的循环特效但没有印记：给一个兜底寿命（否则循环特效永不结束，越叠越多）。 */
      var life = Number(f.life) || 0;
      var mlife = Number(groupMarkLife) || 0;
      /* 有印记时，所有敌方挂载特效都拿到一个确定寿命（不再要求 enemyPick=nearest）。
         但「印记一失效就当场消失」仍只对最近敌人生效：印记只有一个目标，
         随机 / 全部敌人时挂载的可能不是被印记的那只，直接判宿主印记会一生成就被回收。 */
      var pickMode = f.enemyPick || 'nearest';
      var markTied = !!(enemyEnt && mlife > 0);
      q.ttl = life > 0 ? life
        : (markTied ? mlife
          : (enemyEnt && f.loop ? ENEMY_FX_FALLBACK_LIFE : 0));
      q.markFx = markTied && pickMode === 'nearest';
      q.markLife = markTied;
      /* 同一目标上的同类特效只保留一份：
         · 默认（同类特效覆盖 = 开）就覆盖；
         · 与印记绑定的特效强制覆盖——一份印记只该有一份表现，否则充能循环里每次触发都多一份；
         · 只有用户明确关掉「同类特效覆盖」且没绑印记时，才允许同目标叠多份。 */
      var hostEnt = enemyEnt || (follow && typeof follow === 'object' ? follow : null);
      if (hostEnt && (f.stackReplace !== false || markTied)) {
        q.replaceKey = String(f._nid || f.effect || 'fx') + '#' + hostTag(hostEnt);
      }
      return q;
    }).catch(function () { return null; });
  }
  /** 把新生成的特效并入列表：同键（同一节点 × 同一宿主）的旧实例先销毁，避免循环特效叠加 */
  function pushFx(list, arr) {
    if (!list || !arr) return list;
    for (var i = 0; i < arr.length; i++) {
      var q = arr[i]; if (!q) continue;
      if (q.replaceKey) {
        for (var j = list.length - 1; j >= 0; j--) {
          var o = list[j];
          if (o && o !== q && o.replaceKey === q.replaceKey) {
            if (o.inst) o.inst.kill();
            list.splice(j, 1);
          }
        }
      }
      list.push(q);
    }
    return list;
  }
  /** 宿主每帧兜底去重（最后一道防线）。
      按「特效 id × 宿主实体」分组，只保留最新一份；不依赖 _nid，也不依赖 replaceKey 是否相等，
      因此以下情况都压得住：旧存档缺 _nid、每次编译节点 id 变化、绕过 pushFx 直接 push 的调用点。
      从后往前扫，索引大的（后生成的）留下，旧的实例 kill 后移除。
      尊重「同类特效覆盖」开关：只有用户明确关掉它、且这份特效没跟印记绑定时才允许叠加。 */
  function dedupeFx(list) {
    if (!list || list.length < 2) return list;
    var seen = Object.create(null);
    for (var i = list.length - 1; i >= 0; i--) {
      var q = list[i];
      if (!q || !q.cfg || !q.follow || typeof q.follow !== 'object') continue;
      if (q.cfg.stackReplace === false && !q.markLife && !q.markFx) continue;
      var key = String(q.cfg.effect || 'fx') + '#' + hostTag(q.follow);
      if (seen[key]) {
        if (q.inst) q.inst.kill();
        list.splice(i, 1);
      } else seen[key] = 1;
    }
    return list;
  }
  /** 这份特效是否要一直留在场上（由存在时长 / 印记 / 宿主决定何时回收）。
   *  注意：这只是「不主动播完就删」的标记；填了存在时长后，动画播完一轮
   *  具体怎么撑满剩余时间由 stepFx 的 tailMode 决定，不再默认整轮重播。 */
  function isLooping(q) {
    var f = (q && q.cfg) || {};
    return !!f.loop || Number(f.life) > 0;
  }
  var TAIL_SPAN = 0.1;   // 「循环最后 0.1 秒」的片段长度（素材秒）
  /** 推进动画。填了「存在时长」时，一轮播完后按 tailMode 撑满剩余时长：
   *   freeze  定格最后一帧（不再推进 fx，只继续累加 age 供宿主按时长回收）
   *   loop    反复播放末尾 0.1 秒（重开并快进到末尾前 0.1 秒）
   *   restart 整轮从头重播（旧行为，显式选择才走）
   *  没填存在时长时沿用「循环播放」：勾了就整轮重开，没勾由 drawFx 播完回收。 */
  function stepFx(list, dt) {
    list.forEach(function (q) {
      if (!q || !q.inst) return;
      q.age = (q.age || 0) + dt;
      if (q.frozen) return;                 // 定格中：画面不变，但 age 继续走到存在时长
      var inst = q.inst;
      inst.update(dt * (q.cfg.fps || 1));
      var endT = q.clipEnd > 0 ? q.clipEnd : (inst.cycle || 0);
      if (inst.t < endT) return;

      if (Number(q.cfg.life) > 0) {
        var mode = q.tailMode || 'freeze';
        if (mode === 'freeze') {
          // fx 内部状态此刻已是末尾那一帧，停在这里即可
          inst.t = endT;
          q.frozen = true;
        } else if (mode === 'loop') {
          if (inst.restart) inst.restart(Math.max(q.clipStart || 0, endT - TAIL_SPAN));
        } else if (inst.restart) {
          inst.restart(q.clipStart || 0);
        }
        return;
      }
      // 无存在时长：循环播放由 loop 决定；nativeLoop 素材未设 clipEnd 时让它自己循环
      if (isLooping(q) && inst.restart && (!inst.nativeLoop || q.clipEnd > 0)) {
        if (inst.restart(q.clipStart || 0)) q.cycles = (q.cycles || 0) + 1;
      }
    });
  }
  /** 「持续伤害(跟随)」：推进「伤害·结算」模块触发后留下的持续掉血区。
   *  每个区按自己的「结算间隔」推进计时，到期 / 超半径由宿主（game.js 或后台沙盘）过滤，
   *  这里只负责：跟随圆心 + 到点把半径内的合法目标交给宿主结算。
   *  ctx = { targets:[实体], scale: 全局伤害倍率, onTick(target, dmg, zone) }
   *  伤害口径与「区域 · 残留」一致：单次 = 每秒伤害 × 结算间隔 × 全局倍率。
   *  返回存活（未到期）的区列表，宿主直接赋值即可。 */
  function stepDotZones(list, dt, ctx) {
    if (!list || !list.length) return list || [];
    var targets = (ctx && ctx.targets) || [];
    var scale = (ctx && ctx.scale != null) ? Number(ctx.scale) : 1;
    var out = [];
    (list || []).forEach(function (z) {
      if (!z) return;
      z.age = (z.age || 0) + dt;
      if (z.age > (z.life || 0)) { if (z.inst && z.inst.kill) z.inst.kill(); return; }
      // 跟随圆心：跟随施法者 / 命中目标时圆心跟着实体移动；固定落点不动
      if (z.followEnt && !z.followEnt.dead) { z.x = z.followEnt.x; z.y = z.followEnt.y; }
      z.tick = (z.tick || 0) - dt;
      if (z.tick > 0) { out.push(z); return; }
      var gap = Math.max(0.1, Number(z.cfg.dotInterval) || 0.5);
      z.tick = gap;
      var R = Math.max(0, Number(z.cfg.dotRadius) || 0);
      var dps = Number(z.cfg.dotDps) || 0;
      targets.forEach(function (t) {
        if (!t || t.dead || (t.hp != null && t.hp <= 0)) return;
        if (z.side && t.side === z.side) return;
        var dx = t.x - z.x, dy = t.y - z.y;
        if (Math.sqrt(dx * dx + dy * dy) > R + (t.r || 0)) return;
        var dmg = dps * gap * scale;
        if (dmg > 0 && ctx && ctx.onTick) ctx.onTick(t, dmg, z);
      });
      out.push(z);
    });
    return out;
  }
  /* ---------------- 弹幕外观（对局 / 试放共用） ----------------
     trail：轨迹点由 advance 逐帧写入（带时间戳），这里按「拖尾长度(秒)」的时间窗裁剪，
     所以飞得快的弹尾巴自然更长；宽度 / 不透明度都在投射物模块里调。
     返回 false = 没有可画的尾巴（关闭 / 完全不透明为 0 / 点数不足），调用方无需处理。 */
  function drawShotTrail(ctx, q, color) {
    var tr = q && q.trail;
    if (!tr || tr.length < 2) return false;
    var p = q.params || {};
    if (p.trail === false) return false;
    var alpha = p.trailAlpha == null ? 32 : Number(p.trailAlpha);
    if (!(alpha > 0)) return false;
    var len = p.trailLen == null ? 0.16 : Number(p.trailLen);
    if (!(len > 0)) len = 0.16;
    var wMul = p.trailWidth == null ? 1 : Number(p.trailWidth) / 100;
    if (!(wMul > 0)) wMul = 1;
    var age = Number(q.age) || 0;
    var pts = [], i;
    for (i = 0; i < tr.length; i++) {
      var pt = tr[i];
      var at = pt.t == null ? age : pt.t;   // 老轨迹点没有时间戳：当作当前帧处理
      if (age - at <= len) pts.push(pt);
    }
    if (pts.length < 2) return false;
    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha / 100);
    ctx.strokeStyle = color || '#ffb35a';
    ctx.lineWidth = Math.max(1, (q.r || 4) * wMul);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.restore();
    return true;
  }

  /* 投射物模块可上传一张 PNG 素材（params.image，dataURL）。有素材时按「最长边 = 半径×2」
     等比铺进方框内居中，并随自转（q.rot）一起旋转；没有素材、素材还在解码、或解码失败时
     返回 false，调用方继续画默认的元素颜色圆 —— 外观坏了也不影响玩法。
     图片走 WowPinballSkin.image 的全局缓存，同一张 dataURL 只解码一次。 */
  function drawShotImage(ctx, q) {
    var src = q && q.params && q.params.image;
    if (!src) return false;
    var S = root.WowPinballSkin;
    if (!S || !S.image) return false;
    var rec = S.image(src);
    if (!rec || !rec.ready || !(rec.w > 0) || !(rec.h > 0)) return false;
    var side = (q.r || 0) * 2;
    if (!(side > 0)) return false;
    var k = side / Math.max(rec.w, rec.h);
    var dw = rec.w * k, dh = rec.h * k;
    ctx.save();
    ctx.translate(q.x, q.y);
    if (q.rot) ctx.rotate(q.rot * Math.PI / 180);
    ctx.drawImage(rec.img, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
    return true;
  }

  function drawFx(ctx, list, projectiles) {
    for (var i = list.length - 1; i >= 0; i--) {
      var q = list[i], f = q.cfg;
      // follow 支持两种写法：实体对象（跟随移动：投射物 / 弹珠）或投射物下标（配合 projectiles 参数）
      var pos = null;
      if (q.follow && typeof q.follow === 'object') pos = q.follow.dead ? null : q.follow;
      else if (q.follow && projectiles) pos = projectiles[q.follow];
      if (pos) {
        q.x = pos.x; q.y = pos.y;
        // 朝向：优先用实体自带的 rot；弹珠实体通常只有 vx/vy，则由其速度方向推导。
        // 「效果不跟随挂载位置旋转」勾选时不覆盖角度 —— 位置照跟，角度冻结在释放时的朝向。
        if (!f.noRotFollow) {
          if (pos.rot != null) q.rot = pos.rot;
          else if (pos.vx != null || pos.vy != null) q.rot = Math.atan2(pos.vy, pos.vx) * 180 / Math.PI;
        }
      }
      // 贴合墙面的特效固定按「墙面切向」摆放，不受 matchRotation / 弹体速度朝向影响
      var rotation = q.wallFace ? (q.wallRot || 0) + (f.rotation || 0)
        : (f.matchRotation ? q.rot + f.rotation : f.rotation);
      /* 「弹珠圆心」：pixelfx 素材以 meta.origin 为锚点绘制，
         反向补偿 origin 与包围盒中心的差值，让特效中心真正落在弹珠圆心上。 */
      var rx = q.x, ry = q.y;
      if (q.centerAlign && q.inst.meta && q.inst.meta.size && q.inst.meta.origin) {
        var sc = Number(f.scale) || 1, mt = q.inst.meta;
        rx += sc * (mt.origin[0] - mt.size[0] / 2);
        ry += sc * (mt.origin[1] - mt.size[1] / 2);
      }
      try {
        q.inst.render(ctx, rx, ry, {
          scale: f.scale, alpha: f.alpha, light: f.light, additive: f.additive,
          flipX: f.flipX, rotation: rotation
        });
      } catch (e) {
        /* 单个素材渲染异常不能中断整条试放 / 对局的 RAF 循环，
           否则画面会直接冻结（用户感知为「卡死」）。出错的这一份直接回收。 */
        if (q.inst && q.inst.kill) q.inst.kill();
        list.splice(i, 1);
        continue;
      }
      // 墙面残留在持续时间内保持（即便特效本身不循环），到期由宿主按 wallDuration 回收。
      // 只播一次（既没勾循环、也没填存在时长）：一轮播完就回收
      var endT = q.clipEnd > 0 ? q.clipEnd : (q.inst.cycle || 0);
      if (!isLooping(q) && !q.wallFace && q.inst.t >= endT) { q.inst.kill(); list.splice(i, 1); }
    }
  }

  root.SkillEffects = {
    angles: angles, spawnProjectiles: spawnProjectiles, advance: advance,
    shotClash: shotClash, PROJ_CLASH_ARM: PROJ_CLASH_ARM,
    burstParticles: burstParticles, updateParticles: updateParticles, drawParticles: drawParticles,
    drawShotTrail: drawShotTrail,
    drawShotImage: drawShotImage,
    spawnFx: spawnFx, stepFx: stepFx, drawFx: drawFx, fxOpts: fxOpts, pushFx: pushFx, dedupeFx: dedupeFx,
    isLooping: isLooping, stepDotZones: stepDotZones,
    hostTag: hostTag,
    pickEnemyTargets: pickEnemyTargets,
    wallContactOf: wallContactOf, wallFaceRotation: wallFaceRotation
  };
})(typeof window !== 'undefined' ? window : globalThis);
