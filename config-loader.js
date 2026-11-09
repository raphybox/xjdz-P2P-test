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
    // 拥有的技能最大数量：旧存档缺该字段时回填默认（等于总回合数上限，等效不封顶）
    if (c.maxSkills == null) c.maxSkills = DEF.config.maxSkills;

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

    // 技能充能迁移：旧存档没有 charge 时补默认值（秒），保证对局内充能条有统一基准
    var dCharge = (DEF.skills && DEF.skills[0] && DEF.skills[0].charge) || 3;
    (d.skills || []).forEach(function (sk) {
      if (sk && !(typeof sk.charge === 'number' && sk.charge > 0)) sk.charge = dCharge;
    });
    /* 墙面残留伤害迁移：旧版把 wallDps / wallDuration / wallRadius 挂在「贴合墙面」的
       像素特效节点上，现所有伤害属性统一归到「伤害·结算」模块。这里在节点图里补一个
       damage 节点（或复用已有节点）并连线，后台编辑器中可直接继续编辑两种伤害方式。 */
    (d.skills || []).forEach(function (sk) {
      var g = sk && sk.graph;
      if (!g || !Array.isArray(g.nodes) || !Array.isArray(g.edges)) return;
      var legacy = g.nodes.filter(function (x) {
        return x && x.type === 'fx' && x.params && x.params.attach === 'wallFace' &&
          (Number(x.params.wallDps) > 0 || Number(x.params.wallDuration) > 0 || Number(x.params.wallRadius) > 0);
      });
      if (!legacy.length) return;
      var w = { wallDps: 0, wallDuration: 0, wallRadius: 0 };
      legacy.forEach(function (x) {
        var p = x.params;
        w.wallDps += Math.max(0, Number(p.wallDps) || 0);
        w.wallDuration = Math.max(w.wallDuration, Number(p.wallDuration) || 0);
        w.wallRadius = Math.max(w.wallRadius, Number(p.wallRadius) || 0);
        delete p.wallDps; delete p.wallDuration; delete p.wallRadius;
      });
      var dmg = g.nodes.find(function (x) { return x && x.type === 'damage'; });
      if (!dmg) {
        dmg = {
          id: 'damage_wall_' + Math.random().toString(36).slice(2, 9),
          type: 'damage',
          x: legacy[0].x || 320, y: (legacy[0].y || 90) + 180,
          params: { triggerEvent: legacy[0].params.triggerEvent || 'onWall' }
        };
        g.nodes.push(dmg);
      }
      // 新补的节点 / 原本悬空的节点都保证从 source 可达，否则编译期 BFS 会把它丢掉
      if (!g.edges.some(function (e) { return e && e.to === dmg.id; })) {
        g.edges.push({ from: legacy[legacy.length - 1].id, to: dmg.id });
      }
      dmg.params = dmg.params || {};
      // 只在尚未写入新字段时回填，避免覆盖用户后来在 damage 模块里做过的配置
      if (dmg.params.wallDamageMode == null && dmg.params.wallDps == null && dmg.params.wallTouchDamage == null) {
        dmg.params.wallDamageMode = 'auto';   // 自动：填了哪种数值就启用哪种，两种都填则同时生效
        dmg.params.wallDps = w.wallDps;
        dmg.params.wallTouchDamage = 0;
        dmg.params.wallTouchInterval = 0.8;
        dmg.params.wallDuration = w.wallDuration || 3;
        dmg.params.wallRadius = w.wallRadius || 60;
      }
    });
    /* 运动器迁移：旧版位移模块只有一个 mode（dash / retreat / blink / orbit），
       现拆成「轨迹 + 方向来源 + 速度曲线」并新增作用目标 / 持续时长 / 结束速度 / 叠加方式。
       只处理「有 mode、没有 track」的节点：幂等，且不会覆盖用户后来配置的新字段。 */
    var LEGACY_MOTION = {
      dash: { track: 'line', dirFrom: 'toTarget', ease: 'easeIn' },
      retreat: { track: 'line', dirFrom: 'awayTarget', ease: 'easeIn' },
      blink: { track: 'instant', dirFrom: 'toTarget', ease: 'linear' },
      orbit: { track: 'orbit', dirFrom: 'perp', ease: 'linear' }
    };
    (d.skills || []).forEach(function (sk) {
      var g = sk && sk.graph;
      if (!g || !Array.isArray(g.nodes)) return;
      g.nodes.forEach(function (x) {
        if (!x || x.type !== 'motion' || !x.params) return;
        var p = x.params;
        if (p.track != null || !p.mode) return;
        var lg = LEGACY_MOTION[p.mode];
        if (!lg) return;
        p.track = lg.track;
        // 只补缺失字段：旧 mode 不得覆盖用户在编辑器里显式设置的方向 / 速度曲线
        if (p.dirFrom == null) p.dirFrom = lg.dirFrom;
        if (p.ease == null) p.ease = lg.ease;
        if (p.scope == null) p.scope = 'self';
        if (p.duration == null) p.duration = 0.35;
        if (p.angle == null) p.angle = 0;
        if (p.arcDeg == null) p.arcDeg = 60;
        if (p.endSpeed == null) p.endSpeed = 'keep';
        if (p.stackMode == null) p.stackMode = 'replace';
        if (p.stopOnWall == null) p.stopOnWall = true;
        delete p.mode;
      });
    });
    // 界面编辑器迁移：旧存档没有 ui 字段时补一份空覆盖，保持默认外观
    if (!d.ui || typeof d.ui !== 'object') d.ui = { enabled: true, screens: {} };
    if (!d.ui.screens || typeof d.ui.screens !== 'object') d.ui.screens = {};
    // 文案迁移：旧存档没有 texts 时补齐默认文案（深拷贝，避免与内置默认互相引用）
    if (!Array.isArray(d.texts)) d.texts = (DEF.texts || []).map(function (t) { return Object.assign({}, t); });
    // 状态图标迁移：旧存档没有 statuses 时补内置默认（深拷贝，避免与 DEF 互相引用）
    if (!Array.isArray(d.statuses)) {
      d.statuses = (DEF.statuses || []).map(function (s) { return Object.assign({}, s); });
    }
    // 天气迁移：旧存档没有 weather 时整体补一份默认（纯数据，深拷贝隔离引用）
    if (!d.weather || typeof d.weather !== 'object') {
      d.weather = JSON.parse(JSON.stringify(DEF.weather || { enabled: true, noneWeight: 5, types: [] }));
    }
    // 下雨迁移：旧存档的 rain 类型缺 rainForce 时补默认（向下压弹珠的加速度），避免升级后不下雨压珠
    (d.weather.types || []).forEach(function (t) {
      if (t && t.id === 'rain' && !(typeof t.rainForce === 'number')) t.rainForce = 70;
    });
    // 私有版本号：旧 localStorage 存档没有 version 字段时，从已发布静态副本回填，
    // 否则右下角版本号会被旧存档遮蔽（发布记录在服务端文件里，浏览器存档天然滞后一拍）
    if (!d.version && window.WOWPINBALL_PUBLISHED && window.WOWPINBALL_PUBLISHED.version) {
      d.version = window.WOWPINBALL_PUBLISHED.version;
      if (window.WOWPINBALL_PUBLISHED.versionSeq != null) d.versionSeq = window.WOWPINBALL_PUBLISHED.versionSeq;
    }
    return d;
  }
})();
