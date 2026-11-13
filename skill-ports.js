/* =============================================================================
 * 果实编辑器 · 端口契约（v4 工作流）
 * -----------------------------------------------------------------------------
 * 这一层只做三件事：
 *   1) 声明每种卡片的「泳道 + 输入端口 + 输出端口」，端口带类型（exec/data/event）；
 *   2) 连线前置校验（类型、数据种类、事件接受、重复、执行环）；
 *   3) 给编辑器的默认排布 / 主参数清单提供静态数据。
 *
 * 它不编译、不改 graph、不依赖游戏运行时；浏览器与 Node 都能加载。
 * 端口一旦写进 graph.edges（fromPort/toPort），编译层就优先按端口判定语义；
 * 没有端口的旧边保持旧行为（编辑器里画成灰色「隐含」）。
 * ========================================================================== */
(function (root) {
  'use strict';

  var VERSION = '1.0.0';

  /* ---------------- 泳道 ---------------- */
  var LANES = [
    { id: 'cast',    label: '触发', color: '#7fb3ff', x: 30,   hint: '什么时候放 · 放几次 · 朝哪打' },
    { id: 'target',  label: '目标', color: '#c9a6ff', x: 330,  hint: '打谁 · 怎么挑 · 打几个' },
    { id: 'deliver', label: '投递', color: '#ffb270', x: 630,  hint: '用什么形式送出去' },
    { id: 'present', label: '表现', color: '#5ac8fa', x: 930,  hint: '看起来发生什么' },
    { id: 'effect',  label: '结算', color: '#ef7c8e', x: 1230, hint: '最后算什么：伤害 / 元素 / 状态 / 护盾' },
    { id: 'event',   label: '事件', color: '#b98cff', x: 1580, hint: '命中 / 撞墙 / 消失 / 持续 各自再做什么' }
  ];
  var LANE_BY_ID = {};
  LANES.forEach(function (l) { LANE_BY_ID[l.id] = l; });

  /* ---------------- 端口类型 ---------------- */
  var ROLE_LABEL = { cast: '触发', target: '目标', deliver: '投递', effect: '结算', present: '表现', meta: '属性' };

  var PORT_TYPES = {
    exec:  { label: '执行', color: '#e0a340', dash: false, rank: 0 },
    data:  { label: '数据', color: '#5aa9e6', dash: true,  rank: 1 },
    event: { label: '事件', color: '#b98cff', dash: false, rank: 2 }
  };
  /* 事件端口 → 运行时四事件组 */
  var EVENT_TO_GROUP = { hit: 'onHit', wall: 'onWall', expire: 'onExpire', tick: 'onCast' };

  function E(id, label) { return { id: id, type: 'exec', label: label }; }
  function D(id, label, data) { return { id: id, type: 'data', label: label, data: data }; }
  function V(id, label, ev, accept) { return { id: id, type: 'event', label: label, ev: ev, accept: accept || null }; }

  /* ---------------- 卡片 / 节点规格 ----------------
     lane   : 所属泳道
     role   : 卡片角色（编辑器用来决定「这张卡能切成哪些类型」）
     ins    : 输入端口（从左边缘进）
     outs   : 输出端口（从右边缘出）
     accept : 该输入口接受的事件组（不填 = 只接受自身 ev）
     data   : 该输入口接受的数据种类（不填 = 通配）
  */
  var SPEC = {
    /* 触发 */
    source: {
      lane: 'cast', role: 'cast', label: '触发',
      ins: [],
      outs: [E('cast', '施放'), D('signal', '信号', 'signal')]
    },
    delay: {
      lane: 'cast', role: 'cast', label: '延迟',
      ins: [E('cast', '执行')],
      outs: [E('cast', '延迟')]
    },

    /* 目标 */
    select: {
      lane: 'target', role: 'target', label: '目标',
      ins: [D('signal', '信号', 'signal'), E('cast', '执行')],
      outs: [D('targets', '目标', 'targets'), E('cast', '执行')]
    },

    /* 投递 */
    projectile: {
      lane: 'deliver', role: 'deliver', label: '投射物',
      ins: [E('cast', '执行'), D('targets', '目标', 'targets'), D('signal', '信号', 'signal')],
      outs: [D('entity', '弹体', 'entity'), D('trail', '路径', 'trail'),
             V('hit', '命中', 'onHit'), V('wall', '撞墙', 'onWall'), V('expire', '消失', 'onExpire'),
             E('cast', '继续')]
    },
    range: {
      lane: 'target', role: 'target', label: '范围',
      ins: [E('cast', '执行'), D('targets', '目标', 'targets'), D('signal', '信号', 'signal')],
      outs: [D('area', '判定区', 'area'), D('targets', '目标', 'targets'),
             V('hit', '命中', 'onHit'), E('cast', '继续')]
    },
    motion: {
      lane: 'deliver', role: 'deliver', label: '位移',
      ins: [E('cast', '执行'), D('entity', '弹体', 'entity')],
      outs: [D('entity', '弹体', 'entity'), V('wall', '撞墙', 'onWall'), V('expire', '结束', 'onExpire'),
             E('cast', '继续')]
    },
    targeted: {
      lane: 'deliver', role: 'deliver', label: '指向',
      ins: [E('cast', '执行'), D('targets', '目标', 'targets')],
      outs: [D('entity', '锁定', 'entity'), V('hit', '命中', 'onHit'), V('expire', '消失', 'onExpire'),
             E('cast', '继续')]
    },
    zone: {
      lane: 'deliver', role: 'deliver', label: '区域',
      ins: [E('cast', '执行'), D('area', '判定区', 'area'), D('point', '落点', 'point')],
      outs: [D('entity', '区域', 'entity'), D('area', '范围', 'area'),
             V('tick', '持续', 'onCast', ['onCast']), E('cast', '继续')]
    },
    aura: {
      lane: 'deliver', role: 'deliver', label: '光环',
      ins: [E('cast', '执行'), D('entity', '载体', 'entity')],
      outs: [D('entity', '光环', 'entity'), D('area', '范围', 'area'),
             V('tick', '持续', 'onCast', ['onCast']), E('cast', '继续')]
    },

    /* 结算 */
    damage: {
      lane: 'effect', role: 'effect', label: '伤害',
      ins: [V('hit', '命中', 'onHit'), D('targets', '目标', 'targets'),
            V('tick', '持续', 'onCast', ['onCast']), E('cast', '执行')],
      outs: [E('cast', '继续')]
    },
    element: {
      lane: 'effect', role: 'effect', label: '元素',
      ins: [V('hit', '命中', 'onHit'), D('targets', '目标', 'targets'), E('cast', '执行')],
      outs: [E('cast', '继续')]
    },
    status: {
      lane: 'effect', role: 'effect', label: '状态',
      ins: [V('hit', '命中', 'onHit'), D('targets', '目标', 'targets'),
            V('tick', '持续', 'onCast', ['onCast']), E('cast', '执行')],
      outs: [E('cast', '继续')]
    },
    mark: {
      lane: 'effect', role: 'effect', label: '印记',
      ins: [V('hit', '命中', 'onHit'), D('targets', '目标', 'targets'),
            V('tick', '持续', 'onCast', ['onCast']), E('cast', '执行')],
      outs: [E('cast', '继续')]
    },
    shield: {
      lane: 'effect', role: 'effect', label: '护盾',
      ins: [D('targets', '目标', 'targets'), V('tick', '持续', 'onCast', ['onCast']), E('cast', '执行')],
      outs: [E('cast', '继续')]
    },
    split: {
      lane: 'effect', role: 'effect', label: '分裂',
      ins: [V('hit', '命中', 'onHit'), D('entity', '弹体', 'entity')],
      outs: [D('entity', '弹体', 'entity')]
    },
    echo: {
      lane: 'effect', role: 'effect', label: '回响',
      ins: [E('cast', '执行'), V('hit', '命中', 'onHit')],
      outs: [E('cast', '继续')]
    },

    /* 表现 */
    fx: {
      lane: 'present', role: 'present', label: '特效',
      ins: [D('entity', '载体', 'entity'), D('point', '落点', 'point'), D('trail', '路径', 'trail'),
            D('targets', '目标', 'targets'), V('hit', '命中', 'onHit'), E('cast', '执行')],
      outs: [E('cast', '继续')]
    },
    particles: {
      lane: 'present', role: 'present', label: '粒子',
      ins: [D('entity', '载体', 'entity'), D('point', '落点', 'point'), D('trail', '路径', 'trail'),
            D('targets', '目标', 'targets'), V('hit', '命中', 'onHit'), E('cast', '执行')],
      outs: [E('cast', '继续')]
    },
    impact: {
      lane: 'present', role: 'present', label: '爆发',
      ins: [V('hit', '命中', 'onHit'), D('point', '落点', 'point'), D('area', '判定区', 'area'), E('cast', '执行')],
      outs: [E('cast', '继续')]
    }
  };

  /* 结算 · 属性（旧 stats 节点不再参与连线：数值直接写 skill.mods） */
  var SPECIAL = { stats: { lane: null, role: 'meta', label: '属性', ins: [], outs: [] } };

  /* 每种卡片的可选类型（下拉切换） */
  var ROLE_TYPES = {
    cast: ['source', 'delay'],
    target: ['select', 'range'],
    deliver: ['projectile', 'motion', 'targeted', 'zone', 'aura'],
    effect: ['damage', 'element', 'status', 'mark', 'shield', 'split', 'echo'],
    present: ['fx', 'particles', 'impact'],
    meta: ['stats']
  };

  /* 卡片主参数：只显示这些，其余进「全部参数」。
     键名与 SkillModules.MODULES[type].fields 完全一致。 */
  var CARD_FIELDS = {
    source: ['trigger', 'delay', 'interval', 'maxCasts', 'aim'],
    delay: ['seconds'],
    select: ['side', 'pick', 'count'],
    projectile: ['name', 'count', 'spread', 'speed', 'size', 'range', 'lifetime'],
    range: ['shape', 'radius', 'angleDeg', 'length', 'width', 'maxTargets', 'pick'],
    motion: ['scope', 'track', 'dirFrom', 'distance', 'duration', 'ease'],
    targeted: ['targetSide', 'applyMode', 'delay', 'channelDuration', 'maxRange'],
    zone: ['radius', 'duration', 'dps', 'slowPct', 'color'],
    aura: ['auraType', 'radius', 'duration', 'dps', 'buff', 'color'],
    damage: ['affect', 'base', 'pctMaxHp', 'critChance', 'knockback', 'dotEnable', 'dotDps'],
    element: ['element', 'damage', 'damagePct', 'status', 'statusPower', 'statusDuration'],
    status: ['status', 'statusPower', 'statusDuration', 'self'],
    mark: ['stacks', 'maxStacks', 'duration', 'damageAmp', 'dotDps'],
    shield: ['amount', 'duration', 'thorns'],
    split: ['count', 'damageScale', 'spread', 'speedScale'],
    echo: ['times', 'delay', 'powerScale'],
    fx: ['effect', 'attach', 'scale', 'life', 'alpha'],
    particles: ['count', 'shape', 'color', 'attach', 'emitRate', 'life'],
    impact: ['aoeRadius', 'aoePct', 'chainCount', 'shake', 'hitStop'],
    stats: ['maxHp', 'power', 'speed', 'mass', 'crit', 'armor', 'dodge', 'regen', 'shield']
  };

  /* ---------------- 查询 ---------------- */
  function spec(type) { return SPEC[type] || SPECIAL[type] || null; }
  function laneOf(type) { var s = spec(type); return s ? s.lane : null; }
  function lane(laneId) { return LANE_BY_ID[laneId] || null; }
  function roleOf(type) { var s = spec(type); return s ? s.role : null; }
  function typesOfRole(role) { return (ROLE_TYPES[role] || []).slice(); }
  function inPorts(type) { var s = spec(type); return (s && s.ins) ? s.ins : []; }
  function outPorts(type) { var s = spec(type); return (s && s.outs) ? s.outs : []; }
  function port(type, dir, id) {
    var list = dir === 'in' ? inPorts(type) : outPorts(type);
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function portIndex(type, dir, id) {
    var list = dir === 'in' ? inPorts(type) : outPorts(type);
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return i;
    return -1;
  }
  function eventGroup(portId) { return EVENT_TO_GROUP[portId] || null; }

  /* ---------------- 连线校验 ---------------- */
  function nodesOf(skill) { return (skill && skill.graph && skill.graph.nodes) || []; }
  function edgesOf(skill) { return (skill && skill.graph && skill.graph.edges) || []; }
  function nodeOf(skill, id) {
    var ns = nodesOf(skill);
    for (var i = 0; i < ns.length; i++) if (ns[i].id === id) return ns[i];
    return null;
  }

  /* 执行链是否已有 b → … → a 的路径（用于阻止加边成环） */
  function execReach(skill, fromId, toId) {
    var next = {};
    edgesOf(skill).forEach(function (e) {
      if (!e || !e.from || !e.to) return;
      var a = nodeOf(skill, e.from), b = nodeOf(skill, e.to);
      if (!a || !b) return;
      var p = e.fromPort || 'cast';
      var pt = port(a.type, 'out', p);
      /* 旧边（无端口）一律视为执行边，与旧编译的「全边可传播」保持一致的保守判断 */
      if (e.fromPort && pt && pt.type !== 'exec') return;
      (next[e.from] || (next[e.from] = [])).push(e.to);
    });
    var seen = {}, q = [fromId];
    seen[fromId] = 1;
    while (q.length) {
      var cur = q.shift();
      if (cur === toId) return true;
      (next[cur] || []).forEach(function (n) { if (!seen[n]) { seen[n] = 1; q.push(n); } });
    }
    return false;
  }

  /** 校验一条拟新增的连线。返回 {ok, level, code, msg, fix} */
  function canConnect(skill, fromId, fromPortId, toId, toPortId) {
    var a = nodeOf(skill, fromId), b = nodeOf(skill, toId);
    if (!a || !b) return { ok: false, level: 'error', code: 'NO_NODE', msg: '卡片已不存在，请刷新画布' };
    if (fromId === toId) return { ok: false, level: 'error', code: 'SELF', msg: '卡片不能连自己' };
    var pa = port(a.type, 'out', fromPortId);
    var pb = port(b.type, 'in', toPortId);
    if (!pa) return { ok: false, level: 'error', code: 'NO_PORT', msg: '输出口「' + fromPortId + '」不在' + (spec(a.type) ? spec(a.type).label : a.type) + '卡片上' };
    if (!pb) return { ok: false, level: 'error', code: 'NO_IN', msg: (spec(b.type) ? spec(b.type).label : b.type) + '卡片没有输入口「' + toPortId + '」' };

    /* 类型必须一致 */
    if (pa.type !== pb.type) {
      return {
        ok: false, level: 'error', code: 'TYPE_MISMATCH',
        msg: PORT_TYPES[pa.type].label + '口不能接到' + PORT_TYPES[pb.type].label + '口',
        fix: '按端口颜色接：橙色执行、蓝色数据、紫色事件'
      };
    }
    /* 数据种类 */
    if (pa.type === 'data' && pb.data && pa.data !== pb.data) {
      return { ok: false, level: 'error', code: 'DATA_MISMATCH', msg: '数据种类不匹配：' + dataLabel(pa.data) + ' → ' + dataLabel(pb.data) };
    }
    /* 事件接受 */
    if (pa.type === 'event') {
      var acc = pb.accept || [pb.ev];
      if (acc.indexOf(pa.ev) < 0) {
        return { ok: false, level: 'error', code: 'EVENT_MISMATCH', msg: '这张卡片不接受「' + pa.label + '」事件' };
      }
    }
    /* 重复 */
    var dup = edgesOf(skill).some(function (e) {
      return e && e.from === fromId && e.to === toId &&
        (e.fromPort || '') === (fromPortId || '') && (e.toPort || '') === (toPortId || '');
    });
    if (dup) return { ok: false, level: 'warn', code: 'DUP', msg: '这两个端口已经连过了' };
    /* 执行环 */
    if (pa.type === 'exec' && execReach(skill, toId, fromId)) {
      return { ok: false, level: 'error', code: 'CYCLE', msg: '执行链会绕成环：' + labelOf(a) + ' → ' + labelOf(b) + ' → … → ' + labelOf(a), fix: '延迟 / 继续不能接回自己上游' };
    }
    return { ok: true, level: 'ok', code: 'OK', msg: '' };
  }

  function labelOf(n) { var s = n && spec(n.type); return s ? s.label : (n ? n.type : '卡片'); }
  function dataLabel(k) {
    return ({ signal: '信号', targets: '目标', entity: '载体', trail: '路径', area: '判定区', point: '落点' })[k] || k || '数据';
  }

  /** 从旧编译语义反推端口（供「结构固化」使用）。
   *  semantics.byNode[id] = {event, hostId, hitKind, ...}
   *  规则：目标是结算/表现卡时优先接事件口；select→投递接目标集合；其余接执行口。 */
  function inferPort(skill, edge, semantics) {
    var a = nodeOf(skill, edge.from), b = nodeOf(skill, edge.to);
    if (!a || !b) return null;
    var sem = semantics && semantics.byNode && semantics.byNode[b.id];
    var aSpec = spec(a.type), bSpec = spec(b.type);
    if (!aSpec || !bSpec) return null;
    var ev = sem && sem.event;
    var evPort = ev === 'onWall' ? 'wall' : ev === 'onExpire' ? 'expire' : ev === 'onHit' ? 'hit' : null;
    /* 投递 → 结算：按目标事件口 */
    if (aSpec.role === 'deliver' && evPort && port(b.type, 'in', evPort)) {
      return { fromPort: evPort, toPort: evPort, kind: 'flow' };
    }
    /* 目标卡 → 投递/结算：目标集合 */
    if (a.type === 'select' && port(b.type, 'in', 'targets') && port(a.type, 'out', 'targets')) {
      return { fromPort: 'targets', toPort: 'targets', kind: 'bind' };
    }
    /* 触发 → 目标：施放信号；触发 → 其它：执行 */
    if (a.type === 'source') {
      if (b.type === 'select' && port(b.type, 'in', 'signal')) return { fromPort: 'signal', toPort: 'signal', kind: 'flow' };
      if (port(b.type, 'in', 'cast')) return { fromPort: 'cast', toPort: 'cast', kind: 'flow' };
    }
    /* 其它统一执行口 */
    if (port(a.type, 'out', 'cast') && port(b.type, 'in', 'cast')) return { fromPort: 'cast', toPort: 'cast', kind: 'flow' };
    return null;
  }

  /** 默认排布：按泳道横向分列，纵向按「离触发的层数」堆叠。 */
  function autoLayout(skill, opts) {
    var W = (opts && opts.cw) || 236, GAP = (opts && opts.gap) || 18, TOP = (opts && opts.top) || 64;
    var ns = nodesOf(skill);
    var edges = edgesOf(skill);
    var byId = {}; ns.forEach(function (n) { byId[n.id] = n; });
    var depth = {}, roots = [];
    ns.forEach(function (n) { if (n.type === 'source' && depth[n.id] == null) depth[n.id] = 0; });
    if (!Object.keys(depth).length) { ns.forEach(function (n) { roots.push(n.id); }); if (roots[0]) depth[roots[0]] = 0; }
    for (var pass = 0; pass < 8; pass++) {
      edges.forEach(function (e) {
        if (!byId[e.from] || !byId[e.to]) return;
        if (depth[e.from] == null) return;
        var d = depth[e.from] + 1;
        if (depth[e.to] == null || d > depth[e.to]) depth[e.to] = d;
      });
    }
    var rows = {};
    ns.forEach(function (n) {
      var sp = spec(n.type); if (!sp || !sp.lane) return;
      var L = (opts && opts.laneX) ? opts.laneX(n, depth) : (lane(sp.lane) || { x: 0 }).x;
      var col = rows[sp.lane] || (rows[sp.lane] = { y: TOP, maxW: 0 });
      n.x = L; n.y = col.y;
      col.y += 190; // 单卡最小高度，实际渲染后由编辑器二次校正
    });
  }

  var api = {
    VERSION: VERSION, LANES: LANES, LANE_BY_ID: LANE_BY_ID, ROLE_LABEL: ROLE_LABEL, PORT_TYPES: PORT_TYPES,
    EVENT_TO_GROUP: EVENT_TO_GROUP, SPEC: SPEC, SPECIAL: SPECIAL, ROLE_TYPES: ROLE_TYPES,
    CARD_FIELDS: CARD_FIELDS,
    spec: spec, laneOf: laneOf, lane: lane, roleOf: roleOf, typesOfRole: typesOfRole,
    inPorts: inPorts, outPorts: outPorts, port: port, portIndex: portIndex, eventGroup: eventGroup,
    canConnect: canConnect, inferPort: inferPort, autoLayout: autoLayout,
    nodeOf: nodeOf, labelOf: labelOf, dataLabel: dataLabel, execReach: execReach
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SkillPorts = api;
})(typeof window !== 'undefined' ? window : globalThis);
