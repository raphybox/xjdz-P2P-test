/* 果实流水线（v2 固定七段编辑器）的数据模型与「流水线 ↔ 模块图」翻译器。
 *
 * 设计要点：
 *  1) 参考「技能实验室」的固定七段：目标选择 → 施放规则（并行 命中行为）→ 效果传递
 *     → 效果结算①（并行 技能事件）→ 效果结算②。段与段之间的连线由拓扑固定生成，
 *     用户不再拖线，只调每段内部的数值。
 *  2) 「功能全部嵌入」不是重写 300 多个字段，而是每段声明 accept（允许承载的原模块类型），
 *     段内每个 slot 可用下拉切换类型，切换后字段自动换成该类型的完整字段表
 *     （直接读 SkillModules.MODULES[type].fields，字段随编译器升级自动同步）。
 *  3) 关键：流水线只作为「编辑视图」，toGraph() 把它翻译成既有 graph，再交给
 *     SkillModules.compile()。因此 game.js、admin.js 试放、FG/SG 守卫、60+ 测试一行都不用改，
 *     旧技能的 graph 数据也保持兼容。
 *  4) fromGraph() 把旧图按模块类型回收进七段并保留原节点 id，从旧编辑器切过来参数不丢。
 */
(function (root) {
  'use strict';
  var SM = root.SkillModules;
  if (!SM) throw new Error('skill-pipeline.js 需要在 skill-modules.js 之后加载');

  /* 七段固定拓扑。parallel=true 表示它是并行段（参考图里位于下排）。 */
  var STAGES = [
    { id: 'target',   label: '目标选择',   sub: '谁 · 方向',        tone: 'data',  parallel: false,
      accept: ['source', 'select', 'range'], defaults: ['source', 'select', 'range'] },
    { id: 'cast',     label: '施放规则',   sub: '何时 · 延时 · 连发', tone: 'exec',  parallel: false,
      accept: ['delay', 'source'], defaults: ['delay'] },
    { id: 'behavior', label: '命中行为',   sub: '轨迹 · 碰撞 · 切换', tone: 'exec',  parallel: true,
      accept: ['motion', 'projectile', 'impact', 'split', 'shield'], defaults: ['motion'] },
    { id: 'transfer', label: '效果传递',   sub: '做什么 · 怎么送达',  tone: 'exec',  parallel: false,
      accept: ['projectile', 'targeted', 'fx', 'particles', 'element', 'impact', 'zone', 'aura'],
      defaults: ['projectile', 'fx'] },
    { id: 'settle1',  label: '效果结算 ①', sub: '伤害 · 状态 · 印记', tone: 'exec',  parallel: false,
      accept: ['damage', 'status', 'mark', 'shield', 'split', 'echo', 'stats', 'zone', 'aura', 'impact'],
      defaults: ['damage', 'status'] },
    { id: 'events',   label: '技能事件',   sub: '生命周期具名出口',   tone: 'event', parallel: true,
      accept: [], defaults: [] },
    { id: 'settle2',  label: '效果结算 ②', sub: '追加结算 · 增益 · 连发', tone: 'exec', parallel: false,
      accept: ['damage', 'status', 'mark', 'shield', 'split', 'echo', 'stats', 'zone', 'aura', 'impact'],
      defaults: [] }
  ];

  /* 技能事件的具名出口 → 现有编译器的四个事件组（EVENT_KEYS）。
     同一事件组可挂多条独立结算链，编译器会各自归组。 */
  var EVENT_PORTS = [
    { key: 'hit',     label: '命中',       ev: 'onHit' },
    { key: 'crit',    label: '暴击',       ev: 'onHit' },
    { key: 'kill',    label: '击杀',       ev: 'onHit' },
    { key: 'done',    label: '完成',       ev: 'onExpire' },
    { key: 'wall',    label: '撞墙',       ev: 'onWall' },
    { key: 'range',   label: '射程耗尽',   ev: 'onExpire' },
    { key: 'projEnd', label: '投射物结束', ev: 'onExpire' }
  ];

  var STAGE_BY_ID = {};
  STAGES.forEach(function (s) { STAGE_BY_ID[s.id] = s; });

  function uid(p) {
    return (p || 'pl') + '_' + Math.random().toString(36).slice(2, 9);
  }

  function defaultParams(type) {
    var d = SM.defaults ? SM.defaults(type) : {};
    var out = {}, k;
    for (k in d) if (Object.prototype.hasOwnProperty.call(d, k)) out[k] = d[k];
    return out;
  }

  function blankStage(def) {
    var st = { enabled: true, slots: [], ports: {} };
    EVENT_PORTS.forEach(function (p) {
      st.ports[p.key] = { enabled: false, type: 'damage', params: defaultParams('damage') };
    });
    return st;
  }

  function blankPipeline() {
    var stages = {};
    STAGES.forEach(function (s) {
      stages[s.id] = blankStage(s);
      (s.defaults || []).forEach(function (type) {
        stages[s.id].slots.push({ id: uid(type), type: type, params: defaultParams(type), enabled: true });
      });
    });
    return { v: 2, stages: stages };
  }

  /* 旧图 → 七段：按模块类型找第一个能接纳它的段；同类型第二个及以后放 settle2。
     保留原节点 id，这样 params.bindTo 指向的宿主引用仍然有效。 */
  function fromGraph(graph) {
    var pl = { v: 2, stages: {} };
    STAGES.forEach(function (s) { pl.stages[s.id] = blankStage(s); });
    // 清空默认槽：从真实图回收，不掺默认节点
    STAGES.forEach(function (s) { pl.stages[s.id].slots = []; });

    var seenType = {};
    ((graph && graph.nodes) || []).forEach(function (n) {
      if (!n || !SM.MODULES[n.type]) return;
      var sid = null;
      for (var i = 0; i < STAGES.length; i++) {
        var s = STAGES[i];
        if (s.id === 'events' || s.accept.indexOf(n.type) < 0) continue;
        if (seenType[n.type] && s.id !== 'settle2') continue;   // 同类型第二个进结算②
        sid = s.id; break;
      }
      if (!sid) {                                               // 兜底：塞进结算②
        for (var j = 0; j < STAGES.length; j++) {
          if (STAGES[j].accept.indexOf(n.type) >= 0) { sid = STAGES[j].id; break; }
        }
      }
      if (!sid) sid = 'settle1';
      seenType[n.type] = true;
      pl.stages[sid].slots.push({
        id: n.id, type: n.type,
        params: Object.assign(defaultParams(n.type), n.params || {}),
        enabled: n.enabled !== false
      });
    });
    // 触发 · 来源 必须是根：没有就补一个
    if (!pl.stages.target.slots.some(function (x) { return x.type === 'source'; })) {
      pl.stages.target.slots.unshift({ id: uid('source'), type: 'source', params: defaultParams('source'), enabled: true });
    } else {
      var arr = pl.stages.target.slots;
      var si = arr.findIndex(function (x) { return x.type === 'source'; });
      if (si > 0) arr.unshift(arr.splice(si, 1)[0]);
    }
    return pl;
  }

  /* 七段 → 标准 graph：段间首尾串联、段内 slot 依次串联（保持 _delay 最长路径语义），
     事件出口各自生成一条结算链并写入对应 triggerEvent。 */
  function toGraph(pl) {
    var nodes = [], edges = [], prev = null;
    var W = 250, H = 210;
    function push(slot, col, row, forceEv) {
      var params = Object.assign({}, slot.params || {});
      if (forceEv) params.triggerEvent = forceEv;
      var node = {
        id: slot.id || uid(slot.type), type: slot.type, params: params,
        x: 30 + col * W, y: 20 + row * H
      };
      if (slot.enabled === false) node.enabled = false;
      nodes.push(node);
      if (prev) edges.push({ from: prev, to: node.id, kind: 'flow' });
      prev = node.id;
      return node;
    }
    STAGES.forEach(function (s, col) {
      if (s.id === 'events') return;
      var st = pl && pl.stages && pl.stages[s.id];
      if (!st || st.enabled === false) return;
      (st.slots || []).forEach(function (slot, row) { push(slot, col, s.parallel ? row + 1 : row); });
    });
    // 事件出口：每条启用的出口挂一条独立结算链，落在最右侧一列
    var evSt = pl && pl.stages && pl.stages.events;
    if (evSt && evSt.enabled !== false) {
      var evRow = 0;
      EVENT_PORTS.forEach(function (p) {
        var e = evSt.ports && evSt.ports[p.key];
        if (!e || !e.enabled) return;
        push({ id: e.id || uid(p.key), type: e.type || 'damage', params: e.params, enabled: true },
             STAGES.length - 1, evRow++, p.ev);
      });
    }
    // 编译期 roots 取 source 节点，缺一个就补
    if (!nodes.some(function (n) { return n.type === 'source'; })) {
      var src = { id: uid('source'), type: 'source', params: defaultParams('source'), x: 30, y: 20 };
      nodes.unshift(src);
      if (prev) edges.unshift({ from: src.id, to: nodes[1].id, kind: 'flow' });
    }
    return { nodes: nodes, edges: edges };
  }

  /* 段内切换模块类型：旧参数按类型存档，切回来时恢复，避免用户调好的数值被清空。 */
  function switchSlotType(pl, stageId, slotId, newType) {
    var st = pl && pl.stages && pl.stages[stageId];
    var slot = st && (st.slots || []).find(function (x) { return x.id === slotId; });
    if (!slot || !SM.MODULES[newType]) return false;
    slot._saved = slot._saved || {};
    slot._saved[slot.type] = Object.assign({}, slot.params);
    slot.type = newType;
    slot.params = slot._saved[newType] ? Object.assign({}, slot._saved[newType]) : defaultParams(newType);
    return true;
  }

  function stageOf(type) {
    for (var i = 0; i < STAGES.length; i++) if (STAGES[i].accept.indexOf(type) >= 0) return STAGES[i];
    return null;
  }

  var api = {
    STAGES: STAGES, EVENT_PORTS: EVENT_PORTS, STAGE_BY_ID: STAGE_BY_ID,
    blankPipeline: blankPipeline, fromGraph: fromGraph, toGraph: toGraph,
    switchSlotType: switchSlotType, stageOf: stageOf,
    defaultParams: defaultParams, uid: uid
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SkillPipeline = api;
})(typeof window !== 'undefined' ? window : globalThis);
