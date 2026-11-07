/* ---------------------------------------------------------
   UI 布局运行时（游戏端 + 后台共用）
   1) 正常游戏：把后台配置的「位置 / 尺寸 / PNG 素材 / 样式覆盖」应用到真实 DOM
   2) ?uiEditor=1：在 iframe 里铺一层可拖拽的选择框，与后台 postMessage 双向通信
   配置结构：ui = { enabled, screens: { <screenId>: { <key>: patch } } }
   patch = { dx, dy, w, h, img, fit, bg, opacity, radius, z, hide }
   ref   = 'card_<职业 id>'：该元素沿用另一张职业卡的全部样式，只在配置里存一个引用，
           不重复保存 PNG。用于「一键同步到其它职业卡」，避免 9 份 base64 撑爆存档。
   --------------------------------------------------------- */
(function () {
  'use strict';

  /* 每项：[key, 名称, CSS 选择器, 锁定位置尺寸(可选), 多个元素统一应用(可选), 分组(可选)]
     锁定项多为页面根 / 画布，拖拽它们会破坏布局或物理坐标，只允许换素材与样式。
     第 5 位 multi=1：一份覆盖应用到所有匹配元素（选择框只画第一个）。
     职业卡不是「首张」一张，而是按职业列表动态展开，每个职业的背景都能单独上传 PNG。 */
  var CLASS_GROUP = '职业卡背景 · 每个职业单独设置';
  var START_BASE = [
    ['bg', '整页背景', 'body', 1], ['app', '内容容器', '.app', 1],
    ['topbar', '顶部栏', '.topbar'], ['brand', '品牌区', '.brand'],
    ['brandMark', '品牌图标', '.brand-mark'], ['brandText', '品牌文字', '.brand-text'],
    ['topActions', '右上按钮组', '.top-actions'], ['nickBtn', '昵称按钮', '#nickBtn'],
    ['head', '标题说明区', '#startScreen .section-head'], ['grid', '职业卡网格', '#classGrid'],
    // ↓ setClasses() 在这里插入「每个职业一张卡」的独立图层
    ['orb', '卡片弹珠头像（全部职业卡）', '#classGrid .cc-orb', 0, 1],
    ['footer', '底部操作栏', '#startScreen .start-footer'], ['selected', '已选择信息', '.selected-line'],
    ['actions', '底部按钮组', '.start-actions'], ['coin', '金币标签', '#coinChip'],
    ['ghostBtn', '异步对战按钮', '#ghostBtn'], ['shopBtn', '商店按钮', '#shopBtn'],
    ['startBtn', '开始对战按钮', '#startBtn']
  ];
  var SCREENS = [
    { id: 'start', name: '首页 · 选职业', kind: 'screen', root: '#startScreen', items: START_BASE.slice() },
    { id: 'battle', name: '对战 · 竞技场', kind: 'screen', root: '#battleScreen', items: [
      ['bg', '整页背景', 'body', 1], ['app', '内容容器', '.app', 1],
      ['score', '计分板', '.scoreboard'], ['pPanel', '我方面板', '.player-panel'],
      ['ePanel', '对手面板', '.enemy-panel'], ['round', '回合面板', '.round-panel'],
      ['arena', '竞技场容器', '#arenaWrap'], ['canvas', '对战画布', '#arena', 1],
      ['timer', '倒计时', '.arena-timer'], ['logBtn', '战斗记录按钮', '#logBtn'],
      ['banner', '回合横幅', '#banner'], ['aim', '瞄准浮层', '#aimOverlay'],
      ['launchBtn', '发射按钮', '#launchBtn'], ['pHp', '我方血条', '#pHpBar'],
      ['eHp', '对手血条', '#eHpBar'], ['pSkills', '我方技能条', '#pSkills'],
      ['eSkills', '对手技能条', '#eSkills']
    ] },
    { id: 'result', name: '对战结算', kind: 'screen', root: '#resultScreen', items: [
      ['bg', '整页背景', 'body', 1], ['app', '内容容器', '.app', 1],
      ['card', '结算卡片', '.result-card'], ['kicker', '结果标签', '#resultKicker'],
      ['title', '结果标题', '#resultTitle'], ['desc', '结果说明', '#resultDesc'],
      ['review', '回合回顾', '#roundReview'], ['build', '构筑回顾', '#buildReview'],
      ['actions', '结算按钮行', '.result-actions'], ['rematchBtn', '再战按钮', '#rematchBtn'],
      ['shareBtn', '分享码按钮', '#shareResultBtn']
    ] },
    { id: 'name', name: '弹层 · 昵称', kind: 'modal', root: '#nameModal', items: [
      ['mask', '弹层遮罩', '#nameModal', 1], ['card', '弹层卡片', '#nameModal .modal-card'],
      ['head', '标题栏', '#nameModal .modal-head'], ['tip', '说明文字', '.name-tip'],
      ['label', '输入框标签', '.name-label'], ['input', '昵称输入框', '#nameInput'],
      ['actions', '按钮行', '.name-actions'], ['confirmBtn', '确定按钮', '#nameConfirmBtn']
    ] },
    { id: 'rules', name: '弹层 · 规则', kind: 'modal', root: '#rulesModal', items: [
      ['mask', '弹层遮罩', '#rulesModal', 1], ['card', '弹层卡片', '#rulesModal .modal-card'],
      ['head', '标题栏', '#rulesModal .modal-head'], ['list', '规则列表', '#rulesList'],
      ['foot', '底部说明', '#rulesModal .modal-foot']
    ] },
    { id: 'log', name: '弹层 · 战斗记录', kind: 'modal', root: '#logModal', items: [
      ['mask', '弹层遮罩', '#logModal', 1], ['card', '弹层卡片', '#logModal .modal-card'],
      ['head', '标题栏', '#logModal .modal-head'], ['body', '记录内容区', '#battleLog']
    ] },
    { id: 'draft', name: '弹层 · 技能三选一', kind: 'modal', root: '#draftModal', items: [
      ['mask', '弹层遮罩', '#draftModal', 1], ['card', '弹层卡片', '#draftModal .modal-card'],
      ['head', '标题栏', '#draftModal .modal-head'], ['cards', '技能卡容器', '#draftCards'],
      ['card1', '首张技能卡', '#draftCards .draft-card']
    ] },
    { id: 'shop', name: '弹层 · 商店', kind: 'modal', root: '#shopModal', items: [
      ['mask', '弹层遮罩', '#shopModal', 1], ['card', '弹层卡片', '#shopModal .modal-card'],
      ['head', '标题栏', '#shopModal .modal-head'], ['drawRow', '抽卡信息行', '.shop-draw-row'],
      ['drawBtn', '抽取按钮', '#shopDrawBtn'], ['result', '抽取结果', '#shopResult'],
      ['poolTitle', '卡池标题', '.shop-section-title'], ['pool', '卡池列表', '#shopPool'],
      ['pool1', '首个卡池项', '#shopPool .shop-pool-item']
    ] },
    { id: 'ghost', name: '弹层 · 异步对战', kind: 'modal', root: '#ghostModal', items: [
      ['mask', '弹层遮罩', '#ghostModal', 1], ['card', '弹层卡片', '#ghostModal .modal-card'],
      ['head', '标题栏', '#ghostModal .modal-head'], ['tip', '说明文字', '.ghost-tip'],
      ['list', '幽灵列表', '#ghostList'], ['item', '首个幽灵条目', '#ghostList .ghost-item'],
      ['share', '分享码区域', '.ghost-share'], ['code', '分享码输入框', '#ghostCode'],
      ['importBtn', '导入按钮', '#ghostImportBtn']
    ] },
    { id: 'share', name: '弹层 · 分享这局', kind: 'modal', root: '#shareModal', items: [
      ['mask', '弹层遮罩', '#shareModal', 1], ['card', '弹层卡片', '#shareModal .modal-card'],
      ['head', '标题栏', '#shareModal .modal-head'], ['tip', '说明文字', '.share-tip'],
      ['meta', '对局信息', '#shareMeta'], ['plays', '回合决策列表', '#sharePlays'],
      ['code', '分享码输入框', '#shareCode'], ['actions', '按钮行', '.share-actions']
    ] }
  ];

  var FITS = ['cover', 'contain', 'stretch', 'tile', 'center'];
  var COLOR_RE = /^#[0-9a-fA-F]{6}$/;
  var EDITOR = /[?&]uiEditor=1/.test(window.location ? window.location.search : '');
  var W = 'WowPinballUI';

  /* ---------- 动态职业卡图层 ----------
     职业由后台配置决定（可以增删），首页的「职业卡背景」不是写死的一张，
     而是按 classes 逐张展开：key = card_<职业 id>，选择器锁定对应 data-id 的卡片。
     后台与预览 iframe 通过 init 消息同步 classes，保证两侧图层一致。 */
  var CLASS_LIST = [];
  var GRID_SLOT = (function () {
    for (var i = 0; i < START_BASE.length; i++) if (START_BASE[i][0] === 'grid') return i + 1;
    return START_BASE.length;
  })();
  function attrVal(v) { return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }
  function setClasses(list) {
    var seen = {}, arr = [];
    (Array.isArray(list) ? list : []).forEach(function (c) {
      if (!c || c.id === undefined || c.id === null) return;
      var id = String(c.id);
      if (!id || seen[id] || arr.length >= 40) return;
      seen[id] = 1;
      arr.push({ id: id, name: String(c.name || c.id) });
    });
    if (!arr.length) return CLASS_LIST;   // 空列表保留上一次的有效列表，避免图层瞬间清空
    CLASS_LIST = arr;
    var dyn = arr.map(function (c) {
      return ['card_' + c.id, c.name + ' · 卡片背景',
        '#classGrid .class-card[data-id="' + attrVal(c.id) + '"]', 0, 0, CLASS_GROUP];
    });
    SCREENS[0].items = START_BASE.slice(0, GRID_SLOT)
      .concat(dyn)
      .concat(START_BASE.slice(GRID_SLOT));
    return arr;
  }
  function classList() { return CLASS_LIST.map(function (c) { return { id: c.id, name: c.name }; }); }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function num(v, lo, hi) { var n = parseFloat(v); return isFinite(n) ? clamp(n, lo, hi) : null; }
  function screenById(id) { for (var i = 0; i < SCREENS.length; i++) if (SCREENS[i].id === id) return SCREENS[i]; return null; }
  function itemOf(screenId, key) {
    var s = screenById(screenId); if (!s) return null;
    for (var i = 0; i < s.items.length; i++) if (s.items[i][0] === key) return s.items[i];
    return null;
  }
  function elsOf(screenId, key) {
    var it = itemOf(screenId, key); if (!it) return [];
    try {
      if (it[4]) return Array.prototype.slice.call(document.querySelectorAll(it[2]));
      var e = document.querySelector(it[2]);
      return e ? [e] : [];
    } catch (e) { return []; }
  }
  function elOf(screenId, key) { return elsOf(screenId, key)[0] || null; }
  function publicSchema() {
    return SCREENS.map(function (s) {
      return { id: s.id, name: s.name, kind: s.kind, root: s.root,
        items: s.items.map(function (it) {
          return { k: it[0], label: it[1], sel: it[2], lock: !!it[3],
            multi: !!it[4], group: it[5] || '' };
        }) };
    });
  }

  /* ---------- 配置清洗：只保留合法字段，避免脏数据注入样式 ---------- */
  function normalize(raw) {
    var out = { enabled: !raw || raw.enabled !== false, screens: {} };
    if (!raw || !raw.screens) return out;
    SCREENS.forEach(function (s) {
      var src = raw.screens[s.id]; if (!src || typeof src !== 'object') return;
      // 旧版只有「首张职业卡」(key=card)：迁移成第一张职业卡的独立配置，
      // 不复制成 9 份，避免把一张 PNG 在存档里放大 9 倍。
      if (s.id === 'start' && src.card && CLASS_LIST.length) {
        var legacyKey = 'card_' + CLASS_LIST[0].id;
        if (!src[legacyKey]) {
          var copy = {}; Object.keys(src).forEach(function (k) { copy[k] = src[k]; });
          copy[legacyKey] = src.card;
          src = copy;
        }
      }
      // 旧存档里「同一张 PNG 被逐张上传」会让配置变成 9 份 base64（10 MB+）。
      // 只保留第一张职业卡的二进制，其余同图卡片改成 ref 引用；不同的图不自动丢弃。
      if (s.id === 'start') {
        var cardKeys = [];
        for (var ci = 0; ci < s.items.length; ci++) {
          var ik = s.items[ci][0];
          if (ik.indexOf('card_') === 0 && s.items[ci][5]) cardKeys.push(ik);
        }
        var master = '', masterImg = '';
        cardKeys.forEach(function (k) {
          var p = src[k];
          if (!master && p && typeof p.img === 'string' &&
              p.img.indexOf('data:image/png;base64,') === 0) { master = k; masterImg = p.img; }
        });
        if (master) {
          var merged = {}; Object.keys(src).forEach(function (k) { merged[k] = src[k]; });
          cardKeys.forEach(function (k) {
            if (k === master) return;
            var p = merged[k];
            if (!p || typeof p !== 'object' || p.img !== masterImg) return;
            var q2 = {};
            Object.keys(p).forEach(function (f) { if (f !== 'img' && f !== 'ref') q2[f] = p[f]; });
            q2.ref = master;
            merged[k] = q2;
          });
          src = merged;
        }
      }
      var dst = {};
      s.items.forEach(function (it) {
        var p = src[it[0]]; if (!p || typeof p !== 'object') return;
        var q = {}, v;
        // 只保留「显式写过」的字段（sparse patch）：没写过的字段一律沿用 CSS 默认外观
        function keep(k, lo, hi) {
          if (p[k] === undefined || p[k] === null || p[k] === '') return;
          var n = num(p[k], lo, hi); if (n !== null) q[k] = n;
        }
        keep('dx', -2000, 2000); keep('dy', -2000, 2000);
        keep('w', 8, 4000); keep('h', 8, 4000);
        keep('opacity', 0, 1); keep('radius', 0, 200); keep('z', -50, 999);
        keep('bgX', 0, 100); keep('bgY', 0, 100);
        if (typeof p.img === 'string' && p.img.indexOf('data:image/png;base64,') === 0 && p.img.length < 2400000) q.img = p.img;
        if (FITS.indexOf(p.fit) >= 0) q.fit = p.fit;
        if (typeof p.bg === 'string' && COLOR_RE.test(p.bg)) q.bg = p.bg;
        if (p.hide === true) q.hide = true;
        if (typeof p.ref === 'string' && /^card_[A-Za-z0-9_-]{1,40}$/.test(p.ref) && p.ref !== it[0]) q.ref = p.ref;
        if (Object.keys(q).length) dst[it[0]] = q;
      });
      if (Object.keys(dst).length) out.screens[s.id] = dst;
    });
    return out;
  }
  function defaults() { return { enabled: true, screens: {} }; }

  /* ---------- 应用覆盖到真实 DOM ---------- */
  var state = { ui: defaults(), screen: 'start', key: null, applying: false };

  // 只恢复「本模块曾经写入过」的内联属性。
  // 血条宽度、横幅显隐等是游戏运行时每帧写进 style 的，绝不能被编辑器整体清空。
  var OWN = '__wowUiOwn';
  function applyPatch(el, p, lock) {
    var prev = el[OWN] || {};
    Object.keys(prev).forEach(function (k) { el.style[k] = prev[k]; });
    var own = {};
    function set(prop, value) {
      if (!Object.prototype.hasOwnProperty.call(own, prop)) own[prop] = el.style[prop];
      el.style[prop] = value;
    }
    el[OWN] = own;
    // 图层上传了图片：隐藏其装饰性子元素（如品牌图标里的手绘圆点），避免遮挡素材
    if (p && p.img) el.classList.add('__hasImg'); else el.classList.remove('__hasImg');
    if (!p) return;

    var dx = num(p.dx, -2000, 2000) || 0, dy = num(p.dy, -2000, 2000) || 0;
    if (!lock) {
      if (dx || dy) set('transform', 'translate(' + dx + 'px,' + dy + 'px)');
      var w = num(p.w, 8, 4000), h = num(p.h, 8, 4000);
      if (w !== null || h !== null) set('boxSizing', 'border-box');
      if (w !== null) set('width', w + 'px');
      if (h !== null) set('height', h + 'px');
    }
    if (p.img) {
      set('backgroundImage', 'url("' + p.img + '")');
      var fit = p.fit || 'cover';
      if (fit === 'stretch') { set('backgroundSize', '100% 100%'); set('backgroundRepeat', 'no-repeat'); }
      else if (fit === 'tile') { set('backgroundSize', 'auto'); set('backgroundRepeat', 'repeat'); }
      else if (fit === 'contain') { set('backgroundSize', 'contain'); set('backgroundRepeat', 'no-repeat'); }
      else if (fit === 'center') { set('backgroundSize', 'auto'); set('backgroundRepeat', 'no-repeat'); }
      else { set('backgroundSize', 'cover'); set('backgroundRepeat', 'no-repeat'); }
      set('backgroundPosition', (num(p.bgX, 0, 100) === null ? 50 : num(p.bgX, 0, 100)) + '% ' +
        (num(p.bgY, 0, 100) === null ? 50 : num(p.bgY, 0, 100)) + '%');
    }
    if (p.bg) set('backgroundColor', p.bg);
    var op = num(p.opacity, 0, 1), rad = num(p.radius, 0, 200), z = num(p.z, -50, 999);
    if (op !== null && op !== 1) set('opacity', String(op));
    if (rad !== null) set('borderRadius', rad + 'px');
    if (z !== null) {
      if (getComputedStyle(el).position === 'static') set('position', 'relative');
      set('zIndex', String(z));
    }
    if (p.hide === true) set('display', 'none');
  }

  function rawPatchOf(screenId, key) {
    var sc = state.ui.screens[screenId];
    return (sc && sc[key]) || null;
  }
  /* 解析 ref：以被引用卡的样式为底，本卡显式写过的字段覆盖其上。
     循环引用直接返回 null，避免恶意/脏配置导致死循环。 */
  function resolvePatch(screenId, key, seen) {
    if (seen.indexOf(key) >= 0) return null;
    seen.push(key);
    var p = rawPatchOf(screenId, key); if (!p) return null;
    if (!p.ref) return p;
    var base = resolvePatch(screenId, p.ref, seen) || {}, out = {};
    Object.keys(base).forEach(function (k) { if (k !== 'ref') out[k] = base[k]; });
    Object.keys(p).forEach(function (k) { if (k !== 'ref') out[k] = p[k]; });
    return out;
  }
  function patchOf(screenId, key) { return resolvePatch(screenId, key, []); }
  function applyOne(screenId, key) {
    var els = elsOf(screenId, key); if (!els.length) return;
    var it = itemOf(screenId, key), p = patchOf(screenId, key), lock = !!(it && it[3]);
    els.forEach(function (el) { applyPatch(el, p, lock); });
  }
  function applyAll() {
    if (state.applying) return;
    state.applying = true;
    try {
      SCREENS.forEach(function (s) { s.items.forEach(function (it) { applyOne(s.id, it[0]); }); });
    } finally { state.applying = false; }
  }
  function setUi(raw) { state.ui = normalize(raw); applyAll(); }
  function setPatch(screenId, key, patch) {
    var sc = state.ui.screens[screenId] || (state.ui.screens[screenId] = {});
    if (patch && Object.keys(patch).length) {
      var wrap = { enabled: state.ui.enabled !== false, screens: {} };
      wrap.screens[screenId] = {}; wrap.screens[screenId][key] = patch;
      var clean = normalize(wrap).screens[screenId];
      if (clean && clean[key] && Object.keys(clean[key]).length) sc[key] = clean[key];
      else delete sc[key];
    } else delete sc[key];
    applyOne(screenId, key);
  }

  /* ---------- 屏幕切换（正常模式不调用，仅编辑器使用） ---------- */
  var FORCE_VISIBLE = ['#banner', '#aimOverlay', '#asyncTag', '#shopResult', '#ghostMsg',
    '#shareMsg', '#nameMsg', '#nameCancelBtn', '#closeNameBtn'];
  // 编辑态下没开局的动态容器是空的，补占位内容后才能被选中、拖拽、换素材
  var SAMPLE_FILL = [
    ['#draftCards', 3, 'draft-card', '技能示例'],
    ['#sharePlays', 3, 'share-play', '第 N 回合 · 技能 · 方向'],
    ['#battleLog', 6, 'log-line', '战斗记录示例'],
    ['#roundReview', 3, 'rr-item', '第 N 回合'],
    ['#buildReview', 2, 'build-col', '构筑回顾'],
    ['#pSkills', 2, 'mini-skill', '技能'],
    ['#eSkills', 2, 'mini-skill', '技能'],
    ['#rulesList', 4, '', '规则说明示例']
  ];
  function fillSamples() {
    SAMPLE_FILL.forEach(function (row) {
      var box = document.querySelector(row[0]);
      if (!box || box.children.length) return;
      for (var i = 0; i < row[1]; i++) {
        var tag = (box.tagName === 'OL' || box.tagName === 'UL') ? 'li' : 'div';
        var e = document.createElement(tag);
        if (row[2]) e.className = row[2];
        e.textContent = row[3] + (row[1] > 1 ? ' ' + (i + 1) : '');
        e.setAttribute('data-ui-sample', '1');
        e.style.cssText = 'padding:9px 11px;margin:6px 0;border:1px solid #3a4760;' +
          'border-radius:8px;color:#9aa7bb;font-size:12px;background:#141c29;list-style:none;';
        box.appendChild(e);
      }
    });
  }
  // 后台新增、但还没保存 / 发布的职业，在预览 iframe 里还没有真实卡片。
  // 编辑态补一张占位卡，保证「每个职业的背景」都能立刻单独编辑（正常游戏不受影响）。
  function fillClassPlaceholders() {
    if (!EDITOR || !CLASS_LIST.length) return;
    var grid = document.querySelector('#classGrid'); if (!grid) return;
    var first = grid.querySelector('.class-card'), added = 0;
    CLASS_LIST.forEach(function (c) {
      var sel = '.class-card[data-id="' + attrVal(c.id) + '"]';
      if (grid.querySelector(sel)) return;
      added++;
      var e = first ? first.cloneNode(true) : document.createElement('button');
      e.className = 'class-card'; e.type = 'button';
      e.setAttribute('data-id', c.id);
      e.setAttribute('data-ui-sample', '1');
      var nm = e.querySelector('.cc-name'); if (nm) nm.textContent = c.name;
      var orb = e.querySelector('canvas.cc-orb');
      if (orb) {
        var d = document.createElement('div'); d.className = 'cc-orb';
        orb.parentNode.replaceChild(d, orb);
      }
      grid.appendChild(e);
    });
    if (added) applyAll();   // 占位卡也要带上已经配置好的背景
  }
  function showScreen(id) {
    var s = screenById(id); if (!s) return;
    state.screen = id;
    var screens = document.querySelectorAll('.screen'), modals = document.querySelectorAll('.modal');
    Array.prototype.forEach.call(screens, function (x) { x.hidden = true; });
    Array.prototype.forEach.call(modals, function (x) { x.hidden = true; });
    var root = document.querySelector(s.root);
    if (s.kind === 'modal') {
      var start = document.querySelector('#startScreen'); if (start) start.hidden = false;
      if (root) root.hidden = false;
    } else if (root) root.hidden = false;
    if (EDITOR) {
      FORCE_VISIBLE.forEach(function (sel) {
        var e = document.querySelector(sel); if (e) e.hidden = false;
      });
      fillSamples();
      fillClassPlaceholders();
    }
    applyAll();
    return true;
  }

  /* ---------- 编辑模式：覆盖层 + 拖拽 / 缩放 ---------- */
  function post(msg) {
    msg = msg || {}; msg.__wowUi = 1;
    try { if (window.parent !== window) window.parent.postMessage(msg, '*'); } catch (e) {}
  }
  function listenParent(fn) {
    window.addEventListener('message', function (ev) {
      var d = ev.data;
      if (d && d.__wowUi === 1 && d.type) fn(d);
    });
  }

  function initEditor() {
    document.body.classList.add('ui-edit-mode');
    var css = document.createElement('style');
    css.textContent = [
      '#uiEditLayer{position:fixed;inset:0;z-index:2147483000;pointer-events:none;font-family:"Segoe UI","PingFang SC",sans-serif}',
      '.ue-box{position:absolute;pointer-events:auto;box-sizing:border-box;border:1px dashed rgba(217,164,65,.75);',
      'background:rgba(217,164,65,.05);cursor:move;transition:border-color .12s}',
      '.ue-box:hover{border-color:rgba(217,164,65,1);background:rgba(217,164,65,.1)}',
      '.ue-box.on{border:2px solid #ffd479;background:rgba(217,164,65,.13);box-shadow:0 0 0 1px #0008,0 0 18px #d9a44155}',
      '.ue-tag{position:absolute;left:0;top:-19px;height:18px;line-height:18px;padding:0 7px;white-space:nowrap;',
      'font-size:10px;color:#0d1117;background:#d9a441;border-radius:4px 4px 0 0;cursor:pointer}',
      '.ue-box.on .ue-tag{background:#ffd479}',
      '.ue-h{position:absolute;width:10px;height:10px;background:#ffd479;border:1px solid #6b4b12;border-radius:2px;pointer-events:auto}',
      '.ue-h[data-d="nw"]{left:-6px;top:-6px;cursor:nwse-resize}.ue-h[data-d="n"]{left:50%;top:-6px;margin-left:-5px;cursor:ns-resize}',
      '.ue-h[data-d="ne"]{right:-6px;top:-6px;cursor:nesw-resize}.ue-h[data-d="e"]{right:-6px;top:50%;margin-top:-5px;cursor:ew-resize}',
      '.ue-h[data-d="se"]{right:-6px;bottom:-6px;cursor:nwse-resize}.ue-h[data-d="s"]{left:50%;bottom:-6px;margin-left:-5px;cursor:ns-resize}',
      '.ue-h[data-d="sw"]{left:-6px;bottom:-6px;cursor:nesw-resize}.ue-h[data-d="w"]{left:-6px;top:50%;margin-top:-5px;cursor:ew-resize}',
      'body.ui-edit-mode .modal:not([hidden]){display:flex}',
      '/* 每个职业一张卡：9 个选择框同时铺开会挡住卡面，未选中时只留淡边框 */',
      '#uiEditLayer .ue-box[data-key^="card_"]:not(.on){border-color:rgba(217,164,65,.3);background:transparent}',
      '#uiEditLayer .ue-box[data-key^="card_"]:not(.on) .ue-tag,#uiEditLayer .ue-box[data-key^="card_"]:not(.on) .ue-h{visibility:hidden}',
      '#uiEditLayer .ue-box[data-key^="card_"]:not(.on):hover{border-color:rgba(217,164,65,.95);background:rgba(217,164,65,.08)}',
      '#uiEditLayer .ue-box[data-key^="card_"]:not(.on):hover .ue-tag,#uiEditLayer .ue-box[data-key^="card_"]:not(.on):hover .ue-h{visibility:visible}'
    ].join('\n');
    document.head.appendChild(css);

    var layer = document.createElement('div'); layer.id = 'uiEditLayer';
    document.body.appendChild(layer);
    var boxes = {}, drag = null, lastPost = 0;

    function currentScreen() { return screenById(state.screen) || SCREENS[0]; }

    function drawBoxes() {
      var s = currentScreen();
      var keep = {};
      s.items.forEach(function (it) {
        var key = it[0], el = elOf(s.id, key);
        if (!el) return;
        var r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return;
        keep[key] = 1;
        var b = boxes[key];
        if (!b) {
          b = document.createElement('div'); b.className = 'ue-box'; b.dataset.key = key;
          var tag = document.createElement('span'); tag.className = 'ue-tag'; tag.textContent = it[1];
          b.appendChild(tag);
          ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach(function (d) {
            var h = document.createElement('i'); h.className = 'ue-h'; h.dataset.d = d; b.appendChild(h);
          });
          layer.appendChild(b); boxes[key] = b;
        }
        b.style.left = r.left + 'px'; b.style.top = r.top + 'px';
        b.style.width = r.width + 'px'; b.style.height = r.height + 'px';
        b.classList.toggle('on', state.key === key);
        b.style.display = it[3] ? 'none' : '';   // 锁定项不显示选择框，仅可在图层列表里编辑素材
      });
      Object.keys(boxes).forEach(function (k) {
        if (!keep[k]) { boxes[k].style.display = 'none'; }
      });
    }

    function select(key, notify) {
      state.key = key || null;
      drawBoxes();
      if (notify !== false) post({ type: 'select', screen: state.screen, key: state.key });
    }

    layer.addEventListener('pointerdown', function (ev) {
      var box = ev.target.closest('.ue-box'); if (!box) return;
      var key = box.dataset.key, it = itemOf(state.screen, key);
      select(key);
      if (!it || it[3]) return;
      var el = elOf(state.screen, key); if (!el) return;
      // eff = 引用展开后的实际样式（决定拖拽起点）；own = 原始 sparse patch（写回时保留 ref，不复制引用的 PNG）
      var eff = patchOf(state.screen, key) || {};
      var own = rawPatchOf(state.screen, key) || {};
      var r = el.getBoundingClientRect();
      var handle = ev.target.closest('.ue-h');
      drag = {
        key: key, el: el, dir: handle ? handle.dataset.d : 'move',
        x0: ev.clientX, y0: ev.clientY,
        dx0: num(eff.dx, -2000, 2000) || 0, dy0: num(eff.dy, -2000, 2000) || 0,
        w0: num(eff.w, 8, 4000) || r.width, h0: num(eff.h, 8, 4000) || r.height,
        base: Object.assign({}, eff), own: Object.assign({}, own)
      };
      ev.preventDefault(); ev.stopPropagation();
    });

    window.addEventListener('pointermove', function (ev) {
      if (!drag) return;
      var mx = ev.clientX - drag.x0, my = ev.clientY - drag.y0;
      var p = Object.assign({}, drag.base), d = drag.dir;
      if (d === 'move') {
        p.dx = Math.round(drag.dx0 + mx); p.dy = Math.round(drag.dy0 + my);
      } else {
        var w = drag.w0, h = drag.h0, dx = drag.dx0, dy = drag.dy0;
        if (d.indexOf('e') >= 0) w = Math.max(16, drag.w0 + mx);
        if (d.indexOf('s') >= 0) h = Math.max(12, drag.h0 + my);
        if (d.indexOf('w') >= 0) { w = Math.max(16, drag.w0 - mx); dx = drag.dx0 + (drag.w0 - w); }
        if (d.indexOf('n') >= 0) { h = Math.max(12, drag.h0 - my); dy = drag.dy0 + (drag.h0 - h); }
        p.w = Math.round(w); p.h = Math.round(h); p.dx = Math.round(dx); p.dy = Math.round(dy);
      }
      // 只把「位置/尺寸 + 本卡原有字段」写回，继承来的 img/fit/bg 等不落盘
      var out = Object.assign({}, drag.own);
      ['dx', 'dy', 'w', 'h'].forEach(function (k) { if (p[k] !== undefined) out[k] = p[k]; });
      setPatch(state.screen, drag.key, out);
      drawBoxes();
      var now = Date.now();
      if (now - lastPost > 70 || !ev.buttons) { lastPost = now; post({ type: 'change', screen: state.screen, key: drag.key, patch: out }); }
    });
    window.addEventListener('pointerup', function () {
      if (!drag) return;
      post({ type: 'change', screen: state.screen, key: drag.key, patch: rawPatchOf(state.screen, drag.key) || {} });
      drag = null;
    });

    window.addEventListener('resize', drawBoxes);
    window.addEventListener('scroll', drawBoxes, true);
    setInterval(drawBoxes, 700);   // 动态内容（职业卡/技能卡/血条）生成后也能跟上

    listenParent(function (d) {
      if (d.type === 'init') {
        if (d.classes) setClasses(d.classes);
        state.ui = normalize(d.ui);
        showScreen(d.screen || 'start');
        select(d.key || null, false);
        drawBoxes();
        post({ type: 'ready', schema: publicSchema(), screen: state.screen });
      } else if (d.type === 'screen') { showScreen(d.screen); state.key = null; drawBoxes(); }
      else if (d.type === 'select') { select(d.key, false); }
      else if (d.type === 'patch') { setPatch(d.screen, d.key, d.patch); drawBoxes(); }
      else if (d.type === 'ui') { if (d.classes) setClasses(d.classes); state.ui = normalize(d.ui); applyAll(); drawBoxes(); }
      else if (d.type === 'reset') { setPatch(d.screen, d.key, null); drawBoxes(); }
      else if (d.type === 'showScreenOnly') { showScreen(d.screen); drawBoxes(); }
    });

    // 父窗口若在脚本就绪前就发了 init，这里主动要一次
    post({ type: 'needInit' });
    window.addEventListener('load', function () {
      fillClassPlaceholders(); drawBoxes();
      post({ type: 'ready', schema: publicSchema(), screen: state.screen });
    });
  }

  /* ---------- 初始化 ---------- */
  // 后台页面没有 #startScreen 会提前 return，这里先按默认职业表展开一次图层，
  // 之后 admin.js 会用 S.data.classes（含尚未保存的新增职业）再同步。
  var bootData = window.WOWPINBALL_DATA || window.WOWPINBALL_DEFAULT;
  setClasses(bootData && bootData.classes);

  var api = {
    schema: publicSchema, screens: SCREENS, normalize: normalize, defaults: defaults,
    apply: applyAll, applyOne: applyOne, setUi: setUi, setPatch: setPatch,
    showScreen: showScreen, patchOf: patchOf, rawPatchOf: rawPatchOf, elOf: elOf, itemOf: itemOf,
    setClasses: setClasses, classList: classList, isEditor: EDITOR, state: state
  };
  window[W] = api;

  if (!document.querySelector('#startScreen')) return;   // 后台页面只借用 API，不初始化 DOM

  // 游戏端读 config-loader 的最终配置，后台由 admin.js 调用 setClasses 同步内存里的职业列表
  var initialData = window.WOWPINBALL_DATA || window.WOWPINBALL_DEFAULT;
  setClasses(initialData && initialData.classes);
  var initial = (initialData && initialData.ui) || defaults();
  state.ui = normalize(initial);

  if (EDITOR) {
    // 编辑态由父窗口的 init 消息决定显示哪一屏；先给一个兜底
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initEditor);
    else initEditor();
  } else {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyAll);
    else applyAll();
    window.addEventListener('load', applyAll);
    // 切屏（hidden 变化）后重新应用一次，保证每个界面都带上自定义布局
    if (window.MutationObserver) {
      var t = null;
      new MutationObserver(function () {
        clearTimeout(t); t = setTimeout(applyAll, 60);
      }).observe(document.body, { attributes: true, attributeFilter: ['hidden'], subtree: true });
    }
  }
})();
