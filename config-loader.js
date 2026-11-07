/* 运行时配置装载：后台保存的配置优先，否则使用 game-data.js 的默认配置 */
(function () {
  'use strict';
  var KEY = 'wowpinball.config.v1';
  var DEF = window.WOWPINBALL_DEFAULT;
  var data = null;
  try {
    var raw = window.localStorage && window.localStorage.getItem(KEY);
    if (raw) data = JSON.parse(raw);
  } catch (e) { data = null; }

  function valid(d) {
    return d && d.config && d.meta && d.meta.schema === DEF.meta.schema &&
      Array.isArray(d.classes) && Array.isArray(d.skills) &&
      Array.isArray(d.maps) && Array.isArray(d.events) &&
      d.classes.length > 0 && d.skills.length > 0;
  }

  /* 纯静态托管（GitHub Pages）没有 /api/config、访问者也没有本地存档：
     回退到仓库导出的已发布配置，保证弹珠贴图 / 卡片背景 / 数值与本地一致。
     优先级始终是：本地存档 > 已发布静态副本 > 内置默认。 */
  var fromPublished = false;
  if (!valid(data) && window.WOWPINBALL_PUBLISHED) {
    data = window.WOWPINBALL_PUBLISHED;
    fromPublished = true;
  }
  window.WOWPINBALL_CONFIG_KEY = KEY;
  window.WOWPINBALL_CONFIG_SOURCE = valid(data) ? (fromPublished ? 'published' : 'saved') : 'default';
  window.WOWPINBALL_DATA = valid(data) ? migrate(data) : DEF;

  // 物理重构迁移：旧配置用「朝对手加速度 + 速度衰减」，
  // 现改为「初始方向发射 + 无衰减 + 碰撞加速反弹」。升级旧存档避免回退到旧手感。
  function migrate(d) {
    if (!d || !d.config) return d;
    var c = d.config;
    if (c.accel != null && c.launchSpeed == null) {
      delete c.accel;
      c.launchSpeed = DEF.config.launchSpeed;
      c.collisionBoost = DEF.config.collisionBoost;
      c.restitution = DEF.config.restitution;
      c.wallRestitution = DEF.config.wallRestitution;
    }
    if (c.launchSpeed == null) c.launchSpeed = DEF.config.launchSpeed;
    if (c.collisionBoost == null) c.collisionBoost = DEF.config.collisionBoost;
    if (c.restitution == null) c.restitution = 1.0;
    if (c.wallRestitution == null) c.wallRestitution = 1.0;

    // 商店迁移：旧配置没有 shop 时补齐默认商店与卡池
    var ds = DEF.shop || {};
    var s = d.shop || (d.shop = {});
    if (s.enabled == null) s.enabled = ds.enabled !== false;
    if (!s.currency) s.currency = ds.currency;
    if (s.initialCoins == null) s.initialCoins = ds.initialCoins;
    if (s.drawCost == null) s.drawCost = ds.drawCost;
    if (s.duplicateRefund == null) s.duplicateRefund = ds.duplicateRefund;
    s.rewards = Object.assign({}, ds.rewards || {}, s.rewards || {});
    if (!Array.isArray(s.starter)) s.starter = (ds.starter || []).slice();
    if (!Array.isArray(s.pool)) s.pool = (ds.pool || []).map(function (p) { return Object.assign({}, p); });

    // 界面编辑器迁移：旧存档没有 ui 字段时补一份空覆盖，保持默认外观
    if (!d.ui || typeof d.ui !== 'object') d.ui = { enabled: true, screens: {} };
    if (!d.ui.screens || typeof d.ui.screens !== 'object') d.ui.screens = {};
    // 文案迁移：旧存档没有 texts 时补齐默认文案（深拷贝，避免与内置默认互相引用）
    if (!Array.isArray(d.texts)) d.texts = (DEF.texts || []).map(function (t) { return Object.assign({}, t); });
    // 天气迁移：旧存档没有 weather 时整体补一份默认（纯数据，深拷贝隔离引用）
    if (!d.weather || typeof d.weather !== 'object') {
      d.weather = JSON.parse(JSON.stringify(DEF.weather || { enabled: true, noneWeight: 5, types: [] }));
    }
    // 私有版本号：旧 localStorage 存档没有 version 字段时，从已发布静态副本回填，
    // 否则右下角版本号会被旧存档遮蔽（发布记录在服务端文件里，浏览器存档天然滞后一拍）
    if (!d.version && window.WOWPINBALL_PUBLISHED && window.WOWPINBALL_PUBLISHED.version) {
      d.version = window.WOWPINBALL_PUBLISHED.version;
      if (window.WOWPINBALL_PUBLISHED.versionSeq != null) d.versionSeq = window.WOWPINBALL_PUBLISHED.versionSeq;
    }
    return d;
  }
})();
