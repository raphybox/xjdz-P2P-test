/* -------------------------------------------------------------
   pixelfx 运行时（浏览器）
   - 244 个特效来自 vendor/pixelfx/src/fx（MIT，github.com/patch-gg/pixelfx）
   - 不烘焙 PNG：按需动态 import 单个特效模块，实时以代码渲染像素帧
   - 因此每个特效 meta.options 里的调色板/种子/专属参数都能在后台编辑
   - 目录 data/pixelfx-catalog.js 由 tools/build-pixelfx-catalog.mjs 生成
   ------------------------------------------------------------- */
(function () {
  'use strict';
  var BASE = new URL('./', (document.currentScript && document.currentScript.src) || location.href).href;
  var VENDOR = new URL('vendor/pixelfx/src/', BASE).href;
  var catalog = window.PIXELFX_CATALOG || [];
  var byId = {};
  catalog.forEach(function (e) { byId[e.id] = e; });

  var coreP = null, modP = {};
  function core() {
    if (!coreP) coreP = import(new URL('core/index.js', VENDOR).href);
    return coreP;
  }
  function moduleOf(id) {
    if (!modP[id]) modP[id] = import(new URL('fx/' + id + '.js', VENDOR).href);
    return modP[id];
  }

  // 离屏画布按特效 id 复用，避免每次施放都新建 frame / ImageData
  var surfaces = [], SURFACE_CAP = 48;
  function surface(id, w, h) {
    for (var i = 0; i < surfaces.length; i++) if (surfaces[i].id === id) return surfaces[i];
    var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    var cx = cv.getContext('2d');
    var s = { id: id, cv: cv, cx: cx, img: cx.createImageData(w, h), frame: null, w: w, h: h };
    surfaces.push(s);
    if (surfaces.length > SURFACE_CAP) surfaces.shift();
    return s;
  }

  function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }

  /** 创建一个实时特效实例（Promise）。opts 会覆盖 meta.options 的同名项。 */
  async function spawn(id, opts) {
    var meta = byId[id];
    if (!meta) throw new Error('未知特效：' + id);
    var C = await core();
    var mod = await moduleOf(id);
    var s = surface(id, meta.size[0], meta.size[1]);
    var frame = C.createFrame(s.w, s.h);
    var o = Object.assign({}, opts || {});
    o.x = meta.origin[0]; o.y = meta.origin[1];
    if (o.seed == null) o.seed = 1;
    var fx = C.createFx(mod, o);
    var dead = false, stopped = false;
    /* 把动画快进到素材时间轴的第 t 秒。
       特效内部多用「每帧累加 dt」推进状态，一次塞 3~10 秒的大 dt 会让粒子 / 缓动
       直接跳到终态甚至溢出，所以按 1/30 秒小步推进（seek 只在生成 / 重开时执行一次）。 */
    function fastForward(t) {
      var step = 1 / 30, left = Math.max(0, num(t, 0)), guard = 0;
      while (left > 0.0001 && guard++ < 1500) {
        var d = Math.min(step, left);
        fx.update(d);
        inst.t += d;
        left -= d;
      }
    }
    var inst = {
      id: id, meta: meta, options: o,
      t: 0,
      /** 一轮播放的时长（秒）：循环播放据此判断该从第一帧重开 */
      cycle: Math.max(0.05, num(meta.duration, 1)),
      /** 特效自己就是无限循环的（meta.loop）：它每一帧已经按 t % 时长取值，不需要外层再重开 */
      nativeLoop: !!meta.loop,
      update: function (dt) { if (!dead) { fx.update(dt); inst.t += dt; } },
      /** 把当前帧画到目标 ctx：(px,py) 为特效原点在世界中的位置 */
      render: function (ctx, px, py, v) {
        if (dead) return;
        v = v || {};
        C.clearFrame(frame);
        fx.draw(frame, 'back');
        fx.draw(frame, 'front');
        C.composite(frame, s.img.data, null, num(v.light, 1));
        s.cx.putImageData(s.img, 0, 0);
        var scale = num(v.scale, 1), alpha = num(v.alpha, 1);
        if (scale <= 0 || alpha <= 0) return;
        ctx.save();
        ctx.translate(px, py);
        if (v.rotation) ctx.rotate(v.rotation * Math.PI / 180);
        var sx = scale * (v.flipX ? -1 : 1);
        ctx.scale(sx, scale);
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
        if (v.additive) ctx.globalCompositeOperation = 'lighter';
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(s.cv, -meta.origin[0], -meta.origin[1]);
        ctx.restore();
      },
      done: function () { return dead || stopped || fx.done(); },
      stop: function () { stopped = true; fx.stop(); },
      /** 循环播放：重开一轮（同一个画布 / 同一份参数，不重新加载模块）。
       *  from 为「动画起始秒」时重开后直接快进到该处，实现 3→6 秒区间循环。
       *  被 kill / stop 过的不复活，返回 false 让宿主照常收尾。 */
      restart: function (from) {
        if (dead || stopped) return false;
        fx = C.createFx(mod, o);
        inst.t = 0;
        fastForward(num(from, 0));
        return true;
      },
      /** 跳到素材时间轴的第 t 秒（用于「不从第一帧开始播放」） */
      seek: function (t) {
        if (dead || stopped) return false;
        fx = C.createFx(mod, o);
        inst.t = 0;
        fastForward(t);
        return true;
      },
      kill: function () { dead = true; },
      duration: meta.duration
    };
    return inst;
  }

  /** 后台特效浏览器：创建持续循环播放的实例（loop 特效到时长后自动重开） */
  function loopInCanvas(canvas, id, opts, view) {
    var stopped = false, inst = null, last = performance.now();
    var meta = byId[id];
    if (!meta || !canvas) return function () { };
    var cx = canvas.getContext('2d');
    var v = view || {};
    var clipFrom = Math.max(0, num(v.clipStart, 0));
    var clipTo = num(v.clipEnd, 0);
    if (clipTo > 0 && clipTo <= clipFrom) clipTo = clipFrom + 0.05;
    var hasLife = num(v.life, 0) > 0;
    var tailMode = v.tailMode || 'freeze';
    var frozen = false;
    function start() {
      spawn(id, opts).then(function (i) {
        inst = i; frozen = false;
        if (clipFrom > 0 && inst.seek) inst.seek(clipFrom);
      }).catch(function () { inst = null; });
    }
    start();
    function tick(now) {
      if (stopped) return;
      var dt = Math.min(0.05, (now - last) / 1000); last = now;
      cx.clearRect(0, 0, canvas.width, canvas.height);
      if (inst) {
        if (!frozen) inst.update(dt);
        var endT = clipTo > 0 ? clipTo : inst.cycle;
        if (!frozen && inst.t >= endT) {
          if (hasLife) {
            if (tailMode === 'freeze') { inst.t = endT; frozen = true; }
            else if (tailMode === 'loop' && inst.restart) inst.restart(Math.max(clipFrom, endT - 0.1));
            else if (inst.restart) inst.restart(clipFrom);
          } else if (inst.restart) inst.restart(clipFrom);
        }
        // 填了存在时长时由 tailMode 决定收尾，不因素材自身 done() 反复重启
        if (!hasLife && inst.done()) { inst = null; start(); }
        else {
          try {
            inst.render(cx, canvas.width / 2, canvas.height / 2, {
              scale: Math.min(canvas.width / meta.size[0], canvas.height / meta.size[1]) * 0.9 * num(v.zoom, 1),
              alpha: num(v.alpha, 1), additive: !!v.additive, rotation: num(v.rotation, 0),
              light: num(v.light, 1)
            });
          } catch (e) {
            // 单个素材画不出来时只清掉这份预览，别让 RAF 链断掉（否则预览/试放整体冻结）
            if (inst.kill) inst.kill();
            inst = null;
          }
        }
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    return function () { stopped = true; };
  }

  window.PixelFX = {
    catalog: catalog,
    get: function (id) { return byId[id] || null; },
    categories: (function () {
      var seen = {}, out = [];
      catalog.forEach(function (e) { if (!seen[e.category]) { seen[e.category] = 1; out.push({ id: e.category, name: e.categoryName }); } });
      return out;
    })(),
    spawn: spawn,
    loopInCanvas: loopInCanvas,
    preload: function (id) { return core().then(function () { return moduleOf(id); }); },
    base: VENDOR
  };
})();
