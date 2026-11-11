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

  /* v3 核心玩法：职业表 classes 不再是必需结构（旧存档会在 migrate 中移除）。
     这里只校验真正参与运行的最小集合，其余字段由 migrate 补齐。 */
  function valid(d) {
    return d && d.config && d.meta && d.meta.schema === DEF.meta.schema &&
      Array.isArray(d.skills) && d.skills.length > 0 &&
      Array.isArray(d.maps) && Array.isArray(d.events);
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
    /* ---- v3 核心玩法迁移：职业系统 -> 统一弹珠 + 果实池 + 外观库 ----
       幂等。旧存档里的职业贴图会被转成「魔兽主题」外观保留下来，不会丢素材。 */
    delete c.classSkillWeight;
    delete c.maxSkills;
    if (c.hatchEggs == null) c.hatchEggs = DEF.config.hatchEggs || 5;
    var OLD_CLASSES = Array.isArray(d.classes) ? d.classes : null;
    if (!d.marble || typeof d.marble !== 'object') {
      d.marble = JSON.parse(JSON.stringify(DEF.marble || {}));
    }
    if (!Array.isArray(d.themes) || !d.themes.length) {
      d.themes = JSON.parse(JSON.stringify(DEF.themes || []));
    }
    if (!Array.isArray(d.skins) || !d.skins.length) {
      var moved = (OLD_CLASSES || []).filter(function (x) { return x && x.enabled !== false; }).map(function (cl) {
        var s = cl.skin || {};
        return {
          id: 'skin_' + cl.id, name: cl.name + ' · 弹珠', theme: 'wow',
          src: typeof s.src === 'string' ? s.src : '', scale: s.scale == null ? 1.05 : s.scale,
          offsetX: s.offsetX || 0, offsetY: s.offsetY || 0, rotation: s.rotation || 0,
          opacity: s.opacity == null ? 1 : s.opacity, gloss: !!s.gloss, label: !!s.label,
          w: s.w || 0, h: s.h || 0, color: cl.color || '#88aacc', enabled: true
        };
      });
      d.skins = moved.length ? moved : JSON.parse(JSON.stringify(DEF.skins || []));
    }
    delete d.classes;
    delete d.shop;
    // skills 即果实池：去职业归属、补图标字段、清掉节点里的「职业限制」
    (d.skills || []).forEach(function (sk) {
      if (!sk) return;
      delete sk.cls;
      if (sk.icon == null) sk.icon = '';
      var ns = sk.graph && Array.isArray(sk.graph.nodes) ? sk.graph.nodes : [];
      ns.forEach(function (n) { if (n && n.type === 'source' && n.params) delete n.params.classId; });
    });
    /* 所有果实必须有「目标 · 锁定」，且必须串在 source 之后的主链路上。
       对旧存档 / 导入配置幂等补全，保证运行时一定有明确的指向单位。 */
    (d.skills || []).forEach(function (sk) {
      var g = sk && sk.graph;
      if (!g || !Array.isArray(g.nodes) || !Array.isArray(g.edges)) return;
      var sel = g.nodes.find(function (n) { return n && n.type === 'select'; });
      var src = g.nodes.find(function (n) { return n && n.type === 'source'; });
      if (!src) return;
      if (!sel) {
        sel = {
          id: 'select_auto_' + Math.random().toString(36).slice(2, 9),
          type: 'select', x: 200, y: 90,
          params: { bindTo: 'auto', side: 'enemyOne', pick: 'nearest', count: 1 }
        };
        g.nodes.push(sel);
        // source 的所有出边改由 select 转发，select 接在 source 之后
        g.edges.forEach(function (e) { if (e && e.from === src.id) e.from = sel.id; });
        g.edges.push({ from: src.id, to: sel.id });
      } else if (!g.edges.some(function (e) { return e && e.from === sel.id; })) {
        // 已有 select 却是孤立分支：把主链路从 select 出发，真正参与逻辑链路
        g.edges.forEach(function (e) {
          if (e && e.from === src.id && e.to !== sel.id) e.from = sel.id;
        });
      }
    });
    // 出生点扩到 4 个：1V1 用前两个，2V2 用全部
    (d.maps || []).forEach(function (m) {
      if (!m || !Array.isArray(m.spawns)) return;
      while (m.spawns.length < 4) {
        var base = m.spawns[m.spawns.length % 2] || { x: 216, y: 200 };
        var i = m.spawns.length;
        m.spawns.push({
          x: base.x,
          y: Math.max(40, Math.min((m.height || 400) - 40, base.y + (i % 2 ? 110 : -110)))
        });
      }
    });
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
    // 果实充能迁移：旧存档没有 charge 时补默认值（秒），保证对局内充能条有统一基准
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
    /* 职业 / 商店文案随玩法移除，必须强制覆盖（用户曾改过的旧文案语义已失效）；
       同时补上孵化弹层的四条新文案。按 id 定位，缺哪条补哪条，幂等。 */
    (function () {
      var DROP = { shopTitle: 1, shopCost: 1, shopHint: 1, shopSection: 1, shopBtn: 1 };
      var REPLACE = {
        brandSub: '果实构筑 · 每回合选一枚果实',
        startTitle: '我的果实库',
        startDesc: '所有玩家的弹珠数值相同；选择不同的果实，对战时弹珠技能不同。',
        nameTip: '昵称会显示在对战与联机房间里，方便好友认出你。',
        draftTitle: '本回合 · 果实三选一',
        draftSub: '从你的果实库抽取，选中的果实只在这一回合生效'
      };
      var ADD = [
        { id: 'hatchTitle', label: '孵化弹层标题', group: '弹层文案', selector: '#hatchTitle', mode: 'text', value: '初始果实 · 孵化' },
        { id: 'hatchSub', label: '孵化弹层副标题', group: '弹层文案', selector: '#hatchSub', mode: 'text', value: '5 枚蛋正在孵化…' },
        { id: 'hatchHint', label: '孵化说明', group: '弹层文案', selector: '.hatch-tip', mode: 'text', value: '每枚蛋都会随机开出一种果实，存入你的果实库' },
        { id: 'hatchConfirm', label: '孵化「收下果实」按钮', group: '按钮文字', selector: '#hatchConfirmBtn', mode: 'text', value: '收下果实' }
      ];
      d.texts = d.texts.filter(function (t) { return t && !DROP[t.id]; });
      d.texts.forEach(function (t) { if (REPLACE[t.id] != null) t.value = REPLACE[t.id]; });
      ADD.forEach(function (t) {
        if (!d.texts.some(function (x) { return x.id === t.id; })) d.texts.push(t);
      });
    })();
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
    /* v3.1：浏览器本地存档可能停留在旧草稿（素材被快照剥离、外观被误禁用、
       品牌文案还是旧名），从而遮蔽服务端 / 已发布的新配置。
       这里只补「当前缺、已发布配置有」的字段，不覆盖用户新编辑的结构。 */
    var PUBD = window.WOWPINBALL_PUBLISHED;
    if (PUBD && Array.isArray(PUBD.skins) && Array.isArray(d.skins)) {
      var pubHas = PUBD.skins.some(function (x) { return x && x.src; });
      var curHas = d.skins.some(function (x) { return x && x.src; });
      if (pubHas && !curHas) {
        d.skins.forEach(function (x) {
          if (!x || x.src) return;
          var m = PUBD.skins.find(function (y) { return y && y.id === x.id; });
          if (m && m.src) { x.src = m.src; if (m.w) x.w = m.w; if (m.h) x.h = m.h; }
        });
      }
      if (pubHas && !curHas) {
        // 整份素材都被剥掉属于异常状态，连启用标记一起按已发布配置复位
        d.skins.forEach(function (x) {
          if (!x) return;
          var m = PUBD.skins.find(function (y) { return y && y.id === x.id; });
          if (m && m.enabled !== false) x.enabled = true;
        });
      } else {
        d.skins.forEach(function (x) {
          if (!x || x.enabled !== false || !x.src) return;
          var m = PUBD.skins.find(function (y) { return y && y.id === x.id; });
          if (m && m.enabled !== false) x.enabled = true;
        });
      }
      var pubBrand = (PUBD.texts || []).find(function (t) { return t && t.id === 'brandTitle'; });
      var curBrand = (d.texts || []).find(function (t) { return t && t.id === 'brandTitle'; });
      if (pubBrand && curBrand && pubBrand.value) curBrand.value = pubBrand.value;
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
