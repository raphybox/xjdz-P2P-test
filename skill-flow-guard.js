/* =============================================================================
 * 选技弹珠 · 果实编辑器「语义链路判定」 SkillFlowGuard
 * -----------------------------------------------------------------------------
 * 与 SkillGraphGuard 的分工：
 *   SkillGraphGuard  = 图论结构层（环 / 悬空 / 重复 / 归属歧义 / 编译对照）
 *   SkillFlowGuard   = 语义因果层（类型契约 / 执行顺序 / 生命周期 / 目标一致性）
 *
 * 边的两种语义（A 方案 · 增量双语义，旧存档零迁移）：
 *   {from,to}              bind 边：只表达「属性归属哪个载体」，旧图默认全部如此
 *   {from,to,kind:'flow'}  flow 边：表达「执行顺序 + 上下文数据流」
 *   同一张图里两者可共存；modelOf() 依据是否出现 flow 边判定用哪套严格度。
 *
 * 上下文 token（沿 flow 边累积向下传递）：
 *   signal   触发信号            targets  已选定的目标集合
 *   point    世界坐标点          area     判定区域描述符
 *   entity   运行期实体句柄      hit      一次命中事件
 *   trail    弹珠轨迹点序列
 *
 * 每个模块声明 inputs / outputs / phase / requires / produces。
 * 判定引擎据此回答三个问题：
 *   1) 这条线传不传得过去（类型契约）
 *   2) 先后顺序对不对（因果 / 生命周期）
 *   3) 连完之后到底会发生什么、有没有白连的模块（链路解释 + 死链提示）
 *
 * 输出 issue 统一结构：
 *   { code, level:'error'|'warn'|'info', edge:{from,to}|null, node,
 *     msg, why, fix }
 *   error 由后台 validate() 灌成发布阻断项；warn/info 只提示。
 *
 * 零依赖，传统 <script src> 与 Node 均可运行。
 * ========================================================================== */
(function (root) {
  'use strict';

  var VERSION = '1.0.0';

  /* --------------------------------------------------------------------------
   * 模块契约表：这是「底层编辑器」的地基。
   * 新增模块类型时必须在此登记，否则判定引擎按 UNKNOWN_MODULE 报 error。
   * ------------------------------------------------------------------------ */
  var CONTRACTS = {
    source:     { phase: 'trigger', inputs: [],                              outputs: ['signal'],                 requires: [],               produces: null,     label: '触发·来源' },
    select:     { phase: 'query',   inputs: ['signal'],                      outputs: ['targets'],                requires: ['signal'],       produces: null,     label: '目标·锁定' },
    range:      { phase: 'query',   inputs: ['signal', 'point', 'entity'],   outputs: ['targets', 'area'],        requires: ['origin'],       produces: null,     label: '范围判定' },
    projectile: { phase: 'deliver', inputs: ['signal'],                      outputs: ['entity', 'point', 'trail'], requires: ['signal'],    produces: 'entity', label: '投射物' },
    targeted:   { phase: 'deliver', inputs: ['signal', 'targets'],           outputs: ['hit', 'point'],           requires: ['signal'],       produces: null,     label: '指向性·锁定' },
    motion:     { phase: 'deliver', inputs: ['entity'],                      outputs: ['entity', 'trail'],        requires: ['entity'],       produces: null,     label: '运动器' },
    split:      { phase: 'deliver', inputs: ['hit', 'point'],                outputs: ['entity'],                 requires: ['hit'],          produces: 'entity', label: '分裂·溅射' },
    zone:       { phase: 'entity',  inputs: ['signal', 'point', 'trail', 'entity'], outputs: ['entity', 'area'], requires: ['signal'],    produces: 'entity', label: '区域·残留' },
    aura:       { phase: 'entity',  inputs: ['signal', 'entity'],            outputs: ['entity', 'area'],         requires: ['signal'],       produces: 'entity', label: '光环·领域' },
    tick:       { phase: 'control', inputs: ['entity'],                      outputs: ['signal'],                 requires: ['entity'],       produces: null,     label: '周期触发' },
    echo:       { phase: 'control', inputs: ['signal'],                      outputs: ['signal'],                 requires: ['act'],          produces: null,     label: '回响·连发' },
    damage:     { phase: 'act',     inputs: ['targets', 'hit'],              outputs: [],                         requires: ['targets'],      produces: null,     label: '伤害·结算' },
    element:    { phase: 'act',     inputs: ['targets', 'hit'],              outputs: [],                         requires: ['targets'],      produces: null,     label: '元素·属性' },
    /* 状态 / 印记 / 护盾：运行时在触发事件（onHit/onCast…）按「作用于自身」开关决定打谁，
       目标由运行时解析，不依赖 flow 边的 targets 上下文。contract 不再要求 targets，
       否则「特效之后接事件状态」这类合法连线会被误判成死链 / 无执行（与编译器实际行为不一致）。 */
    status:     { phase: 'act',     inputs: [],                              outputs: [],                         requires: [],               produces: null,     label: '事件状态', runtimeResolved: true },
    mark:       { phase: 'act',     inputs: [],                              outputs: [],                         requires: [],               produces: null,     label: '标记·印记', runtimeResolved: true },
    shield:     { phase: 'act',     inputs: [],                              outputs: [],                         requires: [],               produces: null,     label: '护盾', runtimeResolved: true },
    impact:     { phase: 'act',     inputs: ['hit', 'point'],                outputs: [],                         requires: ['hit'],          produces: null,     label: '命中表现' },
    /* 表现层（特效 / 粒子）：运行时在触发事件用真实 落点 / 实体 / 碰撞面 作锚点渲染，
       不依赖 flow 边传来的 anchor 上下文；标记 runtimeResolved 后不再误报「没有可挂载的位置」。 */
    fx:         { phase: 'present', inputs: ['entity', 'point', 'targets', 'hit', 'trail'], outputs: [],       requires: ['anchor'],       produces: null,     label: '像素特效', runtimeResolved: true },
    particles:  { phase: 'present', inputs: ['entity', 'point', 'targets', 'hit', 'trail'], outputs: [],       requires: ['anchor'],       produces: null,     label: '粒子特效', runtimeResolved: true },
    stats:      { phase: 'meta',    inputs: [],                              outputs: [],                         requires: [],               produces: null,     label: '属性' },
    /* 延迟·延时：纯路由节点，不消费也不产出上下文，只把下游所有模块相对触发事件延后 seconds 秒生效。
       runtimeResolved = true：运行时按触发事件自行解析上下文，不依赖 flow 边传来的 token，
       跳过类型契约 / 缺失上下文 / 目标判定等检查，避免「A → 延迟 → B」这类合法连线被误判。 */
    delay:      { phase: 'control', inputs: [],                              outputs: [],                         requires: [],               produces: null,     label: '延迟·延时', runtimeResolved: true }
  };

  var PHASE_LABEL = {
    trigger: '触发', query: '判定', deliver: '投递', entity: '实体',
    control: '控制', act: '结算', present: '表现', meta: '属性'
  };

  var TOKENS = {
    signal: '触发信号', targets: '目标集合', point: '落点坐标', area: '判定区域',
    entity: '运行期实体', hit: '命中事件', trail: '轨迹点序列'
  };

  function isObj(o) { return !!o && typeof o === 'object'; }
  function nodesOf(sk) { return (sk && sk.graph && Array.isArray(sk.graph.nodes)) ? sk.graph.nodes : []; }
  function edgesOf(sk) { return (sk && sk.graph && Array.isArray(sk.graph.edges)) ? sk.graph.edges : []; }
  function isFlow(e) { return !!e && e.kind === 'flow'; }
  function typeOf(n) { return n ? n.type : ''; }
  function paramsOf(n) { return (n && isObj(n.params)) ? n.params : {}; }
  function labelOf(SM, n) {
    if (!n) return '未知模块';
    var c = CONTRACTS[n.type];
    if (c) return c.label;
    var d = SM && SM.MODULES && SM.MODULES[n.type];
    return (d && (d.short || d.label)) || n.type || '未知模块';
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function uniq(a) { var s = {}, o = []; a.forEach(function (x) { if (!s[x]) { s[x] = 1; o.push(x); } }); return o; }
  function intersect(a, b) { return a.filter(function (x) { return b.indexOf(x) >= 0; }); }

  /** 图模型判定：出现任一 flow 边即视为新模型（严格判定）；否则为旧归属图 */
  function modelOf(sk) { return edgesOf(sk).some(isFlow) ? 'flow' : 'legacy'; }

  function issue(code, level, o) {
    var x = { code: code, level: level, edge: (o && o.edge) || null, node: (o && o.node) || null,
      msg: (o && o.msg) || '', why: (o && o.why) || '', fix: (o && o.fix) || '' };
    return x;
  }

  /* --------------------------------------------------------------------------
   * 图的确定性解析：只在此处做一次，后面所有规则共用
   * ------------------------------------------------------------------------ */
  function build(sk, SM) {
    var nodes = nodesOf(sk).filter(function (n) { return n && n.id; });
    var map = {}, out = {}, inn = {}, bindInn = {}, outAll = {};
    nodes.forEach(function (n) { map[n.id] = n; out[n.id] = []; inn[n.id] = []; bindInn[n.id] = []; outAll[n.id] = []; });
    var flowEdges = [], dangling = [], dup = [], selfLoop = [];
    var seen = {};
    edgesOf(sk).forEach(function (e, i) {
      if (!e) return;
      if (!map[e.from] || !map[e.to]) { dangling.push({ index: i, edge: e }); return; }
      if (e.from === e.to) { selfLoop.push({ index: i, edge: e }); return; }
      // 全部边（flow + 归属）都进入 outAll：编译器按全部边判定可达性，死链判定须与此一致
      if (outAll[e.from].indexOf(e.to) < 0) outAll[e.from].push(e.to);
      if (!isFlow(e)) { if (bindInn[e.to]) bindInn[e.to].push(e.from); return; }
      var key = e.from + '>' + e.to;
      if (seen[key]) { dup.push({ index: i, edge: e }); return; }
      seen[key] = 1;
      flowEdges.push({ from: e.from, to: e.to });
      out[e.from].push(e.to);
      inn[e.to].push(e.from);
    });

    var roots = nodes.filter(function (n) { return !inn[n.id].length; }).map(function (n) { return n.id; });
    var triggerRoots = roots.filter(function (id) { return typeOf(map[id]) === 'source'; });
    var startSet = triggerRoots.length ? triggerRoots : roots;

    // 上下文沿 flow 边累积传播；多入边取并集
    var ctx = {}, ancestors = {}, live = {};
    nodes.forEach(function (n) { ctx[n.id] = []; ancestors[n.id] = []; });
    var q = startSet.slice(), guard = 0;
    startSet.forEach(function (id) { live[id] = true; });
    while (q.length && guard++ < 20000) {
      var u = q.shift();
      var base = ctx[u].slice();
      var produced = (CONTRACTS[typeOf(map[u])] || {}).outputs || [];
      var pass = uniq(base.concat(produced));
      (out[u] || []).forEach(function (v) {
        var merged = uniq((ctx[v] || []).concat(pass));
        ctx[v] = merged;
        ancestors[v] = uniq((ancestors[v] || []).concat([u], ancestors[u] || []));
        if (!live[v]) { live[v] = true; q.push(v); }
      });
    }

    // liveAll：沿全部边（flow + 归属）的可达性，与编译器一致。
    // 被「归属连线」挂到主链上的模块（如特效之后接事件状态）也视为可达，避免误报死链。
    var liveAll = {};
    var qa = startSet.slice(), ga = 0;
    startSet.forEach(function (id) { liveAll[id] = true; });
    while (qa.length && ga++ < 20000) {
      var ua = qa.shift();
      (outAll[ua] || []).forEach(function (v) { if (!liveAll[v]) { liveAll[v] = true; qa.push(v); } });
    }

    // 环检测（只看 flow 边）
    var state = {}, cyc = [];
    function dfs(v) {
      state[v] = 1;
      (out[v] || []).forEach(function (w) {
        if (state[w] === 1 && cyc.indexOf(w) < 0) cyc.push(w);
        else if (!state[w]) dfs(w);
      });
      state[v] = 2;
    }
    nodes.forEach(function (n) { if (!state[n.id]) dfs(n.id); });

    return {
      nodes: nodes, map: map, out: out, inn: inn, bindInn: bindInn, outAll: outAll,
      flowEdges: flowEdges, roots: roots, triggerRoots: triggerRoots, startSet: startSet,
      ctx: ctx, ancestors: ancestors, live: live, liveAll: liveAll,
      dangling: dangling, dup: dup, selfLoop: selfLoop, cycles: cyc,
      model: modelOf(sk)
    };
  }

  function hasAnchor(c) { return ['entity', 'point', 'targets', 'hit', 'trail'].some(function (t) { return c.indexOf(t) >= 0; }); }
  function hasOrigin(c) { return ['signal', 'point', 'entity', 'trail'].some(function (t) { return c.indexOf(t) >= 0; }); }
  function hasActAncestor(R, id) {
    return (R.ancestors[id] || []).some(function (a) {
      var c = CONTRACTS[typeOf(R.map[a])];
      return c && c.phase === 'act';
    });
  }
  function entityLife(R, id) {
    var list = (R.ancestors[id] || []).filter(function (a) {
      var c = CONTRACTS[typeOf(R.map[a])];
      return c && c.produces === 'entity';
    });
    if (!list.length) return null;
    var p = paramsOf(R.map[list[list.length - 1]]);
    var v = Number(p.duration != null ? p.duration : (p.life != null ? p.life : p.lifetime));
    return isFinite(v) ? v : null;
  }
  function flowText(R, SM, edge) {
    return labelOf(SM, R.map[edge.from]) + ' → ' + labelOf(SM, R.map[edge.to]);
  }

  /* --------------------------------------------------------------------------
   * 语义判定主入口
   * ------------------------------------------------------------------------ */
  function check(sk, SM) {
    var R = build(sk, SM), issues = [];
    var nm = function (id) { return labelOf(SM, R.map[id]); };

    // 旧归属图：只提示迁移，不灌 error（否则阶段一就把发布通道堵死）
    if (R.model === 'legacy') {
      issues.push(issue('LEGACY_GRAPH', 'warn', {
        msg: '这张图仍是旧「归属」模型（连线只决定属性挂靠，不表达执行顺序）',
        why: '旧模型的连线无法表达「先判定范围 → 再结算 → 再生成残留 → 残留再周期判定」，多级因果链做不出来',
        fix: '用「重建为因果链路」把这张图转换成新模型，或新建果实直接使用 flow 连线'
      }));
      return issues;
    }

    R.dangling.forEach(function (d) {
      issues.push(issue('DANGLING_FLOW', 'error', {
        edge: { from: d.edge.from, to: d.edge.to },
        msg: '存在指向已删除模块的因果连线',
        why: '悬空线不会在画布显示，但编译层仍可能读到，是「加模块后逻辑不对」的常见来源',
        fix: '删除这条连线，或在「校验与发布」执行一次链路清洗'
      }));
    });
    R.dup.forEach(function (d) {
      issues.push(issue('DUP_FLOW', 'error', { edge: { from: d.edge.from, to: d.edge.to },
        msg: '存在完全重复的因果连线', why: '同一份上下文会被重复投递一次', fix: '删掉重复的那条' }));
    });
    R.selfLoop.forEach(function (d) {
      issues.push(issue('SELF_FLOW', 'error', { edge: { from: d.edge.from, to: d.edge.to },
        msg: '模块连到了自己', why: '因果链自环没有起点', fix: '删除这条连线' }));
    });
    if (R.cycles.length) {
      issues.push(issue('FLOW_CYCLE', 'error', {
        msg: '因果链路成环（涉及 ' + R.cycles.length + ' 个模块）',
        why: '带环的链无法确定谁先执行，运行结果取决于遍历顺序',
        fix: '断开环上任意一条线；需要重复执行请接「回响·连发」或「周期触发」'
      }));
    }
    if (!R.triggerRoots.length) {
      issues.push(issue('NO_TRIGGER', 'error', {
        msg: '因果链路没有「触发·来源」起点',
        why: '没有触发信号，整条链永远不会被启动',
        fix: '添加一个「触发·来源」模块并连到链路最前端；多次触发用它的参数配置，不要画多个根'
      }));
    }

    R.nodes.forEach(function (n) {
      var id = n.id, t = typeOf(n), C = CONTRACTS[t], p = paramsOf(n);
      if (!C) {
        issues.push(issue('UNKNOWN_MODULE', 'error', { node: id,
          msg: '「' + nm(id) + '」没有登记模块契约',
          why: '判定引擎不知道它消费/产出什么上下文，无法裁决这条链路是否成立',
          fix: '在 skill-flow-guard.js 的 CONTRACTS 里补上该类型的 inputs/outputs/phase' }));
        return;
      }
      if (t === 'source' || t === 'stats') return;
      var c = R.ctx[id] || [], incoming = R.inn[id] || [];
      /* 同一个「上下文缺失」可能同时命中类型契约、必填前驱、因果顺序三条规则。
         只保留最具体的一条，避免同一个模块刷出三条一样的 error 把诊断淹没。 */
      var ctxErr = null;

      // ⓪ 专属诊断优先：周期触发 / 表现模块的失败原因比通用类型契约更具体
      if (t === 'tick' && c.indexOf('entity') < 0) {
        ctxErr = issue('TICK_NO_ENTITY', 'error', { node: id,
          msg: '「周期触发」没有挂在任何实体上',
          why: '周期结算需要一个持续存在的区域 / 光环 / 投射物作为作用域，否则没有可重复的载体',
          fix: '把它连到「区域·残留」「光环·领域」或「投射物」之后' });
      }
      if (!ctxErr && C.phase === 'present' && !C.runtimeResolved && !hasAnchor(c)) {
        ctxErr = issue('NO_ANCHOR', 'error', { node: id,
          msg: '「' + C.label + '」没有可挂载的位置',
          why: '特效需要实体 / 落点 / 目标之一作为锚点，否则运行时不知道画在哪里',
          fix: '把特效连到产生实体或落点的模块之后（投射物 / 区域残留 / 命中事件）' });
      }

      // ① 类型契约：上游传下来的上下文里，至少要有一个是本模块能接收的。
      // runtimeResolved（表现层 / 状态 / 印记 / 护盾）由运行时在触发事件自行解析锚点/目标，
      // 不依赖 flow 边传来的具体 token，跳过类型契约，避免「source→特效」「特效→状态」等合法连线被误判。
      if (!ctxErr && !C.runtimeResolved && incoming.length && C.inputs.length && !intersect(c, C.inputs).length) {
        ctxErr = issue('TYPE_CONTRACT', 'error', { node: id,
          edge: { from: incoming[0], to: id },
          msg: flowText(R, SM, { from: incoming[0], to: id }) + '：上游传下来的东西和这个模块对不上',
          why: '上游产出 ' + (uniq(incoming.reduce(function (a, u) {
            return a.concat((CONTRACTS[typeOf(R.map[u])] || {}).outputs || []); }, [])).map(function (x) { return TOKENS[x] || x; }).join('、') || '无') +
               '，而「' + C.label + '」只接收 ' + C.inputs.map(function (x) { return TOKENS[x] || x; }).join('、'),
          fix: '在两者之间插入能产出所需上下文的模块（缺目标集合就插「目标·锁定」或「范围判定」，缺实体就插「区域·残留」/「投射物」）' });
      }

      // ② 必填前驱。entity / anchor 交给 ④⑥ 出更具体的文案，这里跳过
      if (!ctxErr) C.requires.forEach(function (req) {
        if (ctxErr) return;
        if (t === 'tick' && req === 'entity') return;
        if (req === 'anchor') return;
        var ok = c.indexOf(req) >= 0;
        if (req === 'origin') ok = hasOrigin(c);
        if (req === 'act') ok = hasActAncestor(R, id);
        if (!ok) {
          var need = req === 'origin' ? '触发信号 / 落点 / 实体（作判定圆心）'
            : req === 'act' ? '至少一个已执行的结算模块' : (TOKENS[req] || req);
          ctxErr = issue('MISSING_CONTEXT', 'error', { node: id,
            msg: '「' + C.label + '」缺少必要前置：' + need,
            why: '该模块在 ' + PHASE_LABEL[C.phase] + ' 阶段运行，拿不到 ' + need + ' 时运行时不会执行（连上了也没效果）',
            fix: '把能提供 ' + need + ' 的模块连到它前面；注意连线要选「因果连线」而不是「归属连线」' });
        }
      });

      // ③ 因果顺序：结算模块必须站在判定之后（runtimeResolved 模块由运行时在触发事件自行解析目标，跳过此检查）
      if (!ctxErr && C.phase === 'act' && !C.runtimeResolved && c.indexOf('targets') < 0 && c.indexOf('hit') < 0) {
        ctxErr = issue('NO_TARGET_QUERY', 'error', { node: id,
          msg: '「' + C.label + '」前面没有任何目标判定',
          why: '结算阶段需要「对谁生效」，没有目标集合或命中事件时伤害/状态不会落到任何单位',
          fix: '在它前面接「范围判定」或「目标·锁定」；如果是命中触发，前面接「投射物」/「指向性·锁定」产出命中事件' });
      }
      if (ctxErr) issues.push(ctxErr);

      // ④ 生命周期：实体存活时长 / 周期后是否有结算
      if (!ctxErr && t === 'tick') {
        {
          var life = entityLife(R, id);
          if (life != null && life <= 0) {
            issues.push(issue('TICK_NO_LIFETIME', 'warn', { node: id,
              msg: '上游实体的存活时长为 0，周期触发可能一次都跑不到',
              why: '实体生成即销毁，周期计时没有推进空间',
              fix: '给实体模块填上「持续时间 / 存活时间」' }));
          }
          var hasDownstreamQuery = false, stack = (R.out[id] || []).slice(), g = 0;
          while (stack.length && g++ < 2000) {
            var v = stack.pop(), vc = CONTRACTS[typeOf(R.map[v])];
            if (vc && (vc.phase === 'query' || vc.phase === 'act')) { hasDownstreamQuery = true; break; }
            (R.out[v] || []).forEach(function (w) { stack.push(w); });
          }
          if (!hasDownstreamQuery) {
            issues.push(issue('EMPTY_TICK', 'warn', { node: id,
              msg: '「周期触发」后面没有判定或结算模块，这一路是空转',
              why: '周期信号发出后没有任何模块消费，白跑一次计时',
              fix: '在后面接「范围判定 → 伤害·结算」，做出「区域内持续伤害」' }));
          }
        }
      }

      // ⑤ 目标一致性：查询选了自身，结算却写敌方
      if (t === 'damage' && p.affect === 'enemy') {
        var selfQuery = (R.ancestors[id] || []).filter(function (a) {
          return typeOf(R.map[a]) === 'select' && paramsOf(R.map[a]).side === 'self';
        });
        if (selfQuery.length) {
          issues.push(issue('TARGET_MISMATCH', 'error', { node: id,
            msg: '上游「目标·锁定」选的是自身，这里却结算敌方伤害',
            why: '目标集合沿链路传递，下游拿到的只有自身；敌方伤害不会命中任何人',
            fix: '把「目标·锁定」的「选择对象」改成敌人，或把「伤害目标」改成「自身（反噬）」' }));
        }
      }

      // ⑥ 实体产出后无人消费
      if (C.produces === 'entity' && !(R.out[id] || []).length) {
        issues.push(issue('ORPHAN_ENTITY', 'warn', { node: id,
          msg: '「' + C.label + '」创建的实体没有被后续模块使用',
          why: '实体会按自己的存活时长存在，但没有任何判定 / 结算 / 特效挂在它上面',
          fix: '在后面接「周期触发 → 范围判定 → 伤害·结算」，或至少挂一个「像素特效」' }));
      }

      // ⑦ 同一节点混用两种边语义
      if ((R.bindInn[id] || []).length && (R.inn[id] || []).length) {
        issues.push(issue('MIXED_EDGE', 'warn', { node: id,
          msg: '「' + C.label + '」同时接了「归属连线」和「因果连线」',
          why: '两种边的语义不同，混用会让「这条线到底在传数据还是定归属」难以判断',
          fix: '新模型下统一改用因果连线；确实只需属性挂靠就删掉因果连线' }));
      }

      // ⑧ 死链：与编译器一致，沿全部边（flow + 归属）从触发根可达才算活着。
      // 用 liveAll 而非 live：被「归属连线」挂到主链上的模块（如特效之后接事件状态）也视为可达。
      if (!R.liveAll[id] && R.triggerRoots.length) {
        issues.push(issue('DEAD_FLOW', 'warn', { node: id,
          msg: '「' + C.label + '」不在任何触发链路里，运行时不会执行',
          why: '从「触发·来源」沿连线走不到这个模块',
          fix: '把它接进链路，或删掉这个模块' }));
      }
    });

    // ⑩ 同一条路径上重复结算（没有控制节点分隔）
    R.nodes.forEach(function (n) {
      if (typeOf(n) !== 'damage') return;
      var samePath = (R.ancestors[n.id] || []).filter(function (a) {
        if (typeOf(R.map[a]) !== 'damage') return false;
        var between = (R.ancestors[n.id] || []).filter(function (x) {
          var c = CONTRACTS[typeOf(R.map[x])];
          return c && (c.phase === 'control');
        });
        return !between.length;
      });
      if (samePath.length) {
        issues.push(issue('DUPLICATE_SETTLE', 'warn', { node: n.id,
          msg: '同一条链路上有 ' + (samePath.length + 1) + ' 次伤害结算，中间没有「回响 / 周期触发」分隔',
          why: '两次结算会在同一瞬间对同一批目标各扣一次血，通常不是预期效果',
          fix: '若想做连击，在两次结算之间插「回响·连发」；若想做持续伤害，插「周期触发」' }));
      }
    });

    return issues;
  }

  /* --------------------------------------------------------------------------
   * 连线前置判定：模拟加边后跑一遍全量规则，只报「由这条边新增」的问题。
   * 返回 { ok, level, code, msg, why, fix, warnings[] }
   *   level==='error' → 调用方应阻止连线；warn 级放行但提示。
   * ------------------------------------------------------------------------ */
  function canConnect(sk, SM, from, to, kind) {
    var k = kind || 'flow';
    if (!sk || !sk.graph) return { ok: false, level: 'error', code: 'NO_GRAPH', msg: '当前果实没有节点图' };
    var map = {}; nodesOf(sk).forEach(function (n) { if (n && n.id) map[n.id] = n; });
    if (!map[from] || !map[to]) return { ok: false, level: 'error', code: 'NO_NODE', msg: '连线的某个模块已不存在，请刷新画布' };
    if (from === to) return { ok: false, level: 'error', code: 'SELF_FLOW', msg: '模块不能连自己' };

    var sim = { graph: { nodes: clone(nodesOf(sk)), edges: clone(edgesOf(sk)) } };
    var exists = sim.graph.edges.some(function (e) { return e && e.from === from && e.to === to && ((e.kind || 'bind') === k); });
    if (exists) return { ok: false, level: 'error', code: 'DUP_FLOW', msg: '这两个模块已经用同类连线连过了' };

    var before = {};
    check(sk, SM).forEach(function (x) { before[x.code + ':' + (x.node || '') + ':' + (x.edge ? x.edge.from + '>' + x.edge.to : '')] = 1; });
    sim.graph.edges.push({ from: from, to: to, kind: k });
    var added = check(sim, SM).filter(function (x) {
      var key = x.code + ':' + (x.node || '') + ':' + (x.edge ? x.edge.from + '>' + x.edge.to : '');
      return !before[key];
    });
    var errs = added.filter(function (x) { return x.level === 'error'; });
    var warns = added.filter(function (x) { return x.level !== 'error'; });
    if (errs.length) {
      var e0 = errs[0];
      return { ok: false, level: 'error', code: e0.code, msg: e0.msg, why: e0.why, fix: e0.fix,
        warnings: warns, issues: added };
    }
    return { ok: true, level: 'ok', code: 'OK', msg: '', warnings: warns, issues: added };
  }

  /* --------------------------------------------------------------------------
   * 链路解释：把「连完之后到底会发生什么」用人类可读的顺序讲清楚
   * ------------------------------------------------------------------------ */
  function describeFlow(sk, SM) {
    var R = build(sk, SM);
    if (R.model === 'legacy') return '（旧归属图：连线只决定属性挂靠，无执行顺序）';
    var seen = {}, parts = [], q = R.startSet.slice(), g = 0;
    while (q.length && g++ < 20000) {
      var id = q.shift();
      if (seen[id]) continue;
      seen[id] = 1;
      var n = R.map[id], C = CONTRACTS[typeOf(n)];
      if (!n || !C) continue;
      var p = paramsOf(n), extra = '';
      if (typeOf(n) === 'range') {
        var shape = { circle: '圆形', cone: '扇形', line: '射线带', ring: '环形' }[p.shape] || p.shape || '圆形';
        extra = '[' + shape + '·圆心=' + ({ caster: '施法者', opponent: '对手', impact: '落点', auto: '自动' }[p.origin] || '施法者') +
          (Number(p.radius) > 0 ? '·半径' + p.radius : '') + ']';
      } else if (typeOf(n) === 'select') {
        extra = '[' + ({ self: '自身', enemyOne: '单个敌人', enemyMany: '多个敌人', allyOne: '单个队友', allyMany: '多个队友' }[p.side] || '按参数') + ']';
      } else if (typeOf(n) === 'damage') {
        extra = '[目标=上游集合·' + ({ enemy: '敌方', self: '自身', both: '双方' }[p.affect] || '敌方') + ']';
      } else if (typeOf(n) === 'zone' || typeOf(n) === 'aura') {
        extra = '[实体·' + (Number(p.duration) || 0) + '秒]';
      } else if (typeOf(n) === 'tick') {
        extra = '[每' + (Number(p.interval) || 0.5) + '秒]';
      } else if (typeOf(n) === 'fx' || typeOf(n) === 'particles') {
        extra = '[挂载=' + (p.attach || '自动') + ']';
      } else if (typeOf(n) === 'source') {
        extra = '[' + ({ roundStart: '回合开始', interval: '定时循环', onCharge: '充能完成', onHit: '受击时', onWall: '撞墙时' }[p.trigger] || '施放') + ']';
      }
      parts.push((typeOf(n) === 'source' ? '' : PHASE_LABEL[C.phase] + '·') + C.label + extra);
      (R.out[id] || []).slice().sort().forEach(function (v) { q.push(v); });
    }
    R.nodes.forEach(function (n) {
      if (seen[n.id]) return;
      var C = CONTRACTS[typeOf(n)];
      if (C) parts.push('(未接入) ' + PHASE_LABEL[C.phase] + '·' + C.label);
    });
    return parts.join(' → ') || '（空链路）';
  }

  /** 汇总：给后台体检条用 */
  function summarize(sk, SM) {
    var list = check(sk, SM);
    var e = list.filter(function (x) { return x.level === 'error'; }).length;
    var w = list.filter(function (x) { return x.level === 'warn'; }).length;
    return { model: modelOf(sk), errors: e, warnings: w, issues: list, flow: describeFlow(sk, SM) };
  }

  root.SkillFlowGuard = {
    VERSION: VERSION,
    CONTRACTS: CONTRACTS,
    PHASE_LABEL: PHASE_LABEL,
    TOKENS: TOKENS,
    modelOf: modelOf,
    build: build,
    check: check,
    canConnect: canConnect,
    describeFlow: describeFlow,
    summarize: summarize
  };
})(typeof window !== 'undefined' ? window : globalThis);
