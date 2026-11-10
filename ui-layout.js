/* ---------------------------------------------------------
   UI 布局运行时（游戏端 + 后台共用）
   1) 正常游戏：把后台配置的「位置 / 尺寸 / PNG 素材 / 样式覆盖」应用到真实 DOM
   2) ?uiEditor=1：在 iframe 里铺一层可拖拽的选择框，与后台 postMessage 双向通信；
      拖动时自动吸附并画出垂直/水平对齐参考线（左/中/右、上/中/下）
   配置结构：ui = { enabled, screens: { <screenId>: { <key>: patch } } }
   patch = { dx, dy, w, h, img, fit, bgX, bgY, imgZoom, imgW, imgH, bg, opacity, radius, z, hide,
             文字排版：fs, fw, ff, fc, ta, va, lh, ls, it, nw, ts,
             盒模型：pt, pr, pb, pl, bw, bc, sh, zoom, rot, bwOff（隐藏元素自带 CSS 边框） }
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
    ['p2pBtn', '联机对战按钮', '#p2pBtn'],
    ['shopBtn', '商店按钮', '#shopBtn'],
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
      /* 画布图层（canvas）：不对应 DOM，只存素材与绘制参数，由 game.js 的
         drawAimArrow 读取后画在 canvas 上。位置跟着弹珠走，所以锁定不可拖。 */
      ['aimArrow', '瞄准箭头（画布）', '', 1, 0, '', 'canvas'],
      ['launchBtn', '发射按钮', '#launchBtn'], ['pHp', '我方血条', '#pHpBar'],
      ['eHp', '对手血条', '#eHpBar'], ['pSkills', '我方技能条', '#pSkills'],
      ['eSkills', '对手技能条', '#eSkills'],
      ['pBuffs', '我方状态图标栏', '#pBuffs'], ['eBuffs', '对手状态图标栏', '#eBuffs']
    ] },
    { id: 'result', name: '对战结算', kind: 'screen', root: '#resultScreen', items: [
      ['bg', '整页背景', 'body', 1], ['app', '内容容器', '.app', 1],
      ['card', '结算卡片', '.result-card'], ['kicker', '结果标签', '#resultKicker'],
      ['title', '结果标题', '#resultTitle'], ['desc', '结果说明', '#resultDesc'],
      ['review', '回合回顾', '#roundReview'], ['build', '构筑回顾', '#buildReview'],
      ['actions', '结算按钮行', '.result-actions'], ['rematchBtn', '再战按钮', '#rematchBtn'],
      ['logResultBtn', '战斗记录按钮', '#logResultBtn']
    ] },
    { id: 'room', name: '联机房间', kind: 'screen', root: '#roomScreen', items: [
      ['bg', '整页背景', 'body', 1], ['app', '内容容器', '.app', 1],
      ['shell', '房间主卡片', '#roomScreen .room-shell'],
      ['head', '房间标题区', '#roomScreen .room-head'],
      ['leaveBtn', '退出房间按钮', '#roomLeaveBtn'],
      ['codePanel', '邀请码面板', '.room-code-panel'],
      ['codeLabel', '邀请码标题', '.room-code-label'],
      ['code', '8 位邀请码', '#roomCode'],
      ['codeActions', '邀请码按钮行', '.room-code-actions'],
      ['copyBtn', '复制邀请码按钮', '#roomCopyBtn'],
      ['codeHint', '邀请码说明', '#roomCodeHint'],
      ['status', '房间状态条', '#roomStatus'],
      ['players', '双方卡片容器', '.room-players'],
      ['myCard', '我方案卡', '#roomMyCard'],
      ['peerCard', '对手方卡', '#roomPeerCard'],
      ['myNick', '我方昵称', '#roomMyNick'],
      ['peerNick', '对手昵称', '#roomPeerNick'],
      ['myClass', '我方职业', '#roomMyClass'],
      ['peerClass', '对手职业', '#roomPeerClass'],
      ['myReady', '我方准备徽标', '#roomMyReady'],
      ['peerReady', '对手准备徽标', '#roomPeerReady'],
      ['vs', 'VS 标识', '.room-vs'],
      ['classHead', '选职业标题', '.room-class-head'],
      ['classGrid', '职业网格', '#roomClassGrid'],
      ['classBtn', '首个职业按钮', '#roomClassGrid .room-class-btn'],
      ['footer', '房间底部操作栏', '.room-footer'],
      ['sharedHint', '共享状态提示', '#roomSharedHint'],
      ['readyBtn', '准备按钮', '#roomReadyBtn']
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
    { id: 'p2p', name: '弹层 · 联机房间入口', kind: 'modal', root: '#p2pModal', items: [
      ['mask', '弹层遮罩', '#p2pModal', 1],
      ['card', '弹层卡片', '#p2pModal .modal-card'],
      ['head', '标题栏', '#p2pModal .modal-head'],
      ['tip', '说明文字', '#p2pStageSel .p2p-tip'],
      ['choice', '创建/加入按钮行', '.p2p-choice'],
      ['createBtn', '创建房间按钮', '#p2pCreateBtn'],
      ['joinBtn', '加入房间按钮', '#p2pJoinBtn'],
      ['joinPanel', '加入房间面板', '#p2pStageJoin'],
      ['codeLabel', '邀请码输入标题', '#p2pStageJoin .share-code-head'],
      ['codeInput', '8 位码输入框', '#p2pRoomCodeIn'],
      ['acceptBtn', '加入确认按钮', '#p2pAcceptBtn'],
      ['joinMsg', '加入提示', '#p2pJoinMsg'],
      ['status', '连接状态行', '#p2pStatus']
    ] }
  ];

  var FITS = ['cover', 'contain', 'stretch', 'tile', 'center'];
  var ANCHORS = ['tail', 'center', 'head'];   // 画布素材的锚点：尾 / 中 / 头 对准弹珠中心
  var COLOR_RE = /^#[0-9a-fA-F]{6}$/;
  var EDITOR = /[?&]uiEditor=1/.test(window.location ? window.location.search : '');
  var W = 'WowPinballUI';

  /* ---------- 文字排版预设 ----------
     只暴露「键」给配置，真实 CSS 写死在这里：
     配置存档小、非法值进不来，也方便以后统一换字体栈。
     zoom / rot 属于盒子级微调，和文字排版放在同一组里一起用。 */
  var FONT_STACKS = {
    sys: '"Segoe UI","PingFang SC","Microsoft YaHei","Hiragino Sans GB",system-ui,sans-serif',
    serif: '"Songti SC","SimSun","Noto Serif SC",Georgia,"Times New Roman",serif',
    mono: 'ui-monospace,SFMono-Regular,Menlo,Consolas,"Courier New",monospace',
    round: '"Yuanti SC","YouYuan","Microsoft YaHei",system-ui,sans-serif',
    impact: '"Arial Black",Impact,"PingFang SC","Microsoft YaHei",sans-serif'
  };
  var FONT_KEYS = ['sys', 'serif', 'mono', 'round', 'impact'];
  var TAS = ['left', 'center', 'right', 'justify'];
  var VAS = ['top', 'middle', 'bottom'];
  var FWS = ['300', '400', '500', '600', '700', '800', '900'];
  var TSS = ['soft', 'strong', 'glow', 'stroke'];
  var SHS = ['soft', 'strong', 'inset'];
  var TA_FLEX = { left: 'flex-start', center: 'center', right: 'flex-end', justify: 'space-between' };
  var VA_FLEX = { top: 'flex-start', middle: 'center', bottom: 'flex-end' };
  // glow 用 currentColor：跟着文字颜色一起变，换色不用重设阴影
  var TEXT_SHADOWS = {
    soft: '0 1px 2px rgba(0,0,0,.45)',
    strong: '0 2px 6px rgba(0,0,0,.8),0 1px 0 rgba(0,0,0,.65)',
    glow: '0 0 10px currentColor'
  };
  var BOX_SHADOWS = {
    soft: '0 6px 18px rgba(0,0,0,.35)',
    strong: '0 12px 32px rgba(0,0,0,.62)',
    inset: 'inset 0 0 0 1px rgba(255,255,255,.08),inset 0 3px 12px rgba(0,0,0,.55)'
  };

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
    if (!it[2]) return [];   // 画布图层没有选择器，别让 querySelector('') 抛异常
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
            multi: !!it[4], group: it[5] || '', canvas: it[6] || '' };
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
        /* 素材可能是 PNG / WebP / JPEG 的 dataURL（上传端超预算时会用 WebP 压缩），
           统一按前缀正则判定，避免只认 PNG 把压缩后的图当成「没有素材」。 */
        cardKeys.forEach(function (k) {
          var p = src[k];
          if (!master && p && typeof p.img === 'string' &&
              /^data:image\/(png|webp|jpeg);base64,/.test(p.img)) { master = k; masterImg = p.img; }
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
        keep('imgZoom', 10, 300);
        /* 精确宽高（px）：0 = 不指定，所以不能直接用 keep 的下限做钳制（0 会被夹成下限），单独判。
           下限 8px 与渲染端一致：更小的值不落盘，历史坏配置（如 imgH=1）读入时自动回退百分比。 */
        var _iw = num(p.imgW, 0, 4000); if (_iw !== null && _iw >= 8) q.imgW = _iw;
        var _ih = num(p.imgH, 0, 4000); if (_ih !== null && _ih >= 8) q.imgH = _ih;
        // 文字排版
        keep('fs', 4, 200); keep('lh', 0.5, 5); keep('ls', -20, 60);
        // 盒模型与微调
        keep('pt', 0, 300); keep('pr', 0, 300); keep('pb', 0, 300); keep('pl', 0, 300);
        keep('bw', 0, 20); keep('zoom', 20, 400); keep('rot', -180, 180);
        if (FONT_KEYS.indexOf(p.ff) >= 0) q.ff = p.ff;
        if (FWS.indexOf(String(p.fw)) >= 0) q.fw = String(p.fw);
        if (TAS.indexOf(p.ta) >= 0) q.ta = p.ta;
        if (VAS.indexOf(p.va) >= 0) q.va = p.va;
        if (TSS.indexOf(p.ts) >= 0) q.ts = p.ts;
        if (SHS.indexOf(p.sh) >= 0) q.sh = p.sh;
        if (typeof p.fc === 'string' && COLOR_RE.test(p.fc)) q.fc = p.fc;
        if (typeof p.bc === 'string' && COLOR_RE.test(p.bc)) q.bc = p.bc;
        if (p.it === true) q.it = true;
        if (p.nw === true) q.nw = true;
        if (p.fsu === true) q.fsu = true;
        if (p.hideText === true) q.hideText = true;
        if (p.bwOff === true) q.bwOff = true;
        /* 单张素材上限 2.6M 字符（≈1.9 MB 二进制）：上传端硬上限 1.5 MB，这里留足余量；
           PNG / WebP / JPEG 都接受，不再只认 PNG（超预算的素材会被压成 WebP）。 */
        if (typeof p.img === 'string' && /^data:image\/(png|webp|jpeg);base64,/.test(p.img) &&
            p.img.length < 2600000) q.img = p.img;
        if (FITS.indexOf(p.fit) >= 0) q.fit = p.fit;
        if (typeof p.bg === 'string' && COLOR_RE.test(p.bg)) q.bg = p.bg;
        if (p.hide === true) q.hide = true;
        if (typeof p.ref === 'string' && /^card_[A-Za-z0-9_-]{1,40}$/.test(p.ref) && p.ref !== it[0]) q.ref = p.ref;
        /* 画布图层（例如瞄准箭头）：没有 DOM，位置由游戏逻辑决定，
           除通用字段（img / rot / opacity / hide）外还要保留这几个绘制参数。 */
        if (it[6] === 'canvas') {
          keep('len', 8, 800); keep('thick', 0, 300);
          if (ANCHORS.indexOf(p.anchor) >= 0) q.anchor = p.anchor;
          if (typeof p.tint === 'string' && COLOR_RE.test(p.tint)) q.tint = p.tint;
        }
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

  /* ---------- 层级权重：让 z 真正跨容器比较 ----------
     z-index 只在最近的堆叠上下文内比较，且会被祖先的 overflow 裁剪。
     例如「倒计时」在 .arena-wrap 里，.arena-wrap 有 overflow:hidden 又是定位元素，
     把倒计时拖到回合面板上方时，子元素再高的 z 也出不来（直接被裁掉）。
     所以显式设了层级权重（z > 0）时，同步沿祖先链：
       · 解除 overflow 裁剪（不解除就永远看不见）；
       · 补 position/z-index，让整条链抬到目标高度。
     原值逐项记录，改回 0 / 清空时按记录还原，不影响游戏自己的样式。
     引用计数用于「多个图层共用同一个祖先」的情况，避免先恢复的那个把别人也放下去。 */
  function releaseBoost(el) {
    var list = el.__wowBoostList || [];
    for (var i = 0; i < list.length; i++) {
      var node = list[i], rec = node.__wowBoost;
      if (!rec) continue;
      rec.n = (rec.n || 1) - 1;
      if (rec.n > 0) continue;
      Object.keys(rec.props).forEach(function (k) { node.style[k] = rec.props[k]; });
      delete node.__wowBoost;
    }
    el.__wowBoostList = null;
  }
  function boostSet(rec, node, prop, value) {
    if (!Object.prototype.hasOwnProperty.call(rec.props, prop)) rec.props[prop] = node.style[prop];
    node.style[prop] = value;
  }
  /* 元素被拖出某个会裁剪的祖先时，必须解除该祖先的 overflow，否则元素等于被删掉。
     lift=true（层级权重 > 0）时额外补 position/z-index，让整条祖先链抬到目标高度。
     两件事分开判断：只移动不提层级，也应当看得见。 */
  function boostAncestors(el, z, lift) {
    // 元素当前矩形（已含拖拽产生的 transform）。只有真的越出某个祖先时才需要解除它的裁剪，
    // 否则会把圆角之类的裁剪属性一并放开，视觉上白改。
    var er = el.getBoundingClientRect();
    var list = [], node = el.parentNode;
    while (node && node.nodeType === 1 && node !== document.body && node !== document.documentElement) {
      var cs = window.getComputedStyle(node);
      var changes = [];
      var crop = cs.overflow !== 'visible' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible';
      if (crop) {
        var nr = node.getBoundingClientRect();
        var spill = er.left < nr.left - 0.5 || er.top < nr.top - 0.5 ||
          er.right > nr.right + 0.5 || er.bottom > nr.bottom + 0.5;
        if (spill) changes.push(['overflow', 'visible']);
      }
      if (lift) {
        var zc = parseInt(cs.zIndex, 10);
        if (cs.position === 'static') changes.push(['position', 'relative']);
        changes.push(['zIndex', String(isFinite(zc) ? Math.max(zc, z) : z)]);
      }
      if (changes.length) {
        var rec = node.__wowBoost;
        if (!rec) rec = node.__wowBoost = { props: {}, n: 0 };
        for (var c = 0; c < changes.length; c++) boostSet(rec, node, changes[c][0], changes[c][1]);
        rec.n += 1;
        list.push(node);
      }
      node = node.parentNode;
    }
    el.__wowBoostList = list;
  }

  function applyPatch(el, p, lock) {
    var prev = el[OWN] || {};
    Object.keys(prev).forEach(function (k) { el.style[k] = prev[k]; });
    var own = {};
    function set(prop, value) {
      if (!Object.prototype.hasOwnProperty.call(own, prop)) own[prop] = el.style[prop];
      el.style[prop] = value;
    }
    el[OWN] = own;
    releaseBoost(el);   // 祖先提权每次都按当前 z 重算，先还原再决定是否重新抬升
    // 图层上传了图片：隐藏其装饰性子元素（如品牌图标里的手绘圆点），避免遮挡素材
    if (p && p.img) el.classList.add('__hasImg'); else el.classList.remove('__hasImg');
    // 子级字号统一：内部写死 px 的后缀 / 数字也跟着外层字号走（纯 CSS 类，去掉即还原）
    if (p && p.fsu === true) el.classList.add('__wowFsUniform'); else el.classList.remove('__wowFsUniform');
    if (!p) return;

    var dx = num(p.dx, -2000, 2000) || 0, dy = num(p.dy, -2000, 2000) || 0;
    var rot = num(p.rot, -180, 180) || 0;
    if (!lock) {
      // 位移与旋转共用 transform，必须一次拼好，否则后写的会覆盖前面的
      var tf = [];
      if (dx || dy) tf.push('translate(' + dx + 'px,' + dy + 'px)');
      if (rot) tf.push('rotate(' + rot + 'deg)');
      if (tf.length) set('transform', tf.join(' '));
      var w = num(p.w, 8, 4000), h = num(p.h, 8, 4000);
      if (w !== null || h !== null) set('boxSizing', 'border-box');
      if (w !== null) set('width', w + 'px');
      if (h !== null) set('height', h + 'px');
    }
    // 整体缩放：连同内边距、边框、子元素一起放大，适合「一整个模块都变大」
    var zm = num(p.zoom, 20, 400);
    if (zm !== null && zm !== 100) set('zoom', String(zm / 100));
    if (p.img) {
      set('backgroundImage', 'url("' + p.img + '")');
      var fit = p.fit || 'cover';
      var iz = num(p.imgZoom, 10, 300);
      /* 精确宽高（px）：0 = 不指定。任一边填了就按 px 渲染，优先级高于百分比与填充方式，
         因为「精准尺寸」是最明确的意图；只填一边、另一边写 auto 以保持原图长宽比；
         tile 仍保持平铺（把这组尺寸当成一块瓷砖）。
         下限 8px：1~7px 会把图压成一条线（视觉上等于素材消失），这类值一律按「不指定」
         处理，让配置回退到百分比 / 填充方式，避免调参时把素材「调没」。 */
      var iw = num(p.imgW, 0, 4000), ih = num(p.imgH, 0, 4000);
      if (iw !== null && iw < 8) iw = null;
      if (ih !== null && ih < 8) ih = null;
      if (iw !== null || ih !== null) {
        set('backgroundSize', (iw !== null ? iw + 'px' : 'auto') + ' ' + (ih !== null ? ih + 'px' : 'auto'));
        set('backgroundRepeat', fit === 'tile' ? 'repeat' : 'no-repeat');
      }
      else if (fit === 'stretch') { set('backgroundSize', '100% 100%'); set('backgroundRepeat', 'no-repeat'); }
      else if (fit === 'tile') { set('backgroundSize', 'auto'); set('backgroundRepeat', 'repeat'); }
      // 图片尺寸 %：单值百分比 = 宽度按 iz% 渲染、高度 auto（保持原图长宽比），与 bgX/bgY 取景配合
      else if (iz !== null && iz !== 100) { set('backgroundSize', iz + '%'); set('backgroundRepeat', 'no-repeat'); }
      else if (fit === 'contain') { set('backgroundSize', 'contain'); set('backgroundRepeat', 'no-repeat'); }
      else if (fit === 'center') { set('backgroundSize', 'auto'); set('backgroundRepeat', 'no-repeat'); }
      else { set('backgroundSize', 'cover'); set('backgroundRepeat', 'no-repeat'); }
      set('backgroundPosition', (num(p.bgX, 0, 100) === null ? 50 : num(p.bgX, 0, 100)) + '% ' +
        (num(p.bgY, 0, 100) === null ? 50 : num(p.bgY, 0, 100)) + '%');
    }
    if (p.bg) set('backgroundColor', p.bg);
    /* ---------- 文字排版 ----------
       字号 / 字重 / 字体 / 颜色 / 行距 / 字距 / 斜体 / 不换行 / 阴影。
       只写本元素：子元素没单独设字号时会自然继承；设了固定 px 的子元素
       要一起变，用「整体缩放」而不是字号。 */
    var fs = num(p.fs, 4, 200);
    if (fs !== null) set('fontSize', fs + 'px');
    if (p.fw) set('fontWeight', p.fw);
    if (p.ff && FONT_STACKS[p.ff]) set('fontFamily', FONT_STACKS[p.ff]);
    if (p.fc) set('color', p.fc);
    if (p.it === true) set('fontStyle', 'italic');
    if (p.nw === true) set('whiteSpace', 'nowrap');
    var lh = num(p.lh, 0.5, 5);
    if (lh !== null) set('lineHeight', String(lh));
    var ls = num(p.ls, -20, 60);
    if (ls !== null) set('letterSpacing', ls + 'px');
    if (p.ts === 'stroke') set('webkitTextStroke', '1.2px rgba(0,0,0,.85)');
    else if (p.ts && TEXT_SHADOWS[p.ts]) set('textShadow', TEXT_SHADOWS[p.ts]);
    /* 对齐要按当前布局选对属性：
       flex / grid 的「居中」靠 justify-content / align-items，text-align 只管文字行内；
       普通块只能 text-align，垂直方向要先转成 flex 行（只在用户显式选择时做，
       且锁定元素不转，避免把 body / .app 的整页布局改成 flex）。 */
    if (p.ta || p.va) {
      var cs = getComputedStyle(el);
      var disp = cs.display || '';
      var flexish = disp.indexOf('flex') >= 0, gridish = disp.indexOf('grid') >= 0;
      var col = /column/.test(cs.flexDirection || '');
      if (p.va && !flexish && !gridish && !lock) {
        flexish = true; col = false;
        set('display', 'flex'); set('flexWrap', 'wrap');
      }
      if (p.ta) {
        set('textAlign', p.ta);
        if (flexish) set(col ? 'alignItems' : 'justifyContent', TA_FLEX[p.ta]);
        else if (gridish) set('justifyItems', TA_FLEX[p.ta]);
      }
      if (p.va) {
        if (flexish) set(col ? 'justifyContent' : 'alignItems', VA_FLEX[p.va]);
        else if (gridish) set('alignItems', VA_FLEX[p.va]);
      }
    }
    /* ---------- 盒模型：内边距 / 边框 / 阴影 ---------- */
    [['pt', 'paddingTop'], ['pr', 'paddingRight'], ['pb', 'paddingBottom'], ['pl', 'paddingLeft']]
      .forEach(function (pair) {
        var v = num(p[pair[0]], 0, 300);
        if (v !== null) set(pair[1], v + 'px');
      });
    var bw = num(p.bw, 0, 20);
    if (bw !== null && bw > 0) {
      set('borderStyle', 'solid');
      set('borderWidth', bw + 'px');
      set('borderColor', p.bc || '#2b3648');
    } else if (p.bwOff === true) {
      /* 原边框隐藏：按钮自带的描边写在 styles.css 的 .ghost-btn / .primary-btn 里
         （border:1px solid …），不是内联样式，所以 bw=0 清不掉它。
         这里显式写 borderStyle:none 覆盖掉 CSS 描边；用户又给了自定义边框粗细时
         以自定义为准（上面的分支优先），避免「勾了隐藏又设了粗细」互相打架。 */
      set('borderStyle', 'none');
    } else if (p.bc) set('borderColor', p.bc);
    if (p.sh && BOX_SHADOWS[p.sh]) set('boxShadow', BOX_SHADOWS[p.sh]);
    var op = num(p.opacity, 0, 1), rad = num(p.radius, 0, 200), z = num(p.z, -50, 999);
    if (op !== null && op !== 1) set('opacity', String(op));
    if (rad !== null) set('borderRadius', rad + 'px');
    var lift = z !== null && z > 0;   // 正层级才需要把祖先一起抬起来
    if (z !== null) {
      if (getComputedStyle(el).position === 'static') set('position', 'relative');
      set('zIndex', String(z));
    }
    // 只要挪过位置 / 转过角度 / 设过正层级，就检查是否被祖先裁剪（单纯拖出容器也必须看得见）
    if ((lift || (!lock && (dx || dy || rot))) && p.hide !== true) boostAncestors(el, z || 0, lift);
    /* ---------- 隐藏文字内容 ----------
       按钮换成 PNG 图片素材后，原来的文字还叠在图上面很碍眼。
       把文字颜色透明 + 去掉文字阴影，元素与子元素的文本立刻不可见，
       但保留布局尺寸（按钮仍按原尺寸显示背景图，不会塌成一条线）。
       放在所有文字排版之后、隐藏元素之前，确保「显示文字颜色」被它覆盖，关掉又能还原。 */
    if (p.hideText === true) {
      set('color', 'transparent');
      set('textShadow', 'none');
      set('webkitTextStroke', '0');
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
  /* 层级提权在 applyAll 的第二遍统一处理（见下），这里保留单元素入口供编辑器用 */
  function boostOne(screenId, key) {
    var els = elsOf(screenId, key); if (!els.length) return;
    var p = patchOf(screenId, key); if (!p || p.hide === true) return;
    var it = itemOf(screenId, key), lock = !!(it && it[3]);
    var z = num(p.z, -50, 999), lift = z !== null && z > 0;
    // 锁定项没有位移（applyPatch 里跳过 transform），只有层级会生效
    var dx = lock ? 0 : (num(p.dx, -2000, 2000) || 0), dy = lock ? 0 : (num(p.dy, -2000, 2000) || 0);
    if (!lift && !dx && !dy) return;
    els.forEach(function (el) { releaseBoost(el); boostAncestors(el, z || 0, lift); });
  }
  function applyAll() {
    if (state.applying) return;
    state.applying = true;
    try {
      /* body / .app / #arena 这类元素在多个界面里重复登记（整页背景、内容容器…）。
         以前按界面逐个 applyPatch，后一个界面的空配置会把前一个刚写好的样式还原掉，
         表现为「首页设的整页背景，切到对战就没了」。
         这里先把命中同一元素的 patch 合并（后写的字段覆盖先写的），每个元素只写一次。 */
      var order = [], seen = [];
      function groupOf(el, lock) {
        var i = seen.indexOf(el);
        if (i >= 0) { if (lock) order[i].lock = true; return order[i]; }
        seen.push(el);
        var g = { el: el, lock: !!lock, p: null };
        order.push(g);
        return g;
      }
      SCREENS.forEach(function (s) {
        s.items.forEach(function (it) {
          var els = elsOf(s.id, it[0]);
          if (!els.length) return;
          var p = patchOf(s.id, it[0]);
          els.forEach(function (el) {
            var g = groupOf(el, it[3]);
            if (!p) return;
            if (!g.p) g.p = {};
            Object.keys(p).forEach(function (k) { g.p[k] = p[k]; });
          });
        });
      });
      order.forEach(function (g) { applyPatch(g.el, g.p, g.lock); });
      /* 层级提权单独一遍：applyPatch 会逐个重写元素内联样式，
         若「被另一个高图层托起来的祖先」排在它后面，它自己的 applyPatch 会把 z 改回原值。
         所以全部应用完再统一做一次提权，保证顺序无关。 */
      order.forEach(function (g) {
        var p = g.p;
        if (!p || p.hide === true) return;
        var z = num(p.z, -50, 999), lift = z !== null && z > 0;
        var dx = g.lock ? 0 : (num(p.dx, -2000, 2000) || 0), dy = g.lock ? 0 : (num(p.dy, -2000, 2000) || 0);
        var rot = g.lock ? 0 : (num(p.rot, -180, 180) || 0);
        if (!lift && !dx && !dy && !rot) return;
        releaseBoost(g.el); boostAncestors(g.el, z || 0, lift);
      });
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
  var FORCE_VISIBLE = ['#banner', '#aimOverlay', '#asyncTag', '#shopResult',
    '#nameMsg', '#nameCancelBtn', '#closeNameBtn',
    /* 联机弹层的加入面板与提示默认 hidden，编辑态强制展开才能改素材 */
    '#p2pStageJoin', '#p2pJoinMsg'];
  // 编辑态下没开局的动态容器是空的，补占位内容后才能被选中、拖拽、换素材
  var SAMPLE_FILL = [
    ['#draftCards', 3, 'draft-card', '技能示例'],
    ['#battleLog', 6, 'log-line', '战斗记录示例'],
    ['#roundReview', 3, 'rr-item', '第 N 回合'],
    ['#buildReview', 2, 'build-col', '构筑回顾'],
    ['#pSkills', 2, 'mini-skill', '技能'],
    ['#eSkills', 2, 'mini-skill', '技能'],
    ['#pBuffs', 3, 'buff-chip', '状态'],
    ['#eBuffs', 3, 'buff-chip', '状态'],
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
      /* 未选中：不画任何边缘线，只留一块透明命中区，点击仍可选中元素 */
      '.ue-box{position:absolute;pointer-events:auto;box-sizing:border-box;border:1px dashed transparent;',
      'background:transparent;cursor:move;transition:border-color .12s,background .12s}',
      '.ue-box .ue-tag,.ue-box .ue-h{visibility:hidden}',
      /* 悬停：一条淡虚线 + 名称标签做定位提示，仍不出现手柄 */
      '.ue-box:not(.on):hover{border-color:rgba(217,164,65,.55);background:rgba(217,164,65,.04)}',
      '.ue-box:not(.on):hover .ue-tag{visibility:visible}',
      /* 选中：才显示完整边缘线、名称标签与 8 个缩放手柄 */
      '.ue-box.on{border:2px solid #ffd479;background:rgba(217,164,65,.13);box-shadow:0 0 0 1px #0008,0 0 18px #d9a44155}',
      '.ue-box.on .ue-tag,.ue-box.on .ue-h{visibility:visible}',
      '.ue-tag{position:absolute;left:0;top:-19px;height:18px;line-height:18px;padding:0 7px;white-space:nowrap;',
      'font-size:10px;color:#0d1117;background:#d9a441;border-radius:4px 4px 0 0;cursor:pointer}',
      '.ue-box.on .ue-tag{background:#ffd479}',
      '.ue-h{position:absolute;width:10px;height:10px;background:#ffd479;border:1px solid #6b4b12;border-radius:2px;pointer-events:auto}',
      '.ue-h[data-d="nw"]{left:-6px;top:-6px;cursor:nwse-resize}.ue-h[data-d="n"]{left:50%;top:-6px;margin-left:-5px;cursor:ns-resize}',
      '.ue-h[data-d="ne"]{right:-6px;top:-6px;cursor:nesw-resize}.ue-h[data-d="e"]{right:-6px;top:50%;margin-top:-5px;cursor:ew-resize}',
      '.ue-h[data-d="se"]{right:-6px;bottom:-6px;cursor:nwse-resize}.ue-h[data-d="s"]{left:50%;bottom:-6px;margin-left:-5px;cursor:ns-resize}',
      '.ue-h[data-d="sw"]{left:-6px;bottom:-6px;cursor:nesw-resize}.ue-h[data-d="w"]{left:-6px;top:50%;margin-top:-5px;cursor:ew-resize}',
      /* 对齐参考线：拖拽时与其它元素的边/中线重合，1px 洋红线贯穿整屏 */
      '.ue-guide{position:absolute;pointer-events:none;display:none;background:#ff5da2;z-index:3;box-shadow:0 0 5px rgba(255,93,162,.55)}',
      '.ue-guide-v{width:1px;top:0;height:100%}',
      '.ue-guide-h{height:1px;left:0;width:100%}',
      'body.ui-edit-mode .modal:not([hidden]){display:flex}'
      /* 职业卡同样走通用规则：9 张卡未选中时不再铺满虚线框与黄色手柄 */
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

    /* ---------- 对齐参考线（拖动吸附） ----------
       拖动位置时，把当前元素的 左/中/右 与同屏其它元素的 左/中/右 比对（纵轴同理），
       差距小于 SNAP 像素就吸附过去并画一条洋红参考线。
       目标线在 pointerdown 时缓存一次：拖动期间其它元素不会动，每帧重算纯属浪费，
       而且动态内容（金币数字）变化会让线来回跳。 */
    var SNAP = 6;
    function snapTargets(s, excludeKey) {
      var xs = [], ys = [];
      s.items.forEach(function (it) {
        if (it[0] === excludeKey || it[3]) return;      // 跳过自己与锁定项
        var el = elOf(s.id, it[0]); if (!el) return;
        var r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return;        // 隐藏元素没有参考价值
        xs.push(r.left, r.left + r.width / 2, r.right);
        ys.push(r.top, r.top + r.height / 2, r.bottom);
      });
      // 屏幕容器本身的边与中线（适用于把元素贴齐版心 / 水平居中）
      var root = document.querySelector(s.root);
      if (root) {
        var rr = root.getBoundingClientRect();
        xs.push(rr.left, rr.left + rr.width / 2, rr.right);
        ys.push(rr.top, rr.top + rr.height / 2, rr.bottom);
      }
      // 视口中线：整页垂直/水平居中最常用
      xs.push(window.innerWidth / 2);
      ys.push(window.innerHeight / 2);
      return { xs: xs, ys: ys };
    }
    /* 三条候选边里挑最近的一条。返回 { at: 目标线坐标, dist: 还要补多少位移 } */
    function snapAxis(edges, lines) {
      var best = null, bestAbs = SNAP;
      for (var i = 0; i < edges.length; i++) {
        for (var j = 0; j < lines.length; j++) {
          var d = lines[j] - edges[i], a = Math.abs(d);
          if (a <= bestAbs) { bestAbs = a; best = { at: lines[j], dist: d }; }
        }
      }
      return best;
    }
    var gv = null, gh = null;
    function guide(axis) {
      if (!gv) {
        gv = document.createElement('div'); gv.className = 'ue-guide ue-guide-v'; layer.appendChild(gv);
        gh = document.createElement('div'); gh.className = 'ue-guide ue-guide-h'; layer.appendChild(gh);
      }
      return axis === 'x' ? gv : gh;
    }
    function showGuide(axis, at) {
      var g = guide(axis);
      g.style.display = 'block';
      if (axis === 'x') g.style.left = Math.round(at) + 'px'; else g.style.top = Math.round(at) + 'px';
    }
    function hideGuide(axis) { if (gv) guide(axis).style.display = 'none'; }
    function hideGuides() { if (gv) { gv.style.display = 'none'; gh.style.display = 'none'; } }

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
      hideGuides();
      drag = {
        key: key, el: el, dir: handle ? handle.dataset.d : 'move',
        x0: ev.clientX, y0: ev.clientY,
        dx0: num(eff.dx, -2000, 2000) || 0, dy0: num(eff.dy, -2000, 2000) || 0,
        w0: num(eff.w, 8, 4000) || r.width, h0: num(eff.h, 8, 4000) || r.height,
        // 拖动位置才吸附；缩放（拖手柄）不参与，避免尺寸与位移互相打架
        r0: r, snap: handle ? null : snapTargets(currentScreen(), key),
        base: Object.assign({}, eff), own: Object.assign({}, own)
      };
      ev.preventDefault(); ev.stopPropagation();
    });

    window.addEventListener('pointermove', function (ev) {
      if (!drag) return;
      var mx = ev.clientX - drag.x0, my = ev.clientY - drag.y0;
      var p = Object.assign({}, drag.base), d = drag.dir;
      if (d === 'move') {
        var tdx = drag.dx0 + mx, tdy = drag.dy0 + my;
        /* 吸附：按「拖动后的矩形」算左/中/右与上/中/下，命中则把位移补到目标线上 */
        if (drag.snap) {
          var r0 = drag.r0, w0 = r0.width, h0 = r0.height;
          var L = r0.left + (tdx - drag.dx0), T = r0.top + (tdy - drag.dy0);
          var sx = snapAxis([L, L + w0 / 2, L + w0], drag.snap.xs);
          var sy = snapAxis([T, T + h0 / 2, T + h0], drag.snap.ys);
          if (sx) { tdx += sx.dist; showGuide('x', sx.at); } else hideGuide('x');
          if (sy) { tdy += sy.dist; showGuide('y', sy.at); } else hideGuide('y');
        }
        p.dx = Math.round(tdx); p.dy = Math.round(tdy);
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
      hideGuides();
    });
    window.addEventListener('pointercancel', function () { drag = null; hideGuides(); });

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
      } else if (d.type === 'screen') { showScreen(d.screen); state.key = null; hideGuides(); drawBoxes(); }
      else if (d.type === 'select') { hideGuides(); select(d.key, false); }
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

  /* ---------- 画布素材缓存 ----------
     瞄准箭头这类「画在 canvas 上」的图层不是 DOM，取不到元素背景，
     游戏端每帧都要拿贴图。按 src 缓存解码结果，未就绪时返回 null，
     调用方下一帧再取（游戏主循环本来就在跑，不需要额外重绘逻辑）。 */
  var IMGCACHE = {};
  function imageOf(src) {
    if (typeof src !== 'string' || !src) return null;
    var rec = IMGCACHE[src];
    if (!rec) {
      rec = IMGCACHE[src] = { img: new Image(), ok: false };
      rec.img.onload = function () { rec.ok = true; };
      rec.img.onerror = function () { rec.ok = false; };
      rec.img.src = src;
      if (rec.img.complete && rec.img.naturalWidth > 0) rec.ok = true;
    }
    return rec.ok ? rec.img : null;
  }
  function canvasPatch(screenId, key) { return patchOf(screenId, key) || {}; }

  /* ---------- 瞄准箭头绘制（游戏端 + 后台预览共用同一份实现） ----------
     patch 来自「瞄准箭头（画布）」图层：
       img    PNG 素材（约定朝右 +x）
       len    箭头长度 px（沿瞄准方向）
       thick  素材厚度 px（0 = 按原图比例）
       anchor 尾 / 中 / 头 哪一端对准弹珠中心
       rot    素材朝向偏移（度）
       tint   颜色（素材模式忽略，程序化箭头用它上色）
       opacity / hide 通用
     没有 img 时退回程序化箭头，外观与改造前一致（默认长度 84 / 颜色 #7cc4ff）。 */
  function hexA(hex, a) {
    var h = String(hex || '').replace('#', '');
    if (h.length !== 6) return 'rgba(124,196,255,' + a + ')';
    return 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' +
      parseInt(h.slice(4, 6), 16) + ',' + a + ')';
  }
  function drawAim(ctx, x, y, angle, patch, ballR) {
    var p = patch || {};
    if (p.hide === true) return;
    var nLen = parseFloat(p.len), nThick = parseFloat(p.thick);
    var L = isFinite(nLen) && nLen > 0 ? Math.max(8, Math.min(800, nLen)) : 84;
    var alpha = (typeof p.opacity === 'number' && isFinite(p.opacity)) ? Math.max(0, Math.min(1, p.opacity)) : 1;
    var col = (typeof p.tint === 'string' && /^#[0-9a-fA-F]{6}$/.test(p.tint)) ? p.tint : '#7cc4ff';
    var sprite = p.img ? imageOf(p.img) : null;
    var a = angle || 0;

    if (sprite) {
      var sw = sprite.naturalWidth || 1, sh = sprite.naturalHeight || 1;
      var w = L, h = (isFinite(nThick) && nThick > 0) ? nThick : Math.max(3, w * sh / sw);
      var anchor = (p.anchor === 'center' || p.anchor === 'head') ? p.anchor : 'tail';
      var ox = anchor === 'center' ? -w / 2 : (anchor === 'head' ? -w : 0);
      var rot = (parseFloat(p.rot) || 0) * Math.PI / 180;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x, y);
      ctx.rotate(a + rot);
      ctx.drawImage(sprite, ox, -h / 2, w, h);
      ctx.restore();
      return;
    }

    var ex = x + Math.cos(a) * L, ey = y + Math.sin(a) * L;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.setLineDash([5, 6]);
    ctx.strokeStyle = hexA(col, 0.5); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
    var ah = Math.max(7, Math.min(22, L * 0.155));
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - Math.cos(a - 0.42) * ah, ey - Math.sin(a - 0.42) * ah);
    ctx.lineTo(ex - Math.cos(a + 0.42) * ah, ey - Math.sin(a + 0.42) * ah);
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(ex, ey, Math.max(4, Math.min(13, L * 0.095)), 0, Math.PI * 2); ctx.fill();
    if (ballR > 0) {
      var t = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
      ctx.strokeStyle = hexA(col, 0.55); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, ballR + 6 + Math.sin(t * 4) * 3, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  var api = {
    schema: publicSchema, screens: SCREENS, normalize: normalize, defaults: defaults,
    apply: applyAll, applyOne: applyOne, setUi: setUi, setPatch: setPatch,
    showScreen: showScreen, patchOf: patchOf, rawPatchOf: rawPatchOf, elOf: elOf, itemOf: itemOf,
    setClasses: setClasses, classList: classList, isEditor: EDITOR, state: state,
    // 画布图层（瞄准箭头）用：素材解码缓存 + 取某一层的绘制参数 + 共用绘制函数
    image: imageOf, canvasPatch: canvasPatch, drawAim: drawAim, hexA: hexA,
    // 给后台属性面板用的排版预设（键 -> CSS 由本模块统一维护）
    FONTS: FONT_STACKS, FONT_KEYS: FONT_KEYS, ALIGNS: TAS, VALIGNS: VAS, WEIGHTS: FWS,
    TEXT_SHADOWS: TSS, BOX_SHADOWS: SHS, ANCHORS: ANCHORS
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
