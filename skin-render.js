/* =============================================================
   弹珠外观共用渲染器
   游戏（index.html）与后台（admin.html）加载同一份，
   保证后台可视化预览与实战画面完全一致。
   skin 数据挂在职业对象上：
   { src, scale, offsetX, offsetY, rotation, opacity, gloss, label, w, h }
   ============================================================= */
(function () {
  'use strict';

  var imgCache = Object.create(null);

  function num(v, d, min, max) {
    var n = Number(v);
    if (!isFinite(n)) return d;
    return Math.max(min, Math.min(max, n));
  }
  function defaults() {
    return {
      src: '', scale: 1, offsetX: 0, offsetY: 0, rotation: 0,
      opacity: 1, gloss: true, label: true, w: 0, h: 0
    };
  }
  // 清洗外部数据（配置 / 分享导入），脏值一律回落到默认
  function normalize(s) {
    var d = defaults();
    if (!s || typeof s !== 'object') return d;
    if (typeof s.src === 'string' && s.src.indexOf('data:image/') === 0) d.src = s.src;
    d.scale = num(s.scale, 1, 0.3, 3);
    d.offsetX = num(s.offsetX, 0, -100, 100);
    d.offsetY = num(s.offsetY, 0, -100, 100);
    d.rotation = num(s.rotation, 0, -180, 180);
    d.opacity = num(s.opacity, 1, 0.1, 1);
    d.gloss = s.gloss !== false;
    d.label = s.label !== false;
    d.w = Math.round(num(s.w, 0, 0, 4096));
    d.h = Math.round(num(s.h, 0, 0, 4096));
    return d;
  }
  function hasSkin(s) { return !!(s && s.src); }

  // 图片缓存：同一张 dataURL 只解码一次，绘制每帧直接复用
  function image(src) {
    if (!src) return null;
    var rec = imgCache[src];
    if (rec) return rec;
    rec = { img: new Image(), ready: false, failed: false, w: 0, h: 0, waiters: [] };
    rec.img.onload = function () {
      rec.ready = true;
      rec.w = rec.img.naturalWidth; rec.h = rec.img.naturalHeight;
      var list = rec.waiters.splice(0);
      for (var i = 0; i < list.length; i++) { try { list[i](); } catch (e) {} }
    };
    rec.img.onerror = function () {
      rec.failed = true;
      var list = rec.waiters.splice(0);
      for (var i = 0; i < list.length; i++) { try { list[i](); } catch (e) {} }
    };
    rec.img.src = src;
    imgCache[src] = rec;
    return rec;
  }
  // 后台预览是静态 canvas，图片解码完成后需要重画一次
  function ready(src, cb) {
    var rec = image(src);
    if (!rec) return;
    if (rec.ready || rec.failed) { cb(); return; }
    rec.waiters.push(cb);
  }

  function parseHex(hex) {
    var h = String(hex || '#888888').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0];
  }
  function lighten(hex, k) {
    return 'rgb(' + parseHex(hex).map(function (v) { return Math.round(v + (255 - v) * k); }).join(',') + ')';
  }
  function darken(hex, k) {
    return 'rgb(' + parseHex(hex).map(function (v) { return Math.round(v * (1 - k)); }).join(',') + ')';
  }
  function rgba(hex, a) {
    var c = parseHex(hex);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }

  /* 画一颗弹珠。
     cx/cy 为球心，r 为半径；调用方的变换只做平移与统一缩放，球体恒为正圆。
     opts.glow=true 时额外画外圈光晕（后台预览用；游戏单独画阵营光晕）。 */
  function paint(ctx, cx, cy, r, color, rawSkin, label, opts) {
    var skin = normalize(rawSkin), o = opts || {};
    var col = color || '#8899aa';
    ctx.save();
    ctx.translate(cx, cy);

    if (o.glow) {
      var glow = ctx.createRadialGradient(0, 0, r * 0.3, 0, 0, r * 2.4);
      glow.addColorStop(0, rgba(col, 0.38));
      glow.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(0, 0, r * 2.4, 0, Math.PI * 2); ctx.fill();
    }

    var body = ctx.createRadialGradient(-r * 0.35, -r * 0.42, r * 0.1, 0, 0, r);
    body.addColorStop(0, '#ffffff');
    body.addColorStop(0.22, lighten(col, 0.35));
    body.addColorStop(0.72, col);
    body.addColorStop(1, darken(col, 0.55));
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = body; ctx.fill();

    if (skin.src) {
      var rec = image(skin.src);
      if (rec && rec.ready && rec.w > 0 && rec.h > 0) {
        ctx.save();
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.clip();
        ctx.globalAlpha = skin.opacity;
        ctx.translate(r * skin.offsetX / 100, r * skin.offsetY / 100);
        ctx.rotate(skin.rotation * Math.PI / 180);
        var side = 2 * r * skin.scale;
        var k = side / Math.max(rec.w, rec.h);
        var dw = rec.w * k, dh = rec.h * k;
        ctx.drawImage(rec.img, -dw / 2, -dh / 2, dw, dh);
        ctx.restore();
      }
    }

    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.stroke();

    if (skin.gloss) {
      ctx.beginPath();
      ctx.arc(-r * 0.32, -r * 0.38, r * 0.24, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fill();
    }
    if (skin.label && label) {
      ctx.fillStyle = 'rgba(8,10,16,0.78)';
      ctx.font = '700 ' + Math.round(r * 0.82) + 'px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(label).charAt(0), 0, 1);
    }
    ctx.restore();
  }

  // 小尺寸缩略图（职业卡 / 商店卡），dpr 由调用方决定
  function paintThumb(canvas, color, skin, label, size) {
    if (!canvas) return;
    var s = size || 32, dpr = 2;
    canvas.width = s * dpr; canvas.height = s * dpr;
    canvas.style.width = s + 'px'; canvas.style.height = s + 'px';
    var c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, s, s);
    paint(c, s / 2, s / 2, s * 0.42, color, skin, label, { glow: false });
  }

  window.WowPinballSkin = {
    defaults: defaults, normalize: normalize, hasSkin: hasSkin,
    paint: paint, paintThumb: paintThumb, ready: ready, image: image,
    rgba: rgba
  };
})();
