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
      /** 循环播放：从第一帧重开一轮（同一个画布 / 同一份参数，不重新加载模块）
       *  被 kill / stop 过的不复活，返回 false 让宿主照常收尾。 */
      restart: function () {
        if (dead || stopped) return false;
        fx = C.createFx(mod, o);
        inst.t = 0;
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
    function start() {
      spawn(id, opts).then(function (i) { inst = i; }).catch(function () { inst = null; });
    }
    start();
    function tick(now) {
      if (stopped) return;
      var dt = Math.min(0.05, (now - last) / 1000); last = now;
      cx.clearRect(0, 0, canvas.width, canvas.height);
      if (inst) {
        inst.update(dt);
        if (inst.done()) { inst = null; start(); }
        else inst.render(cx, canvas.width / 2, canvas.height / 2, {
          scale: Math.min(canvas.width / meta.size[0], canvas.height / meta.size[1]) * 0.9 * num(v.zoom, 1),
          alpha: num(v.alpha, 1), additive: !!v.additive, rotation: num(v.rotation, 0),
          light: num(v.light, 1)
        });
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
