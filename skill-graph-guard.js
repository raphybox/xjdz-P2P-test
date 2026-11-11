/* =============================================================================
 * 选技弹珠 · 果实编辑器「链路守卫」 SkillGraphGuard
 * -----------------------------------------------------------------------------
 * 适配真实项目：传统 <script src> + window.* 全局（非 ES Module），
 * 完全保留现有存档结构 skill.graph = { nodes:[{id,type,x,y,params}], edges:[{from,to}] }，
 * 不新增必填字段、不改编译层、不碰游戏端。只做四件事：
 *
 *   1. 连线前置校验：成环 / 多入边归属冲突 / 宿主互绑 / 根模块被接入 / 悬空引用
 *   2. 图体检：把结构性问题灌进后台「校验与发布」页，发布前拦住
 *   3. 语义对照：用确定性规则独立算一遍 live / owner，与 SM.compile(sk) 的实际结果
 *      逐项比对，不一致就明确报出来 —— 直接解决「后台看着对、运行时不对」
 *   4. 原子操作：加边 / 删边（不再靠数组下标）/ 多选复制粘贴（保留内部连线）
 *
 * 用法：<script src="skill-graph-guard.js"></script>（放在 skill-modules.js 之后）
 *       window.SkillGraphGuard
 *
 * 零依赖，浏览器与 Node 均可运行。
 * ========================================================================== */
(function (root) {
  'use strict';

  var VERSION = '1.0.0';
  var SEP = '|';   // 边引用的分隔符；本项目 uid() 生成的 id 不含此字符

  function isObj(o) { return !!o && typeof o === 'object'; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function nodesOf(sk) { return (sk && sk.graph && Array.isArray(sk.graph.nodes)) ? sk.graph.nodes : []; }
  function edgesOf(sk) { return (sk && sk.graph && Array.isArray(sk.graph.edges)) ? sk.graph.edges : []; }
  function byId(sk) { var m = {}; nodesOf(sk).forEach(function (n) { if (n && n.id) m[n.id] = n; }); return m; }
  function typeOf(n) { return n ? n.type : ''; }
  function labelOf(SM, n) {
    if (!n) return '未知模块';
    var d = SM && SM.MODULES && SM.MODULES[n.type];
    return (d && (d.short || d.label)) || n.type || '未知模块';
  }
  function edgeRef(e) { return (e.from + SEP + e.to); }

  /* --------------------------------------------------------------------------
   * 从编译层「自省」出宿主类型，不需要读 skill-modules.js 源码
   * SM.HOST_TYPES 是 { projectile:true, ... } 形态；若未暴露，则退化用
   * SM.compile(sk).hosts 反推（每次调用现场算，兼容不同版本）。
   * ------------------------------------------------------------------------ */
  function hostSet(sk, SM) {
    var explicit = SM && SM.HOST_TYPES;
    var types = {};
    if (isObj(explicit)) Object.keys(explicit).forEach(function (t) { if (explicit[t]) types[t] = true; });
    else if (Array.isArray(explicit)) explicit.forEach(function (t) { types[t] = true; });
    var ids = {};
    nodesOf(sk).forEach(function (n) { if (n && types[n.type]) ids[n.id] = true; });
    // 若显式表为空，用一次编译结果兜底反推 host 的 type 集合
    if (!Object.keys(ids).length && SM && typeof SM.compile === 'function') {
      var C = safeCompile(SM, sk);
      (C.hosts || []).forEach(function (h) {
        var n = byId(sk)[h.id];
        if (n) { types[n.type] = true; ids[n.id] = true; }
      });
    }
    return { ids: ids, types: types };
  }
  function safeCompile(SM, sk) {
    try { return (SM && typeof SM.compile === 'function' ? SM.compile(sk) : null) || {}; }
    catch (e) { return { __compileError: String(e && e.message || e) }; }
  }

  /* --------------------------------------------------------------------------
   * 确定性图解析（guard 自己的一套判断，不复用 compile 的结论）
   *   - scope：节点所属作用域。遇到「宿主」节点就开一个新作用域，其余继承上游。
   *   - live：从触发根可达的节点集合（对应画布上的「已接入」）
   *   - 多入边若解析出多个不同作用域 -> AMBIGUOUS_HOST（加联动最常见的坑）
   * ------------------------------------------------------------------------ */
  function resolve(sk, SM) {
    var nodes = nodesOf(sk), edges = edgesOf(sk), map = byId(sk);
    var H = hostSet(sk, SM);
    var out = {}, inn = {};
    nodes.forEach(function (n) { if (n && n.id) { out[n.id] = []; inn[n.id] = []; } });
    var dangling = [], dup = [], selfLoop = [];

    edges.forEach(function (e, i) {
      if (!e) return;
      if (!map[e.from] || !map[e.to]) { dangling.push({ index: i, edge: e }); return; }
      if (e.from === e.to) { selfLoop.push({ index: i, edge: e }); return; }
      var key = edgeRef(e);
      if (out[e.from].some(function (x) { return x.ref === key; })) { dup.push({ index: i, edge: e }); return; }
      out[e.from].push({ to: e.to, ref: key });
      inn[e.to].push({ from: e.from, ref: key });
    });

    // 根：无有效入边；触发根特指 type === 'source'
    var roots = nodes.filter(function (n) { return n && n.id && !(inn[n.id] || []).length; }).map(function (n) { return n.id; });
    var triggerRoots = roots.filter(function (id) { return typeOf(map[id]) === 'source'; });
    var startSet = triggerRoots.length ? triggerRoots : roots;

    // 作用域传播：BFS，多入边收集全部候选
    var scopes = {}, ambiguous = [], visited = {}, cycles = [];
    var queue = [];
    startSet.forEach(function (id) {
      scopes[id] = [H.ids[id] ? id : 'public'];
      queue.push(id);
    });
    var guard = 0;
    while (queue.length && guard++ < 10000) {
      var u = queue.shift();
      var base = scopes[u];
      (out[u] || []).forEach(function (lnk) {
        var v = lnk.to;
        var cand = H.ids[u] ? u : (base.length === 1 ? base[0] : 'public');
        if (!scopes[v]) scopes[v] = [];
        if (scopes[v].indexOf(cand) < 0) scopes[v].push(cand);
        if (!visited[v]) { visited[v] = true; queue.push(v); }
      });
    }
    // 未被根可达的节点，也给它一个基于自身入边的作用域（用于报冲突，不参与 live）
    nodes.forEach(function (n) {
      if (!n || !n.id || scopes[n.id]) return;
      var c = [];
      (inn[n.id] || []).forEach(function (x) {
        var up = scopes[x.from] || ['public'];
        up.forEach(function (s) { if (c.indexOf(s) < 0) c.push(s); });
      });
      scopes[n.id] = c.length ? c : ['public'];
    });
    Object.keys(scopes).forEach(function (id) {
      if (scopes[id].length > 1) {
        ambiguous.push({ node: id, fromScopes: scopes[id].slice(),
          incoming: (inn[id] || []).map(function (x) { return x.from; }) });
      }
    });

    // live：从触发根可达
    var live = {}, stack = startSet.slice(), g2 = 0;
    while (stack.length && g2++ < 10000) {
      var a = stack.pop();
      if (live[a]) continue;
      live[a] = true;
      (out[a] || []).forEach(function (l) { stack.push(l.to); });
    }
    // 环检测（仅有效边）
    var state = {}, cycNodes = [];
    function dfs(v) {
      state[v] = 1;
      var hit = false;
      (out[v] || []).forEach(function (l) {
        if (state[l.to] === 1) { hit = true; cycNodes.push(l.to); }
        else if (!state[l.to] && dfs(l.to)) hit = true;
      });
      state[v] = 2;
      return hit;
    }
    nodes.forEach(function (n) { if (n && n.id && !state[n.id]) dfs(n.id); });

    var owners = {};
    Object.keys(scopes).forEach(function (id) {
      owners[id] = (scopes[id].length === 1 && scopes[id][0] !== 'public') ? scopes[id][0] : null;
    });

    return {
      nodes: nodes, edges: edges, map: map, out: out, inn: inn,
      roots: roots, triggerRoots: triggerRoots, live: live,
      scopes: scopes, owners: owners, ambiguous: ambiguous,
      dangling: dangling, dup: dup, selfLoop: selfLoop,
      cycles: cycNodes, hostIds: H.ids, hostTypes: H.types
    };
  }

  /* --------------------------------------------------------------------------
   * 连线前置校验：返回 { ok, code, msg }
   * ------------------------------------------------------------------------ */
  function canConnect(sk, SM, from, to) {
    var map = byId(sk);
    if (!map[from] || !map[to]) return bad('NO_NODE', '连线的某个模块已不存在，请刷新画布');
    if (from === to) return bad('SELF_LOOP', '模块不能连自己');
    var edges = edgesOf(sk);
    if (edges.some(function (e) { return e && e.from === from && e.to === to; })) {
      return bad('DUP_EDGE', '这两个模块已经连过了');
    }
    if (typeOf(map[to]) === 'source') {
      return bad('ROOT_HAS_INPUT', '「触发·来源」是整张图的根，不能再被别的模块接入');
    }
    if (typeOf(map[from]) === 'source' && edges.some(function (e) { return e && e.to === from; })) {
      return bad('ROOT_HAS_INPUT', '「触发·来源」不能有上游');
    }
    var H = hostSet(sk, SM);
    if (H.ids[from] && H.ids[to]) {
      return bad('HOST_TO_HOST', '两个「独立载体」不能直接互连；请把附属模块接到其中一个载体上');
    }
    // 模拟加边后：成环？
    var sim = clone(sk);
    sim.graph.edges = edgesOf(sim).concat([{ from: from, to: to }]);
    var R = resolve(sim, SM);
    if (R.cycles.length) return bad('CYCLE', '这条连线会让链路成环，模块归属将无法确定');
    // 模拟加边后：是否制造作用域冲突
    var conflict = R.ambiguous.filter(function (a) {
      return a.node === to || (a.incoming || []).indexOf(from) >= 0;
    });
    if (conflict.length) {
      return bad('AMBIGUOUS_HOST',
        '「' + labelOf(SM, map[to]) + '」会同时接到不同的作用对象上，运行时只能认其中一个；' +
        '请先断开它已有的连线，或改用同一条载体分支');
    }
    return { ok: true, code: 'OK', msg: '' };
  }
  function bad(code, msg) { return { ok: false, code: code, msg: msg }; }

  /** 原子加边；失败返回 false 且图不被改动 */
  function connect(sk, SM, from, to) {
    var r = canConnect(sk, SM, from, to);
    if (!r.ok) return r;
    if (!sk.graph) sk.graph = { nodes: [], edges: [] };
    if (!Array.isArray(sk.graph.edges)) sk.graph.edges = [];
    sk.graph.edges.push({ from: from, to: to });
    return { ok: true, code: 'OK', msg: '', edge: { from: from, to: to } };
  }

  /** 按引用删边（不靠数组下标）；ref 可为 'from|to' 或 {from,to} */
  function removeEdge(sk, ref) {
    var a, b;
    if (typeof ref === 'string') { var p = ref.split(SEP); a = p[0]; b = p[1]; }
    else if (isObj(ref)) { a = ref.from; b = ref.to; }
    else return 0;
    var before = edgesOf(sk).length;
    sk.graph.edges = edgesOf(sk).filter(function (e) {
      return !(e && e.from === a && e.to === b);
    });
    return before - edgesOf(sk).length;
  }

  /** 清洗：删悬空边与重复边，返回 { removed, detail } */
  function clean(sk) {
    var map = byId(sk), seen = {}, kept = [], removed = 0, detail = [];
    edgesOf(sk).forEach(function (e) {
      if (!e || !map[e.from] || !map[e.to]) { removed++; detail.push('悬空连线'); return; }
      if (e.from === e.to) { removed++; detail.push('自连线'); return; }
      var k = edgeRef(e);
      if (seen[k]) { removed++; detail.push('重复连线'); return; }
      seen[k] = true; kept.push(e);
    });
    if (sk.graph) sk.graph.edges = kept;
    return { removed: removed, detail: detail };
  }

  /* --------------------------------------------------------------------------
   * 图体检 check(sk, SM) -> issues[]
   * level: 'error' 必须修（发布拦截器用） / 'warn' 提示
   * ------------------------------------------------------------------------ */
  function check(sk, SM) {
    var issues = [], R = resolve(sk, SM), map = R.map;
    var nm = function (id) { return labelOf(SM, map[id]) + (id ? '' : ''); };

    R.dangling.forEach(function (d) {
      issues.push({ code: 'DANGLING_EDGE', level: 'error',
        msg: '存在指向已删除模块的连线（' + String(d.edge.from) + ' → ' + String(d.edge.to) + '）',
        hint: '这类线在画布上不显示，但编译层仍可能读到，是「加模块后逻辑不对」的常见来源' });
    });
    R.dup.forEach(function () {
      issues.push({ code: 'DUP_EDGE', level: 'error', msg: '存在完全重复的连线' });
    });
    R.selfLoop.forEach(function () {
      issues.push({ code: 'SELF_LOOP', level: 'error', msg: '存在模块连自己的连线' });
    });
    if (R.cycles.length) {
      issues.push({ code: 'CYCLE', level: 'error',
        msg: '链路成环（涉及 ' + R.cycles.length + ' 个节点），模块归属由遍历顺序决定，结果不稳定' });
    }
    R.ambiguous.forEach(function (a) {
      issues.push({ code: 'AMBIGUOUS_HOST', level: 'error',
        node: a.node,
        msg: '「' + nm(a.node) + '」有 ' + a.incoming.length + ' 条来自不同作用对象的连线，运行时只会认其中一个',
        hint: '一个附属模块只能归属一个载体；要同时作用于多处，请复制模块而不是多连几条线' });
    });
    nodesOf(sk).forEach(function (n) {
      if (!n || !n.id) return;
      if (typeOf(n) === 'source' && (R.inn[n.id] || []).length) {
        issues.push({ code: 'ROOT_HAS_INPUT', level: 'error', node: n.id,
          msg: '「触发·来源」被接了上游，触发语义会失效' });
      }
      if (typeOf(n) !== 'source' && !(R.inn[n.id] || []).length && !R.live[n.id]) {
        issues.push({ code: 'ORPHAN', level: 'warn', node: n.id,
          msg: '「' + labelOf(SM, n) + '」没有任何连线，画布会显示「未接入」，正式对局不会执行',
          hint: '要么连到触发节点/载体上，要么删掉' });
      }
    });
    if (!R.triggerRoots.length) {
      issues.push({ code: 'NO_TRIGGER', level: 'error', msg: '整张图没有「触发·来源」根节点' });
    } else if (R.triggerRoots.length > 1) {
      issues.push({ code: 'MULTI_TRIGGER', level: 'warn',
        msg: '存在 ' + R.triggerRoots.length + ' 个独立触发根，多触发请用「触发·来源」的参数配置而不是画多个根' });
    }

    /* ---- 与真实编译层对照：后台判断 vs 运行时实际 ---- */
    var C = safeCompile(SM, sk);
    if (C.__compileError) {
      issues.push({ code: 'COMPILE_ERROR', level: 'error', msg: '技能编译失败：' + C.__compileError });
    } else if (SM && typeof SM.compile === 'function') {
      var cLive = {};
      if (Array.isArray(C.liveIds)) C.liveIds.forEach(function (id) { cLive[id] = true; });
      else if (isObj(C.liveIds)) Object.keys(C.liveIds).forEach(function (id) { if (C.liveIds[id]) cLive[id] = true; });
      if (Object.keys(cLive).length) {
        var onlyGuard = Object.keys(R.live).filter(function (id) { return !cLive[id]; });
        var onlyCompile = Object.keys(cLive).filter(function (id) { return !R.live[id]; });
        if (onlyGuard.length || onlyCompile.length) {
          issues.push({ code: 'COMPILE_MISMATCH', level: 'warn',
            msg: '编辑器判断与编译层实际生效的模块不一致' +
              (onlyGuard.length ? '（编辑器认为生效但运行时没生效：' + onlyGuard.map(nm).join('/') + '）' : '') +
              (onlyCompile.length ? '（运行时生效但编辑器没算到：' + onlyCompile.map(nm).join('/') + '）' : ''),
            hint: '以编译层为准；这类差异通常来自多入边或成环，按上面的结构问题先修' });
        }
      }
      var cOwner = C.bindings && C.bindings.byNode;
      if (isObj(cOwner)) {
        Object.keys(cOwner).forEach(function (id) {
          var pick = cOwner[id];
          var scopes = R.scopes[id] || [];
          if (scopes.length > 1) {
            issues.push({ code: 'HOST_SILENT_PICK', level: 'error', node: id,
              msg: '「' + nm(id) + '」被多个载体连入，编译层静默挑了 ' +
                (C.hosts || []).filter(function (h) { return h.id === pick; }).map(function (h) { return h.label; })[0] +
                '，其余连线白连了',
              hint: '这就是「后台看着连上了、游戏里没效果」的直接原因' });
          }
        });
      }
    }
    return issues;
  }

  /* --------------------------------------------------------------------------
   * 机制摘要（基于图，不依赖错误单链）
   * ------------------------------------------------------------------------ */
  function summary(sk, SM) {
    var R = resolve(sk, SM), map = R.map, seen = {}, parts = [];
    var order = [];
    // 确定性顺序：触发根 -> BFS 层序 -> 同层按 type + id
    var q = R.triggerRoots.length ? R.triggerRoots.slice() : R.roots.slice();
    var g = 0;
    while (q.length && g++ < 10000) {
      var u = q.shift();
      if (seen[u]) continue;
      seen[u] = true; order.push(u);
      (R.out[u] || []).map(function (l) { return l.to; }).sort().forEach(function (v) { q.push(v); });
    }
    nodesOf(sk).forEach(function (n) { if (n && n.id && !seen[n.id]) order.push(n.id); });
    order.forEach(function (id) {
      var n = map[id]; if (!n) return;
      var own = R.owners[id];
      var host = own && (safeCompile(SM, sk).hosts || []).filter(function (h) { return h.id === own; })[0];
      parts.push(labelOf(SM, n) + (R.live[id] ? '' : '(未接入)') + (host ? '→' + host.label : ''));
    });
    return parts.join(' → ') || '（空图）';
  }

  /* --------------------------------------------------------------------------
   * 多选复制 / 粘贴：保留内部连线，外部连线不复制，id 全部重映射
   * uid 由调用方传入（项目里的 uid()）
   * ------------------------------------------------------------------------ */
  function cloneSelection(sk, ids, uidFn) {
    var set = {}; (ids || []).forEach(function (id) { set[id] = true; });
    var nodes = nodesOf(sk).filter(function (n) { return n && set[n.id]; }).map(function (n) { return clone(n); });
    var edges = edgesOf(sk).filter(function (e) { return e && set[e.from] && set[e.to]; })
      .map(function (e) { return { from: e.from, to: e.to }; });
    return { nodes: nodes, edges: edges, __guard: VERSION };
  }
  function paste(sk, clip, opts) {
    opts = opts || {};
    var uidFn = opts.uid || function (t) { return t + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); };
    var dx = Number(opts.dx == null ? 28 : opts.dx), dy = Number(opts.dy == null ? 28 : opts.dy);
    if (!clip || !Array.isArray(clip.nodes) || !clip.nodes.length) return [];
    var map = {}, added = [];
    clip.nodes.forEach(function (src) {
      var n = clone(src), nid = uidFn(n.type);
      map[src.id] = nid; n.id = nid;
      n.x = Math.max(0, (Number(n.x) || 0) + dx);
      n.y = Math.max(0, (Number(n.y) || 0) + dy);
      added.push(n);
    });
    if (!sk.graph) sk.graph = { nodes: [], edges: [] };
    if (!Array.isArray(sk.graph.nodes)) sk.graph.nodes = [];
    if (!Array.isArray(sk.graph.edges)) sk.graph.edges = [];
    sk.graph.nodes = sk.graph.nodes.concat(added);
    (clip.edges || []).forEach(function (e) {
      var a = map[e.from], b = map[e.to];
      if (!a || !b) return;
      if (!sk.graph.edges.some(function (x) { return x.from === a && x.to === b; })) {
        sk.graph.edges.push({ from: a, to: b });
      }
    });
    return added.map(function (n) { return n.id; });
  }

  /* --------------------------------------------------------------------------
   * 编译层版本探测：admin.js 预览里有「旧编译层兜底」分支，
   * 浏览器缓存旧 skill-modules.js 时，后台试放与游戏端会走不同代码路径。
   * ------------------------------------------------------------------------ */
  function buildTag(SM) {
    var need = ['rangeDescriptor', 'targetsInRange', 'rangePoint', 'compile', 'describeBindings'];
    var missing = need.filter(function (k) { return !(SM && typeof SM[k] === 'function'); });
    return {
      version: VERSION,
      fresh: missing.length === 0,
      missing: missing,
      advice: missing.length
        ? '检测到编译层是旧版（缺少 ' + missing.join(' / ') + '），后台试放会走「旧编译层兜底」，与游戏端不一致。请 Ctrl+F5 强刷后再试放。'
        : ''
    };
  }

  root.SkillGraphGuard = {
    VERSION: VERSION,
    SEP: SEP,
    edgeRef: edgeRef,
    resolve: resolve,
    canConnect: canConnect,
    connect: connect,
    removeEdge: removeEdge,
    clean: clean,
    check: check,
    summary: summary,
    cloneSelection: cloneSelection,
    paste: paste,
    buildTag: buildTag
  };
})(typeof window !== 'undefined' ? window : globalThis);
