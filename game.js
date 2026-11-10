/* =============================================================
   选技弹珠 · 三回合对撞
   数据驱动：CLASSES 职业表 / SKILLS 技能表 / CONFIG 手感参数
   ============================================================= */
(function () {
  'use strict';

  /* ---------------------------------------------------------
     1. 配置
     --------------------------------------------------------- */
  /* 共享配置层：game-data.js 提供默认值，config-loader.js 注入后台保存的覆盖配置 */
  /* 预览模式：后台「实时编排」工作台会把编辑中的配置写入专用键，引擎只读它，避免与正式存档互扰 */
  const PREVIEW = /[?&]preview=1/.test(location.search);
  const UI_EDITOR = /[?&]uiEditor=1/.test(location.search);   // 后台界面编辑器 iframe：不打扰预览
  const PREVIEW_KEY = 'wowpinball.preview.v1';
  const RAW =
    (PREVIEW && (function () { try { return JSON.parse(localStorage.getItem(PREVIEW_KEY)); } catch (e) { return null; } })())
    || window.WOWPINBALL_DATA || window.WOWPINBALL_DEFAULT;
  const DATA = RAW;
  const MAP_LIST = DATA.maps.filter(m => m.enabled !== false);
  const MAP = MAP_LIST.find(m => m.id === DATA.activeMapId) || MAP_LIST[0] || null;
  const C = DATA.config;

  /* 对局天气配置：只保留启用且有权重的类型，数值全部兜底，旧存档缺字段也能跑 */
  const WEATHER_CFG = (function () {
    const w = (DATA.weather && typeof DATA.weather === 'object') ? DATA.weather : {};
    const all = Array.isArray(w.types) ? w.types : [];
    const num = (v, d) => { const n = Number(v); return isFinite(n) ? n : d; };
    const types = all
      .filter(t => t && t.id && t.enabled !== false && num(t.weight, 0) > 0)
      .map(t => ({
        id: t.id,
        name: t.name || t.id,
        weight: num(t.weight, 1),
        forceMin: Math.max(0, num(t.forceMin, 30)),
        forceMax: Math.max(0, num(t.forceMax, 70)),
        sway: Math.max(0, num(t.sway, 0.45)),
        slip: Math.max(0, num(t.slip, 0.12)),
        rainForce: Math.max(0, num(t.rainForce, 0))
      }));
    return {
      enabled: w.enabled !== false && types.length > 0,
      noneWeight: Math.max(0, num(w.noneWeight, 5)),
      types: types
    };
  })();

  const CONFIG = {
    ARENA_W: MAP ? MAP.width : C.arenaW,
    ARENA_H: MAP ? MAP.height : C.arenaH,
    ROUND_SECONDS: C.roundSeconds,
    TOTAL_ROUNDS: C.totalRounds,
    LAUNCH_SPEED: C.launchSpeed != null ? C.launchSpeed : 250,   // 初始发射速度（玩家选定方向）
    COLLISION_BOOST: C.collisionBoost != null ? C.collisionBoost : 1.14, // 碰撞后加速反弹倍率
    MAX_SPEED: C.maxSpeed,             // 速度上限
    RESTITUTION: C.restitution != null ? C.restitution : 1.0,    // 弹珠互撞弹性
    WALL_RESTITUTION: C.wallRestitution != null ? C.wallRestitution : 1.0, // 边界反弹弹性（=1 力不衰减）
    IMPACT_CD: C.impactCd,             // 撞击结算冷却
    MIN_IMPACT: C.minImpact,
    DRAW_WINDOW: C.drawWindow,
    HIT_STOP_MS: C.hitStopMs,
    DMG_BASE: C.dmgBase,               // 撞击基础比例伤害
    DMG_SPEED: C.dmgSpeed,             // 速度附加比例伤害
    CRIT_BASE: C.critBase,
    CRIT_MULT_BASE: C.critMultBase,
    DRAFT_OPTIONS: C.draftOptions,
    MAX_SKILLS: C.maxSkills != null ? C.maxSkills : 9,   // 拥有的技能最大数量（封顶后超出回合不再弹技能选项）
    CLASS_SKILL_WEIGHT: C.classSkillWeight
  };
  const SPEEDS = C.speeds && C.speeds.length ? C.speeds : [1, 2, 4];

  /* 当前生效的活动效果（多个活动可叠加） */
  const EFFECTS = (function () {
    const eff = {
      dmgScale: 1, hpScale: 1,
      tierMul: { common: 1, rare: 1, epic: 1 },
      extraDraft: 0, skillBan: [], skillBoost: [], names: []
    };
    const d = new Date();
    const pad = n => (n < 10 ? '0' : '') + n;
    const today = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    (DATA.events || []).forEach(ev => {
      if (ev.enabled === false) return;
      if (!ev.alwaysOn) {
        if (ev.start && today < ev.start) return;
        if (ev.end && today > ev.end) return;
      }
      const f = ev.effects || {};
      eff.dmgScale *= f.dmgScale == null ? 1 : f.dmgScale;
      eff.hpScale *= f.hpScale == null ? 1 : f.hpScale;
      ['common', 'rare', 'epic'].forEach(t => {
        const v = f.tierMul && f.tierMul[t];
        if (v) eff.tierMul[t] *= v;
      });
      eff.extraDraft += f.extraDraft || 0;
      eff.skillBan = eff.skillBan.concat(f.skillBan || []);
      eff.skillBoost = eff.skillBoost.concat(f.skillBoost || []);
      eff.names.push(ev.name);
    });
    return eff;
  })();

  /* ---------------------------------------------------------
     2. 职业表（来自共享配置，后台可增删改）
     --------------------------------------------------------- */
  const CLASSES = DATA.classes.filter(c => c.enabled !== false);

  /* ---------------------------------------------------------
     2.5 商店（抽取弹珠）与本地钱包
     弹珠归属：shop.starter 默认解锁，其余需要抽卡解锁；
     新增职业若不在 starter 里，会自动进入卡池并处于未解锁状态。
     --------------------------------------------------------- */
  const SHOP = Object.assign({
    enabled: true, currency: '金币', initialCoins: 300,
    drawCost: 80, duplicateRefund: 30,
    rewards: { win: 120, draw: 80, lose: 50 },
    starter: [], pool: []
  }, DATA.shop || {});
  SHOP.rewards = Object.assign({ win: 120, draw: 80, lose: 50 }, SHOP.rewards || {});
  const WALLET_KEY = 'wowpinball.shop.v1';
  const SHOP_RARITY = { common: '普通', rare: '稀有', epic: '史诗' };

  let WALLET = { coins: SHOP.initialCoins, owned: [] };
  function saveWallet() {
    try { window.localStorage.setItem(WALLET_KEY, JSON.stringify(WALLET)); } catch (e) { /* 存储不可用时仅本局生效 */ }
  }
  function loadWallet() {
    let w = null;
    try { w = JSON.parse(window.localStorage.getItem(WALLET_KEY)); } catch (e) { w = null; }
    if (!w || typeof w !== 'object') w = { coins: SHOP.initialCoins, owned: [] };
    if (typeof w.coins !== 'number' || !isFinite(w.coins)) w.coins = SHOP.initialCoins;
    if (!Array.isArray(w.owned)) w.owned = [];
    // starter 是保底解锁：后台改过 starter 后，老存档也能拿到
    (SHOP.starter || []).forEach(id => {
      if (CLASSES.some(c => c.id === id) && w.owned.indexOf(id) < 0) w.owned.push(id);
    });
    WALLET = w;
    saveWallet();
    return w;
  }
  function isOwned(id) { return WALLET.owned.indexOf(id) >= 0; }
  function addCoins(n) {
    WALLET.coins = Math.max(0, Math.round(WALLET.coins + n));
    saveWallet();
    updateCoinChips();
  }
  function shopPool() {
    return CLASSES.map(function (c) {
      const meta = (SHOP.pool || []).find(function (p) { return p.classId === c.id; }) || {};
      return {
        cls: c,
        rarity: meta.rarity || 'common',
        weight: meta.weight == null ? 10 : Number(meta.weight),
        listed: meta.listed !== false
      };
    }).filter(function (e) { return e.listed && e.weight > 0; });
  }

  /* ---------------------------------------------------------
     3. 技能表
     mods 全部为累加数值；描述由 mods 自动生成，保证文案与效果一致
     --------------------------------------------------------- */
  const TIER_NAME = { common: '普通', rare: '稀有', epic: '史诗' };
  const TIER_WEIGHT = DATA.tierWeights;

  const MOD_KEYS = [
    'maxHp', 'power', 'speed', 'mass', 'armor', 'crit', 'critMult',
    'lifesteal', 'thorns', 'regen', 'shield', 'firstStrike', 'execute',
    'combo', 'slow', 'dot', 'knock', 'dodge', 'momentum'
  ];

  function pct(v) { return Math.round(v * 100) + '%'; }
  const MOD_LABEL = {
    maxHp: v => '生命 +' + v,
    power: v => '伤害 +' + pct(v),
    speed: v => '速度 +' + pct(v),
    mass: v => '质量 +' + v.toFixed(2),
    armor: v => '减伤 +' + pct(v),
    crit: v => '暴击率 +' + pct(v),
    critMult: v => '暴击倍率 +' + v.toFixed(1),
    lifesteal: v => '吸血 +' + pct(v),
    thorns: v => '反伤 +' + pct(v),
    regen: v => '每秒回复 ' + pct(v) + ' 生命',
    shield: v => '每回合护盾 ' + pct(v),
    firstStrike: v => '每回合首次撞击 +' + pct(v),
    execute: v => '目标低于 40% 生命时 +' + pct(v),
    combo: v => '连撞每层 +' + pct(v),
    slow: v => '命中使对手减速 ' + pct(v),
    dot: v => '命中附加持续伤害 ' + pct(v),
    knock: v => '击退强度 +' + pct(v),
    dodge: v => '闪避 +' + pct(v),
    momentum: v => '高速撞击加成 +' + pct(v)
  };

  // 技能归属（cls）统一规范化为数组：字符串 -> [字符串]；null / 空 / undefined -> []
  // 兼容旧数据，升级后既有技能仍可正常进入对应职业的抽取池；同时去重避免重复入池
  // 注意：SKILLS 初始化时就要用它，必须定义在 SKILLS 之前，否则会踩 const 的暂时性死区（TDZ）
  const skillClsArr = s => {
    const v = s && s.cls;
    let a;
    if (Array.isArray(v)) a = v.filter(x => typeof x === 'string' && x);
    else if (typeof v === 'string' && v) a = [v];
    else a = [];
    const seen = Object.create(null), out = [];
    a.forEach(x => { if (!seen[x]) { seen[x] = 1; out.push(x); } });
    return out;
  };

  const SKILLS = DATA.skills.filter(s => s.enabled !== false).map(s => {
    const mods = s.mods || {};
    let compiled = null;
    // 预编译节点图（模块化技能），供战斗中实时施放；失败则退化为纯被动
    if (s.graph && window.SkillModules) {
      try { compiled = window.SkillModules.compile(s); } catch (e) { compiled = null; }
    }
    // 充能时间（秒）：技能级属性，未配置时回落到编译器默认值
    const charge = (typeof s.charge === 'number' && s.charge > 0) ? s.charge
      : ((window.SkillModules && window.SkillModules.DEFAULT_CHARGE) || 3);
    return {
      id: s.id, name: s.name, cls: skillClsArr(s), tier: s.tier, mods: mods, graph: s.graph || null, compiled: compiled,
      charge: charge,
      // intro = 后台编辑的技能介绍（用户文案）；desc = 由 mods / 节点图自动生成的机制摘要，两者互不覆盖
      intro: String(s.intro || '').trim(),
      desc: Object.keys(mods).filter(k => MOD_LABEL[k]).map(k => MOD_LABEL[k](mods[k])).join(' / ') +
        (compiled && compiled.active ? (Object.keys(mods).length ? ' / ' : '') + '✸主动技能 · 充能 ' + charge.toFixed(1) + 's' : ''),
      origin: (function () { const a = skillClsArr(s); return a.length ? a.map(id => (CLASSES.find(c => c.id === id) || { name: id }).name).join('/') + '专属' : '通用'; })()
    };
  });

  /* ---------------------------------------------------------
     4. 工具
     --------------------------------------------------------- */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = n => Math.floor(Math.random() * n);
  const $ = id => document.getElementById(id);

  function weightedPick(list) {
    let total = 0;
    const weights = list.map(s => {
      let w = (TIER_WEIGHT[s.tier] || 1) * (EFFECTS.tierMul[s.tier] || 1) *
        (s.cls.length ? CONFIG.CLASS_SKILL_WEIGHT : 1) *
        (EFFECTS.skillBoost.indexOf(s.id) >= 0 ? 2.5 : 1);
      total += w;
      return w;
    });
    let r = Math.random() * total;
    for (let i = 0; i < list.length; i++) {
      r -= weights[i];
      if (r <= 0) return list[i];
    }
    return list[list.length - 1];
  }

  function drawSkills(cls, owned, n) {
    const ownedIds = owned.map(s => s.id);
    const pool = SKILLS.filter(s =>
      (s.cls.length === 0 || s.cls.indexOf(cls.id) >= 0) &&
      ownedIds.indexOf(s.id) < 0 &&
      EFFECTS.skillBan.indexOf(s.id) < 0);
    const out = [];
    while (out.length < n && pool.length) {
      const s = weightedPick(pool);
      out.push(s);
      pool.splice(pool.indexOf(s), 1);
    }
    return out;
  }

  /* ---------------------------------------------------------
     5. 全局状态
     --------------------------------------------------------- */
  const G = {
    screen: 'start',
    phase: 'idle',           // draft | fighting | rest | finished
    selectedClass: null,
    playerClass: null,
    enemyClass: null,
    playerAim: 0,            // 玩家选定的初始发射方向（弧度，0 = 向右）
    aimPos: null,            // 瞄准阶段确定的出生位（发射前沿用，避免跳动）
    player: null,
    enemy: null,
    round: 0,
    roundTime: 0,
    scores: { player: 0, enemy: 0, draw: 0 },
    roundResults: [],
    playerSkills: [],
    enemySkills: [],
    draftOptions: [],
    enemyDraftPick: null,
    myPicks: [],             // 本局我每回合的选择：{ skill, aim }
    speedIdx: 0,
    sound: true,
    clock: 0,
    lastImpact: -10,
    weather: null,           // 本回合天气：null=无 { id, name, dir, force, sway, slip }
    weatherFx: [],           // 天气视觉粒子（风线 / 雨滴）
    trauma: 0,
    hitStopUntil: 0,
    flash: 0,
    particles: [],
    floaters: [],
    logLines: [],
    movers: [],              // 挂在弹珠身上的运动器（位移模块生成，逐帧接管速度）
    // 伤害统计：所有来源（撞击 / 技能 / 区域残留 / 墙面残留 / 荆棘反伤 / 持续伤害 / 回响）统一收口到 recordDamage()
    dmgStats: {
      total: { player: 0, enemy: 0 },   // 整局累计造成的伤害
      round: { player: 0, enemy: 0 },   // 本回合造成的伤害
      byKind: { player: {}, enemy: {} },// 按来源分类
      hits: { player: 0, enemy: 0 }     // 造成伤害的次数
    }
  };

  /* ---------------------------------------------------------
     5.1 联机对战（P2P · 房主权威）
     角色：房主 = 模拟侧 player，客机 = 模拟侧 enemy。
     所有随机（技能抽取 / 出生抖动 / 天气 / 暴击闪避）只发生在房主端；
     客机只做两件事：上报输入（选职业 / 选技能 / 瞄准发射）+ 消费快照插值回放。
     通道分工：ctrl 可靠有序（对局事件）· game 不可靠（20Hz 快照）。
     --------------------------------------------------------- */
  const P2P = {
    active: false,        // 会话已建立（含大厅与对局全程）
    inMatch: false,       // 已进入对局
    role: null,           // 'host' | 'guest'
    peerNick: '',
    net: null,
    roomCode: '',         // 8 位房间码
    myCls: null, peerCls: null, myClsSent: false,
    myReady: false, peerReady: false,   // 双方准备状态（ctrl 通道实时共享）
    guestOpts: null,      // 房主为客机抽出的技能选项
    guestPick: false, myPickDone: false,
    guestAim: null, guestLaunched: false, myLaunched: false,
    buf: null,            // 客机快照缓冲（WowPinballSync.SnapBuf）
    snapAcc: 0,           // 房主快照节拍
    noSnapT: 0,           // 客机本回合「一帧快照都没收到」的累计时长
    noSnapWarned: false,
    snapLogged: false
  };

  const NET = window.WowPinballNet || null;
  const SYNC = window.WowPinballSync || null;

  function p2pSend(obj) { if (P2P.net && P2P.net.ready) P2P.net.sendCtrl(obj); }

  /* 模拟侧 → 本地显示侧的映射（客机视角下双方对调） */
  function p2pMapWinner(w) {
    if (w === 'draw') return 'draw';
    const hostWon = w === 'player';
    return P2P.role === 'host' ? w : (hostWon ? 'enemy' : 'player');
  }
  function p2pMapScores(sc) {
    if (P2P.role === 'host') return { player: sc.player, enemy: sc.enemy, draw: sc.draw };
    return { player: sc.enemy, enemy: sc.player, draw: sc.draw };
  }

  function p2pTeardown(why) {
    if (P2P.net) { try { P2P.net.close(); } catch (e) {} }
    P2P.net = null;
    P2P.active = false; P2P.inMatch = false;
    P2P.role = null; P2P.peerNick = ''; P2P.roomCode = '';
    P2P.myCls = null; P2P.peerCls = null; P2P.myClsSent = false;
    P2P.myReady = false; P2P.peerReady = false;
    P2P.guestOpts = null; P2P.guestPick = false; P2P.myPickDone = false;
    P2P.guestAim = null; P2P.guestLaunched = false; P2P.myLaunched = false;
    P2P.buf = null; P2P.snapAcc = 0;
    if (dom.asyncTag) { dom.asyncTag.hidden = true; dom.asyncTag.textContent = ''; }
    if (why) p2pStatus('已断开：' + why);
  }

  function p2pOnClose(why) {
    if (!P2P.active) return;
    const wasMatch = P2P.inMatch;
    p2pTeardown(null);
    G.phase = 'idle';
    switchScreen('start');
    if (wasMatch) {
      showBanner('连接已断开', '对手离开了对局（' + (why || '网络中断') + '）', 2400);
      addLog('联机对手已断线，本局中止', 'bad');
    }
  }

  /* ---------- ctrl 通道对局事件 ---------- */

  function p2pOnCtrl(msg) {
    if (!msg || !msg.k) return;
    switch (msg.k) {
      case 'hello':
        P2P.peerNick = cleanNick(msg.nick) || '对手';
        if (P2P.active) p2pStatus('已连接 · 对手：' + P2P.peerNick);
        if (P2P.inMatch && dom.asyncTag) dom.asyncTag.textContent = '联机对战 · ' + P2P.peerNick;
        p2pRoomRender();
        p2pSendRoomState();        // 对端上线后立刻同步一次我方状态
        break;
      case 'bye':
        p2pOnClose('对方主动退出');
        break;
      case 'ready':
        P2P.peerReady = !!msg.ready;
        P2P.peerCls = msg.cls || P2P.peerCls;
        if (msg.nick) P2P.peerNick = cleanNick(msg.nick) || P2P.peerNick;
        p2pRoomRender();
        p2pTryStart();
        break;
      case 'cls':   // 旧版本兼容：当作「已准备」
        P2P.peerCls = msg.id;
        P2P.peerReady = true;
        p2pRoomRender();
        p2pTryStart();
        break;
      case 'back_room':
        p2pBackToRoom(false);
        break;
      case 'start':   // 客机收到：房主宣布开局
        if (P2P.role === 'guest') p2pStartMatch(msg.h, msg.g);
        break;
      case 'draft':   // 客机收到：房主发牌
        if (P2P.role === 'guest') p2pGuestOpenDraft(msg);
        break;
      case 'draft_pick':   // 房主收到：客机选的技能
        if (P2P.role === 'host') p2pHostOnGuestPick(msg);
        break;
      case 'aim':     // 客机收到：瞄准阶段（含双方出生位）
        if (P2P.role === 'guest') p2pGuestAim(msg);
        break;
      case 'launch':  // 对方已发射
        if (P2P.role === 'host') {
          P2P.guestAim = msg.aim;
          P2P.guestLaunched = true;
          if (G.phase === 'wait-launch' && P2P.myLaunched) beginRound();
        } else {
          showBanner('对方已发射', '等待回合开始…', 1200);
        }
        break;
      case 'round_start':   // 客机收到：回合正式开始
        if (P2P.role === 'guest') p2pGuestRoundStart(msg);
        break;
      case 'round_end':     // 客机收到：回合结算
        if (P2P.role === 'guest') p2pGuestRoundEnd(msg);
        break;
      case 'match_end':     // 客机收到：整局结算
        if (P2P.role === 'guest') p2pGuestMatchEnd(msg);
        break;
    }
  }

  function p2pTryStart() {
    if (!P2P.active || P2P.role !== 'host') return;
    if (P2P.inMatch) return;
    // 双方必须都选好职业并都点「准备」
    if (!P2P.myReady || !P2P.peerReady || !P2P.myCls || !P2P.peerCls) return;
    P2P.inMatch = true;
    p2pRoomStatus('双方已准备，正在进入对局…');
    p2pSend({ k: 'start', h: P2P.myCls, g: P2P.peerCls });
    p2pStartMatch(P2P.myCls, P2P.peerCls);
  }

  function p2pStartMatch(hostClsId, guestClsId) {
    const hostCls = CLASSES.find(c => c.id === hostClsId);
    const guestCls = CLASSES.find(c => c.id === guestClsId);
    if (!hostCls || !guestCls) return;
    P2P.inMatch = true;
    P2P.myClsSent = false;
    const myCls = P2P.role === 'host' ? hostCls : guestCls;
    const foeCls = P2P.role === 'host' ? guestCls : hostCls;
    startMatch(myCls, { enemyClass: foeCls.id });
  }

  /* ---------- 客机：各阶段 ---------- */

  function p2pGuestOpenDraft(msg) {
    if (!SYNC || !G.player) return;
    G.round = msg.r;
    G.draftOptions = (msg.opts || []).map(id => SKILLS.find(s => s.id === id)).filter(Boolean);
    if (!G.draftOptions.length) return;
    G.phase = 'draft';
    dom.draftTitle.textContent = '第 ' + (G.round + 1) + ' 回合休整 · 随机三选一';
    dom.draftSub.textContent = '联机对战 · 房主发牌，选择一个技能';
    dom.draftModal.hidden = false;
    dom.draftCards.innerHTML = G.draftOptions.map((s, i) =>
      '<button class="skill-card" type="button" data-i="' + i + '" data-tier="' + escHtml(s.tier) + '"' +
      ' title="' + escHtml(s.intro ? s.intro + '\n【机制】' + s.desc : s.desc) + '">' +
      '<div class="sc-top"><span class="sc-name">' + escHtml(s.name) + '</span><span class="sc-tier">' + escHtml(TIER_NAME[s.tier]) + '</span></div>' +
      '<div class="sc-origin">' + escHtml(s.origin) + '</div>' +
      '<div class="sc-effect">' + escHtml(s.intro || s.desc) + '</div>' +
      '<div class="sc-hotkey">' + (i < 3 ? '按 ' + (i + 1) + ' 选择' : '点击选择') + '</div></button>'
    ).join('');
    dom.draftCards.querySelectorAll('.skill-card').forEach(btn => {
      btn.addEventListener('click', () => chooseSkill(Number(btn.getAttribute('data-i'))));
    });
    dom.phaseLabel.textContent = '休整 · 选择技能';
    updateScoreboard();
  }

  function p2pGuestAim(msg) {
    if (!G.player || !G.enemy) return;
    const pos = P2P.role === 'host' ? msg.p : { p: msg.p.e, e: msg.p.p };
    [G.player, G.enemy].forEach(f => {
      recompute(f);
      f.hp = f.maxHp;
      f.shield = f.maxHp * f.mods.shield;
      f.combo = 0; f.firstHitUsed = false;
      f.slowUntil = -1; f.slowFactor = 1;
      f.dotDps = 0; f.dotUntil = -1; f._statusTags = {};
      f._dotAccum = 0; f._dotLogAt = null;
      f.squash = 0; f.trail = []; f.lastDmgAt = -10;
      f._p2pHp = null;
    });
    G.player.x = pos.p.x; G.player.y = pos.p.y;
    G.enemy.x = pos.e.x; G.enemy.y = pos.e.y;
    G.player.vx = 0; G.player.vy = 0;
    G.enemy.vx = 0; G.enemy.vy = 0;
    initSkillCasters();
    G.phase = 'aim';
    dom.phaseLabel.textContent = '瞄准 · 第 ' + msg.r + ' 回合';
    dom.timerText.textContent = CONFIG.ROUND_SECONDS.toFixed(1);
    showBanner('选择发射方向', '拖动弹球上的箭头，点击发射开始第 ' + msg.r + ' 回合', 0);
    if (dom.aimOverlay) dom.aimOverlay.hidden = false;
    if (dom.launchBtn) dom.launchBtn.hidden = false;
    updateScoreboard();
  }

  function p2pGuestRoundStart(msg) {
    G.round = msg.r;
    G.weather = msg.w ? Object.assign({}, msg.w) : null;
    G.weatherFx = [];
    if (G.weather && G.weather.id === 'wind') seedWindFx();
    else if (G.weather && G.weather.id === 'rain') seedRainFx();
    G.roundTime = CONFIG.ROUND_SECONDS;
    G.phase = 'fighting';
    if (P2P.buf) { P2P.buf.snaps = []; P2P.buf.renderT = null; }
    P2P.noSnapT = 0; P2P.noSnapWarned = false; P2P.snapLogged = false;
    [G.player, G.enemy].forEach(f => { f._p2pHp = null; });
    dom.phaseLabel.textContent = '对撞中';
    showBanner('第 ' + G.round + ' 回合', G.playerClass.name + '  对阵  ' + G.enemyClass.name, 900);
    if (G.weather) addLog('本回合天气：' + G.weather.name + (G.weather.id === 'wind' ? (G.weather.dir > 0 ? '（吹向右侧 →）' : '（吹向左侧 ←）') : ''), 'hl');
    resetRoundDmg();
    sfx.round();
    updateScoreboard();
  }

  function p2pGuestRoundEnd(msg) {
    if (G.phase !== 'fighting') return;
    G.phase = 'rest';
    G.round = msg.r;
    const winner = p2pMapWinner(msg.w);
    const pp = P2P.role === 'host' ? msg.pp : msg.ep;   // 我方剩余生命百分比
    const ep = P2P.role === 'host' ? msg.ep : msg.pp;
    G.roundResults.push({ round: msg.r, pp: pp, ep: ep, winner: winner, reason: 'sync' });
    G.scores = p2pMapScores(msg.sc);
    const label = winner === 'player' ? '本回合胜' : (winner === 'enemy' ? '本回合负' : '本回合平');
    addLog('第 ' + msg.r + ' 回合结束 · ' + label + ' · 我方 ' + Math.round(pp * 100) + '% / 对手 ' + Math.round(ep * 100) + '%',
      winner === 'player' ? 'good' : (winner === 'enemy' ? 'bad' : 'hl'));
    showBanner(label, msg.reason === 'ko' ? '一方弹珠被击碎' : '按剩余生命百分比判定', 1350);
    sfx.round();
    updateScoreboard();
    setTimeout(() => { if (G.phase === 'rest') G.phase = 'wait-draft'; }, 1400);
  }

  function p2pGuestMatchEnd(msg) {
    G.scores = p2pMapScores(msg.sc);
    G.roundResults = (msg.rs || []).map(r => ({
      round: r.round,
      pp: P2P.role === 'host' ? r.pp : r.ep,
      ep: P2P.role === 'host' ? r.ep : r.pp,
      winner: p2pMapWinner(r.winner), reason: r.reason || 'sync'
    }));
    showResult();
  }

  /* ---------- 房主：客机输入落地 ---------- */

  function p2pHostOnGuestPick(msg) {
    if (P2P.guestPick) return;
    P2P.guestPick = true;
    const s = P2P.guestOpts && P2P.guestOpts[msg.i];
    if (s && G.enemySkills.every(x => x.id !== s.id)) {
      G.enemySkills.push(s);
      addLog('对手获得「' + s.name + '」', 'hl');
    }
    recompute(G.enemy);
    if (P2P.myPickDone && G.phase === 'transition') startAimPhase();
  }

  /* ---------- 主循环钩子 ---------- */

  function p2pSendSnap() {
    if (!P2P.net || !P2P.net.ready || !G.player || !G.enemy || !SYNC) return;
    P2P.net.sendGame(JSON.stringify(SYNC.encodeSnap(G.round, G.clock, G.player, G.enemy, G.roundTime)));
  }

  function p2pGuestFrame(dt) {
    const buf = P2P.buf;
    if (!buf) return;
    // 快照链路自检：没有任何快照时给出可见告警，首包到达时给一次确认日志
    if (buf.latest()) {
      P2P.noSnapT = 0;
      if (!P2P.snapLogged) {
        P2P.snapLogged = true;
        addLog('联机快照已接通', 'good');
      }
    } else {
      P2P.noSnapT += dt;
      if (P2P.noSnapT > 2.5 && !P2P.noSnapWarned) {
        P2P.noSnapWarned = true;
        addLog('联机：未收到房主的对战快照，弹珠与血条无法同步（请确认两端都是最新版本）', 'bad');
      }
    }
    buf.advanceAdaptive(dt);        // 缓冲水位反馈：不冻结、不硬跳，自动吸收抖动
    buf.resyncIfNeeded();           // 仅在切后台等严重落后（>1.5s）时兜底重置
    const sm = buf.sample();
    if (sm) {
      const mine = P2P.role === 'host' ? sm.p : sm.e;
      const foe = P2P.role === 'host' ? sm.e : sm.p;
      const mf = G.player, ef = G.enemy;
      mf.x = mine.x; mf.y = mine.y; mf.vx = mine.vx; mf.vy = mine.vy;
      mf.hp = mine.hp; mf.shield = mine.shield;
      ef.x = foe.x; ef.y = foe.y; ef.vx = foe.vx; ef.vy = foe.vy;
      ef.hp = foe.hp; ef.shield = foe.shield;
      G.roundTime = sm.rt;
      p2pGuestHitFx(mine.hp, mf, true);
      p2pGuestHitFx(foe.hp, ef, false);
      updateHud();
    }
    dom.timerText.textContent = Math.max(0, G.roundTime).toFixed(1);
  }

  /* 客机没有伤害结算，靠快照血量差补火花 / 飘字 / 音效 */
  function p2pGuestHitFx(hp, f, isMine) {
    if (f._p2pHp == null) { f._p2pHp = hp; return; }
    const drop = f._p2pHp - hp;
    if (drop >= 1) {
      spawnSparks(f.x + rand(-f.r, f.r), f.y + rand(-f.r, f.r), 0, -1, Math.min(8, 2 + Math.round(drop / 4)), '#ffd27a', '#ff7b6b');
      addFloater(f.x, f.y - f.r - 8, '-' + Math.round(drop), isMine ? '#ff7b6b' : '#ffd27a', 15);
      if (drop >= 6) sfx.hit();
    }
    f._p2pHp = hp;
  }

  /* ---------- 大厅 UI ---------- */

  function p2pStatus(text) {
    const el = $('p2pStatus');
    if (el) { el.textContent = text; el.style.color = ''; }
  }
  function p2pStatusBad(text) {
    const el = $('p2pStatus');
    if (el) { el.textContent = text; el.style.color = 'var(--bad, #e5484d)'; }
  }
  function p2pMsg(id, text, kind) {
    const el = $(id);
    if (!el) return;
    if (!text) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false;
    el.textContent = text;
    el.style.color = kind === 'bad' ? 'var(--bad, #e5484d)' : kind === 'good' ? 'var(--good, #2f9e63)' : 'var(--muted, #8a8f98)';
  }
  function p2pStage(name) {
    ['p2pStageSel', 'p2pStageJoin'].forEach(id => { const el = $(id); if (el) el.hidden = id !== name; });
  }

  function openP2P() {
    if (!NET || !SYNC) { p2pMsg('p2pSelMsg', '联机模块加载失败，请刷新页面', 'bad'); }
    $('p2pModal').hidden = false;
    if (!P2P.active) p2pStage('p2pStageSel');
  }

  /* 会话回调统一生成：六个通道缺一不可（onReady/onCtrl/onGame/onClose/onState/onFail），
     另加 onRoom（好友已输入房间码，尚未建连时的提示）。 */
  function p2pSessionOpts(bannerTitle) {
    return {
      nick: nickName(),
      onReady: function () {
        p2pStatus('已连接 · 通道就绪');
        $('p2pModal').hidden = true;
        p2pRoomShow();
        p2pRoomStatus(bannerTitle + ' · 双方选好职业并都点「准备」后开战');
        p2pSend({ k: 'hello', nick: nickName() });
        p2pSendRoomState();
      },
      onCtrl: p2pOnCtrl,
      onGame: function (data) {
        if (P2P.role !== 'guest' || !data || data.k !== 's') return;
        if (!P2P.buf) P2P.buf = new SYNC.SnapBuf();   // 自愈：缓冲意外缺失时补建
        P2P.buf.push(data);
      },
      onClose: function (why) { p2pOnClose(why || '连接关闭'); },
      onState: function (text) { p2pStatus(text); },
      onFail: function (msg) { p2pStatusBad(msg); p2pRoomMsg(msg, 'bad'); },
      onRoom: function (ev) {
        if (ev && ev.k === 'joined') {
          P2P.peerNick = ev.nick || '好友';
          p2pRoomStatus('好友「' + P2P.peerNick + '」已输入房间码，正在建立直连…');
          p2pRoomRender();
        }
      }
    };
  }

  function p2pAttachHandlers(bannerTitle) {
    if (!P2P.net) return;
    const o = p2pSessionOpts(bannerTitle);
    Object.keys(o).forEach(k => { P2P.net.opts[k] = o[k]; });
  }

  /* ---------- 房间页面：8 位码 + 双方状态共享 ---------- */

  function p2pRoomShow() {
    switchScreen('room');
    p2pRoomBuildClasses();
    p2pRoomRender();
  }

  function p2pRoomMsg(text, kind) {
    const el = $('roomMsg');
    if (!el) return;
    if (!text) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false;
    el.textContent = text;
    el.style.color = kind === 'bad' ? 'var(--bad)' : kind === 'good' ? 'var(--good)' : 'var(--text-dim)';
  }

  function p2pRoomStatus(text) { const el = $('roomStatus'); if (el) el.textContent = text; }

  function p2pRoomBuildClasses() {
    const grid = $('roomClassGrid');
    if (!grid) return;
    grid.innerHTML = CLASSES.map(c => {
      const owned = isOwned(c.id);
      const picked = P2P.myCls === c.id;
      return '<button class="room-class-btn' + (owned ? '' : ' locked') + (picked ? ' selected' : '') +
        '" type="button" data-id="' + c.id + '" style="--cls-color:' + c.color + '">' +
        '<div class="rcb-name">' + escHtml(c.name) + (owned ? '' : ' · 未解锁') + '</div>' +
        '<div class="rcb-trait">' + escHtml(c.trait) + '</div></button>';
    }).join('');
    grid.querySelectorAll('.room-class-btn').forEach(btn => {
      btn.addEventListener('click', () => p2pRoomSelectClass(btn.dataset.id));
    });
  }

  function p2pRoomSelectClass(id) {
    const cls = CLASSES.find(c => c.id === id);
    if (!cls) return;
    if (!isOwned(id)) { openShop(); return; }
    P2P.myCls = id;
    G.selectedClass = cls;
    p2pRoomBuildClasses();
    p2pRoomRender();
    p2pSendRoomState();       // 职业变化也实时共享给对方
  }

  function p2pSendRoomState() {
    if (!P2P.active) return;
    p2pSend({ k: 'ready', ready: P2P.myReady, cls: P2P.myCls, nick: nickName() });
  }

  function p2pRoomToggleReady() {
    if (!P2P.active) return;
    if (!P2P.myCls) { p2pRoomMsg('请先在上面选择一个职业', 'bad'); return; }
    P2P.myReady = !P2P.myReady;
    p2pRoomRender();
    p2pSendRoomState();
    p2pTryStart();
  }

  function p2pRoomRender() {
    const connected = !!(P2P.net && P2P.net.ready);
    const myName = P2P.myCls ? ((CLASSES.find(c => c.id === P2P.myCls) || {}).name || '—') : '未选择职业';
    const peerName = P2P.peerCls ? ((CLASSES.find(c => c.id === P2P.peerCls) || {}).name || '—') : '未选择职业';
    const set = (id, text, cls) => {
      const el = $(id);
      if (!el) return;
      el.textContent = text;
      if (cls != null) el.className = cls;
    };
    set('roomCode', P2P.roomCode || '········');
    set('roomMyRole', P2P.role === 'host' ? '房主' : '好友');
    set('roomPeerRole', P2P.role === 'host' ? '好友' : '房主');
    set('roomMyNick', nickName());
    set('roomPeerNick', P2P.peerNick || (connected ? '已连接' : '等待加入…'));
    set('roomMyClass', myName);
    set('roomPeerClass', connected ? peerName : '—');
    set('roomMyReady', P2P.myReady ? '已准备' : '未准备', 'rp-ready' + (P2P.myReady ? ' on' : ''));
    set('roomPeerReady', P2P.peerReady ? '已准备' : '未准备', 'rp-ready' + (P2P.peerReady ? ' on' : ''));
    const myCard = $('roomMyCard'), peerCard = $('roomPeerCard');
    if (myCard) myCard.classList.toggle('is-ready', P2P.myReady);
    if (peerCard) peerCard.classList.toggle('is-ready', P2P.peerReady);
    const btn = $('roomReadyBtn');
    if (btn) {
      btn.disabled = !connected || !P2P.myCls;
      btn.textContent = P2P.myReady ? '取消准备' : '准备';
    }
    const hint = $('roomSharedHint');
    if (hint) {
      if (!connected) hint.textContent = '等待好友加入并建连…';
      else if (P2P.myReady && P2P.peerReady) hint.textContent = '双方都已准备，房主正在开局…';
      else if (P2P.myReady) hint.textContent = '你已准备，等待对手准备…';
      else if (P2P.peerReady) hint.textContent = '对手已准备，等你点「准备」…';
      else hint.textContent = '双方状态实时共享 · 两边都准备后才开始';
    }
    const copyBtn = $('roomCopyBtn'), codeHint = $('roomCodeHint');
    if (copyBtn) copyBtn.hidden = P2P.role !== 'host';
    if (codeHint) codeHint.textContent = P2P.role === 'host'
      ? '把 8 位码发给好友，对方输入即可加入，不需要回传任何码'
      : '你已加入这个房间，无需回传任何码';
  }

  /* 一局结束后任一方点「再战」，双方一起回房间重新准备 */
  function p2pBackToRoom(notify) {
    if (!P2P.active) return;
    P2P.inMatch = false;
    P2P.myReady = false; P2P.peerReady = false;
    if (notify) p2pSend({ k: 'back_room' });
    p2pRoomShow();
    p2pSendRoomState();
  }

  /* 建连失败时退回联机弹窗，并把错误显示出来 */
  function p2pRoomFail(stage, text) {
    P2P.active = false;
    if (P2P.net) { try { P2P.net.close(); } catch (e) {} }
    P2P.net = null;
    $('p2pModal').hidden = false;
    p2pStage(stage);
    p2pMsg(stage === 'p2pStageJoin' ? 'p2pJoinMsg' : 'p2pSelMsg', text, 'bad');
    switchScreen('start');
  }

  async function p2pHostCreate() {
    if (!NET) return;
    const btn = $('p2pCreateBtn');
    try {
      p2pMsg('p2pSelMsg', '正在创建房间…');
      if (btn) btn.disabled = true;
      // 先切到房间页显示进度：收集中继候选可能要 10 秒，别让用户对着弹窗干等
      P2P.role = 'host'; P2P.active = true; P2P.roomCode = '';
      P2P.myCls = G.selectedClass ? G.selectedClass.id : null;
      P2P.myReady = false; P2P.peerReady = false; P2P.inMatch = false;
      $('p2pModal').hidden = true;
      p2pRoomShow();
      p2pRoomStatus('正在创建房间并收集网络地址，请稍候…');
      const made = await NET.Session.createHostRoom(p2pSessionOpts('好友已连接'));
      P2P.net = made.session;
      P2P.roomCode = made.code;
      p2pAttachHandlers('好友已连接');
      p2pRoomShow();
      p2pRoomStatus('房间已创建 · 把 8 位邀请码发给好友，等待加入…');
    } catch (e) {
      p2pRoomFail('p2pStageSel', '创建失败：' + e.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function p2pJoinAccept() {
    const inp = $('p2pRoomCodeIn');
    const raw = inp ? inp.value.trim() : '';
    if (!raw) { p2pMsg('p2pJoinMsg', '请输入 8 位房间邀请码'); return; }
    const btn = $('p2pAcceptBtn');
    try {
      p2pMsg('p2pJoinMsg', '正在查找房间并建连…');
      if (btn) btn.disabled = true;
      P2P.role = 'guest'; P2P.active = true;
      P2P.roomCode = NET.normalizeRoomCode(raw);
      P2P.myCls = G.selectedClass ? G.selectedClass.id : null;
      P2P.myReady = false; P2P.peerReady = false; P2P.inMatch = false;
      $('p2pModal').hidden = true;
      p2pRoomShow();
      p2pRoomStatus('正在查找房间并收集网络地址，请稍候…');
      const made = await NET.Session.joinRoom(raw, p2pSessionOpts('已连接房主'));
      P2P.net = made.session;
      P2P.buf = new SYNC.SnapBuf();
      P2P.roomCode = made.session.roomCode || P2P.roomCode;
      p2pAttachHandlers('已连接房主');
      p2pRoomShow();
      p2pRoomStatus('已加入房间 · 正在建立直连…');
    } catch (e) {
      p2pRoomFail('p2pStageJoin', '加入失败：' + e.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function p2pCopy(id, msgId) {
    const el = $(id);
    if (!el || !el.value) return;
    const done = () => p2pMsg(msgId, '已复制，发给对方吧', 'good');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(el.value).then(done, () => { el.select(); document.execCommand('copy'); done(); });
    } else {
      el.select(); document.execCommand('copy'); done();
    }
  }


  /* ---------------------------------------------------------
     5.2 玩家昵称 / 阵营标识
     昵称只存在浏览器本地，不进后台配置；分享码会带上它。
     --------------------------------------------------------- */
  const PROFILE_KEY = 'wowpinball.profile.v1';
  const NICK_MAX = 12;
  const SIDE = {
    player: { color: '#57c8ff', label: '我方' },
    enemy: { color: '#ff7b6b', label: '对手' }
  };
  let PROFILE = { name: '' };
  let NAME_EDITABLE = false;   // 首次进入必须输入，不可跳过；从顶栏修改才允许取消

  function cleanNick(v) {
    return String(v == null ? '' : v)
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ').trim().slice(0, NICK_MAX);
  }
  function nickName() { return PROFILE.name || '玩家'; }
  function enemyNick() {
    if (P2P.active) return P2P.peerNick || '对手';
    return '电脑陪练';
  }
  function loadProfile() {
    let raw = null;
    try { raw = JSON.parse(window.localStorage.getItem(PROFILE_KEY)); } catch (e) { raw = null; }
    PROFILE = { name: cleanNick(raw && raw.name) };
    return PROFILE;
  }
  function saveProfile(name) {
    PROFILE = { name: cleanNick(name) };
    try { window.localStorage.setItem(PROFILE_KEY, JSON.stringify(PROFILE)); } catch (e) { /* 存储不可用时仅本次会话生效 */ }
    updateNickButton();
  }
  function updateNickButton() {
    if (dom.nickBtn) dom.nickBtn.textContent = PROFILE.name ? ('昵称 · ' + PROFILE.name) : '设置昵称';
  }


  /* ---------------------------------------------------------
     6. DOM
     --------------------------------------------------------- */
  const dom = {
    startScreen: $('startScreen'), battleScreen: $('battleScreen'), resultScreen: $('resultScreen'),
    roomScreen: $('roomScreen'),
    classGrid: $('classGrid'), selectedClassName: $('selectedClassName'), selectedClassTrait: $('selectedClassTrait'),
    startBtn: $('startBtn'), speedBtn: $('speedBtn'), soundBtn: $('soundBtn'),
    rulesBtn: $('rulesBtn'), rulesModal: $('rulesModal'), closeRulesBtn: $('closeRulesBtn'),
    pClassName: $('pClassName'), eClassName: $('eClassName'),
    pNick: $('pNick'), eNick: $('eNick'),
    pHpBar: $('pHpBar'), eHpBar: $('eHpBar'), pShieldBar: $('pShieldBar'), eShieldBar: $('eShieldBar'),
    pHpText: $('pHpText'), eHpText: $('eHpText'), pScore: $('pScore'), eScore: $('eScore'),
    pSkills: $('pSkills'), eSkills: $('eSkills'), pBuffs: $('pBuffs'), eBuffs: $('eBuffs'),
    pPanel: document.querySelector('.player-panel'), ePanel: document.querySelector('.enemy-panel'),
    roundLabel: $('roundLabel'), roundPips: $('roundPips'), phaseLabel: $('phaseLabel'),
    canvas: $('arena'), arenaWrap: $('arenaWrap'), timerText: $('timerText'),
    banner: $('banner'), bannerTitle: $('bannerTitle'), bannerSub: $('bannerSub'),
    draftModal: $('draftModal'), draftTitle: $('draftTitle'), draftSub: $('draftSub'), draftCards: $('draftCards'),
    battleLog: $('battleLog'), dmgSummary: $('dmgSummary'), logModal: $('logModal'), logBtn: $('logBtn'), closeLogBtn: $('closeLogBtn'),
    shopBtn: $('shopBtn'), shopModal: $('shopModal'), closeShopBtn: $('closeShopBtn'), shopDrawBtn: $('shopDrawBtn'),
    shopPool: $('shopPool'), shopCoin: $('shopCoin'), shopCostLabel: $('shopCostLabel'), shopHint: $('shopHint'),
    shopResult: $('shopResult'), coinChip: $('coinChip'),
    asyncTag: $('asyncTag'),
    launchBtn: $('launchBtn'), aimOverlay: $('aimOverlay'),
    resultKicker: $('resultKicker'), resultTitle: $('resultTitle'), resultDesc: $('resultDesc'),
    roundReview: $('roundReview'), buildReview: $('buildReview'),
    rematchBtn: $('rematchBtn'), changeBtn: $('changeBtn'), logResultBtn: $('logResultBtn'),
    nickBtn: $('nickBtn'), nameModal: $('nameModal'), nameTitle: $('nameTitle'),
    nameInput: $('nameInput'), nameMsg: $('nameMsg'),
    nameConfirmBtn: $('nameConfirmBtn'), nameCancelBtn: $('nameCancelBtn'), closeNameBtn: $('closeNameBtn')
  };
  const ctx = dom.canvas.getContext('2d');

  /* ---------------------------------------------------------
     7. 音效（Web Audio 合成，无外部资源）
     --------------------------------------------------------- */
  let audioCtx = null;
  function ensureAudio() {
    if (!G.sound) return;
    try {
      if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) audioCtx = new AC();
      }
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) { audioCtx = null; }
  }
  function tone(freq, dur, type, vol, slideTo) {
    if (!G.sound || !audioCtx) return;
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.01);
  }
  const sfx = {
    hit: () => tone(rand(120, 155), 0.14, 'triangle', 0.13, 58),
    crit: () => { tone(170, 0.16, 'sawtooth', 0.10, 70); tone(680, 0.09, 'square', 0.05, 420); },
    pick: () => tone(520, 0.10, 'sine', 0.07, 760),
    round: () => { tone(330, 0.14, 'sine', 0.07, 440); setTimeout(() => tone(494, 0.18, 'sine', 0.07, 660), 110); },
    win: () => { [392, 523, 659].forEach((f, i) => setTimeout(() => tone(f, 0.24, 'sine', 0.08), i * 130)); },
    lose: () => { [330, 262, 196].forEach((f, i) => setTimeout(() => tone(f, 0.26, 'triangle', 0.07), i * 150)); }
  };

  /* ---------------------------------------------------------
     8. 职业选择界面
     --------------------------------------------------------- */
  function renderClassGrid() {
    const max = {
      hp: Math.max(1, ...CLASSES.map(c => c.hp)),
      power: Math.max(0.01, ...CLASSES.map(c => c.power)),
      mass: Math.max(0.01, ...CLASSES.map(c => c.mass)),
      speed: Math.max(0.01, ...CLASSES.map(c => c.speed))
    };
    dom.classGrid.innerHTML = CLASSES.map(c => {
      const owned = isOwned(c.id);
      const picked = G.selectedClass && G.selectedClass.id === c.id && owned;
      const bars = [
        ['生命', c.hp / max.hp], ['力量', c.power / max.power],
        ['质量', c.mass / max.mass], ['速度', c.speed / max.speed]
      ].map(([label, v]) =>
        '<div class="cc-stat"><label>' + label + '</label><div class="bar"><i style="width:' + Math.round(v * 100) + '%"></i></div></div>'
      ).join('');
      return '<button class="class-card' + (owned ? '' : ' locked') + (picked ? ' selected' : '') + '" type="button" data-id="' + c.id + '" style="--cls-color:' + c.color + '">' +
        '<div class="cc-head"><canvas class="cc-orb" data-orb="' + c.id + '"></canvas><span class="cc-name">' + c.name + '</span>' +
        (owned ? '' : '<span class="cc-lock">未解锁 · 商店抽取</span>') + '</div>' +
        '<div class="cc-trait">' + c.trait + '</div>' +
        '<div class="cc-stats">' + bars + '</div></button>';
    }).join('');
    dom.classGrid.querySelectorAll('.class-card').forEach(btn => {
      btn.addEventListener('click', () => selectClass(btn.dataset.id));
    });
    paintClassOrbs();
    // 抽卡解锁会重建整组职业卡，重建后重新贴上后台为每张卡单独配置的背景
    if (window.WowPinballUI) window.WowPinballUI.apply();
  }

  // 选人卡片上的弹珠缩略图，与实战共用同一套皮肤参数
  function paintClassOrbs() {
    const SK = window.WowPinballSkin;
    if (!SK) return;
    dom.classGrid.querySelectorAll('canvas[data-orb]').forEach(cv => {
      const c = CLASSES.find(x => x.id === cv.dataset.orb);
      if (!c) return;
      // 与 styles.css 里 .cc-orb 的 48px 保持一致（canvas 用 2 倍像素比绘制）
      SK.paintThumb(cv, c.color, c.skin, c.name.charAt(0), 48);
      if (SK.hasSkin(c.skin)) {
        const rec = SK.image(c.skin.src);
        if (rec && !rec.ready && !rec.failed) SK.ready(c.skin.src, paintClassOrbs);
      }
    });
  }

  function selectClass(id) {
    const cls = CLASSES.find(c => c.id === id);
    if (!cls) return;
    if (!isOwned(id)) { openShop(); return; }   // 未解锁 → 引导去商店
    G.selectedClass = cls;
    dom.classGrid.querySelectorAll('.class-card').forEach(b => b.classList.toggle('selected', b.dataset.id === id));
    dom.selectedClassName.textContent = G.selectedClass.name;
    dom.selectedClassName.style.color = G.selectedClass.color;
    dom.selectedClassTrait.textContent = G.selectedClass.trait;
    dom.startBtn.disabled = false;
  }

  /* ---------------------------------------------------------
     8.5 商店：渲染卡池、抽卡、金币展示
     --------------------------------------------------------- */
  function updateCoinChips() {
    const text = SHOP.currency + ' ' + WALLET.coins;
    if (dom.coinChip) dom.coinChip.textContent = text;
    if (dom.shopCoin) dom.shopCoin.textContent = text;
  }

  function renderShop() {
    if (!dom.shopPool) return;
    if (dom.shopCostLabel) dom.shopCostLabel.textContent = '单抽 ' + SHOP.drawCost + ' ' + SHOP.currency;
    if (dom.shopDrawBtn) dom.shopDrawBtn.disabled = !SHOP.enabled;
    const pool = shopPool();
    dom.shopPool.innerHTML = pool.length ? pool.map(e => {
      const owned = isOwned(e.cls.id);
      return '<div class="shop-item' + (owned ? ' owned' : '') + '" style="--si-color:' + e.cls.color + '">' +
        '<span class="si-orb"></span>' +
        '<div class="si-body"><span class="si-name">' + e.cls.name + '</span>' +
        '<span class="si-meta">' + (SHOP_RARITY[e.rarity] || e.rarity) + ' · 权重 ' + e.weight + '</span></div>' +
        '<span class="si-tag' + (owned ? ' owned' : '') + '">' + (owned ? '已拥有' : '未解锁') + '</span></div>';
    }).join('') : '<div class="faint">卡池为空，请在后台「商店」页上架弹珠</div>';
    if (dom.shopHint) {
      const unowned = pool.filter(e => !isOwned(e.cls.id)).length;
      dom.shopHint.textContent = !SHOP.enabled ? '商店已在后台关闭'
        : (unowned ? '卡池中还有 ' + unowned + ' 颗弹珠未解锁' : '全部已拥有 · 后续新增弹珠会进入卡池');
    }
    updateCoinChips();
  }

  function showShopResult(html, kind) {
    if (!dom.shopResult) return;
    dom.shopResult.hidden = false;
    dom.shopResult.className = 'shop-result' + (kind ? ' ' + kind : '');
    dom.shopResult.innerHTML = html;
  }

  function openShop() {
    if (!dom.shopModal) return;
    dom.shopModal.hidden = false;
    renderShop();
  }

  function closeShop() { if (dom.shopModal) dom.shopModal.hidden = true; }

  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------------------------------------------------------
     8.7 昵称弹层：首次进入强制起名字，之后可从顶栏修改
     --------------------------------------------------------- */
  function setNameMsg(text, kind) {
    if (!dom.nameMsg) return;
    dom.nameMsg.hidden = !text;
    dom.nameMsg.className = 'ghost-msg' + (kind ? ' ' + kind : '');
    dom.nameMsg.textContent = text || '';
  }
  function openNameModal(editable) {
    if (!dom.nameModal) return;
    NAME_EDITABLE = !!editable;
    if (dom.nameTitle) dom.nameTitle.textContent = NAME_EDITABLE ? '修改昵称' : '给自己起个名字';
    if (dom.nameInput) dom.nameInput.value = PROFILE.name;
    if (dom.closeNameBtn) dom.closeNameBtn.hidden = !NAME_EDITABLE;
    if (dom.nameCancelBtn) dom.nameCancelBtn.hidden = !NAME_EDITABLE;
    setNameMsg('');
    dom.nameModal.hidden = false;
    if (dom.nameInput) {
      try { if (dom.nameInput.focus) dom.nameInput.focus(); if (dom.nameInput.select) dom.nameInput.select(); } catch (e) { /* 测试沙箱无焦点 API 时忽略 */ }
    }
  }
  function closeNameModal() {
    // 首次进入必须输入昵称，不允许跳过
    if (!NAME_EDITABLE && !PROFILE.name) return;
    if (dom.nameModal) dom.nameModal.hidden = true;
  }
  function confirmName() {
    const name = cleanNick(dom.nameInput ? dom.nameInput.value : '');
    if (!name) { setNameMsg('昵称不能为空，也不能全是空格', 'bad'); return; }
    saveProfile(name);
    if (dom.nameModal) dom.nameModal.hidden = true;
    setNameMsg('');
    syncSideNames();
  }
  // 把昵称同步到 HUD 两侧（改名 / 开新局都会调）
  function syncSideNames() {
    if (dom.pNick) dom.pNick.textContent = nickName();
    if (dom.eNick) dom.eNick.textContent = enemyNick();
    if (dom.pPanel) dom.pPanel.style.setProperty('--side-color', SIDE.player.color);
    if (dom.ePanel) dom.ePanel.style.setProperty('--side-color', SIDE.enemy.color);
    if (dom.pPanel) dom.pPanel.style.setProperty('--side-bg', 'rgba(87,200,255,0.07)');
    if (dom.ePanel) dom.ePanel.style.setProperty('--side-bg', 'rgba(255,123,107,0.07)');
  }
  function syncMatchNames(pcName, ecName, pcColor, ecColor) {
    if (dom.pClassName) dom.pClassName.textContent = pcName;
    if (dom.eClassName) dom.eClassName.textContent = ecName;
    if (dom.pClassName && pcColor) dom.pClassName.style.color = pcColor;
    if (dom.eClassName && ecColor) dom.eClassName.style.color = ecColor;
    syncSideNames();
  }

  function drawMarble() {
    if (!SHOP.enabled) { showShopResult('商店暂未开放', 'bad'); return; }
    const pool = shopPool();
    if (!pool.length) { showShopResult('卡池为空，等待后台新增弹珠', 'bad'); return; }
    if (WALLET.coins < SHOP.drawCost) {
      showShopResult('金币不足：还差 ' + (SHOP.drawCost - WALLET.coins) + ' ' + SHOP.currency + '，多打几局再来', 'bad');
      return;
    }
    WALLET.coins -= SHOP.drawCost;
    const total = pool.reduce((a, e) => a + e.weight, 0);
    let roll = Math.random() * total, pick = pool[pool.length - 1];
    for (let i = 0; i < pool.length; i++) {
      roll -= pool[i].weight;
      if (roll <= 0) { pick = pool[i]; break; }
    }
    if (isOwned(pick.cls.id)) {
      WALLET.coins += SHOP.duplicateRefund;
      showShopResult('<span class="sr-name" style="color:' + pick.cls.color + '">' + pick.cls.name +
        '</span> · 重复获得，返还 ' + SHOP.duplicateRefund + ' ' + SHOP.currency, 'dup');
    } else {
      WALLET.owned.push(pick.cls.id);
      showShopResult('<span class="sr-name" style="color:' + pick.cls.color + '">' + pick.cls.name +
        '</span> · 已解锁！现在可以在职业选择中选用', 'new');
      sfx.pick();
    }
    saveWallet();
    renderShop();
    renderClassGrid();   // 解锁后立即刷新职业卡（保留已选中的高亮）
    updateCoinChips();
  }

  /* ---------------------------------------------------------
     9. 战斗体
     --------------------------------------------------------- */
  function emptyMods() {
    const m = {};
    MOD_KEYS.forEach(k => { m[k] = 0; });
    return m;
  }

  function makeFighter(side, cls) {
    return {
      side: side, cls: cls, color: cls.color,
      x: spawnPoint(side === 'player' ? 0 : 1).x,
      y: spawnPoint(side === 'player' ? 0 : 1).y, vx: 0, vy: 0,
      r: cls.radius, mods: emptyMods(),
      maxHp: cls.hp, hp: cls.hp, shield: 0,
      power: cls.power, mass: cls.mass, speed: cls.speed,
      combo: 0, firstHitUsed: false, slowUntil: -1, slowFactor: 1,
      dotDps: 0, dotUntil: -1, _statusTags: {},
      squash: 0, trail: [], lastDmgAt: -10
    };
  }

  function recompute(f) {
    const skills = f.side === 'player' ? G.playerSkills : G.enemySkills;
    const m = emptyMods();
    skills.forEach(s => Object.keys(s.mods).forEach(k => { m[k] += s.mods[k]; }));
    f.mods = m;
    f.maxHp = Math.round((f.cls.hp + m.maxHp) * EFFECTS.hpScale);
    f.power = f.cls.power * (1 + m.power);
    f.mass = f.cls.mass + m.mass;
    f.speed = f.cls.speed * (1 + m.speed);
    f.r = f.cls.radius;
  }

  function spawnPoint(i) {
    if (MAP && MAP.spawns && MAP.spawns[i]) return MAP.spawns[i];
    return { x: i === 0 ? CONFIG.ARENA_W * 0.24 : CONFIG.ARENA_W * 0.76, y: CONFIG.ARENA_H / 2 };
  }

  // 敌方（AI）初始朝向：大致指向玩家，附带随机散布，保证开局有碰撞节奏
  function enemyAimAngle() {
    const ps = spawnPoint(0), es = spawnPoint(1);
    let a = Math.atan2(ps.y - es.y, ps.x - es.x);
    a += rand(-0.5, 0.5);
    return a;
  }

  function resetForRound() {
    [G.player, G.enemy].forEach((f, i) => {
      recompute(f);
      f.hp = f.maxHp;
      f.shield = f.maxHp * f.mods.shield;
      const sp = spawnPoint(i);
      const jitter = MAP && MAP.spawnJitter != null ? MAP.spawnJitter : 55;
      f.x = clamp(sp.x, f.r, CONFIG.ARENA_W - f.r);
      f.y = clamp(sp.y + rand(-jitter, jitter), f.r, CONFIG.ARENA_H - f.r);
      // 初始发射：玩家用选定方向，敌方用指向玩家的朝向（联机时用房主转发的客机瞄准角）
      const aim = i === 0 ? G.playerAim : (P2P.active ? (P2P.guestAim || enemyAimAngle()) : enemyAimAngle());
      f.vx = Math.cos(aim) * CONFIG.LAUNCH_SPEED * f.speed;
      f.vy = Math.sin(aim) * CONFIG.LAUNCH_SPEED * f.speed;
      f.combo = 0;
      f.firstHitUsed = false;
      f.slowUntil = -1; f.slowFactor = 1;
      f.dotDps = 0; f.dotUntil = -1;
      f._statusTags = {};
      f._dotAccum = 0; f._dotLogAt = null;
      f.squash = 0;
      f.trail = [];
      f.lastDmgAt = -10;
    });
    G.lastImpact = -10;
    G.particles = [];
    G.floaters = [];
    G.clock = 0;
    initSkillCasters();   // 按当前双方技能重建节点图施放器
  }

  /* ---------------------------------------------------------
     10. 技能选择（每颗弹珠各自获得技能）
     --------------------------------------------------------- */
  function openDraft(title, sub) {
    // 超过「拥有的技能最大数量」时，不再弹出技能随机选项，直接进入瞄准阶段；
    // 玩家与对手同步受限（每回合双方各获得 1 个技能，封顶即同时停止）。
    const maxSkills = CONFIG.MAX_SKILLS != null ? CONFIG.MAX_SKILLS : 9;
    if (G.playerSkills.length >= maxSkills) {
      addLog('已达『拥有的技能最大数量』上限（' + maxSkills + '），本回合不再弹出技能选项', 'hl');
      setTimeout(startAimPhase, 60);
      return;
    }
    G.phase = 'draft';
    const draftCount = CONFIG.DRAFT_OPTIONS + EFFECTS.extraDraft;
    G.draftOptions = drawSkills(G.playerClass, G.playerSkills, draftCount);
    const enemyOptions = drawSkills(G.enemyClass, G.enemySkills, draftCount);
    G.enemyDraftPick = P2P.active ? null : enemyOptions[randInt(enemyOptions.length)];

    // 联机（房主）：为客机抽好技能牌发过去，客机只挑不发牌
    if (P2P.active && P2P.role === 'host') {
      P2P.guestOpts = enemyOptions;
      P2P.guestPick = false; P2P.myPickDone = false;
      p2pSend({ k: 'draft', r: G.round, opts: enemyOptions.map(s => s.id) });
    }

    dom.draftTitle.textContent = title;
    dom.draftSub.textContent = sub;
    dom.draftModal.hidden = false;
    // 卡牌正文：介绍优先，留空的技能仍显示自动生成的机制摘要；介绍由后台自由编辑，必须转义
    dom.draftCards.innerHTML = G.draftOptions.map((s, i) =>
      '<button class="skill-card" type="button" data-i="' + i + '" data-tier="' + escHtml(s.tier) + '"' +
      ' title="' + escHtml(s.intro ? s.intro + '\n【机制】' + s.desc : s.desc) + '">' +
      '<div class="sc-top"><span class="sc-name">' + escHtml(s.name) + '</span><span class="sc-tier">' + escHtml(TIER_NAME[s.tier]) + '</span></div>' +
      '<div class="sc-origin">' + escHtml(s.origin) + '</div>' +
      '<div class="sc-effect">' + escHtml(s.intro || s.desc) + '</div>' +
      '<div class="sc-hotkey">' + (i < 3 ? '按 ' + (i + 1) + ' 选择' : '点击选择') + '</div></button>'
    ).join('');
    dom.draftCards.querySelectorAll('.skill-card').forEach(btn => {
      btn.addEventListener('click', () => chooseSkill(Number(btn.dataset.i)));
    });
    dom.phaseLabel.textContent = '休整 · 选择技能';
    addLog('出现 ' + G.draftOptions.length + ' 个随机技能，对手也已选定技能', 'hl');
    updateScoreboard();
  }

  function chooseSkill(i) {
    if (G.phase !== 'draft' || !G.draftOptions[i]) return;
    G.phase = 'transition';   // 立即锁住，防止 260ms 内连点导致重复开回合
    const s = G.draftOptions[i];
    G.playerSkills.push(s);
    G.myPicks[G.round] = { skill: s.id, aim: null };   // 录制：这一回合我选的技能
    sfx.pick();
    G.draftOptions = [];
    dom.draftModal.hidden = true;
    dom.draftCards.innerHTML = '';

    if (P2P.active) {
      recompute(G.player); recompute(G.enemy);
      if (P2P.role === 'guest') {
        // 客机：技能自己先记上，选择上报给房主，然后等房主开瞄准阶段
        p2pSend({ k: 'draft_pick', r: G.round, i: i });
        addLog('我方获得「' + s.name + '」，等待房主进入瞄准阶段', 'good');
        showBanner('已选择', '等待其他玩家…', 0);
      } else {
        // 房主：等客机的 draft_pick 一起进瞄准
        P2P.myPickDone = true;
        addLog('我方获得「' + s.name + '」，等待对手选择技能', 'good');
        showBanner('已选择', '等待对手选择技能…', 0);
        if (P2P.guestPick) setTimeout(startAimPhase, 260);
      }
      return;
    }

    if (G.enemyDraftPick) G.enemySkills.push(G.enemyDraftPick);
    recompute(G.player);
    recompute(G.enemy);
    addLog('我方获得「' + s.name + '」，对手获得「' + (G.enemyDraftPick ? G.enemyDraftPick.name : '—') + '」', 'good');
    G.enemyDraftPick = null;
    setTimeout(startAimPhase, 260);
  }

  /* ---------------------------------------------------------
     10.8 对局天气：进入对撞阶段时按权重随机抽取（含无天气）
     --------------------------------------------------------- */
  function pickWeather() {
    G.weather = null;
    G.weatherFx = [];
    if (!WEATHER_CFG.enabled) return;
    const total = WEATHER_CFG.types.reduce((s, t) => s + t.weight, 0) + WEATHER_CFG.noneWeight;
    if (total <= 0) return;
    let r = Math.random() * total;
    let picked = null;
    for (let i = 0; i < WEATHER_CFG.types.length; i++) {
      if (r < WEATHER_CFG.types[i].weight) { picked = WEATHER_CFG.types[i]; break; }
      r -= WEATHER_CFG.types[i].weight;
    }
    if (!picked) return;   // 落在「无天气」权重区间

    if (picked.id === 'wind') {
      const dir = Math.random() < 0.5 ? -1 : 1;
      const force = rand(picked.forceMin, Math.max(picked.forceMin, picked.forceMax));
      G.weather = { id: 'wind', name: picked.name, dir: dir, force: force, sway: picked.sway };
      seedWindFx();
      addLog('本回合天气：' + picked.name + '（' + (dir > 0 ? '吹向右侧 →' : '吹向左侧 ←') + '，力度 ' + Math.round(force) + '）', 'hl');
    } else if (picked.id === 'rain') {
      G.weather = { id: 'rain', name: picked.name, slipExtra: picked.slip, rainForce: picked.rainForce };
      seedRainFx();
      addLog('本回合天气：' + picked.name + '（场地湿滑，反弹更活跃，雨幕向下压弹珠）', 'hl');
    } else {
      G.weather = { id: picked.id, name: picked.name };
      addLog('本回合天气：' + picked.name, 'hl');
    }
  }

  // 当前回合的湿滑系数：下雨 > 1，其余 = 1
  function weatherSlip() {
    return (G.weather && G.weather.id === 'rain') ? 1 + (G.weather.slipExtra || 0) : 1;
  }

  /* ---------------------------------------------------------
     11. 回合流程
     --------------------------------------------------------- */
  function beginRound() {
    G.round += 1;
    resetForRound();
    // 沿用瞄准阶段已确定的出生位，避免发射前弹珠位置跳动
    if (G.aimPos) {
      G.player.x = G.aimPos.p.x; G.player.y = G.aimPos.p.y;
      G.enemy.x = G.aimPos.e.x; G.enemy.y = G.aimPos.e.y;
      G.aimPos = null;
    }
    G.roundTime = CONFIG.ROUND_SECONDS;
    G.phase = 'fighting';
    pickWeather();   // 进入倒计时后随机抽取本回合天气（风 / 雨 / 无）
    // 联机（房主）：广播回合开始，客机同步天气后进入对撞
    if (P2P.active && P2P.role === 'host') {
      p2pSend({
        k: 'round_start', r: G.round,
        w: G.weather ? {
          id: G.weather.id, name: G.weather.name, dir: G.weather.dir,
          force: G.weather.force, sway: G.weather.sway,
          slipExtra: G.weather.slipExtra, rainForce: G.weather.rainForce
        } : null
      });
    }
    dom.phaseLabel.textContent = '对撞中';
    showBanner('第 ' + G.round + ' 回合', G.playerClass.name + '  对阵  ' + G.enemyClass.name, 900);
    resetRoundDmg();   // 本回合伤害统计清零（整局累计保留）
    addLog('第 ' + G.round + ' 回合<span class="sep-sub">双方血量重置</span>', 'sep');
    sfx.round();
    updateScoreboard();
  }

  function endRound(reason) {
    if (G.phase !== 'fighting') return;
    G.phase = 'rest';
    const p = G.player, e = G.enemy;
    const pp = clamp(p.hp / p.maxHp, 0, 1);
    const ep = clamp(e.hp / e.maxHp, 0, 1);
    let winner;
    if (reason === 'ko') {
      winner = p.hp <= 0 && e.hp <= 0 ? 'draw' : (p.hp <= 0 ? 'enemy' : 'player');
    } else if (Math.abs(pp - ep) < CONFIG.DRAW_WINDOW) {
      winner = 'draw';
    } else {
      winner = pp > ep ? 'player' : 'enemy';
    }
    const result = { round: G.round, pp: pp, ep: ep, winner: winner, reason: reason };
    G.roundResults.push(result);
    G.scores[winner] += 1;

    const label = winner === 'player' ? '本回合胜' : (winner === 'enemy' ? '本回合负' : '本回合平');
    addLog('第 ' + G.round + ' 回合结束 · ' + label + ' · 我方 ' + Math.round(pp * 100) + '% / 对手 ' + Math.round(ep * 100) + '%',
      winner === 'player' ? 'good' : (winner === 'enemy' ? 'bad' : 'hl'));
    const ds = G.dmgStats;
    addLog('回合伤害 · 我方 ' + Math.round(ds.round.player) + ' / 对手 ' + Math.round(ds.round.enemy) +
      ' · 累计 ' + Math.round(ds.total.player) + ' / ' + Math.round(ds.total.enemy) +
      ' · 命中 ' + ds.hits.player + ' / ' + ds.hits.enemy + ' 次', 'hl');
    showBanner(label, reason === 'ko' ? '一方弹珠被击碎' : '按剩余生命百分比判定', 1350);
    sfx.round();
    updateScoreboard();
    // 联机（房主）：广播回合结算，客机按同一份数据判定显示
    if (P2P.active && P2P.role === 'host') {
      p2pSend({
        k: 'round_end', r: G.round, w: winner, reason: reason,
        pp: Math.round(pp * 100) / 100, ep: Math.round(ep * 100) / 100,
        sc: { player: G.scores.player, enemy: G.scores.enemy, draw: G.scores.draw }
      });
    }
    emitPreview('round', { round: G.round, winner: winner, pp: Math.round(pp * 100), ep: Math.round(ep * 100) });

    setTimeout(() => {
      if (G.round >= CONFIG.TOTAL_ROUNDS) {
        showResult();
      } else {
        openDraft('第 ' + G.round + ' 回合休整 · 随机三选一', '再选一个技能，与已有技能叠加生效');
      }
    }, 1400);
  }

  /* ---------------------------------------------------------
     12. 伤害与撞击结算
     --------------------------------------------------------- */
  /* 战斗记录 · 伤害统计：所有造成伤害的路径都必须经过这里，
     这样撞击、技能、区域/墙面残留、荆棘反伤、持续伤害(dot)、回响都能被完整统计，
     不会漏掉任何一笔。 */
  function resetDmgStats() {
    G.dmgStats = {
      total: { player: 0, enemy: 0 },
      round: { player: 0, enemy: 0 },
      byKind: { player: {}, enemy: {} },
      hits: { player: 0, enemy: 0 }
    };
    renderDmgSummary();
  }
  function resetRoundDmg() {
    G.dmgStats.round.player = 0; G.dmgStats.round.enemy = 0;
    renderDmgSummary();
  }
  /* 伤害来源标签：技能伤害一律带技能名，战斗记录里能直接看出是哪一招打的。
     · 字符串  = 纯机制来源（撞击 / 荆棘反伤 / 区域残留 …）
     · { name, tag } = name 是计入统计的主标签（技能名），tag 是机制补充（区域 / 印记 / 回响 …）
     统计按 name 聚合，所以「同一技能的直伤 + 区域 + 印记」会归到同一个技能名下。 */
  function dmgLabel(label) {
    if (label && typeof label === 'object') {
      const name = String(label.name == null ? '' : label.name).trim();
      const tag = String(label.tag == null ? '' : label.tag).trim();
      return { name: name || '技能', tag: tag };
    }
    const s = String(label == null ? '' : label).trim();
    return { name: s || '撞击', tag: '' };
  }
  // 技能名兜底：编译层没带 name（旧编译缓存 / 外部构造的 C）时退回「技能」
  function skillLabel(C, tag) {
    const n = String((C && C.name) || '').trim();
    return { name: n || '技能', tag: tag || '' };
  }

  function recordDamage(target, dmg, src, crit, label, logIt) {
    if (!G.dmgStats) resetDmgStats();
    if (!(dmg > 0)) return;   // 过滤 0 / 负数 / NaN，避免污染累计值
    const s = G.dmgStats;
    // src 决定「谁造成的」；dot 等无明确 src 的按受害方反推
    const side = (src && src.side === 'enemy') ? 'enemy'
      : (src && src.side === 'player') ? 'player'
        : (target && target.side === 'player' ? 'enemy' : 'player');
    const L = dmgLabel(label);
    s.total[side] += dmg;
    s.round[side] += dmg;
    s.byKind[side][L.name] = (s.byKind[side][L.name] || 0) + dmg;
    s.hits[side] += 1;
    if (logIt !== false) {
      const who = side === 'player' ? '我方 → 对手' : '对手 → 我方';
      const pct = Math.round(clamp((target && target.hp || 0) / (target && target.maxHp || 1), 0, 1) * 100);
      const remain = (target && target.side === 'player') ? '我方' : '对手';
      /* 逐笔明细用「四列栅格」而不是一长串文字：方向 / 伤害 / 来源 / 剩余，
         数值右对齐，扫一眼就能看出这一下是谁打的、打了多少、还剩多少。 */
      addLog(
        '<span class="lg-dir">' + who + '</span>' +
        '<span class="lg-val">-' + Math.round(dmg) + '</span>' +
        '<span class="lg-src"><b title="' + escHtml(L.name) + '">' + escHtml(L.name) + '</b>' +
        (L.tag ? '<i>' + escHtml(L.tag) + '</i>' : '') +
        (crit ? '<i class="lg-crit">暴击</i>' : '') + '</span>' +
        '<span class="lg-hp">' + remain + ' ' + pct + '%</span>',
        side === 'player' ? 'dmg-own' : 'dmg-enemy');
    }
    renderDmgSummary();
  }
  function renderDmgSummary() {
    const el = dom.dmgSummary;
    if (!el || !G.dmgStats) return;
    const s = G.dmgStats, fmt = n => String(Math.round(n));
    // 来源按伤害从高到低排，主次一眼分明
    const chips = side => {
      const k = s.byKind[side] || {};
      const keys = Object.keys(k).filter(x => k[x] > 0).sort((a, b) => k[b] - k[a]);
      if (!keys.length) return '<span class="ds-empty">暂无</span>';
      return keys.map(x =>
        '<span class="ds-chip" title="' + escHtml(x) + '"><b>' + escHtml(x) + '</b>' + fmt(k[x]) + '</span>').join('');
    };
    const row = (side, cls, label) => '<div class="ds-row ' + cls + '">' +
      '<span class="ds-who">' + label + '</span>' +
      '<span class="ds-cell"><i>累计</i><b>' + fmt(s.total[side]) + '</b></span>' +
      '<span class="ds-cell"><i>本回合</i><b>' + fmt(s.round[side]) + '</b></span>' +
      '<span class="ds-cell"><i>次数</i><b>' + s.hits[side] + '</b></span>' +
      '</div>';
    el.innerHTML =
      '<div class="ds-head">伤害统计<span class="ds-sub">全部来源 · 累计 / 本回合</span></div>' +
      '<div class="ds-table">' + row('player', 'ds-own', '我方') + row('enemy', 'ds-enemy', '对手') + '</div>' +
      '<div class="ds-src">' +
      '<div class="ds-src-row"><span class="ds-src-tag ds-own">我方</span>' +
      '<span class="ds-chips">' + chips('player') + '</span></div>' +
      '<div class="ds-src-row"><span class="ds-src-tag ds-enemy">对手</span>' +
      '<span class="ds-chips">' + chips('enemy') + '</span></div>' +
      '</div>';
  }

  function applyDamage(target, dmg, src, crit, isThorns, kind, dispDmg) {
    if (dmg <= 0) return;
    let left = dmg;
    if (target.shield > 0) {
      const absorbed = Math.min(target.shield, left);
      target.shield -= absorbed;
      left -= absorbed;
    }
    target.hp = Math.max(0, target.hp - left);
    target.squash = Math.min(0.5, target.squash + 0.22);
    target.lastDmgAt = G.clock;
    recordDamage(target, dmg, src, crit, kind || (isThorns ? '荆棘反伤' : '撞击'));
    addFloater(target.x, target.y - target.r - 6, '-' + Math.round(dispDmg != null ? dispDmg : dmg),
      crit ? '#ffd76a' : (isThorns ? '#b9a0f0' : '#ff9a92'), crit ? 20 : 15);
    // 「护盾 · 屏障」附带的临时反伤
    if (!isThorns && src && src !== target && (target._thornsBoost || 0) > 0) {
      applyDamage(src, dmg * target._thornsBoost, target, false, true);
    }
    updateHud();
  }

  /* ---------- 击退与击飞撞墙 ----------
     伤害模块里的「击退力度」在这里真正落地：沿「施法者 → 受击者」方向给一个冲量。
     同时给受击者打上「刚被技能击飞」的标记，短时间内撞墙就结算该技能的「撞墙时」组，
     这就是「被技能命中后撞到墙造成伤害」的实现（旧版 onWall 只认施法者自己撞墙）。 */
  function applyKnockback(target, att, kb) {
    if (!(kb > 0) || !target || !att || target.dead || target.hp <= 0) return;
    const ang = Math.atan2(target.y - att.y, target.x - att.x) || 0;
    const imp = kb * 2.4;   // 数值口径：400 上限约等于一次强力弹开
    target.vx += Math.cos(ang) * imp;
    target.vy += Math.sin(ang) * imp;
    /* 冲量当帧会被速度上限吃掉：与运动器一样临时放宽 cap，否则「调了数值没感觉」 */
    const sp = Math.hypot(target.vx, target.vy);
    target._motionCapUntil = Math.max(target._motionCapUntil || 0, G.clock + 0.4);
    target._motionCap = Math.max(target._motionCap || 0, sp);
  }
  function tagSlam(target, att, C) {
    if (!target || !att || !C || target === att) return;
    target._slamUntil = G.clock + 1.6;
    target._slamC = C;
    target._slamOwner = att;
  }
  /* 被击飞的单位撞墙：结算该技能「触发事件 = 撞墙时」的伤害。
     伤害节点按 wall 来源过滤——只有撞墙组的伤害会在这里生效，其它组不会误触发。 */
  function resolveSlamDamage(f, contact) {
    if (!f || !f._slamUntil) return;
    if (G.clock > f._slamUntil) { f._slamUntil = 0; f._slamC = null; f._slamOwner = null; return; }
    const C = f._slamC, owner = f._slamOwner;
    f._slamUntil = 0; f._slamC = null; f._slamOwner = null;
    if (!C || !owner) return;
    const SM = SKILL_RT && SKILL_RT.SM;
    const PUB = (SM && SM.publicView) ? SM.publicView(C) : C;
    const grp = PUB.events && PUB.events.onWall;
    if (!grp || !SM || !SM.damageNodesFor) return;
    const hasEnemy = SM.damageNodesFor(grp, 'wall', 'enemy').length > 0;
    const hasSelf = SM.damageNodesFor(grp, 'wall', 'self').length > 0;
    if (!hasEnemy && !hasSelf) return;
    const ctx = { caster: owner, opponent: f, point: { x: f.x, y: f.y }, targets: [f], kind: 'wall' };
    if (hasEnemy) {
      const d = computeSkillDamage(grp, owner, f, 1, ctx, 'enemy');
      if (d.amount > 0) {
        applyDamage(f, d.amount, owner, d.crit, false, skillLabel(C, '撞墙'));
        spawnSkillBurst(PUB, f.x, f.y, contact ? Math.atan2(contact.ny, contact.nx) : 0, 'wall', owner, contact, ctx);
      }
    }
    if (hasSelf) {
      const sd = computeSkillDamage(grp, owner, owner, 1, ctx, 'self');
      if (sd.amount > 0) applyDamage(owner, sd.amount, owner, sd.crit, false, skillLabel(C, '撞墙反噬'));
    }
  }

  /* 施放时伤害：触发事件 = 施放时 的伤害节点在技能释放瞬间结算。
     目标由「目标 · 锁定」模块决定（自身 / 单个敌人 / 多个敌人 / 队友），
     没有接锁定模块时按旧行为打对手。 */
  function castTargetsOf(C, att, opp) {
    const SM = SKILL_RT && SKILL_RT.SM;
    const ents = [G.player, G.enemy].concat(G.enemies || []);
    if (SM && SM.selectTargets && C && C.present && C.present.select) {
      const ts = SM.selectTargets(C, att, ents);
      if (ts.length) return ts;
    }
    return opp ? [opp] : [];
  }
  /* 通用「按组结算伤害」：命中 / 施放 / 撞墙共用一套，保证击退与撞墙标记不漏。
     targets 里包含施法者时按自伤口径结算，其余按敌伤口径。 */
  function applyGroupDamage(grp, C, att, targets, kind, ctx, labelSuffix) {
    if (!grp || !att) return 0;
    let total = 0;
    (targets || []).forEach(t => {
      if (!t || t === att) return;
      const d = computeSkillDamage(grp, att, t, 1, ctx, 'enemy');
      if (d.amount > 0) {
        applyDamage(t, d.amount, att, d.crit, false, skillLabel(C, labelSuffix));
        applyKnockback(t, att, Math.max(d.knockback, (SM && SM.skillKnockback) ? SM.skillKnockback(C) : 0));
        tagSlam(t, att, C);
        total += d.amount;
      }
    });
    // 反噬 / 自伤：无论目标列表里有没有自己，带 self 节点就结算一次
    const selfD = computeSkillDamage(grp, att, att, 1, ctx, 'self');
    if (selfD.amount > 0) {
      applyDamage(att, selfD.amount, att, selfD.crit, false, skillLabel(C, labelSuffix || '反噬'));
      total += selfD.amount;
    }
    return total;
  }
  function applyEventCastDamage(C, att, opp) {
    const grp = C && C.events && C.events.onCast;
    if (!grp) return;
    const SM = SKILL_RT && SKILL_RT.SM;
    if (!SM || !SM.damageNodesFor) return;
    const hasEnemy = SM.damageNodesFor(grp, 'cast', 'enemy').length > 0;
    const hasSelf = SM.damageNodesFor(grp, 'cast', 'self').length > 0;
    if (!hasEnemy && !hasSelf) return;   // 施放时组没有伤害节点：纯表现 / 增益技能，不结算
    const targets = hasEnemy ? castTargetsOf(C, att, opp) : [];
    const ctx = {
      caster: att, opponent: opp || null,
      entities: [G.player, G.enemy].concat(G.enemies || []),
      angle: 0, point: { x: att.x, y: att.y }, targets: targets, kind: 'cast'
    };
    applyGroupDamage(grp, C, att, targets, 'cast', ctx, '施放');
  }

  function resolveHit(p, e, nx, ny, vn) {
    // 各自朝法线正/反方向的冲击速度，决定本次撞击的攻守占比
    const pv = Math.max(0, p.vx * nx + p.vy * ny);
    const ev = Math.max(0, -(e.vx * nx + e.vy * ny));
    const share = pv + ev > 0 ? pv / (pv + ev) : 0.5;
    const t = clamp(vn / 700, 0, 1.3);
    const base = CONFIG.DMG_BASE + t * CONFIG.DMG_SPEED;

    hitOnce(p, e, base * (0.55 + 0.9 * share), t);
    hitOnce(e, p, base * (0.55 + 0.9 * (1 - share)), t);

    // 反馈分层：粒子 / 定格 / 震屏 / 闪光 / 音效
    const cx = (p.x + e.x) / 2, cy = (p.y + e.y) / 2;
    spawnSparks(cx, cy, nx, ny, Math.round(9 + t * 12), p.color, e.color);
    G.trauma = clamp(G.trauma + 0.22 + t * 0.30, 0, 1);
    G.hitStopUntil = performance.now() + (t > 0.7 ? CONFIG.HIT_STOP_MS : CONFIG.HIT_STOP_MS * 0.6);
    G.flash = Math.min(0.16, 0.05 + t * 0.09);
    sfx.hit();
  }

  function hitOnce(att, def, pctBase, t) {
    if (def.mods.dodge > 0 && Math.random() < def.mods.dodge) {
      addFloater(def.x, def.y - def.r - 6, '闪避', '#a8d8ff', 14);
      emitPreview('dodge', { target: def.side });
      return;
    }
    let mult = att.power;
    const crit = Math.random() < (CONFIG.CRIT_BASE + att.mods.crit);
    if (crit) mult *= CONFIG.CRIT_MULT_BASE + att.mods.critMult;
    if (!att.firstHitUsed) {
      mult *= 1 + att.mods.firstStrike;
      att.firstHitUsed = true;
    }
    if (def.hp / def.maxHp < 0.4) mult *= 1 + att.mods.execute;
    mult *= 1 + Math.min(att.combo, 6) * att.mods.combo;
    mult *= 1 + t * att.mods.momentum;
    // 印记：弹珠对撞同样吃「每层增伤 / 破甲」，否则印记在弹珠对撞为主的局面里几乎没有价值
    let armorEff = Math.min(def.mods.armor, 0.65);
    if (def._markUntil > G.clock && def._markStacks > 0 && def._markCfg) {
      const mc = def._markCfg;
      if (mc.damageAmp) mult *= 1 + (mc.damageAmp / 100) * def._markStacks;
      if (mc.armorBreak) armorEff -= mc.armorBreak * def._markStacks;
    }
    mult /= 1 + Math.max(-0.5, armorEff);

    const dmg = def.maxHp * pctBase * mult * EFFECTS.dmgScale;
    applyDamage(def, dmg, att, crit, false);
    emitPreview('hit', {
      src: att.side, target: def.side, crit: crit, dmg: Math.round(dmg),
      targetHp: Math.round(def.hp), targetMax: def.maxHp,
      targetPct: Math.round(clamp(def.hp / def.maxHp, 0, 1) * 100),
      round: G.round
    });

    if (def.mods.thorns > 0) {
      const td = dmg * def.mods.thorns;
      applyDamage(att, td, def, false, true);
      emitPreview('thorns', { src: def.side, target: att.side, dmg: Math.round(td), targetHp: Math.round(att.hp), targetMax: att.maxHp, targetPct: Math.round(clamp(att.hp / att.maxHp, 0, 1) * 100), round: G.round });
    }
    if (att.mods.lifesteal > 0) att.hp = Math.min(att.maxHp, att.hp + dmg * att.mods.lifesteal);
    if (att.mods.slow > 0) {
      def.slowUntil = G.clock + 1.3;
      def.slowFactor = 1 - Math.min(att.mods.slow, 0.6);
    }
    if (att.mods.dot > 0) {
      def.dotDps = Math.min(def.maxHp * 0.09, def.dotDps + def.maxHp * att.mods.dot);
      def.dotUntil = G.clock + 3.2;
    }
    att.combo = Math.min(6, att.combo + 1);
    if (crit) sfx.crit();
  }

  /* ---------------------------------------------------------
     13. 物理步进
     --------------------------------------------------------- */
  /* 地图障碍碰撞：矩形 / 圆形，障碍视为无限质量 */
  function resolveObstacles(f) {
    if (!MAP || !MAP.obstacles || !MAP.obstacles.length) return false;
    let hit = false;   // 是否发生障碍碰撞：运动器据此提前交还控制权
    MAP.obstacles.forEach(ob => {
      const bounce = (ob.bounce == null ? 0.9 : ob.bounce) * weatherSlip();   // 下雨湿滑：障碍反弹更弹
      if (ob.type === 'circle') {
        let dx = f.x - ob.x, dy = f.y - ob.y;
        let d = Math.hypot(dx, dy);
        const min = f.r + (ob.r || 0);
        if (d < min) {
          hit = true;
          if (d < 0.001) { dx = 1; dy = 0; d = 1; }
          const nx = dx / d, ny = dy / d;
          f.x = ob.x + nx * min; f.y = ob.y + ny * min;
          const vn = f.vx * nx + f.vy * ny;
          if (vn < 0) { f.vx -= (1 + bounce) * vn * nx; f.vy -= (1 + bounce) * vn * ny; }
        }
      } else {
        const hw = (ob.w || 0) / 2, hh = (ob.h || 0) / 2;
        const cx = clamp(f.x, ob.x - hw, ob.x + hw);
        const cy = clamp(f.y, ob.y - hh, ob.y + hh);
        let dx = f.x - cx, dy = f.y - cy;
        const d = Math.hypot(dx, dy);
        if (d < f.r) {
          hit = true;
          if (d < 0.001) {
            const dl = Math.abs(f.x - (ob.x - hw)), dr = Math.abs((ob.x + hw) - f.x);
            const dtp = Math.abs(f.y - (ob.y - hh)), db = Math.abs((ob.y + hh) - f.y);
            const m = Math.min(dl, dr, dtp, db);
            if (m === dl) { f.x = ob.x - hw - f.r; f.vx = -Math.abs(f.vx) * bounce; }
            else if (m === dr) { f.x = ob.x + hw + f.r; f.vx = Math.abs(f.vx) * bounce; }
            else if (m === dtp) { f.y = ob.y - hh - f.r; f.vy = -Math.abs(f.vy) * bounce; }
            else { f.y = ob.y + hh + f.r; f.vy = Math.abs(f.vy) * bounce; }
            return;
          }
          const nx = dx / d, ny = dy / d;
          f.x = cx + nx * f.r; f.y = cy + ny * f.r;
          const vn = f.vx * nx + f.vy * ny;
          if (vn < 0) { f.vx -= (1 + bounce) * vn * nx; f.vy -= (1 + bounce) * vn * ny; }
        }
      }
    });
    f.x = clamp(f.x, f.r, CONFIG.ARENA_W - f.r);
    f.y = clamp(f.y, f.r, CONFIG.ARENA_H - f.r);
    return hit;
  }

  /* =========================================================
     12.5 模块化技能运行时（节点图 → 战斗中实时施放）
     - 与后台技能编辑器、skill-modules / skill-effects / pixelfx 共用同一套 schema
     - 被动属性（stats 节点）已在 recompute() 通过 skill.mods 生效
     - 此处只负责「主动」部分：source 触发 → 投射物 / 特效 / 粒子 / 伤害 / 状态
     - 若运行时未加载（异常），整个模块静默降级为纯被动技能
     ========================================================= */
  const SKILL_RT = (window.SkillEffects && window.SkillModules) ? { SE: window.SkillEffects, SM: window.SkillModules } : null;
  // 运动器引擎与技能运行时解耦：即使引擎缺失，其余技能效果仍可正常工作
  const MOTION = window.MotionEngine || null;

  function initSkillCasters() {
    if (!SKILL_RT) return;
    ['player', 'enemy'].forEach(side => {
      const f = side === 'player' ? G.player : G.enemy;
      if (!f) return;
      const list = (side === 'player' ? G.playerSkills : G.enemySkills) || [];
      f._skillCasters = [];
      list.forEach(s => {
        const C = s.compiled;
        if (!C || !C.active) return;
        const sources = (C.sources || []).filter(src => src.enabled !== false);
        if (!sources.length) return;
        // charge：0~1 的充能进度。对局 / 每回合开始一律「未充能」起步，
        // 只有触发时机=回合开始 属于事件型触发，可不受充能条限制在开局立即释放；
        // 定时循环 / 充能完成时 以及所有事件型触发都必须先充满才能放第一发。
        f._skillCasters.push({
          C: C, sid: s.id, charge: 0,
          sources: sources.map(src => ({ src: src, at: 0, n: 0, lastEv: -10 }))
        });
      });
    });
    G.skillShots = []; G.skillFx = []; G.skillParts = []; G.skillZones = []; G.skillEchoes = []; G.skillWallHazards = []; G.skillAuras = []; G.skillChannels = []; G.skillDotZones = []; G._pendingProjMovers = [];
    if (MOTION) MOTION.clear(G.movers, { now: G.clock }); else G.movers = [];
  }

  // 技能充能秒数（0 或非法值回落到默认）
  function skillChargeTime(C) {
    const v = C && C.charge;
    return (typeof v === 'number' && v > 0) ? Math.max(0.2, v) : 3;
  }

  // 事件型 source（onHit / onWall / onLowHp / onCast）统一触发入口，带 0.4s 防抖
  function triggerSkillEvent(f, type, contact, meta) {
    if (!SKILL_RT || !f._skillCasters) return;
    f._skillCasters.forEach(caster => {
      /* 本体碰撞窗口：技能刚施放、本体还在冲刺途中，这时的物理碰撞属于「这一发技能命中」。
         注意必须放在 source.trigger 过滤之前——冲锋/突进通常由「充能完成时」触发，
         若先按 trigger==='onHit' 过滤，这条分支永远走不到，表现就是撞上了也不掉血。
         直接结算「命中时」组，不重新施放、也不要求充能（充能在施放瞬间已清零）。 */
      if (meta && meta.kind === 'body' && caster.bodyUntil && G.clock <= caster.bodyUntil) {
        caster.bodyUntil = 0;
        resolveBodyHit(f, caster.C);
        return;
      }
      caster.sources.forEach(s => {
        if (s.src.trigger !== type || s.src.enabled === false) return;
        if (caster.charge < 1) return;          // 未充能完毕：不释放，也不消耗次数
        if (G.clock - s.lastEv < 0.4) return;
        if (s.src.maxCasts > 0 && s.n >= s.src.maxCasts) return;
        s.lastEv = G.clock; s.n += 1;
        caster.charge = 0;                    // 同一个技能共用一条充能，放完立刻清零
        fireSkillCast(f, caster.C, s.src, true, contact, meta);
      });
    });
  }

  /* 本体碰撞命中的纯结算入口：只走「命中时」组（伤害 / 状态 / 印记 / 特效），
     不再重播「施放时」组——否则一次碰撞会把冲锋位移、护盾、施放特效全都再放一遍。 */
  function resolveBodyHit(f, C) {
    const opp = (f.side === 'player') ? G.enemy : G.player;
    if (!C || !opp || opp === f) return;
    const SM = SKILL_RT && SKILL_RT.SM;
    const PUB = (SM && SM.publicView) ? SM.publicView(C) : C;
    directHit(PUB, f, opp, 'body');
  }

  function fireSkillCast(f, C, src, isEvent, contact, meta) {
    if (!SKILL_RT || !f) return;
    const opp = (f.side === 'player') ? G.enemy : G.player;
    if (!opp) return;
    const SM = SKILL_RT.SM;
    // 技能级公共视图：只含没有绑定到任何载体的模块，施放阶段统一播一次
    const PUB = (SM.publicView ? SM.publicView(C) : C);
    /* 本体碰撞窗口：命中时组里有「弹珠碰撞」伤害、且本次施放不是碰撞触发的，
       为这一发开一个窗口（覆盖位移时长）。窗口内的物理碰撞算这一发的命中，
       不会重新施放、也不受充能条拦截；每次施放只认一次碰撞。 */
    (function armBodyWindow() {
      if (!SM || !SM.onHitNeedsContact) return;
      if (meta && meta.kind) return;
      const onHitGrp = (PUB.events && PUB.events.onHit) || PUB;
      if (!SM.onHitNeedsContact(onHitGrp)) return;
      // 只有真的配了「弹珠碰撞」伤害才开窗：投射物技能的身体摩擦不该触发它的命中组
      const hasBodyNode = !!SM.damageNodesFor &&
        (SM.damageNodesFor(onHitGrp, 'body', 'enemy').length > 0 ||
         SM.damageNodesFor(onHitGrp, 'body', 'self').length > 0);
      // 只配了「撞墙时」伤害 + 自身位移：命中这一下不打伤害，但要负责击退并标记撞墙
      const wallOnly = !hasBodyNode && SM.skillNeedsContact && SM.skillNeedsContact(PUB) &&
        (SM.skillKnockback ? SM.skillKnockback(PUB) > 0 : false);
      if (!hasBodyNode && !wallOnly) return;
      const castGrp = (PUB.events && PUB.events.onCast) || PUB;
      const moveDur = (castGrp.motion || []).reduce((a, m) => Math.max(a, Number(m.duration) || 0), 0);
      const win = Math.max(1.0, moveDur + 0.4);
      (f._skillCasters || []).forEach(c => { if (c.C === C) c.bodyUntil = G.clock + win; });
    })();
    // 本次施放的「投射物绑定」待挂队列：applyEventEffects 里登记，投射物真正发射后再结算
    G._pendingProjMovers = [];
    let baseAngle = null;
    if (src.aim === 'forward') baseAngle = Math.atan2(f.vy, f.vx) || 0;
    else if (src.aim === 'random') baseAngle = Math.random() * Math.PI * 2;
    else if (src.aim === 'mouse' || src.aim === 'fixed') baseAngle = (src.angle || 0) * Math.PI / 180;
    // 施法时事件（onCast）：公共的特效 / 粒子 / 自身状态 / 位移 / 护盾 / 光环
    applyEventEffects(PUB, f, opp, 'onCast', f.x, f.y, 0);
    /* 施放时伤害：伤害模块的触发事件选「施放时」时，释放瞬间就结算（目标由「目标·锁定」决定） */
    applyEventCastDamage(PUB, f, opp);
    // 弹珠本体撞墙：把「撞墙时(onWall)」分组的特效 / 墙面残留伤害直接结算在接触面上
    // （source.trigger=弹珠撞墙时 时才有 contact；投射物撞墙走 skillShotWall）
    if (src.trigger === 'onWall' && contact) {
      const wallRot = Math.atan2(contact.ny, contact.nx);
      applyEventEffects(PUB, f, opp, 'onWall', contact.x, contact.y, wallRot, contact);
    }

    /* 载体分派：连线在此真正生效。
       每个「投射物 / 光环 / 指向性 / 区域」节点都是一个可独立组合的实体；
       连在它后面的模块，属性只进入它自己的结算视图（公共模块仍对所有实体生效）。 */
    const hosts = (SM.hostsOf ? SM.hostsOf(C) : []) || [];
    const targeted = hosts.filter(h => h.type === 'targeted');
    let projectiles = hosts.filter(h => h.type === 'projectile');
    // 旧编译结果 / 外部构造的 C 没有载体清单：回退成技能级单投射物，行为与旧版一致
    if (!hosts.length && C.present && C.present.projectile) projectiles = [{ id: '', type: 'projectile', cfg: C.projectile || {} }];
    const viewOf = h => (h.id && SM.viewFor ? SM.viewFor(C, h.id) : C);
    const exclusiveOf = h => (h.id && SM.exclusiveView ? SM.exclusiveView(C, h.id) : null);

    // 指向性法术优先：不产生投射物，直接锁定目标按「立即 / 延迟 / 持续引导」结算
    if (targeted.length) {
      G._pendingProjMovers = [];   // 不发射投射物：投射物绑定无处可挂
      castTargetedModule(viewOf(targeted[0]), f, opp);
      if (!isEvent) triggerSkillEvent(f, 'onCast');
      return;
    }
    /* 既没有「投射物」也没有「指向性」模块：
       · 命中时组里有「弹珠碰撞 / 投射物命中」的伤害 → 必须等真实接触（物理碰撞再触发本函数），
         这里绝不结算，否则就是冲锋没碰到人也扣血；
       · 其余情况保持旧行为：整组直接结算在对手身上（等价必中单体指向）。 */
    if (!projectiles.length) {
      G._pendingProjMovers = [];
      const needsContact = (SM && SM.skillNeedsContact)
        ? SM.skillNeedsContact(PUB) : ((SM && SM.onHitNeedsContact) ? SM.onHitNeedsContact((PUB.events && PUB.events.onHit) || PUB) : false);
      const hitKind = (meta && meta.kind) ? meta.kind : null;
      if (hitKind) directHit(PUB, f, opp, hitKind);          // 真实碰撞 / 投射物触发的命中
      else if (!needsContact) directHit(PUB, f, opp, 'direct');
      // 需要真实接触但本次不是接触触发：只留施放表现，等物理碰撞再来
      if (!isEvent) triggerSkillEvent(f, 'onCast');
      return;
    }

    projectiles.forEach(h => {
      const VC = viewOf(h);
      const EX = exclusiveOf(h);
      // 该载体专属的「施放时」模块每个载体各播一次，不会串到别的载体上
      if (EX) applyEventEffects(EX, f, opp, 'onCast', f.x, f.y, 0);
      const form = (VC.projectile && VC.projectile.delivery) || 'projectile';
      if (form === 'projectile' || form === 'summon') {
        const shots = SKILL_RT.SE.spawnProjectiles(VC, f, opp, baseAngle);
        const projName = (VC.projectile && VC.projectile.name) || '';
        shots.forEach(q => {
          q._owner = f; q._C = VC; q._projName = projName; q._hostId = h.id;
          if (form === 'summon') { q.summon = true; q.lifetime = (VC.projectile.summonDur || 6); q.homing = Math.max(q.homing || 0, 0.5); }
          G.skillShots.push(q);
        });
        // 跟随投射物的像素特效：只替换「这个载体」的弹体外观
        const projFx = VC.projectileFx || [];
        if (projFx.length) {
          shots.forEach((s, i) => {
            const fx = projFx[i % projFx.length];
            s._skinFx = true;   // 先标记，避免异步创建期间闪现手绘弹体
            SKILL_RT.SE.spawnFx([fx], 'projectile', s.x, s.y, s.rot).then(arr => {
              if (!arr.length) { s._skinFx = false; return; }   // 特效创建失败：回退到手绘弹体
              arr.forEach(a => { a.follow = s; a.x = s.x; a.y = s.y; a.born = performance.now(); });
              SKILL_RT.SE.pushFx(G.skillFx, arr);
            });
          });
        }
        // 「投射物绑定」运动器：只把本 carrier 的待挂项补到这一批弹上
        resolvePendingProjMovers(shots, h.id);
      } else if (!SM.rangeDescriptor || !SM.targetsInRange || !SM.rangePoint) {
        // 旧编译层被浏览器缓存时兜底，避免整局抛错（用户 Ctrl+F5 后走下面的新链路）
        const pt = formPoint(VC, f, opp, baseAngle, form);
        const targets = formTargets(VC, f, opp, pt, form);
        if (targets.length) resolveAt(VC, f, pt.x, pt.y, Math.atan2(pt.y - f.y, pt.x - f.x), 'onHit', targets, undefined, undefined, 'area');
      } else {
        /* 即时形态（近战 / 区域落点 / 射线）：统一走编译层的「范围判定」。
           旧实现把命中整组直接结算在唯一对手身上（melee 只做一次「太远就不放」的二值判断），
           aoe 落点更是取「到对手的距离」= 自动追踪全图 —— 视觉上就是全图范围判定。
           现在：先算出判定区域 → 只挑区域内的敌方 → 命中表现也画在判定点，不再画到对手身上。 */
        const ctx = {
          caster: f, opponent: opp,
          entities: [G.player, G.enemy].concat(G.enemies || []),
          angle: baseAngle, point: null, targets: []
        };
        const desc = SM.rangeDescriptor(VC, ctx);
        const pt = SM.rangePoint(desc, ctx);
        ctx.point = pt;
        ctx.desc = desc;
        ctx.targets = SM.targetsInRange(desc, ctx);
        if (ctx.targets.length) {
          resolveAt(VC, f, pt.x, pt.y, desc.angle, 'onHit', ctx.targets, undefined, ctx, 'area');
        } else {
          // 空挥：只在判定点播一次表现，不结算伤害 / 状态 / 震屏
          spawnSkillBurst(VC, pt.x, pt.y, desc.angle, 'impact', f, null, ctx);
        }
      }
    });
    G._pendingProjMovers = [];
    if (!isEvent) triggerSkillEvent(f, 'onCast');
  }

  function evToAttach(ev) { return ({ onCast: 'launch', onHit: 'impact', onWall: 'wall', onExpire: 'expire' })[ev] || 'impact'; }

  /* 敌方实体列表：供「敌方弹珠身上」的特效/粒子选靶。
     当前对局是 1v1（G.player / G.enemy），这里已经预留多敌人扩展位：
     后续把额外敌人放进 G.enemies 数组，最近 / 随机 / 全部 三种规则会自动覆盖它们。 */
  function enemiesOf(ent) {
    if (!ent) return [];
    const out = [];
    const add = e => {
      if (!e || e === ent || e.dead) return;
      if (e.side && ent.side && e.side === ent.side) return;
      if (e.hp != null && e.hp <= 0) return;
      if (out.indexOf(e) < 0) out.push(e);
    };
    add(ent.side === 'player' ? G.enemy : G.player);
    (G.enemies || []).forEach(add);
    return out;
  }

  /* 同组的印记持续时长：挂在敌方身上的循环特效据此跟随印记结束。
     同组没有印记时回退到本技能其它事件组的印记，跨组配置（如命中挂印记、施放播特效）也能正确联动。 */
  function groupMarkLifeOf(C, grp) {
    const pick = g => ((g && g.mark) || []).reduce((a, m) => Math.max(a, Number(m.duration) || 0), 0);
    let life = pick(grp);
    if (!life && C && C.events) Object.keys(C.events).forEach(k => { life = Math.max(life, pick(C.events[k])); });
    return life;
  }

  function spawnSkillBurst(C, x, y, rot, where, followEnt, contact, ctx) {
    if (!SKILL_RT) return;
    const ev = ({ launch: 'onCast', caster: 'onCast', impact: 'onHit', wall: 'onWall', expire: 'onExpire' })[where] || 'onHit';
    const grp = (C.events && C.events[ev]) || C;
    const SM = SKILL_RT.SM;
    // 命中表现也按「每个模块自己的作用范围」筛：区域内没有任何合法目标时该模块不播。
    // 空挥（ctx.targets 为空）不过滤，仍允许在判定点播一次表现。
    const gate = m => {
      if (!ctx || !ctx.desc || !SM || !SM.moduleTargets) return true;
      const ts = ctx.targets || [];
      if (!ts.length) return true;
      return SM.moduleTargets(ts, m, ctx.desc, ctx).length > 0;
    };
    const fxList = (grp.fx || []).filter(gate);
    const partList = (grp.particles || []).filter(gate);
    // 「敌方弹珠身上」的选靶只从本次判定命中的目标里挑，不再挂到全图另一侧的敌人身上
    const enemies = (ctx && ctx.targets && ctx.targets.length) ? ctx.targets.slice() : enemiesOf(followEnt);
    // 同组里有印记时，挂在敌方身上的循环特效跟随印记一起结束（到期 / 被消耗 / 被引爆都会回收）
    const markLife = groupMarkLifeOf(C, grp);
    SKILL_RT.SE.spawnFx(fxList, where, x, y, rot, null, followEnt, contact, enemies, markLife).then(arr => {
      (arr || []).forEach(a => {
        // 贴合墙面的特效坐标已由接触面算出，不可被事件点覆盖（否则又会飘回释放点）
        // 锚在实体上的（跟随弹珠 / 施法者身上 / 敌方弹珠身上）同理，位置由跟随实体决定
        if (!a.wallFace && !(a.follow && typeof a.follow === 'object')) { a.x = x; a.y = y; }
        a.born = performance.now();
      });
      // 同一目标上的同类特效默认「覆盖」：旧实例在并入列表时就销毁，不会越叠越多
      SKILL_RT.SE.pushFx(G.skillFx, arr);
    });
    // 粒子已在编译期按 triggerEvent 归入对应事件组（events[ev].particles），
    // attach 仅作视觉锚点，不再按 attach===where 过滤，否则默认 attach='impact' 的粒子在非命中事件中不生效
    partList.forEach(p => {
      G.skillParts = G.skillParts.concat(SKILL_RT.SE.burstParticles(p, x, y, rot, followEnt, contact, enemies));
    });
  }

  /* 伤害求和：只累计「命中来源 + 伤害对象」都匹配的伤害节点。
     - kind（ctx.kind）：本次命中的来源。弹珠碰撞 / 投射物命中 / 范围命中 / 必中直击各认各的，
       配置成「弹珠碰撞」的伤害绝不会在投射物命中或隔空结算时生效。
       kind 为空 = DoT / 区域 tick / 印记引爆这类没有「碰撞瞬间」的结算，不按来源过滤。
     - affect：'enemy' 结算敌方伤害（含「双方」节点），'self' 只结算反噬 / 自伤节点。 */
  function computeSkillDamage(grp, att, target, pctScale, ctx, affect) {
    const SM = SKILL_RT && SKILL_RT.SM;
    const side = affect === 'self' ? 'self' : 'enemy';
    const kind = (ctx && ctx.kind) ? ctx.kind : null;
    const scoped = !!(ctx && ctx.desc && SM && SM.moduleInRange);
    const inRange = m => !scoped || SM.moduleInRange(m, ctx.desc, target, ctx);
    const dmg = grp.damage || {};
    const nodes = (SM && SM.damageNodesFor) ? SM.damageNodesFor(grp, kind, side)
      : ((grp.damageList && grp.damageList.length) ? grp.damageList : [dmg]);
    let pct = 0, base = 0, knockback = 0;
    // 逐节点求和：只有「作用范围 + 命中来源 + 伤害对象」都匹配的伤害节点才计入本次结算
    nodes.filter(inRange).forEach(dd => {
      base += Number(dd.base) || 0;
      pct += Number(dd.pctMaxHp) || 0;
      knockback = Math.max(knockback, Number(dd.knockback) || 0);
    });
    // 元素是敌方伤害，自伤结算不叠加
    const els = side === 'enemy' ? (grp.elements || []).filter(inRange) : [];
    els.forEach(e => { base += (e.damage || 0); pct += (e.damagePct || 0); });
    const critChance = CONFIG.CRIT_BASE + (att.mods.crit || 0) + els.reduce((a, e) => a + (e.critBonus || 0), 0);
    const crit = Math.random() < critChance;
    let mult = att.power;
    if (crit) mult *= (CONFIG.CRIT_MULT_BASE + (att.mods.critMult || 0) + (dmg.critMult || 0));
    if (target._weakUntil && G.clock < target._weakUntil) mult *= (1 + (target._weak || 0));
    /* 「标记 · 印记」：按层数放大本次伤害，并按层数削减目标护甲（等效放大所有来源的伤害）。
       效果快照存在 _markCfg 上，印记到期 / 引爆后被清空，不会残留。 */
    let armorEff = Math.min(target.mods.armor || 0, 0.65);
    if (target._markUntil && G.clock < target._markUntil && target._markStacks > 0 && target._markCfg) {
      const mc = target._markCfg;
      if (mc.damageAmp) mult *= (1 + (mc.damageAmp / 100) * target._markStacks);
      if (mc.armorBreak) armorEff -= mc.armorBreak * target._markStacks;
    }
    mult /= (1 + Math.max(-0.5, armorEff));
    let amount = (base + target.maxHp * (pct / 100)) * mult * EFFECTS.dmgScale;
    if (pctScale != null) amount *= pctScale;
    const ls = (dmg.lifesteal || 0) + els.reduce((a, e) => a + (e.lifesteal || 0), 0);
    if (ls > 0) att.hp = Math.min(att.maxHp, att.hp + amount * ls);
    return { amount: Math.max(0, amount), crit: crit, knockback: knockback };
  }

  function applyOneStatus(ent, st, power, dur, att, srcName) {
    if (!ent || !st || st === 'none') return;
    if (st === 'burn' || st === 'poison') {
      ent.dotDps = Math.min(ent.maxHp * 0.12, ent.dotDps + ent.maxHp * (0.02 + power * 0.06));
      ent.dotUntil = G.clock + dur;
      // 持续伤害也要能归因到具体技能：记下施加者这一发技能名（未提供时保留原值）
      if (srcName) ent._dotName = String(srcName).slice(0, 24);
    } else if (st === 'slow' || st === 'freeze') {
      ent.slowUntil = G.clock + dur;
      ent.slowFactor = 1 - Math.min(0.7, power + (st === 'freeze' ? 0.25 : 0));
      if (st === 'freeze') { ent.vx *= 0.2; ent.vy *= 0.2; }
    } else if (st === 'stun') {
      ent.slowUntil = G.clock + dur; ent.slowFactor = 0.05; ent.vx *= 0.1; ent.vy *= 0.1;
    } else if (st === 'weaken') {
      ent._weakUntil = G.clock + dur; ent._weak = Math.min(0.4, power);
    } else if (st === 'heal') {
      att.hp = Math.min(att.maxHp, att.hp + att.maxHp * (0.02 + power * 0.06));
    } else if (st === 'shield') {
      att.shield = Math.min(att.maxHp, att.shield + att.maxHp * (0.02 + power * 0.06));
    }
  }
  // 应用某事件的「状态」集合：元素自带状态 + status 节点（self 标记作用于自身）
  // ctx 带范围判定时，只把状态施加给「该模块作用范围」内的目标；
  // mode='enemyOnly' 用于多目标结算时避免给自身叠 N 次护盾 / 治疗。
  function applyStatusFromGroup(grp, att, target, ctx, mode, srcName) {
    if (!grp) return;
    const SM = SKILL_RT && SKILL_RT.SM;
    const scoped = !!(ctx && ctx.desc && SM && SM.moduleInRange);
    const pass = m => !scoped || SM.moduleInRange(m, ctx.desc, target, ctx);
    const m = mode || 'both';
    (grp.elements || []).forEach(e => {
      if (m === 'selfOnly') return;
      if (pass(e) && e.status && e.status !== 'none') applyOneStatus(target, e.status, e.statusPower || 0.3, e.statusDuration || 2.5, att, srcName);
    });
    (grp.status || []).forEach(s => {
      const tgt = s.self ? att : target;
      if (s.self && m === 'enemyOnly') return;
      if (!s.self && m === 'selfOnly') return;
      if (!s.self && !pass(s)) return;
      applyOneStatus(tgt, s.status, s.statusPower || 0.3, s.statusDuration || 2.5, att, srcName);
      // 自定义状态标签：后台「状态图标」里同 tag 的条目会据此显示在对局状态栏
      const tag = s.statusTag == null ? '' : String(s.statusTag).trim();
      if (tag) {
        if (!tgt._statusTags) tgt._statusTags = {};
        tgt._statusTags[tag] = G.clock + (s.statusDuration || 2.5);
      }
    });
  }

  /* 持续型载体（光环 / 区域残留）的绑定结算：
     连到它的「伤害·结算 / 元素·属性」数值按「每秒伤害」解释，随 tick 间隔缩放；
     「事件状态 / 元素状态」每次 tick 重新施加一次。这样伤害模块不再是光环 cfg.dps 的附属，
     而是真正由模块组合出来。 */
  function boundTickDamage(grp) {
    if (!grp) return 0;
    return (Number(grp.damage && grp.damage.base) || 0) +
      (grp.elements || []).reduce((a, e) => a + (Number(e.damage) || 0), 0);
  }
  function applyBoundTickStatuses(grp, att, target, selfOnly, srcName) {
    if (!grp) return;
    const st = (grp.status || []).filter(s => !selfOnly || s.self);
    applyStatusFromGroup({ status: st, elements: selfOnly ? [] : (grp.elements || []) }, att, target, null, undefined, srcName);
  }

  // 在某事件触发时，对 (att,target) 于 (x,y) 施加该事件的全部效果（伤害/范围/特效/粒子/状态）
  // contact = {x,y,nx,ny}：球与墙的接触面，供「贴合墙面」特效与墙面残留伤害使用
  function applyEventEffects(C, att, target, ev, x, y, rot, contact, ctx) {
    const grp = (C.events && C.events[ev]) || C;
    // 把施法弹珠(att)作为跟随目标传入，attach='marble' 的特效/粒子才会真正跟随移动
    spawnSkillBurst(C, x, y, rot, evToAttach(ev), att, contact, ctx);
    applyStatusFromGroup(grp, att, target, ctx, undefined, C && C.name);
    applyExtraModules(grp, att, target, ev, x, y, contact, C, ctx);
    // 墙面残留伤害规则统一来自「伤害·结算」模块；只要拿到接触面就生成区域，与 damage 节点挂在哪一个事件组无关
    if (contact) spawnWallHazards(C, att, contact);
  }

  /* 墙面残留：在撞墙接触面生成一块持续伤害区，规则取自编译后的 C.wallHazard
     （原先挂在像素特效节点上的 wallDps 等字段已全部迁移到「伤害·结算」模块）。
     两种伤害方式可同时生效：
       · 每秒对周围造成伤害：每 0.5 秒对半径内敌方弹珠结算半秒的量
       · 敌方弹珠触碰区域时受伤：进入区域立即结算，停留在区内按触碰间隔重复结算 */
  function spawnWallHazards(C, att, contact) {
    if (!G.skillWallHazards) G.skillWallHazards = [];
    const w = C.wallHazard || (C.events && C.events.onWall && C.events.onWall.wallHazard);
    if (!w || !(w.wallDps > 0 || w.wallTouchDamage > 0)) return;   // 纯表现：不产生伤害
    G.skillWallHazards.push({
      owner: att, side: att.side, cfg: w, name: (C && C.name) || '',
      x: contact.x, y: contact.y, nx: contact.nx, ny: contact.ny,
      born: G.clock, life: Math.max(0.5, Number(w.wallDuration) || 3),
      tick: 0, touchAt: {}, inside: {}
    });
  }

  /* 伤害·结算模块的「持续伤害(跟随)」：触发后在跟随点留下一片持续掉血区，
     规则取自编译后该事件组的 damage 节点（dotEnable / dotDps / dotRadius / dotInterval / dotFollow / dotDuration）。
     与墙面残留同一归属：伤害数值统一在「伤害·结算」模块配置，特效模块只负责表现。
     follow='caster'=跟随施法者自身弹珠；'target'=跟随命中目标；'impact'=固定落点。 */
  function spawnDamageDot(att, d, followEnt, x, y, C) {
    if (!G.skillDotZones) G.skillDotZones = [];
    const sx = followEnt ? followEnt.x : x;
    const sy = followEnt ? followEnt.y : y;
    G.skillDotZones.push({
      owner: att, side: att.side, cfg: d, C: C || null,
      x: (sx == null ? x : sx), y: (sy == null ? y : sy),
      followEnt: followEnt || null, age: 0,
      life: Math.max(0.5, Number(d.dotDuration) || 6), tick: 0
    });
  }

  /* ---------- 扩充模块：位移 / 护盾 / 标记 / 区域 / 回响 ---------- */
  function applyExtraModules(grp, att, target, ev, x, y, contact, C, ctx) {
    if (!grp || !att) return;
    const SM = SKILL_RT.SM;
    // 光环 / 区域是持续实体：把「连到它身上的模块」的专属视图一起存进实体，
    // 之后每个 tick 都按这一组来结算伤害与状态，而不是只认自己 cfg 里写死的 dps。
    const hostView = cfg => (C && SM.viewOfNode) ? SM.viewOfNode(C, cfg && cfg._nodeId) : null;
    const scoped = !!(ctx && ctx.desc && SM && SM.moduleInRange);
    const pass = (m, t) => !scoped || SM.moduleInRange(m, ctx.desc, t || target || att, ctx);
    const hitTargets = (ctx && ctx.targets && ctx.targets.length) ? ctx.targets : [target];
    (grp.motion || []).forEach(m => {
      if (pass(m, target)) applyMotionModule(att, target, m, contact, ev);
    });
    (grp.shield || []).forEach(s => {
      const amt = att.maxHp * (s.amount || 0) / 100;
      if (amt > 0) {
        if (!att._shieldUntil) att._shieldBase = att.shield || 0;   // 记录施放前的护盾基线
        att._shieldUntil = G.clock + (s.duration || 5);
        att.shield = Math.min(att.maxHp, (att.shield || 0) + amt);
      }
      if (s.thorns) att._thornsBoost = Math.max(att._thornsBoost || 0, s.thorns);
    });
    (grp.mark || []).forEach(m => {
      // 多目标范围技：每个落在「该印记模块作用范围」里的敌人各挂一份
      hitTargets.forEach(t => { if (t && pass(m, t)) applyMarkModule(att, t, m, C); });
    });
    (grp.zone || []).forEach(z => { if (pass(z, target)) spawnZoneModule(att, z, x, y, hostView(z)); });
    (grp.aura || []).forEach(a => { if (pass(a, target)) spawnAuraModule(att, a, x, y, hostView(a)); });
    (grp.echo || []).forEach(e => { if (pass(e, target)) scheduleEchoModule(grp, att, target, ev, x, y, e, C); });
    // 伤害·结算模块的「持续伤害(跟随)」：触发后留下一片跟随目标的持续掉血区（与墙面残留同归属）
    const dm = grp.damage;
    if (dm && dm.dotEnable && Number(dm.dotDps) > 0) {
      let followEnt = null;
      const fm = dm.dotFollow || 'caster';
      if (fm === 'target') followEnt = (target && !target.dead) ? target : null;
      else if (fm === 'caster') followEnt = (att && !att.dead) ? att : null;
      spawnDamageDot(att, dm, followEnt, x, y, C);
    }
  }

  /* 位移模块 = 往目标弹珠挂一个「运动器」。
     轨迹、方向来源、速度曲线、作用目标、叠加与收尾规则都由引擎逐帧解释，
     这里是唯一的挂载入口：任何触发事件都可以调用，不绑定某个具体技能。
     （旧实现是一帧内硬改坐标的瞬移，已由运动器取代。） */
  // 运动器上下文：targetOf 始终把「对家」解析成真正的对手（对投射物同样成立）
  function motionContextFor(ent, opp, origin) {
    return {
      self: ent, opponent: opp, pair: [ent, opp],
      // 「环绕自身」的圆心：施法者自身弹珠（投射物绑定时是发射它的那颗弹珠，不是投射物自己）
      origin: origin || ent,
      w: CONFIG.ARENA_W, h: CONFIG.ARENA_H, now: G.clock,
      targetOf: function (e) { return e === ent ? opp : ent; }
    };
  }

  /* 把运动器绑定到一颗投射物：标记 _motionBound，让投射物引擎把「方向」交给运动器，
     位移仍由投射物自己的 advance 结算（speed / accel / range / 撞墙处理都在那里）。 */
  function bindMoverToProjectile(q, m, opp, origin) {
    if (!MOTION || !q) return;
    /* 位移距离=0 且非瞬移：运动器不推动弹体，但仍然必须绑定——
       它承载「撞墙处理」（撞墙后消失 / 反弹次数），提前 return 会让规则丢掉。
       step 只在 distance>0 时才交出 _motionDir，所以投射物照常按自身速度飞行，不会被冻结。 */
    q._motionBound = true;
    // 运动器结束后把投射物交还给它自己的飞行逻辑（否则 _motionBound 会让它停在原地）
    const cx = Object.assign(motionContextFor(q, opp, origin), { onEnd: function () { q._motionBound = false; } });
    MOTION.spawn(G.movers, Object.assign({}, m, { contact: null, _integrate: true }), cx);
  }

  /* onCast 阶段登记的「投射物绑定」运动器：在投射物真正创建后补挂。
     只处理本次发射的 shots；按名称匹配（空 = 本次创建的全部投射物），命中即由运动器全权接管。 */
  function resolvePendingProjMovers(shots, hostId) {
    if (!G._pendingProjMovers || !G._pendingProjMovers.length) return;
    const keep = [];
    G._pendingProjMovers.forEach(pm => {
      // 专属运动器只挂自己那个载体的弹；公共运动器对每一批弹都要挂，留到下一批
      if (hostId && pm.hostId && pm.hostId !== hostId) { keep.push(pm); return; }
      (shots || []).forEach(q => {
        if (!q || q.dead) return;
        if (pm.att && q._owner !== pm.att) return;
        if (pm.hostId && q._hostId !== pm.hostId) return;
        if (pm.name && (q._projName || '') !== pm.name) return;
        bindMoverToProjectile(q, pm.m, pm.opp, pm.att);
      });
      if (!pm.hostId) keep.push(pm);
    });
    G._pendingProjMovers = keep;
  }

  function applyMotionModule(att, target, m, contact, ev) {
    if (!MOTION || !att) return;
    if (!G.movers) G.movers = [];
    // 对手一律按阵营从对局状态解析，与触发事件传进来的 target 无关：
    // onWall / onExpire 等事件的 target 常常就是施法者自己，若直接拿它当对手，
    // 「朝向对手」会退化成「沿当前速度」，看起来就是完全没朝对手动。
    const bySide = (att.side === 'player') ? G.enemy : G.player;
    const opp = (bySide && bySide !== att) ? bySide : ((target && target !== att) ? target : null);

    /* ---- 投射物绑定 ----
       作用目标=投射物绑定：识别本技能创建的投射物并把运动器挂在它身上。
       优先用「绑定投射物名称」（bindTarget）精确锁定；留空则回退到图结构自动识别的
       前置投射物命名（_autoBind）；两者都为空 = 绑定本次施放创建的全部投射物。
       onHit 等事件触发时投射物已存在 → 立即绑定；onCast 先于发射 → 登记待绑定，发射后结算。 */
    if (m.scope === 'projectile') {
      const nm = String(m.bindTarget || m._autoBind || '').trim();
      // 编译期已按连线写入 _hostId：专属运动器绝不会误绑到另一个投射物载体的弹上
      const match = q => q && !q.dead && q._owner === att &&
        (nm === '' || (q._projName || '') === nm) && (!m._hostId || q._hostId === m._hostId);
      // onCast 先于发射：一律等本次投射物创建后再绑定，避免误绑上一轮残留的同类投射物
      const live = (ev === 'onCast') ? [] : (G.skillShots || []).filter(match);
      if (live.length) {
        live.forEach(q => bindMoverToProjectile(q, m, opp, att));
      } else {
        if (!G._pendingProjMovers) G._pendingProjMovers = [];
        G._pendingProjMovers.push({ m: m, att: att, opp: opp, name: nm, hostId: m._hostId || '' });
      }
      return;
    }

    MOTION.spawn(G.movers, Object.assign({}, m, { contact: contact || null }), motionContextFor(att, opp, att));
  }

  function spawnZoneModule(att, z, x, y, hostC) {
    if (!G.skillZones) G.skillZones = [];
    G.skillZones.push({ owner: att, side: att.side, cfg: z, C: hostC || null, x: x, y: y, born: G.clock, life: z.duration || 3, tick: 0 });
  }

  /* 光环模块：以施法者为圆心持续展开的领域。
     - 伤害型：每隔 tickInterval 对半径内敌方结算一次 dps×间隔 的伤害，并施加减益
     - 增益型：每隔 tickInterval 对半径内己方（含自身）施加增益（治疗 / 护盾 等）
     位置默认跟随施法者（以自身为圆心）；followCaster=false 时固定在施放瞬间的位置。
     范围圈仅作为调试辅助在实时试放里绘制（见 admin.js seStartPreview），正式对局不画。 */
  function spawnAuraModule(att, a, x, y, hostC) {
    if (!G.skillAuras) G.skillAuras = [];
    const cx = (att && att.x != null) ? att.x : x;
    const cy = (att && att.y != null) ? att.y : y;
    G.skillAuras.push({
      owner: att, side: att.side, cfg: a, C: hostC || null,
      x: cx, y: cy, ox: cx, oy: cy,
      born: G.clock, life: Math.max(0.5, Number(a.duration) || 4),
      tick: 0, follow: a.followCaster !== false
    });
    // 连到这个光环上的像素特效 / 粒子：生成时按「专属组」播一次（跨触发事件展平）
    if (hostC && hostC._tickGrp && (hostC._tickGrp.fx.length || hostC._tickGrp.particles.length)) {
      const tickView = { events: { onCast: hostC._tickGrp } };
      spawnSkillBurst(tickView, cx, cy, 0, 'caster', att);
    }
  }

  /* ---------- 指向性法术：锁定一个目标直接结算 ----------
     与「投射物」同属投递方式，但不产生飞行物：
       · 敌方目标 → 走 resolveAt 的「命中时」整条链路（伤害 / 元素 / 状态 / 印记 / 区域 / 回响 / 特效）
       · 自身目标 → 不结算伤害，只把状态 / 护盾 / 增益 / 特效作用在自己身上
     三种节奏：立即命中 / 延迟命中 / 持续引导（引导进 G.skillChannels 逐帧结算）。 */
  function castTargetedModule(C, att, opp) {
    const T = C.targeted || {};
    const selfMode = T.targetSide === 'self';
    const tgt = selfMode ? att : opp;
    if (!att || !tgt || tgt.hp <= 0) return;
    // 最大锁定距离：0 = 不限；超出则本次不生效（施放时的特效已由 onCast 组播放）
    const range = Math.max(0, Number(T.maxRange) || 0);
    if (!selfMode && range > 0 && Math.hypot(tgt.x - att.x, tgt.y - att.y) > range + tgt.r) return;
    const mode = T.applyMode || 'instant';
    const delay = Math.max(0, Number(T.delay) || 0);
    if (mode !== 'channel' && delay <= 0) { targetedHit(C, att, tgt, selfMode); return; }
    if (!G.skillChannels) G.skillChannels = [];
    const gap = (mode === 'channel') ? Math.max(0.1, Number(T.channelInterval) || 0.5) : 0;
    const start = G.clock + delay;
    // 引导：从前摇结束开始计时，首次结算可配置为「立即」或「等一个间隔」
    const first = start + ((mode === 'channel' && T.tickOnStart === false) ? gap : 0);
    const end = (mode === 'channel') ? start + Math.max(0.1, Number(T.channelDuration) || 2) : start;
    if (mode === 'channel' && first > end + 1e-6) return;   // 时长撑不满一个间隔：不产生结算
    G.skillChannels.push({
      C: C, att: att, tgt: tgt, self: selfMode,
      next: first, end: end, gap: gap,
      single: mode !== 'channel',                   // 延迟命中 = 只有一段的引导
      interrupt: T.interruptOnDeath !== false
    });
  }

  // 一次指向性命中：敌方走完整命中链路，自身只走状态 / 增益 / 表现
  function targetedHit(C, att, tgt, selfMode) {
    if (!att || !tgt || tgt.hp <= 0) return;
    if (selfMode) {
      const grp = (C.events && C.events.onHit) || C;
      spawnSkillBurst(C, att.x, att.y, 0, 'impact', att);
      applyStatusFromGroup(grp, att, att);
      applyExtraModules(grp, att, att, 'onHit', att.x, att.y, null, C);
      return;
    }
    targetedResolve(C, att, tgt);
  }

  function targetedResolve(C, att, tgt) {
    const ang = Math.atan2(tgt.y - att.y, tgt.x - att.x) || 0;
    // 指向性 = 锁定命中，按「直接命中」口径结算（与必中直击一致）
    resolveAt(C, att, tgt.x, tgt.y, ang, 'onHit', [tgt], undefined, undefined, 'direct');
  }

  // 推进指向性队列：延迟命中结算一次即出队；引导到期或目标 / 施法者死亡则中断
  function stepSkillChannels() {
    if (!G.skillChannels || !G.skillChannels.length) return;
    G.skillChannels = G.skillChannels.filter(ch => {
      if (!ch.tgt || ch.tgt.hp <= 0) return false;
      if (ch.interrupt && (!ch.att || ch.att.hp <= 0)) return false;
      if (G.clock < ch.next) return true;
      targetedHit(ch.C, ch.att, ch.tgt, ch.self);
      if (ch.single) return false;
      ch.next += ch.gap;
      return ch.next <= ch.end + 1e-6;
    });
  }

  /* ---------- 印记（mark）：可叠加 / 多效果 / 可引爆 ----------
     目标身上用扁平字段保存，伤害结算与绘制直接读取：
       _markStacks 层数、_markUntil 到期时刻、_markCfg 效果快照、_markConsume 命中即清空、_markOwner 施加者
     每层效果都是「层数 × 配置值」；0 表示不启用，可同时生效。 */
  function markCfgOf(m) {
    const sp = (m.detonateSplash == null) ? 50 : Number(m.detonateSplash);
    return {
      damageAmp: Math.max(0, Number(m.damageAmp) || 0),
      dotDps: Math.max(0, Number(m.dotDps) || 0),
      armorBreak: Math.max(0, Number(m.armorBreak) || 0) / 100,
      slowPct: Math.max(0, Number(m.slowPct) || 0) / 100,
      detonate: m.detonate || 'none',
      detonateDamage: Math.max(0, Number(m.detonateDamage) || 0),
      detonateRadius: Math.max(0, Number(m.detonateRadius) || 0),
      detonateSplash: Math.max(0, Math.min(1, sp / 100)),
      color: m.color || '#e8c85a'
    };
  }

  function applyMarkModule(att, target, m, C) {
    if (!att || !target || target === att || target.side === att.side || target.hp <= 0) return;
    const cfg = markCfgOf(m);
    // 旧存档没有「层数上限」：按当年的硬编码 9 层兜底，与 compile 的补齐规则一致
    const max = Math.max(1, Math.round(m.maxStacks == null ? 9 : (Number(m.maxStacks) || 5)));
    const add = Math.max(1, Math.round(Number(m.stacks) || 1));
    const active = target._markStacks > 0 && G.clock < (target._markUntil || 0);
    const cur = active ? target._markStacks : 0;
    const mode = m.stackMode || 'add';
    /* 覆盖（replace）：丢弃旧印记，层数 / 每层效果 / 持续时间全部按本次重算；
       只刷新时长（refresh）与取较高层数（max）：层数不下调；
       累加（add，默认）：继续往上叠，封顶 maxStacks。 */
    let next = (mode === 'replace') ? add
      : ((mode === 'refresh' || mode === 'max') ? Math.max(cur, add) : cur + add);
    next = Math.min(max, next);
    // 效果取「更强的一方」：后上的弱印记不会把前面的强印记冲淡；覆盖模式下整份替换
    const old = (active && target._markCfg) ? target._markCfg : null;
    target._markCfg = (old && mode !== 'replace') ? {
      damageAmp: Math.max(old.damageAmp, cfg.damageAmp),
      dotDps: Math.max(old.dotDps, cfg.dotDps),
      armorBreak: Math.max(old.armorBreak, cfg.armorBreak),
      slowPct: Math.max(old.slowPct, cfg.slowPct),
      detonate: cfg.detonate !== 'none' ? cfg.detonate : old.detonate,
      detonateDamage: Math.max(old.detonateDamage, cfg.detonateDamage),
      detonateRadius: Math.max(old.detonateRadius, cfg.detonateRadius),
      detonateSplash: Math.max(old.detonateSplash, cfg.detonateSplash),
      color: cfg.color
    } : cfg;
    if (mode === 'replace') target._markTick = 0;   // 重新计时：撕裂不会因为旧计时器提前结算
    target._markStacks = next;
    target._markUntil = G.clock + Math.max(1, Number(m.duration) || 4);
    target._markConsume = !!m.consumeOnHit;
    target._markOwner = att;
    // 印记也记住来源技能名：到期引爆 / 撕裂的伤害同样能归因到具体技能
    if (C && C.name) target._markSkill = String(C.name).slice(0, 24);
    // 满层引爆：叠满瞬间清空印记并结算一次爆炸
    const dc = target._markCfg;
    if ((dc.detonate === 'onMax' || dc.detonate === 'both') && next >= max) {
      detonateMark(target, next, dc, att);
      clearMark(target, false);
    }
  }

  function detonateMark(target, stacks, cfg, owner) {
    if (!target || target.hp <= 0 || !(stacks > 0) || !cfg) return;
    const dmg = (cfg.detonateDamage || 0) * stacks * EFFECTS.dmgScale;
    const R = cfg.detonateRadius || 0;
    const lbl = target._markSkill ? { name: target._markSkill, tag: '印记·引爆' } : '印记·引爆';
    if (dmg > 0) {
      applyDamage(target, dmg, owner, false, false, lbl);
      if (R > 0) {
        [G.player, G.enemy].forEach(t => {
          // 溅射只波及「被引爆者的同阵营」其他单位，绝不会误伤施法者自己
          if (!t || t === target || t.hp <= 0 || t.side !== target.side) return;
          if (Math.hypot(t.x - target.x, t.y - target.y) > R + t.r) return;
          applyDamage(t, dmg * (cfg.detonateSplash == null ? 0.5 : cfg.detonateSplash), owner, false, false, lbl);
        });
      }
    }
    if (SKILL_RT) {
      G.skillParts = G.skillParts.concat(SKILL_RT.SE.burstParticles({
        count: Math.min(48, 12 + stacks * 6), shape: 'spark', size: 3, sizeVar: 2,
        speed: 150 + stacks * 22, speedVar: 90, spread: 360, life: 0.55, lifeVar: 0.25,
        gravity: 0, drag: 0.9, color: cfg.color || '#e8c85a', color2: '#ff7a30',
        fade: true, additive: true, enabled: true
      }, target.x, target.y, 0));
    }
    G.trauma = Math.min(1, G.trauma + 0.12 + stacks * 0.02);
  }

  // detonateOnExpire=true 时按配置结算「结束引爆」，其余情况只清空
  function clearMark(target, detonateOnExpire) {
    if (!target) return;
    const cfg = target._markCfg, stacks = target._markStacks || 0;
    if (detonateOnExpire && cfg && stacks > 0 && (cfg.detonate === 'onExpire' || cfg.detonate === 'both')) {
      detonateMark(target, stacks, cfg, target._markOwner);
    }
    target._markStacks = 0;
    target._markUntil = 0;
    target._markCfg = null;
    target._markConsume = false;
    target._markOwner = null;
    target._markSkill = '';
    target._markTick = 0;
  }

  /* 印记「每层迟滞」的位移倍率：只按当前印记状态派生，不写回实体。
     上限 70% 与原配置一致；印记到期 / 被消耗 / 被引爆后 _markStacks 归零，下一帧自动回到 1。 */
  function markSlowMul(ent) {
    if (!ent || !(ent._markStacks > 0) || !(G.clock < (ent._markUntil || 0))) return 1;
    const cfg = ent._markCfg;
    if (!cfg || !(cfg.slowPct > 0)) return 1;
    return Math.max(0.3, 1 - Math.min(0.7, cfg.slowPct * ent._markStacks));
  }

  // 印记逐帧结算：到期引爆、撕裂按 0.5 秒结算（迟滞移到物理积分处派生）
  function stepMarks(dt) {
    [G.player, G.enemy].forEach(t => {
      if (!t || !(t._markStacks > 0)) return;
      if (t.hp <= 0) { clearMark(t, false); return; }
      if (G.clock >= (t._markUntil || 0)) { clearMark(t, true); return; }
      const cfg = t._markCfg;
      if (!cfg) return;
      /* 「每层迟滞」不在这里写 slowFactor / slowUntil：那套机制用速度上限 cap 削掉 vx/vy，
         印记到期后没有任何东西把速度加回来，减速就永久粘在弹珠上。
         改为在物理积分处按当前印记状态派生「位移倍率」，印记一消失当帧即恢复原速。 */
      if (cfg.dotDps > 0) {
        t._markTick = (t._markTick || 0) - dt;
        if (t._markTick <= 0) {
          t._markTick = 0.5;
          const d = cfg.dotDps * t._markStacks * 0.5 * EFFECTS.dmgScale;
          if (d > 0) applyDamage(t, d, t._markOwner, false, false,
            t._markSkill ? { name: t._markSkill, tag: '印记·撕裂' } : '印记·撕裂');
        }
      }
    });
  }

  function scheduleEchoModule(grp, att, target, ev, x, y, cfg, C) {
    if (!G.skillEchoes) G.skillEchoes = [];
    const n = Math.max(1, Math.round(cfg.times || 1));
    const gap = cfg.delay || 0.5;
    for (let i = 1; i <= n; i++) {
      G.skillEchoes.push({
        at: G.clock + gap * i,
        C: { events: { [ev]: grp } }, att: att, target: target, ev: ev, x: x, y: y,
        name: (C && C.name) || '',   // 回响伤害同样要能归因到原技能
        scale: (cfg.powerScale || 60) / 100
      });
    }
  }

  function spawnSplitModule(parent, C, caster, s) {
    const base = Math.atan2(parent.vy, parent.vx) || 0;
    const src = C.projectile || {};
    const P = Object.assign({}, src, {
      count: Math.max(2, Math.round(s.count || 3)),
      spread: s.spread == null ? 360 : s.spread,
      speed: Math.max(40, (src.speed || 300) * (s.speedScale || 70) / 100),
      size: Math.max(2, (src.size || 9) * (s.sizeScale || 60) / 100),
      range: s.range || 260, dieOnWall: true, wallBounce: 0, pierce: 0, homing: 0, gravity: 0,
      spawnOffset: 0, gap: 0, jitter: 0, trail: false, lifetime: 2.5, accel: 0
    });
    const CC = Object.assign({}, C, { projectile: P });
    // 分裂子弹沿用父弹的施法者引用：父弹「绑定施法者」时，子弹同样跟着施法者走
    const splitCaster = parent._casterRef || { x: parent.x, y: parent.y, r: parent.r, side: parent.side };
    const shots = SKILL_RT.SE.spawnProjectiles(CC, splitCaster, null, base);
    shots.forEach(q => {
      q._owner = caster; q._C = C; q._quiet = true;   // 子弹命中只结算伤害，不再触发分裂/区域/回响
      q._dmgScale = Math.max(0, (s.damageScale || 50) / 100);
      G.skillShots.push(q);
    });
  }
  // 以 (x,y) 为中心、按该事件 impact 配置炸开（撞墙/消失爆炸复用）
  function areaBlast(C, caster, grp, x, y, ctx) {
    const imp = grp.impact || { aoeRadius: 0, aoePct: 1 };
    const SM = SKILL_RT.SM;
    let rctx = ctx;
    if (!rctx && SM && SM.rangeDescriptor) {
      rctx = {
        caster: caster, opponent: caster.side === 'player' ? G.enemy : G.player,
        entities: [G.player, G.enemy].concat(G.enemies || []),
        angle: 0, point: { x: x, y: y }, targets: []
      };
      rctx.desc = SM.rangeDescriptor(C, rctx);
    }
    const nodes = (grp.impactList && grp.impactList.length) ? grp.impactList : [imp];
    [G.player, G.enemy].concat(G.enemies || []).forEach(t => {
      if (!t || t.side === caster.side) return;
      const ok = (rctx && rctx.desc && SM && SM.moduleInRange)
        ? nodes.filter(m => SM.moduleInRange(m, rctx.desc, t, rctx)) : nodes;
      const R = ok.reduce((a, m) => Math.max(a, Number(m.aoeRadius) || 0), 0);
      const pct = ok.reduce((a, m) => Math.max(a, Number(m.aoePct) || 0), 1);
      if (R <= 0 || Math.hypot(t.x - x, t.y - y) > R + t.r) return;
      const d = computeSkillDamage(grp, caster, t, pct || 1, rctx);
      applyDamage(t, d.amount, caster, d.crit, false, skillLabel(C, '爆炸'));
      applyStatusFromGroup(grp, caster, t, rctx, 'enemyOnly', C && C.name);
    });
  }

  function resolveAt(C, att, x, y, rot, ev, targets, dmgScale, ctx, kind) {
    const grp = (C.events && C.events[ev]) || C;
    const sc = (dmgScale == null ? 1 : dmgScale);
    const SM = SKILL_RT && SKILL_RT.SM;
    /* 结算上下文：判定区域 + 命中点 + 本次合法目标 + 命中来源。
       没有 ctx 时（旧调用 / 施放事件）按编译视图补一份，口径与即时形态完全一致。 */
    let rctx = ctx || (SM && SM.rangeDescriptor ? {
      caster: att, opponent: (targets && targets[0]) || null,
      entities: [G.player, G.enemy].concat(G.enemies || []),
      angle: rot, point: { x: x, y: y }, targets: targets || []
    } : null);
    // 只带命中来源调用时也要有上下文容器，否则伤害节点拿不到 kind
    if (!rctx && kind) rctx = { caster: att, point: { x: x, y: y }, angle: rot, targets: targets || [] };
    if (rctx) {
      if (!rctx.point) rctx.point = { x: x, y: y };
      if (rctx.angle == null) rctx.angle = rot;
      if (!rctx.targets) rctx.targets = targets || [];
      if (kind) rctx.kind = kind;
      if (!rctx.desc && SM && SM.rangeDescriptor) rctx.desc = SM.rangeDescriptor(C, rctx);
    }
    const hitList = (targets || []).filter(t => t && t.side !== att.side);
    hitList.forEach(t => {
      const d = computeSkillDamage(grp, att, t, sc, rctx, 'enemy');
      applyDamage(t, d.amount, att, d.crit, false, skillLabel(C));
      /* 击退：伤害模块的「击退力度」沿施法者→受击者方向给冲量，并打上「刚被击飞」标记。
         取整技能最大值——伤害节点配在「撞墙时」时，命中这一下也要先把人推开。 */
      applyKnockback(t, att, Math.max(d.knockback, (SM && SM.skillKnockback) ? SM.skillKnockback(C) : 0));
      tagSlam(t, att, C);
      // 「印记」设定为命中即消耗时，本次结算后清空（不触发结束引爆）
      if (t._markConsume) clearMark(t, false);
    });
    /* 反噬 / 自伤：伤害对象 = 自身（或双方）的节点在同一个结算点反向扣自己的血。
       不吃元素与印记加成，只按自身面板走一遍护甲 / 暴击。 */
    const selfDmg = computeSkillDamage(grp, att, att, sc, rctx, 'self');
    if (selfDmg.amount > 0 && att && !att.dead) {
      applyDamage(att, selfDmg.amount, att, selfDmg.crit, false, skillLabel(C, '反噬'));
    }
    G.trauma = Math.min(1, G.trauma + (grp.impact.shake || 0.1));
    spawnSkillBurst(C, x, y, rot, evToAttach(ev), att, null, rctx);
    // 多目标：敌方状态逐个施加，自身状态只施加一次
    hitList.forEach((t, i) => applyStatusFromGroup(grp, att, t, rctx, i === 0 ? 'both' : 'enemyOnly', C && C.name));
    if (!hitList.length) applyStatusFromGroup(grp, att, att, rctx, 'selfOnly', C && C.name);
    applyExtraModules(grp, att, hitList[0] || null, ev, x, y, null, C, rctx);
    const imp = grp.impact;
    /* 溅射范围也按「每个命中·爆发模块自己的作用范围」逐条筛，
       不再让一个默认爆炸半径把全图敌人一起卷进来。 */
    const impNodes = (grp.impactList && grp.impactList.length) ? grp.impactList : [imp];
    if (imp.aoeRadius > 0) {
      [G.player, G.enemy].concat(G.enemies || []).forEach(t => {
        if (!t || hitList.indexOf(t) >= 0 || t.side === att.side) return;
        const ok = (rctx && rctx.desc && SM && SM.moduleInRange)
          ? impNodes.filter(m => SM.moduleInRange(m, rctx.desc, t, rctx)) : impNodes;
        const R = ok.reduce((a, m) => Math.max(a, Number(m.aoeRadius) || 0), 0);
        const pct = ok.reduce((a, m) => Math.max(a, Number(m.aoePct) || 0), 0);
        if (R <= 0 || Math.hypot(t.x - x, t.y - y) > R + t.r) return;
        const d2 = computeSkillDamage(grp, att, t, pct * sc, rctx, 'enemy');
        applyDamage(t, d2.amount, att, d2.crit, false, skillLabel(C, '溅射'));
        applyKnockback(t, att, d2.knockback * 0.6);   // 溅射只带六成击退
        tagSlam(t, att, C);
        applyStatusFromGroup(grp, att, t, rctx, 'enemyOnly', C && C.name);
        spawnSkillBurst(C, t.x, t.y, 0, evToAttach(ev), att, null, rctx);
      });
    }
  }

  /* 直接命中：没有「投射物 / 指向性」载体时把「命中时」组结算在对手身上。
     kind 说明这次命中算哪种来源：'direct' = 必中直击（施放即结算）；
     'body' = 本体物理碰撞后补结算（触发事件选「弹珠碰撞」的技能走这里）。 */
  function directHit(C, att, opp, kind) {
    if (!C || !att || !opp || opp === att) return;
    if (opp.hp != null && opp.hp <= 0) return;
    const grp = (C.events && C.events.onHit) || C;
    const SM = SKILL_RT && SKILL_RT.SM;
    const has = (SM && SM.hitHasContent) ? SM.hitHasContent(grp) : true;
    const kb = (SM && SM.skillKnockback) ? SM.skillKnockback(C) : 0;
    if (!has && !(kb > 0)) return;   // 既没有命中内容、也没有击退：纯施放型技能，不凭空产生一次命中
    /* 接了「目标 · 锁定」时以它选出的单位为准：选自身 = 只走自伤 / 增益，不会再打对手；
       选多个敌人 = 逐个结算。没接模块时保持旧行为（必中单体打对手）。 */
    let targets = [opp];
    if (SM && SM.selectTargets && C.present && C.present.select) {
      const ts = SM.selectTargets(C, att, [G.player, G.enemy].concat(G.enemies || []));
      targets = ts.filter(t => t && t !== att);
      if (!targets.length) return;
    }
    const t0 = targets[0];
    const rot = Math.atan2(t0.y - att.y, t0.x - att.x);
    resolveAt(C, att, t0.x, t0.y, rot, 'onHit', targets, undefined, undefined, kind || 'direct');
  }

  /* 旧入口保留为兼容包装：全部委托给编译层范围判定，杜绝两套口径漂移。
     旧的 formTargets('melee') 无条件 return [opp]、aoe 落点取「到对手的距离」，
     正是「全图范围判定」的根因，已不再被主链路调用。 */
  function formPoint(C, att, opp, angle, form) {
    const SM = SKILL_RT.SM;
    if (!SM || !SM.rangeDescriptor) {
      const a = (angle == null) ? Math.atan2(opp.y - att.y, opp.x - att.x) : angle;
      const p = C.projectile || {};
      const d = form === 'aoe' ? (p.range || 260) : ((p.meleeRange || 60) + att.r + opp.r);
      return { x: att.x + Math.cos(a) * d, y: att.y + Math.sin(a) * d };
    }
    const ctx = {
      caster: att, opponent: opp,
      entities: [G.player, G.enemy].concat(G.enemies || []),
      angle: angle, point: null, targets: []
    };
    const d = SM.rangeDescriptor(C, ctx);
    return SM.rangePoint(d, ctx);
  }
  function formTargets(C, att, opp, pt, form) {
    const SM = SKILL_RT.SM;
    if (!SM || !SM.rangeDescriptor) return (opp && opp.side !== att.side) ? [opp] : [];
    const ctx = {
      caster: att, opponent: opp,
      entities: [G.player, G.enemy].concat(G.enemies || []),
      angle: Math.atan2(pt.y - att.y, pt.x - att.x), point: pt, targets: []
    };
    const d = SM.rangeDescriptor(C, ctx);
    return SM.targetsInRange(d, ctx);
  }

  function skillShotHit(q, target) {
    const caster = q._owner, C = q._C; if (!caster || !C) return;
    const ang = Math.atan2(q.vy, q.vx);
    const SM = SKILL_RT.SM;
    // 碰撞型载体：命中目标由物理给出，但模块级「自定义作用范围」仍要逐条筛
    const ctx = {
      caster: caster, opponent: target,
      entities: [G.player, G.enemy].concat(G.enemies || []),
      angle: ang, point: { x: q.x, y: q.y },
      targets: (target && target.side !== caster.side) ? [target] : []
    };
    if (SM && SM.rangeDescriptor) ctx.desc = SM.rangeDescriptor(C, ctx);
    ctx.kind = 'projectile';   // 投射物命中：只认「命中判定 = 投射物命中 / 自动」的伤害节点
    if (q._quiet) {
      // 分裂子弹：只结算伤害与命中特效，避免二次分裂 / 区域雪球
      const grp = (C.events && C.events.onHit) || C;
      if (target && target.side !== caster.side) {
        const d = computeSkillDamage(grp, caster, target, q._dmgScale, ctx, 'enemy');
        applyDamage(target, d.amount, caster, d.crit, false, skillLabel(C, '分裂'));
      }
      spawnSkillBurst(C, q.x, q.y, ang, 'impact', caster, null, ctx);
      return;
    }
    resolveAt(C, caster, q.x, q.y, ang, 'onHit', [target], q._dmgScale, ctx, 'projectile');
    const grp = (C.events && C.events.onHit) || C;
    (grp.split || []).forEach(s => spawnSplitModule(q, C, caster, s));
  }
  function skillShotWall(q, contact) {
    const caster = q._owner, C = q._C; if (!C) return;
    /* 墙体不参与判定时（碰撞对象不含障碍物 / 触墙后行为=继续按运动器移动），
       撞墙事件整体作废：不交还运动器、不播撞墙特效、不结算撞墙组。
       源头已在 integrateShot 拦掉，这里再兜一层，防止以后新增调用点又踩到。 */
    if (q._hitWall === false || q._wallAction === 'continue') return;
    /* 被运动器接管的投射物撞墙：立刻交还控制权（保留这一帧的反弹速度）。
       否则运动器会每帧继续把它往墙里推，表现为「贴着墙抖动」。 */
    if (q._motionBound && MOTION && G.movers) {
      MOTION.noticeWall(G.movers, q, { now: G.clock, w: CONFIG.ARENA_W, h: CONFIG.ARENA_H }, true);
    }
    const grp = C.events.onWall;
    const ct = contact || q.wallContact || { x: q.x, y: q.y, nx: 0, ny: -1 };
    const opp = (caster && caster.side === 'player') ? G.enemy : G.player;
    if (grp && grp.impact && grp.impact.explodeOnWall) areaBlast(C, caster, grp, ct.x, ct.y);
    // target 传对手：撞墙分组里的灼烧 / 中毒等状态应作用于敌方，而非施法者自己
    applyEventEffects(C, caster, opp || caster, 'onWall', ct.x, ct.y, Math.atan2(ct.ny, ct.nx), ct);
  }
  function skillShotExpire(q) {
    const caster = q._owner, C = q._C; if (!C) return;
    const grp = C.events.onExpire;
    if (grp && grp.impact && grp.impact.explodeOnExpire) areaBlast(C, caster, grp, q.x, q.y);
    /* target 传对手（此前传的是施法者自己）：否则「消失时 → 标记 / 减速」会落到施法者身上、
       甚至被 applyMarkModule 的同阵营守卫直接丢掉，表现在编辑器里配了却完全不生效。
       自身向的状态仍由 status.self 决定，不受这里影响。 */
    const opp = (caster.side === 'player') ? G.enemy : G.player;
    applyEventEffects(C, caster, opp || caster, 'onExpire', q.x, q.y, 0);
  }

  function stepSkillRuntime(dt) {
    if (!SKILL_RT) return;
    // 技能护盾到期：回落到施放前的护盾基线
    [G.player, G.enemy].forEach(f => {
      if (!f || !f._shieldUntil) return;
      if (G.clock >= f._shieldUntil) {
        f.shield = Math.min(f.shield || 0, f._shieldBase || 0);
        f._shieldUntil = 0; f._shieldBase = 0;
      }
    });
    // 充能推进：开局从 0 起步，未满的按各自充能时间回充；放完清零进入下一轮充能
    [G.player, G.enemy].forEach(f => {
      if (!f || !f._skillCasters) return;
      f._skillCasters.forEach(c => {
        if (c.charge >= 1) return;
        c.charge = Math.min(1, c.charge + dt / skillChargeTime(c.C));
      });
    });
    // 计时/充能型 source（回合开始 / 定时循环 / 充能完成时）
    // 「回合开始」是事件型触发：回合开始即放，不要求充能条已满 —— 它才是一开局唯一能释放的类型；
    // 「定时循环」「充能完成时」以及 onHit/onWall/onLowHp/onCast 都必须先充满才能放第一发。
    [G.player, G.enemy].forEach(f => {
      if (!f._skillCasters) return;
      f._skillCasters.forEach(caster => {
        caster.sources.forEach(s => {
          const tr = s.src.trigger;
          if (tr === 'roundStart' || tr === 'interval' || tr === 'onCharge') {
            if (tr !== 'roundStart' && caster.charge < 1) return;
            if (s.src.maxCasts > 0 && s.n >= s.src.maxCasts) return;
            if (tr === 'roundStart' || tr === 'interval') {
              if (s.at > G.clock) return;            // 未到编排的时间点
              s.at = G.clock + (tr === 'interval' ? (s.src.interval || 2.2) : 1e9);
            }
            // tr === 'onCharge'：充能条一满即放；所有施放共用一条充能，放完清零重新回充
            caster.charge = 0;
            fireSkillCast(f, caster.C, s.src, false);
            s.n += 1;
          }
        });
      });
    });
    // 生命过低触发
    [G.player, G.enemy].forEach(f => { if (f && f.hp > 0 && f.hp / f.maxHp < 0.4) triggerSkillEvent(f, 'onLowHp'); });
    // 推进投射物（命中 / 撞墙 / 消失回调）
    if (G.skillShots && G.skillShots.length) {
      SKILL_RT.SE.advance(G.skillShots, dt, {
        w: CONFIG.ARENA_W, h: CONFIG.ARENA_H,
        targets: [G.player, G.enemy],
        onHit: skillShotHit, onWall: skillShotWall, onExpire: skillShotExpire
      });
    }
    // 指向性法术：延迟命中 / 持续引导的逐帧结算
    stepSkillChannels();
    // 区域残留：每 0.5 秒对范围内敌人结算一次
    if (G.skillZones && G.skillZones.length) {
      G.skillZones = G.skillZones.filter(z => {
        if (G.clock - z.born > z.life) return false;
        if (z.cfg.followCaster && z.owner && !z.owner.dead) { z.x = z.owner.x; z.y = z.owner.y; }
        z.tick -= dt;
        if (z.tick <= 0) {
          z.tick = 0.5;
          const R = z.cfg.radius || 70;
          [G.player, G.enemy].forEach(t => {
            if (!t || t.hp <= 0 || t.side === z.side) return;
            if (Math.hypot(t.x - z.x, t.y - z.y) > R + t.r) return;
            const grp = z.C && z.C._tickGrp;
            const dmg = ((z.cfg.dps || 0) + boundTickDamage(grp)) * 0.5 * EFFECTS.dmgScale;
            if (dmg > 0) applyDamage(t, dmg, z.owner, false, false,
              (z.C && z.C.name) ? { name: z.C.name, tag: '区域残留' } : '区域残留');
            applyBoundTickStatuses(grp, z.owner, t, false, z.C && z.C.name);
            if (z.cfg.slowPct > 0) {
              t.slowUntil = G.clock + 0.7;
              // 直接赋值而不是 Math.min：后者会让减速系数单调递减、再也回不到 1（粘滞在弹珠上）
              t.slowFactor = 1 - Math.min(0.8, Math.max(0, Number(z.cfg.slowPct) || 0));
            }
          });
        }
        return true;
      });
    }
    // 光环：以施法者为圆心的持续领域（伤害型打敌方 / 增益型给己方，含自身）
    if (G.skillAuras && G.skillAuras.length) {
      G.skillAuras = G.skillAuras.filter(a => {
        if (G.clock - a.born > a.life) return false;
        if (a.follow && a.owner && !a.owner.dead) { a.x = a.owner.x; a.y = a.owner.y; }
        a.tick -= dt;
        if (a.tick > 0) return true;
        const gap = Math.max(0.1, Number(a.cfg.tickInterval) || 0.5);
        a.tick = gap;
        const R = Number(a.cfg.radius) || 90;
        const grp = a.C && a.C._tickGrp;
        if (a.cfg.auraType === 'buff') {
          // 增益型：对半径内同阵营（含自身）持续施加增益；治疗/护盾按 applyOneStatus 的规则作用于目标自身
          [G.player, G.enemy].forEach(t => {
            if (!t || t.hp <= 0 || t.side !== a.side) return;
            if (Math.hypot(t.x - a.x, t.y - a.y) > R + t.r) return;
            if (a.cfg.buff && a.cfg.buff !== 'none') {
              applyOneStatus(t, a.cfg.buff, a.cfg.buffPower || 0.3, a.cfg.buffDuration || 2, t);
            }
            applyBoundTickStatuses(grp, t, t, true, a.C && a.C.name);
          });
        } else {
          // 伤害型：光环自身 dps ＋ 连到它的伤害 / 元素模块，按结算间隔缩放
          [G.player, G.enemy].forEach(t => {
            if (!t || t.hp <= 0 || t.side === a.side) return;
            if (Math.hypot(t.x - a.x, t.y - a.y) > R + t.r) return;
            const dmg = ((a.cfg.dps || 0) + boundTickDamage(grp)) * gap * EFFECTS.dmgScale;
            if (dmg > 0) applyDamage(t, dmg, a.owner, false, false,
              (a.C && a.C.name) ? { name: a.C.name, tag: '光环' } : '光环');
            if (a.cfg.debuff && a.cfg.debuff !== 'none') {
              applyOneStatus(t, a.cfg.debuff, a.cfg.debuffPower || 0.3, a.cfg.debuffDuration || 2, a.owner);
            }
            applyBoundTickStatuses(grp, a.owner, t, false, a.C && a.C.name);
          });
        }
        return true;
      });
    }
    // 印记：到期引爆 / 迟滞续期 / 撕裂持续伤害
    stepMarks(dt);
    // 墙面残留：每秒对周围伤害 + 敌方弹珠触碰区域伤害（两种规则由伤害·结算模块配置，可同时生效）
    if (G.skillWallHazards && G.skillWallHazards.length) {
      G.skillWallHazards = G.skillWallHazards.filter(h => {
        if (G.clock - h.born > h.life) return false;
        const w = h.cfg, R = w.wallRadius || 60;
        const foes = [G.player, G.enemy].filter(t => t && t.hp > 0 && t.side !== h.side);
        // 触碰伤害：进入区域立刻结算一次；停留在区域内时按「触碰间隔」重复结算（间隔 0 = 只结算进入那一次）
        if (w.wallTouchDamage > 0) {
          foes.forEach(t => {
            const inZone = Math.hypot(t.x - h.x, t.y - h.y) <= R + t.r;
            const key = t.side, gap = w.wallTouchInterval || 0;
            const entered = inZone && !h.inside[key];
            const repeat = gap > 0 && inZone && (h.touchAt[key] == null || G.clock - h.touchAt[key] >= gap);
            if (inZone && (entered || repeat)) {
              applyDamage(t, w.wallTouchDamage * EFFECTS.dmgScale, h.owner, false, false,
                h.name ? { name: h.name, tag: '墙面·触碰' } : '墙面残留·触碰');
              h.touchAt[key] = G.clock;
            }
            h.inside[key] = inZone;
          });
        }
        // 每秒伤害：每 0.5 秒结算半秒的量
        h.tick -= dt;
        if (h.tick <= 0) {
          h.tick = 0.5;
          if (w.wallDps > 0) foes.forEach(t => {
            if (Math.hypot(t.x - h.x, t.y - h.y) > R + t.r) return;
            applyDamage(t, w.wallDps * 0.5 * EFFECTS.dmgScale, h.owner, false, false,
              h.name ? { name: h.name, tag: '墙面·持续' } : '墙面残留·每秒');
          });
        }
        return true;
      });
    }
    // 回响：到期重放同组伤害与特效
    if (G.skillEchoes && G.skillEchoes.length) {
      G.skillEchoes = G.skillEchoes.filter(e => {
        if (e.at > G.clock) return true;
        const grp = (e.C.events && e.C.events[e.ev]) || e.C;
        const t = e.target;
        const SM = SKILL_RT.SM;
        const ectx = {
          caster: e.att, opponent: t,
          entities: [G.player, G.enemy].concat(G.enemies || []),
          angle: 0, point: { x: t ? t.x : e.x, y: t ? t.y : e.y },
          targets: (t && t.side !== e.att.side) ? [t] : []
        };
        if (SM && SM.rangeDescriptor) ectx.desc = SM.rangeDescriptor(e.C, ectx);
        if (t && t.hp > 0 && t.side !== e.att.side) {
          const d = computeSkillDamage(grp, e.att, t, e.scale, ectx);
          applyDamage(t, d.amount, e.att, d.crit, false,
            e.name ? { name: e.name, tag: '回响' } : '回响');
        }
        spawnSkillBurst(e.C, ectx.point.x, ectx.point.y, 0, evToAttach(e.ev), e.att, null, ectx);
        return false;
      });
    }
    // 特效步进 + 跟随投射物定位 + 清理
    const now = performance.now();
    G.skillFx.forEach(q => {
      if (q.follow && typeof q.follow === 'object' && !q.follow.dead) {
        q.x = q.follow.x; q.y = q.follow.y;
        // 「效果不跟随挂载位置旋转」勾选时不覆盖角度：位置照跟，角度冻结在释放时的朝向
        if (!(q.cfg && q.cfg.noRotFollow) && q.follow.rot != null) q.rot = q.follow.rot;
      }
    });
    /* 「伤害·结算」模块的「持续伤害(跟随)」：本帧推进所有持续掉血区（跟随圆心 / 到期回收 / 半径内结算），
       与试放沙盘共用 skill-effects 里的同一份结算口径（stepDotZones）。伤害数值统一由本模块结算。 */
    if (G.skillDotZones && G.skillDotZones.length) {
      G.skillDotZones = SKILL_RT.SE.stepDotZones(G.skillDotZones, dt, {
        targets: [G.player, G.enemy], scale: EFFECTS.dmgScale,
        onTick: (t, dmg, z) => {
          // 飘字显示每秒伤害(= dotDps × 倍率)，而非把每 tick 的 0.6 取整成 1；实际扣血仍按 tick 真实结算
          const perSec = dmg / Math.max(0.1, Number(z.cfg.dotInterval) || 0.5);
          applyDamage(t, dmg, z.owner, false, false,
            (z.C && z.C.name) ? { name: z.C.name, tag: '持续伤害' } : '持续伤害', perSec);
        }
      });
    }
    SKILL_RT.SE.stepFx(G.skillFx, dt);
    SKILL_RT.SE.updateParticles(G.skillParts, dt);
    // 每帧兜底去重：任何路径（含绕过 pushFx 的投射物特效）都不允许同宿主叠多份
    if (SKILL_RT.SE.dedupeFx) SKILL_RT.SE.dedupeFx(G.skillFx);
    G.skillFx = G.skillFx.filter(q => {
      if (q.follow && typeof q.follow === 'object' && q.follow.dead) { if (q.inst) q.inst.kill(); return false; }
      /* 挂在敌方身上的特效若与「标记·印记」同组：印记一旦失效（到期 / 被消耗 / 被引爆），
         特效同步销毁。此前这里只判「跟随实体是否死亡」，循环特效会一直留着 → 越叠越多。 */
      if (q.markFx) {
        const host = (q.follow && typeof q.follow === 'object') ? q.follow : null;
        const markOn = !!host && host._markStacks > 0 && G.clock < (host._markUntil || 0);
        if (!markOn) { if (q.inst) q.inst.kill(); return false; }
      }
      // 显式「存在时长」到点回收
      if (q.ttl > 0 && (q.age || 0) > q.ttl) { if (q.inst) q.inst.kill(); return false; }
      if (q.inst && q.inst.done() && !(SKILL_RT.SE.isLooping ? SKILL_RT.SE.isLooping(q) : (q.cfg && q.cfg.loop))) { if (q.inst) q.inst.kill(); return false; }
      // 跟随投射物的特效由投射物存亡决定，不受固定寿命限制。
      // 贴合墙面的残留特效按「伤害·结算」模块里的墙面残留持续秒数存活（至少 3.2 秒），到点才收。
      // 显式填了「存在时长」的以数值为准（否则 5 秒的循环特效会在 3.2 秒被这条兜底提前掐掉）。
      const fxLife = q.wallFace ? Math.max(3200, (q.cfg._wallDuration || 3) * 1000) : 3200;
      if (!q.follow && !(q.ttl > 0) && now - (q.born || now) > fxLife) { if (q.inst) q.inst.kill(); return false; }
      return true;
    });
  }

  function drawSkillLayer() {
    if (!SKILL_RT) return;
    /* 残留伤害的「半径圈」属于判定范围调试辅助：
       只在技能编辑器 → 实时试放沙盘（admin.js seStartPreview，头部「半径圈」勾选框可控）里绘制；
       正式对局不画任何半径指示，只保留像素特效本体、粒子与伤害跳字（伤害结算照常进行）。
       若需在真实对局里临时核对判定范围，把下面开关改成 true 即可（默认关闭）。 */
    const SHOW_HAZARD_RADIUS = false;
    if (SHOW_HAZARD_RADIUS) {
      // 区域残留：半透明圆 + 呼吸描边
      (G.skillZones || []).forEach(z => {
        const R = z.cfg.radius || 70;
        const k = Math.max(0, 1 - (G.clock - z.born) / Math.max(0.001, z.life));
        const col = z.cfg.color || '#ff7a30';
        ctx.save();
        ctx.globalAlpha = 0.13 * (0.4 + k * 0.6);
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(z.x, z.y, R, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 0.42 * (0.4 + k * 0.6);
        ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
        ctx.restore();
      });
      // 光环：以施法者为圆心的半透明圆 + 描边（增益型用暖色、伤害型用配置色）
      (G.skillAuras || []).forEach(a => {
        const R = Number(a.cfg.radius) || 90;
        const k = Math.max(0, 1 - (G.clock - a.born) / Math.max(0.001, a.life));
        const col = a.cfg.color || '#b98cff';
        ctx.save();
        ctx.globalAlpha = 0.13 * (0.4 + k * 0.6);
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(a.x, a.y, R, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 0.42 * (0.4 + k * 0.6);
        ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
        ctx.restore();
      });
      // 墙面残留伤害区：贴着墙面的半圆 + 接触点标记，随剩余时间淡出
      (G.skillWallHazards || []).forEach(h => {
        const R = h.cfg.wallRadius || 60;
        const k = Math.max(0, 1 - (G.clock - h.born) / Math.max(0.001, h.life));
        const a = Math.atan2(h.ny, h.nx);
        ctx.save();
        ctx.globalAlpha = 0.42 * (0.4 + k * 0.6);
        ctx.strokeStyle = '#ffb066'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(h.x, h.y, R, a - Math.PI / 2, a + Math.PI / 2); ctx.stroke();
        ctx.fillStyle = '#ff7a30';
        ctx.beginPath(); ctx.arc(h.x, h.y, 3.5, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      });
    }
    SKILL_RT.SE.drawParticles(ctx, G.skillParts || []);
    (G.skillShots || []).forEach(q => {
      const col = (q._C && q._C.elements[0] && q._C.elements[0].color) || '#ffb35a';
      // 多发间隔还没轮到的弹：停在出生点待发，不绘制（否则会看到好几发叠在一起）
      if (q.gap > 0) return;
      /* 拖尾先画，且不受 _skinFx 影响：这颗弹挂了像素特效时，弹体由特效渲染，
         但尾迹仍然是投射物模块的事（之前整段 return 导致「勾了拖尾却看不到」）。 */
      if (SKILL_RT.SE.drawShotTrail) SKILL_RT.SE.drawShotTrail(ctx, q, col);
      // 该弹已挂上像素特效时，由特效充当外观，不再画默认手绘弹体
      if (q._skinFx) return;
      // 上传过 PNG 素材时按素材绘制（随自转旋转）；没有素材才画默认手绘弹体
      if (!(SKILL_RT.SE.drawShotImage && SKILL_RT.SE.drawShotImage(ctx, q))) {
        ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2);
        ctx.fillStyle = col; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1; ctx.stroke();
      }
    });
    SKILL_RT.SE.drawFx(ctx, G.skillFx || [], null);
    // 印记：目标头顶按层数画点（颜色取印记配置），最多显示 10 个
    [G.player, G.enemy].forEach(t => {
      if (!t || !(t._markStacks > 0) || G.clock >= (t._markUntil || 0)) return;
      const col = (t._markCfg && t._markCfg.color) || '#e8c85a';
      const n = Math.min(10, t._markStacks);
      for (let i = 0; i < n; i++) {
        ctx.beginPath();
        ctx.arc(t.x - (n - 1) * 2.4 + i * 4.8, t.y - t.r - 10, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = col; ctx.fill();
      }
    });
  }

  function step(dt) {
    G.clock += dt;
    const p = G.player, e = G.enemy;
    const list = [p, e];
    const slip = weatherSlip();   // 下雨湿滑：反弹系数整体放大

    // 运动器：先于物理积分统一算出被接管弹珠本帧的速度。
    // 对局自带 f.x += vx*dt 的积分与碰撞，所以引擎不重复积分（integrate=false）。
    if (MOTION && G.movers && G.movers.length) {
      MOTION.step(G.movers, dt, {
        w: CONFIG.ARENA_W, h: CONFIG.ARENA_H, now: G.clock, integrate: false,
        // 按阵营解析对手：弹珠与「被绑定的投射物」都适用（投射物不在 p/e 之列，不能用 ent===p 判断）
        targetOf: function (ent) { return (ent && ent.side === 'player') ? e : p; }
      });
    }

    list.forEach((f, i) => {
      // 无追踪加速度、无速度衰减：全程只靠初始发射方向与反弹推进
      const slowActive = G.clock < f.slowUntil ? f.slowFactor : 1;

      // 天气 · 大风：持续水平力推弹珠（含正弦阵风波动），同样受速度上限约束
      if (G.weather && G.weather.id === 'wind') {
        const gust = 1 + G.weather.sway * Math.sin(G.clock * 2.1 + (f.side === 'player' ? 0 : 1.7));
        f.vx += G.weather.dir * G.weather.force * gust * dt;
      }
      // 天气 · 下雨：持续向下力（加速度，rainForce），让雨幕把弹珠往下压；同样受速度上限约束
      if (G.weather && G.weather.id === 'rain' && G.weather.rainForce) {
        f.vy += G.weather.rainForce * dt;
      }

      const sp = Math.hypot(f.vx, f.vy);
      // 运动器接管期间 / 刚交还控制权的短时间内放宽速度上限，
      // 否则加速冲刺与附加冲量会在同一帧被 cap 直接吃掉，看起来又变成「没动」。
      const mvNeed = MOTION ? MOTION.maxNeed(G.movers, f) : 0;
      const mvBoost = G.clock < (f._motionCapUntil || 0) ? (f._motionCap || 0) : 0;
      const cap = Math.max(CONFIG.MAX_SPEED * f.speed * slowActive, mvNeed, mvBoost);
      if (sp > cap) { f.vx = f.vx / sp * cap; f.vy = f.vy / sp * cap; }

      // 印记迟滞只缩放本帧位移，不动 vx/vy：印记消失当帧即恢复原速
      const markMul = markSlowMul(f);
      f.x += f.vx * dt * markMul;
      f.y += f.vy * dt * markMul;

      // 边界反弹（下雨湿滑：反弹更有弹性）
      const wr = CONFIG.WALL_RESTITUTION * slip;
      let wb = false, wallContact = null;
      // 记录墙面接触点与法线（法线指向场内），供「贴合墙面」特效 / 墙面残留伤害定位
      if (f.x - f.r < 0) { f.x = f.r; f.vx = Math.abs(f.vx) * wr; wb = true; wallContact = { x: 0, y: f.y, nx: 1, ny: 0 }; }
      if (f.x + f.r > CONFIG.ARENA_W) { f.x = CONFIG.ARENA_W - f.r; f.vx = -Math.abs(f.vx) * wr; wb = true; wallContact = { x: CONFIG.ARENA_W, y: f.y, nx: -1, ny: 0 }; }
      if (f.y - f.r < 0) { f.y = f.r; f.vy = Math.abs(f.vy) * wr; wb = true; wallContact = { x: f.x, y: 0, nx: 0, ny: 1 }; }
      if (f.y + f.r > CONFIG.ARENA_H) { f.y = CONFIG.ARENA_H - f.r; f.vy = -Math.abs(f.vy) * wr; wb = true; wallContact = { x: f.x, y: CONFIG.ARENA_H, nx: 0, ny: -1 }; }
      const obHit = resolveObstacles(f);
      // 撞到场地边界 / 地图障碍：立刻交还控制权，保留这一帧的反弹速度
      if ((wb || obHit) && MOTION) {
        MOTION.noticeWall(G.movers, f, { now: G.clock, w: CONFIG.ARENA_W, h: CONFIG.ARENA_H }, true);
      }
      // onWall 事件放在物理处理之后：旧运动器已收尾，该事件分组可以再挂新的运动器
      if (wb) triggerSkillEvent(f, 'onWall', wallContact);
      /* 被技能击飞后撞墙：结算该技能「撞墙时」组的伤害（击飞撞墙），
         与上面「弹珠自己撞墙触发技能」是两回事，互不影响 */
      if (wb || obHit) resolveSlamDamage(f, wallContact);

      // 持续回复
      if (f.mods.regen > 0 && f.hp > 0) f.hp = Math.min(f.maxHp, f.hp + f.maxHp * f.mods.regen * dt);
      // 持续伤害（dot）：逐帧扣血，按 0.5 秒聚合成一条战斗记录，避免逐帧刷屏；统计不丢任何一笔
      if (G.clock < f.dotUntil && f.dotDps > 0 && f.hp > 0) {
        const rawDot = f.dotDps * dt;
        let dot = rawDot;
        if (f.shield > 0) {
          const a = Math.min(f.shield, dot);
          f.shield -= a; dot -= a;
        }
        f.hp = Math.max(0, f.hp - dot);
        f._dotAccum = (f._dotAccum || 0) + rawDot;
        if (f._dotLogAt == null) f._dotLogAt = G.clock;
        if (G.clock - f._dotLogAt >= 0.5) {
          const accum = f._dotAccum;
          f._dotAccum = 0; f._dotLogAt = G.clock;
          // dot 由对手施加：受害方是我方则统计到对手，反之统计到我方
          recordDamage(f, accum, { side: f.side === 'player' ? 'enemy' : 'player' }, false,
            f._dotName ? { name: f._dotName, tag: '持续伤害' } : '持续伤害');
        }
        if (Math.random() < dt * 8) spawnSparks(f.x + rand(-f.r, f.r), f.y + rand(-f.r, f.r), 0, -1, 1, '#a06ce0', '#a06ce0');
      } else if (f._dotAccum > 0) {
        // dot 提前结束（回合重置 / 护盾清完）：不足 0.5 秒的尾量也计入统计
        const accum = f._dotAccum;
        f._dotAccum = 0; f._dotLogAt = null;
        recordDamage(f, accum, { side: f.side === 'player' ? 'enemy' : 'player' }, false,
          f._dotName ? { name: f._dotName, tag: '持续伤害' } : '持续伤害');
      }
      f.squash = Math.max(0, f.squash - dt * 2.6);
    });

    // 圆-圆碰撞
    let dx = e.x - p.x, dy = e.y - p.y;
    let dist = Math.hypot(dx, dy);
    const minDist = p.r + e.r;
    if (dist < minDist) {
      if (dist < 0.001) { dx = 1; dy = 0; dist = 1; }
      const nx = dx / dist, ny = dy / dist;
      const overlap = minDist - dist;
      const tm = p.mass + e.mass;
      p.x -= nx * overlap * (e.mass / tm);
      p.y -= ny * overlap * (e.mass / tm);
      e.x += nx * overlap * (p.mass / tm);
      e.y += ny * overlap * (p.mass / tm);

      const rvx = p.vx - e.vx, rvy = p.vy - e.vy;
      const vn = rvx * nx + rvy * ny;   // >0 表示正在接近
      if (vn > 0) {
        const j = (1 + CONFIG.RESTITUTION * slip) * vn / (1 / p.mass + 1 / e.mass);
        p.vx -= j / p.mass * nx; p.vy -= j / p.mass * ny;
        e.vx += j / e.mass * nx; e.vy += j / e.mass * ny;

        // 击退强化
        if (p.mods.knock > 0) { e.vx += nx * vn * p.mods.knock * 0.35; e.vy += ny * vn * p.mods.knock * 0.35; }
        if (e.mods.knock > 0) { p.vx -= nx * vn * e.mods.knock * 0.35; p.vy -= ny * vn * e.mods.knock * 0.35; }

        // 加速反弹：双方碰撞后整体提速一小段，制造「撞一下更带劲」的手感
        p.vx *= CONFIG.COLLISION_BOOST; p.vy *= CONFIG.COLLISION_BOOST;
        e.vx *= CONFIG.COLLISION_BOOST; e.vy *= CONFIG.COLLISION_BOOST;

        if (vn > CONFIG.MIN_IMPACT && G.clock - G.lastImpact > CONFIG.IMPACT_CD) {
          G.lastImpact = G.clock;
          resolveHit(p, e, nx, ny, vn);
          /* 本体物理碰撞：这是唯一合法的「弹珠碰撞」命中来源。
             同时把 meta 传下去——触发事件=命中时 且 命中判定=弹珠碰撞 的技能只认这一次。 */
          triggerSkillEvent(p, 'onHit', null, { kind: 'body' });
          triggerSkillEvent(e, 'onHit', null, { kind: 'body' });
        }
      }
    }

    // 模块化技能：推进计时触发、投射物、特效与粒子
    stepSkillRuntime(dt);
  }

  /* ---------------------------------------------------------
     14. 视觉反馈
     --------------------------------------------------------- */
  function spawnSparks(x, y, nx, ny, n, c1, c2) {
    for (let i = 0; i < n; i++) {
      const a = Math.atan2(ny, nx) + rand(-1.5, 1.5);
      const sp = rand(70, 260);
      G.particles.push({
        x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: rand(0.22, 0.55), max: 0.55, size: rand(1.6, 3.8),
        color: Math.random() < 0.5 ? c1 : c2
      });
    }
  }
  function addFloater(x, y, text, color, size) {
    G.floaters.push({ x: x + rand(-8, 8), y: y, vy: -46, life: 0.85, max: 0.85, text: text, color: color, size: size });
  }
  function updateFx(dt) {
    G.trauma = Math.max(0, G.trauma - dt * 1.5);
    G.flash = Math.max(0, G.flash - dt * 1.2);
    G.particles.forEach(q => {
      q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt;
      q.vx *= Math.pow(0.94, dt * 60); q.vy *= Math.pow(0.94, dt * 60);
      q.vy += 90 * dt;
    });
    G.particles = G.particles.filter(q => q.life > 0);
    G.floaters.forEach(q => { q.life -= dt; q.y += q.vy * dt; q.vy *= Math.pow(0.96, dt * 60); });
    G.floaters = G.floaters.filter(q => q.life > 0);
    updateWeatherFx(dt);
  }

  /* ---------------------------------------------------------
     14.2 天气视觉：风线 / 雨滴 / 左上角天气牌
     --------------------------------------------------------- */
  function seedWindFx() {
    const n = 26;
    for (let i = 0; i < n; i++) {
      G.weatherFx.push({
        x: rand(0, CONFIG.ARENA_W), y: rand(0, CONFIG.ARENA_H),
        len: rand(26, 64), sp: rand(220, 480) * (G.weather.dir || 1),
        al: rand(0.08, 0.22), wob: rand(0, 6.28)
      });
    }
  }
  function seedRainFx() {
    const n = 84;
    for (let i = 0; i < n; i++) {
      G.weatherFx.push({
        x: rand(0, CONFIG.ARENA_W), y: rand(-CONFIG.ARENA_H, CONFIG.ARENA_H),
        len: rand(10, 22), v: rand(420, 640), drift: rand(-26, 26), al: rand(0.12, 0.3)
      });
    }
  }
  function updateWeatherFx(dt) {
    const AW = CONFIG.ARENA_W, AH = CONFIG.ARENA_H;
    G.weatherFx.forEach(q => {
      if (G.weather && G.weather.id === 'wind') {
        q.x += q.sp * dt;
        q.y += Math.sin(G.clock * 1.4 + q.wob) * 14 * dt;
        if (q.sp > 0 && q.x - q.len > AW) { q.x = -q.len; q.y = rand(0, AH); }
        if (q.sp < 0 && q.x + q.len < 0) { q.x = AW + q.len; q.y = rand(0, AH); }
        q.y = clamp(q.y, 0, AH);
      } else if (G.weather && G.weather.id === 'rain') {
        q.y += q.v * dt; q.x += q.drift * dt;
        if (q.y - q.len > AH) { q.y = -q.len - rand(0, 40); q.x = rand(0, AW); }
        if (q.x < -8) q.x = AW + 8; if (q.x > AW + 8) q.x = -8;
      }
    });
  }
  function drawWeatherBack() {
    if (!G.weather || G.weather.id !== 'wind' || !G.weatherFx.length) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(190,214,255,1)';
    ctx.lineWidth = 1.4;
    G.weatherFx.forEach(q => {
      ctx.globalAlpha = q.al;
      ctx.beginPath();
      ctx.moveTo(q.x, q.y);
      ctx.lineTo(q.x - q.len * Math.sign(q.sp || 1), q.y + 3);
      ctx.stroke();
    });
    ctx.restore();
  }
  function drawWeatherFront() {
    if (!G.weather) return;
    const AW = CONFIG.ARENA_W;
    if (G.weather.id === 'rain' && G.weatherFx.length) {
      ctx.save();
      ctx.strokeStyle = 'rgba(150,196,255,1)';
      ctx.lineWidth = 1.2;
      G.weatherFx.forEach(q => {
        ctx.globalAlpha = q.al;
        ctx.beginPath();
        ctx.moveTo(q.x, q.y);
        ctx.lineTo(q.x - q.drift * 0.05, q.y - q.len);
        ctx.stroke();
      });
      // 全场淡淡的湿滑雾层
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(96,150,220,0.05)';
      ctx.fillRect(0, 0, AW, CONFIG.ARENA_H);
      ctx.restore();
    }
    // 左上角天气牌：一眼看清本回合天气与方向
    let label, color;
    if (G.weather.id === 'wind') {
      const s = G.weather.force >= 55 ? '▍▍▍' : (G.weather.force >= 40 ? '▍▍' : '▍');
      label = G.weather.name + ' ' + (G.weather.dir > 0 ? '→' : '←') + s;
      color = 'rgba(140,190,255,0.92)';
    } else if (G.weather.id === 'rain') {
      label = G.weather.name + ' · 湿滑 · 下压' + Math.round(G.weather.rainForce || 0);
      color = 'rgba(150,196,255,0.92)';
    } else {
      label = G.weather.name;
      color = 'rgba(200,214,235,0.8)';
    }
    ctx.save();
    ctx.font = '600 12px "PingFang SC","Microsoft YaHei",sans-serif';
    const w = ctx.measureText(label).width + 22, h = 24, x = 12, y = 12;
    roundRectPath(ctx, x, y, w, h, 9);
    ctx.fillStyle = 'rgba(9,14,22,0.78)'; ctx.fill();
    ctx.strokeStyle = 'rgba(120,160,220,0.35)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + 11, y + h / 2 + 0.5);
    ctx.restore();
  }

  /* ---------------------------------------------------------
     15. 绘制
     --------------------------------------------------------- */
  let viewScale = 1, viewOffsetX = 0, viewOffsetY = 0;
  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = dom.arenaWrap.clientWidth;
    const h = dom.arenaWrap.clientHeight;
    dom.canvas.width = Math.round(w * dpr);
    dom.canvas.height = Math.round(h * dpr);
    viewScale = Math.min((w * dpr) / CONFIG.ARENA_W, (h * dpr) / CONFIG.ARENA_H);
    viewOffsetX = (w * dpr - CONFIG.ARENA_W * viewScale) / 2;
    viewOffsetY = (h * dpr - CONFIG.ARENA_H * viewScale) / 2;
  }

  function draw() {
    const W = dom.canvas.width, H = dom.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.setTransform(viewScale, 0, 0, viewScale, viewOffsetX, viewOffsetY);

    const AW = CONFIG.ARENA_W, AH = CONFIG.ARENA_H;

    // 背景（主题来自当前地图配置；上传过背景图则整张铺满，覆盖渐变与网格）
    const theme = (MAP && MAP.theme) || { bgTop: '#0d1420', bgBottom: '#080c14', grid: '#182233', border: '#26344a', accent: '#2b3a52' };
    let drewBgImg = false;
    if (MAP && MAP.bgImg) {
      if (MAPBG.key !== MAP.bgImg || !MAPBG.img) {
        MAPBG.key = MAP.bgImg;
        const im = new Image();
        im.onload = () => { MAPBG.img = im; };
        im.src = MAP.bgImg;
        MAPBG.img = im;
      }
      if (MAPBG.img.complete && MAPBG.img.naturalWidth) {
        ctx.drawImage(MAPBG.img, 0, 0, AW, AH);
        drewBgImg = true;
      }
    }
    if (!drewBgImg) {
      const bg = ctx.createLinearGradient(0, 0, 0, AH);
      bg.addColorStop(0, theme.bgTop);
      bg.addColorStop(1, theme.bgBottom);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, AW, AH);
    }
    // 网格已整体移除（编辑器与游戏端一致）

    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, AW - 2, AH - 2);
    ctx.setLineDash([6, 9]);
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(AW / 2, 12); ctx.lineTo(AW / 2, AH - 12); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(AW / 2, AH / 2, 62, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(AW / 2, AH / 2, 4, 0, Math.PI * 2); ctx.fillStyle = theme.accent; ctx.fill();
    drawObstacles();
    drawWeatherBack();   // 风线画在弹珠后面，作为场内环境层

    // 震屏只作用于视觉变换，不影响物理坐标
    const shake = G.trauma * G.trauma;
    const t = performance.now() / 1000;
    ctx.save();
    ctx.translate(shake * 11 * Math.sin(t * 37), shake * 8 * Math.sin(t * 29));

    [G.player, G.enemy].forEach(drawFighter);
    if (G.phase === 'aim' && G.player) drawAimArrow();
    drawParticles();
    drawFloaters();
    drawSkillLayer();   // 模块化技能的投射物 / 像素特效 / 粒子
    ctx.restore();

    drawWeatherFront();   // 雨滴与天气牌画在弹珠前面

    if (G.flash > 0) {
      ctx.fillStyle = 'rgba(255,255,255,' + (G.flash * 0.35).toFixed(3) + ')';
      ctx.fillRect(0, 0, AW, AH);
    }
  }

  // 地图背景图缓存：src 未变时复用已解码图片，避免每帧重新加载
  const MAPBG = { key: '', img: null };

  function drawObstacles() {
    if (!MAP || !MAP.obstacles) return;
    MAP.obstacles.forEach(ob => {
      ctx.fillStyle = ob.color || '#2b3a52';
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (ob.type === 'circle') ctx.arc(ob.x, ob.y, ob.r || 0, 0, Math.PI * 2);
      else ctx.rect(ob.x - (ob.w || 0) / 2, ob.y - (ob.h || 0) / 2, ob.w || 0, ob.h || 0);
      ctx.fill(); ctx.stroke();
    });
  }

  // 圆角矩形路径（不依赖 CanvasRenderingContext2D.roundRect，兼容旧浏览器）
  function roundRectPath(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y);
    c.closePath();
  }
  // 弹珠上方跟随的阵营名牌：我方青蓝 / 对手橙红，同职业也能一眼分清
  function drawSideLabel(f, side) {
    const name = f.side === 'player' ? nickName() : enemyNick();
    const text = side.label + ' · ' + name;
    ctx.save();
    ctx.font = '600 13px "PingFang SC","Microsoft YaHei",sans-serif';
    const w = ctx.measureText(text).width + 25, h = 22;
    const x = clamp(f.x - w / 2, 6, Math.max(6, CONFIG.ARENA_W - w - 6));
    const y = clamp(f.y - f.r - 33, 6, Math.max(6, CONFIG.ARENA_H - h - 6));
    roundRectPath(ctx, x, y, w, h, 11);
    ctx.fillStyle = 'rgba(9,14,22,0.88)'; ctx.fill();
    ctx.strokeStyle = hexAlpha(side.color, 0.9); ctx.lineWidth = 1.5; ctx.stroke();
    ctx.beginPath(); ctx.arc(x + 11, y + h / 2, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = side.color; ctx.fill();
    ctx.fillStyle = '#f2f5fa'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 19, y + h / 2 + 0.5);
    ctx.restore();
  }

  function drawFighter(f) {
    if (!f) return;
    const side = SIDE[f.side] || SIDE.enemy;

    // 拖尾
    f.trail.push({ x: f.x, y: f.y });
    if (f.trail.length > 14) f.trail.shift();
    for (let i = 0; i < f.trail.length - 1; i++) {
      const a = (i / f.trail.length) * 0.32;
      ctx.beginPath();
      ctx.arc(f.trail[i].x, f.trail[i].y, f.r * (0.35 + i / f.trail.length * 0.55), 0, Math.PI * 2);
      ctx.fillStyle = hexAlpha(f.color, a);
      ctx.fill();
    }

    ctx.save();
    ctx.translate(f.x, f.y);

    // 阵营外发光：球体本身仍是职业底色/贴图，光圈用阵营色区分敌我
    const glow = ctx.createRadialGradient(0, 0, f.r * 0.35, 0, 0, f.r * 2.7);
    glow.addColorStop(0, hexAlpha(side.color, 0.46));
    glow.addColorStop(0.52, hexAlpha(side.color, 0.2));
    glow.addColorStop(1, hexAlpha(side.color, 0));
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(0, 0, f.r * 2.7, 0, Math.PI * 2); ctx.fill();

    // 弹珠恒为正圆：不做速度拉伸 / 碰撞挤压，上传的 PNG 贴图在移动与对撞时都不变形。
    // 速度感改由上面的拖尾体现。

    // 弹珠本体：与后台「弹珠外观」预览共用同一套渲染（支持上传的 PNG 皮肤）
    if (window.WowPinballSkin) {
      window.WowPinballSkin.paint(ctx, 0, 0, f.r, f.color, f.cls.skin, f.cls.name.charAt(0), { glow: false });
    } else {
      const body = ctx.createRadialGradient(-f.r * 0.35, -f.r * 0.42, f.r * 0.1, 0, 0, f.r);
      body.addColorStop(0, '#ffffff');
      body.addColorStop(0.22, lighten(f.color, 0.35));
      body.addColorStop(0.72, f.color);
      body.addColorStop(1, darken(f.color, 0.55));
      ctx.beginPath(); ctx.arc(0, 0, f.r, 0, Math.PI * 2);
      ctx.fillStyle = body; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = hexAlpha('#ffffff', 0.35); ctx.stroke();
      ctx.beginPath();
      ctx.arc(-f.r * 0.32, -f.r * 0.38, f.r * 0.24, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fill();
      ctx.fillStyle = 'rgba(8,10,16,0.78)';
      ctx.font = '700 ' + Math.round(f.r * 0.82) + 'px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(f.cls.name.charAt(0), 0, 1);
    }
    ctx.restore();

    // 阵营环：只保留虚线外环（实线内环已移除），颜色固定为 我方青蓝 / 对手橙红
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.r + 8, 0, Math.PI * 2);
    ctx.setLineDash([4, 5]);
    ctx.strokeStyle = hexAlpha(side.color, 0.5); ctx.lineWidth = 1.5; ctx.stroke();
    ctx.setLineDash([]);

    // 状态环改成中性色，避免与阵营色混淆
    if (f.shield > 0.5) {
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r + 12.5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(240,220,155,' + (0.45 + 0.25 * Math.sin(performance.now() / 180)) + ')';
      ctx.lineWidth = 2.5; ctx.stroke();
    }
    if (G.clock < f.slowUntil) {
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r + 16.5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(190,170,235,0.5)'; ctx.lineWidth = 1.5; ctx.stroke();
    }

    drawSideLabel(f, side);
  }

  function drawParticles() {
    G.particles.forEach(q => {
      const a = clamp(q.life / q.max, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = q.color;
      ctx.beginPath(); ctx.arc(q.x, q.y, q.size * a, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;
  }
  function drawFloaters() {
    G.floaters.forEach(q => {
      const a = clamp(q.life / q.max, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = q.color;
      ctx.font = '700 ' + q.size + 'px "Segoe UI",sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(q.text, q.x, q.y);
    });
    ctx.globalAlpha = 1;
  }

  function hexAlpha(hex, a) {
    const c = parseHex(hex);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }
  function parseHex(hex) {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function lighten(hex, k) {
    const c = parseHex(hex).map(v => Math.round(v + (255 - v) * k));
    return 'rgb(' + c.join(',') + ')';
  }
  function darken(hex, k) {
    const c = parseHex(hex).map(v => Math.round(v * (1 - k)));
    return 'rgb(' + c.join(',') + ')';
  }

  /* ---------------------------------------------------------
     16. HUD / 日志 / 横幅
     --------------------------------------------------------- */
  /* ---- 双方卡片的 BUFF / DEBUFF 图标栏 ----
     目录来自后台「状态图标」页（DATA.statuses）：名称 / 类型 / 颜色 / 图标 / 说明 / 排序全部可编辑。
     这里只负责采集弹珠上「真正生效」的状态并渲染；没有上传 PNG 时用内置矢量图标（不使用 emoji）。 */
  const STATUS_GLYPHS = {
    shield: '<path d="M12 2.5 20 6v6c0 5-3.4 8-8 9.5C7.4 20 4 17 4 12V6z"/><path d="M8.5 12h7"/>',
    aura: '<circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="8.2"/>',
    combo: '<path d="M13 2 5 13h6l-1 9 8-11h-6z"/>',
    mark: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/>',
    slow: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/>',
    dot: '<path d="M12 3c3 4 5 6 5 10a5 5 0 0 1-10 0c0-2 1-4 2.5-6 .3 2 1 3 2 3 0-2 .2-4 .5-7z"/>',
    stun: '<path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3"/><circle cx="12" cy="12" r="3"/>',
    weaken: '<path d="M12 3v14M7 12l5 5 5-5"/><path d="M5 21h14"/>',
    custom: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>'
  };
  const STATUS_SOURCES = ['shield', 'aura', 'combo', 'mark', 'slow', 'dot', 'stun', 'weaken', 'custom'];
  // 预览模式写入的临时配置可能没有 statuses，回退到内置默认，保证状态栏不空白
  const STATUS_RAW = (Array.isArray(DATA.statuses) && DATA.statuses.length) ? DATA.statuses
    : ((window.WOWPINBALL_DEFAULT && window.WOWPINBALL_DEFAULT.statuses) || []);
  const STATUS_DEFS = STATUS_RAW
    .filter(s => s && s.enabled !== false && STATUS_SOURCES.indexOf(s.source) >= 0)
    .slice().sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.id).localeCompare(String(b.id)));

  function statusColorVars(color) {
    const ok = /^#[0-9a-fA-F]{6}$/.test(color || '');
    const hex = ok ? color : '#8fa3c0';
    const c = ok ? parseHex(hex) : [143, 163, 192];
    return '--st-color:' + hex + ';--st-bg:rgba(' + c.join(',') + ',.16);--st-glow:rgba(' + c.join(',') + ',.32)';
  }

  /* 采集一名弹珠当前实际生效的状态：返回 [{def, stacks, remain}] */
  function collectStatuses(f) {
    if (!f) return [];
    const now = G.clock, out = [];
    const add = (source, stacks, remain, tag) => {
      STATUS_DEFS.forEach(def => {
        if (def.source !== source) return;
        if (source === 'custom' && String(def.tag || '') !== String(tag || '')) return;
        out.push({ def: def, stacks: stacks || 0, remain: Math.max(0, remain || 0) });
      });
    };
    // 增益：护盾 / 光环 / 连击
    if (f.shield > 0.5) add('shield', 0, 0);
    if (f.combo > 0) add('combo', f.combo, 0);
    const auraOn = (G.skillAuras || []).filter(a => a && a.side === f.side && a.cfg && a.cfg.auraType === 'buff' && now - a.born < a.life);
    if (auraOn.length) add('aura', auraOn.length, Math.max.apply(null, auraOn.map(a => a.born + a.life - now)));
    // 减益：印记 / 眩晕 / 迟滞 / 撕裂 / 易伤
    const markOn = f._markStacks > 0 && now < (f._markUntil || 0);
    if (markOn) add('mark', f._markStacks, f._markUntil - now);
    const stunOn = now < (f.slowUntil || 0) && f.slowFactor <= 0.1;
    if (stunOn) add('stun', 0, f.slowUntil - now);
    else {
      const markSlow = markOn && f._markCfg && f._markCfg.slowPct > 0;
      if (markSlow) add('slow', f._markStacks, f._markUntil - now);
      else if (now < (f.slowUntil || 0) && f.slowFactor < 1) add('slow', 0, f.slowUntil - now);
    }
    if (f.dotDps > 0 && now < (f.dotUntil || 0)) add('dot', 0, f.dotUntil - now);
    if (f._weakUntil && now < f._weakUntil) add('weaken', 0, f._weakUntil - now);
    // 自定义标签：技能「事件状态」模块填写的 statusTag 会写进 _statusTags
    const tags = f._statusTags || {};
    Object.keys(tags).forEach(tag => { if (tags[tag] > now) add('custom', 0, tags[tag] - now, tag); });
    return out.sort((a, b) => (Number(a.def.order) || 0) - (Number(b.def.order) || 0));
  }

  /* 只在内容或整数秒变化时重排 DOM，避免每帧 innerHTML 造成抖动 */
  const buffSig = { player: null, enemy: null };
  function renderBuffBar(side, f) {
    const el = side === 'player' ? dom.pBuffs : dom.eBuffs;
    if (!el) return;
    const list = collectStatuses(f);
    const sig = list.map(x => x.def.id + ':' + x.stacks + ':' + Math.ceil(x.remain)).join('|');
    if (buffSig[side] === sig) return;
    buffSig[side] = sig;
    el.innerHTML = list.map(x => {
      const d = x.def;
      const color = /^#[0-9a-fA-F]{6}$/.test(d.color || '') ? d.color : '#8fa3c0';
      const glyph = STATUS_GLYPHS[d.source] || STATUS_GLYPHS.custom;
      const icon = d.icon
        ? '<img class="st-icon" alt="" src="' + escHtml(d.icon) + '">'
        : '<svg class="st-glyph" viewBox="0 0 24 24" aria-hidden="true">' + glyph + '</svg>';
      const badge = x.stacks > 1 ? '×' + x.stacks : (x.remain > 0 ? Math.ceil(x.remain) + 's' : '');
      const tip = (d.name || '状态') + (d.kind === 'buff' ? ' · 增益' : ' · 减益') +
        (d.desc ? ' · ' + d.desc : '') +
        (x.stacks > 1 ? ' · ' + x.stacks + ' 层' : '') +
        (x.remain > 0 ? ' · 剩余 ' + Math.ceil(x.remain) + ' 秒' : '');
      return '<span class="buff-chip" data-kind="' + (d.kind === 'buff' ? 'buff' : 'debuff') +
        '" style="' + statusColorVars(color) + '" title="' + escHtml(tip) + '">' +
        icon + '<i class="st-kind"></i><i class="st-stack">' + escHtml(badge) + '</i></span>';
    }).join('');
  }

  function updateHud() {
    if (!G.player || !G.enemy) return;
    const p = G.player, e = G.enemy;
    dom.pHpBar.style.width = (clamp(p.hp / p.maxHp, 0, 1) * 100) + '%';
    dom.eHpBar.style.width = (clamp(e.hp / e.maxHp, 0, 1) * 100) + '%';
    dom.pShieldBar.style.width = (clamp(p.shield / p.maxHp, 0, 1) * 100) + '%';
    dom.eShieldBar.style.width = (clamp(e.shield / e.maxHp, 0, 1) * 100) + '%';
    dom.pHpText.textContent = Math.ceil(p.hp) + ' / ' + p.maxHp + (p.shield > 0.5 ? '  +' + Math.ceil(p.shield) + '盾' : '');
    dom.eHpText.textContent = Math.ceil(e.hp) + ' / ' + e.maxHp + (e.shield > 0.5 ? '  +' + Math.ceil(e.shield) + '盾' : '');
    dom.pScore.textContent = '回合胜 ' + G.scores.player;
    dom.eScore.textContent = '回合胜 ' + G.scores.enemy;
    syncSkillCharge(false);
    renderBuffBar('player', p);
    renderBuffBar('enemy', e);
  }

  function updateMeta() {
    if (!G.player || !G.enemy) return;
    dom.pSkills.innerHTML = renderMiniSkills(G.playerSkills);
    dom.eSkills.innerHTML = renderMiniSkills(G.enemySkills);
    cacheSkillBars();
    syncSkillCharge(true);
    // 瞄准阶段时，回合尚未开始，标签与高亮显示「即将到来的回合」
    const upcoming = G.phase === 'aim' ? G.round + 1 : G.round;
    dom.roundLabel.textContent = '第 ' + Math.max(1, upcoming) + ' / ' + CONFIG.TOTAL_ROUNDS + ' 回合';
    const currentIdx = Math.max(0, upcoming - 1);
    dom.roundPips.innerHTML = Array.from({ length: CONFIG.TOTAL_ROUNDS }, (_, i) => i).map(i => {
      const r = G.roundResults[i];
      let cls = '';
      if (r) cls = r.winner === 'player' ? 'win' : (r.winner === 'enemy' ? 'lose' : 'draw');
      if (!r && i === currentIdx && G.phase !== 'finished') cls += ' current';
      return '<span class="rpip ' + cls + '"></span>';
    }).join('');
  }

  function updateScoreboard() { updateHud(); updateMeta(); }

  function renderMiniSkills(skills) {
    const count = Math.max(3, skills.length);
    const slots = Array.from({ length: count }, (_, i) => {
      const s = skills[i];
      if (!s) return '<div class="mini-skill empty">技能位 ' + (i + 1) + '</div>';
      const t = (s.charge > 0 ? s.charge : 3).toFixed(1);
      const isActive = !!(s.compiled && s.compiled.active);
      const tip = s.intro ? s.intro + ' · ' + (s.desc || s.name) : (s.desc || s.name);
      return '<div class="mini-skill has-cd" data-tier="' + escHtml(s.tier) + '" data-sid="' + escHtml(s.id) + '" title="' + escHtml(tip) +
        (isActive ? ' · 充能 ' + t + 's' : ' · 被动 · 无需充能') + '">' +
        '<span class="ms-name">' + escHtml(s.name) + '</span>' +
        '<span class="ms-cd"><i></i></span></div>';
    });
    return slots.join('');
  }

  /* 技能图标下方的充能条：只在数值变化时写样式，避免每帧重排 */
  const skillBars = { player: [], enemy: [] };
  function cacheSkillBars() {
    ['player', 'enemy'].forEach(side => {
      const host = side === 'player' ? dom.pSkills : dom.eSkills;
      skillBars[side] = host ? Array.prototype.slice.call(host.querySelectorAll('.mini-skill[data-sid]')) : [];
    });
  }
  function syncSkillCharge(force) {
    ['player', 'enemy'].forEach(side => {
      const f = side === 'player' ? G.player : G.enemy;
      const nodes = skillBars[side] || [];
      if (!f || !nodes.length) return;
      const casters = f._skillCasters || [];
      nodes.forEach(el => {
        const sid = el.getAttribute('data-sid');
        let charge = -1;
        for (let i = 0; i < casters.length; i++) {
          if (casters[i].sid === sid) { charge = casters[i].charge; break; }
        }
        const passive = charge < 0;    // 纯被动技能没有施放行为，不做充能
        const pct = Math.round(clamp(passive ? 1 : charge, 0, 1) * 100);
        if (!force && el._cpct === pct && el._cpsv === passive) return;
        el._cpct = pct; el._cpsv = passive;
        const fill = el._cfill || (el._cfill = el.querySelector('.ms-cd i'));
        if (fill) fill.style.width = pct + '%';
        el.classList.toggle('passive', passive);
        el.classList.toggle('ready', !passive && pct >= 100);
        el.classList.toggle('charging', !passive && pct < 100);
      });
    });
  }

  function addLog(text, kind) {
    G.logLines.unshift({ text: text, kind: kind || '' });
    // 逐笔伤害明细也写进战斗记录，容量放宽（弹层本身可滚动），避免把回合事件挤掉
    if (G.logLines.length > 300) G.logLines.pop();
    dom.battleLog.innerHTML = G.logLines.map(l => '<div class="log-line ' + l.kind + '">' + l.text + '</div>').join('');
  }

  let bannerTimer = null;
  function showBanner(title, sub, ms) {
    dom.bannerTitle.textContent = title;
    dom.bannerSub.textContent = sub;
    dom.banner.hidden = false;
    dom.banner.style.animation = 'none';
    void dom.banner.offsetWidth;
    dom.banner.style.animation = '';
    clearTimeout(bannerTimer);
    if (ms > 0) bannerTimer = setTimeout(() => { dom.banner.hidden = true; }, ms);
  }

  /* ---------------------------------------------------------
     17. 结算
     --------------------------------------------------------- */
  function showResult() {
    if (PREVIEW) {
      const pt = G.roundResults.reduce((a, r) => a + r.pp, 0);
      const et = G.roundResults.reduce((a, r) => a + r.ep, 0);
      emitPreview('match', {
        scores: Object.assign({}, G.scores),
        pp: Math.round(pt * 100), ep: Math.round(et * 100),
        pc: G.playerClass.name, ec: G.enemyClass.name
      });
      setTimeout(() => startPreviewMatch(G.playerClass.id, G.enemyClass.id), 1500);
      return;
    }
    G.phase = 'finished';
    G.screen = 'result';
    dom.battleScreen.hidden = true;
    dom.resultScreen.hidden = false;
    dom.banner.hidden = true;

    const ps = G.scores.player, es = G.scores.enemy;
    let title, cls, kicker;
    const over = CONFIG.TOTAL_ROUNDS + ' 回合结束';
    if (ps > es) { title = '胜 利'; cls = 'win'; kicker = over + ' · 你赢下了这局对撞'; sfx.win(); }
    else if (ps < es) { title = '落 败'; cls = 'lose'; kicker = over + ' · 对手赢下了这局对撞'; sfx.lose(); }
    else {
      const pt = G.roundResults.reduce((a, r) => a + r.pp, 0);
      const et = G.roundResults.reduce((a, r) => a + r.ep, 0);
      if (Math.abs(pt - et) < 0.001) { title = '平 局'; cls = 'draw'; kicker = over + ' · 势均力敌'; }
      else if (pt > et) { title = '胜 利'; cls = 'win'; kicker = '回合数持平 · 按总剩余生命判定'; sfx.win(); }
      else { title = '落 败'; cls = 'lose'; kicker = '回合数持平 · 按总剩余生命判定'; sfx.lose(); }
    }
    dom.resultKicker.textContent = kicker;
    dom.resultTitle.textContent = title;
    dom.resultTitle.className = cls;
    dom.resultDesc.textContent = '回合比分  ' + ps + ' : ' + es + '（平局 ' + G.scores.draw + '）  ·  ' +
      nickName() + '（' + G.playerClass.name + '） 对阵 ' + enemyNick() + '（' + G.enemyClass.name + '）';
    if (SHOP.enabled) {
      const rw = SHOP.rewards;
      const gain = cls === 'win' ? rw.win : (cls === 'lose' ? rw.lose : rw.draw);
      addCoins(gain);
      dom.resultDesc.textContent += '  ·  ' + SHOP.currency + ' +' + gain;
    }

    // 联机局：房主先把整局结果广播给客机，再走本地结算
    if (P2P.active && P2P.role === 'host') {
      p2pSend({
        k: 'match_end',
        sc: { player: G.scores.player, enemy: G.scores.enemy, draw: G.scores.draw },
        rs: G.roundResults.map(r => ({ round: r.round, pp: r.pp, ep: r.ep, winner: r.winner, reason: r.reason }))
      });
    }

    dom.roundReview.innerHTML = G.roundResults.map(r => {
      const label = r.winner === 'player' ? '胜' : (r.winner === 'enemy' ? '负' : '平');
      const style = r.winner === 'player' ? 'win' : (r.winner === 'enemy' ? 'lose' : 'draw');
      return '<div class="rr-item"><div class="rr-no">第 ' + r.round + ' 回合</div>' +
        '<div class="rr-res ' + style + '">' + label + '</div>' +
        '<div class="rr-detail">我方 ' + Math.round(r.pp * 100) + '%  /  对手 ' + Math.round(r.ep * 100) + '%</div></div>';
    }).join('');

    dom.buildReview.innerHTML =
      buildCol('我方 · ' + nickName() + ' · ' + G.playerClass.name, G.playerClass.color, G.playerSkills) +
      buildCol('对手 · ' + enemyNick() + ' · ' + G.enemyClass.name, G.enemyClass.color, G.enemySkills);
  }

  function buildCol(title, color, skills) {
    return '<div class="br-col"><h4 style="color:' + color + '">' + title + '</h4><div class="br-list">' +
      skills.map(s => '<span class="mini-skill" data-tier="' + escHtml(s.tier) + '" title="' + escHtml(s.intro ? s.intro + ' · ' + s.desc : s.desc) + '">' + escHtml(s.name) + '</span>').join('') +
      '</div></div>';
  }

  /* ---------------------------------------------------------
     18. 流程控制
     --------------------------------------------------------- */
  function switchScreen(name) {
    G.screen = name;
    dom.startScreen.hidden = name !== 'start';
    dom.battleScreen.hidden = name !== 'battle';
    dom.resultScreen.hidden = name !== 'result';
    dom.roomScreen.hidden = name !== 'room';
    if (name !== 'battle') dom.logModal.hidden = true;
  }

  function startMatch(cls, opts) {
    opts = opts || {};
    ensureAudio();
    G.playerClass = cls;
    G.enemyClass = opts.enemyClass ? (CLASSES.find(c => c.id === opts.enemyClass) || CLASSES[randInt(CLASSES.length)]) : CLASSES[randInt(CLASSES.length)];
    G.player = makeFighter('player', cls);
    G.enemy = makeFighter('enemy', G.enemyClass);
    G.round = 0;
    G.roundTime = 0;
    G.scores = { player: 0, enemy: 0, draw: 0 };
    G.roundResults = [];
    G.playerSkills = [];
    G.enemySkills = [];
    G.myPicks = [];
    G.logLines = [];
    G.particles = [];
    G.floaters = [];
    G.trauma = 0;
    resetDmgStats();
    dom.battleLog.innerHTML = '';

    syncMatchNames(cls.name, G.enemyClass.name, cls.color, G.enemyClass.color);

    switchScreen('battle');
    resizeCanvas();   // 必须在面板可见后取尺寸，否则 clientWidth 为 0
    if (dom.asyncTag) {
      if (P2P.active) {
        dom.asyncTag.hidden = false;
        dom.asyncTag.textContent = '联机对战 · ' + enemyNick();
      } else {
        dom.asyncTag.hidden = true;
        dom.asyncTag.textContent = '';
      }
    }
    addLog('对战开始：' + nickName() + '（' + cls.name + '） 对阵 ' + enemyNick() + '（' + G.enemyClass.name + '）', 'hl');
    if (P2P.active) addLog('联机对战 · ' + (P2P.role === 'host' ? '本端为房主，判定在本端进行' : '本端为客机，画面由房主同步'), 'hl');
    if (P2P.active && P2P.role === 'guest') {
      // 联机客机：不自己发牌，等房主的 draft / aim 事件
      G.phase = 'wait-draft';
      showBanner('等待房主发牌', '双方技能与出生位由房主同步', 0);
      return;
    }
    openDraft('战前准备 · 随机三选一', '选择一个技能，本局全程生效');
  }

  /* ---------------------------------------------------------
     18.5 预览模式（后台「实时编排」工作台内嵌引擎）
     --------------------------------------------------------- */
  function emitPreview(type, payload) {
    if (!PREVIEW) return;
    try { window.parent.postMessage(Object.assign({ kind: 'pb', type: type }, payload), '*'); } catch (e) { /* 跨域或父窗口缺失时忽略 */ }
  }

  function randSkillOf(cls) {
    const pool = SKILLS.filter(s => (s.cls.length === 0 || s.cls.indexOf(cls.id) >= 0) && s.enabled !== false);
    return pool.length ? pool[randInt(pool.length)] : null;
  }

  // 后台指定的对阵（来自 URL hash #matchup=id,id）；缺省取前两个启用职业
  function previewMatchup() {
    const m = (location.hash.match(/matchup=([A-Za-z0-9_]+),([A-Za-z0-9_]+)/) || []);
    const list = CLASSES;
    const pc = list.find(c => c.id === m[1]) || list[0];
    const ec = list.find(c => c.id === m[2] && c.id !== pc.id) || list.find(c => c.id !== pc.id) || list[0];
    return [pc, ec];
  }

  // 预览：跳过选技能，自动随机给双方各 1 个技能并直接开打，三回合后自动重开
  function startPreviewMatch(pcId, ecId) {
    const list = CLASSES;
    const pc = list.find(c => c.id === pcId) || list[0];
    const ec = list.find(c => c.id === ecId && c.id !== pc.id) || list.find(c => c.id !== pc.id) || list[0];
    G.playerClass = pc; G.enemyClass = ec;
    G.playerAim = 0;   // 预览模式无玩家操作，默认朝敌方发射
    G.player = makeFighter('player', pc);
    G.enemy = makeFighter('enemy', ec);
    G.round = 0; G.roundTime = 0; G.scores = { player: 0, enemy: 0, draw: 0 };
    G.roundResults = []; G.playerSkills = []; G.enemySkills = [];
    G.logLines = []; G.particles = []; G.floaters = []; G.trauma = 0;
    resetDmgStats();
    dom.battleLog.innerHTML = '';

    const ps = randSkillOf(pc), es = randSkillOf(ec);
    if (ps) G.playerSkills.push(ps);
    if (es) G.enemySkills.push(es);
    recompute(G.player); recompute(G.enemy);

    syncMatchNames(pc.name, ec.name, pc.color, ec.color);

    switchScreen('battle');
    resizeCanvas();
    addLog('预览 · ' + pc.name + ' 对阵 ' + ec.name + (ps ? '（我方 ' + ps.name + '）' : ''), 'hl');
    beginRound();
  }

  function buildPreviewBar() {
    const bar = document.createElement('div');
    bar.className = 'preview-bar';
    bar.innerHTML =
      '<span class="pb-tag">预览引擎</span>' +
      '<button class="pb-btn" type="button" data-act="pb-speed">速度 x' + SPEEDS[G.speedIdx] + '</button>' +
      '<button class="pb-btn" type="button" data-act="pb-sound">音效 ' + (G.sound ? '开' : '关') + '</button>' +
      '<button class="pb-btn" type="button" data-act="pb-restart">重开对战</button>';
    document.body.appendChild(bar);
    bar.addEventListener('click', ev => {
      const a = ev.target.getAttribute('data-act'); if (!a) return;
      if (a === 'pb-speed') { G.speedIdx = (G.speedIdx + 1) % SPEEDS.length; ev.target.textContent = '速度 x' + SPEEDS[G.speedIdx]; }
      else if (a === 'pb-sound') { G.sound = !G.sound; ev.target.textContent = '音效 ' + (G.sound ? '开' : '关'); if (G.sound) ensureAudio(); }
      else if (a === 'pb-restart') { startPreviewMatch(G.playerClass.id, G.enemyClass.id); }
    });
  }

  /* ---------------------------------------------------------
     19. 主循环
     --------------------------------------------------------- */
  let lastTs = performance.now();
  function loop(ts) {
    const realDt = Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts;

    if (G.screen === 'battle' && G.phase === 'fighting') {
      if (P2P.active && P2P.role === 'guest') {
        // 联机客机：不跑物理，消费房主快照做插值回放
        p2pGuestFrame(realDt);
      } else if (ts >= G.hitStopUntil) {
        const dt = realDt * (P2P.active ? 1 : SPEEDS[G.speedIdx]);   // 联机锁 x1：双方节奏必须一致
        const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
        for (let i = 0; i < steps; i++) {
          step(dt / steps);
          if (G.player.hp <= 0 || G.enemy.hp <= 0) break;
        }
        G.roundTime -= dt;
        dom.timerText.textContent = Math.max(0, G.roundTime).toFixed(1);
        if (G.player.hp <= 0 || G.enemy.hp <= 0) {
          endRound('ko');
        } else if (G.roundTime <= 0) {
          endRound('time');
        } else {
          updateHud();
          // 联机（房主）：30Hz 快照广播（不可靠 game 通道）
          // 用 -= 保持节拍稳定；更高频率让 17% 丢包下的插值间隔更短
          if (P2P.active && P2P.role === 'host') {
            P2P.snapAcc += realDt;
            if (P2P.snapAcc >= 0.033) { P2P.snapAcc -= 0.033; p2pSendSnap(); }
          }
        }
      }
    }

    if (G.screen === 'battle') {
      updateFx(realDt);
      draw();
    }
    requestAnimationFrame(loop);
  }

  /* ---------------------------------------------------------
     20. 事件绑定
     --------------------------------------------------------- */
  dom.startBtn.addEventListener('click', () => {
    if (!G.selectedClass) return;
    if (P2P.active) {
      ensureAudio();
      p2pRoomShow();             // 联机：回房间页选职业并准备
      return;
    }
    startMatch(G.selectedClass);
  });
  if (dom.launchBtn) dom.launchBtn.addEventListener('click', () => launchRound());
  dom.rematchBtn.addEventListener('click', () => {
    if (P2P.active) { p2pBackToRoom(true); return; }   // 任一方点再战，双方一起回房间重新准备
    ensureAudio(); startMatch(G.playerClass);
  });
  dom.changeBtn.addEventListener('click', () => {
    if (P2P.active) p2pTeardown('你退出了对局');   // 通知对方后断开
    switchScreen('start');
  });

  // 联机大厅
  const p2pBtn = $('p2pBtn');
  if (p2pBtn) p2pBtn.addEventListener('click', openP2P);
  const p2pClose = $('closeP2pBtn');
  if (p2pClose) p2pClose.addEventListener('click', () => {
    $('p2pModal').hidden = true;
    // 连接还没建起来就关窗：清理半成品会话
    if (P2P.active && !P2P.inMatch && (!P2P.net || !P2P.net.ready)) p2pTeardown(null);
  });
  const bindP2P = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
  bindP2P('p2pCreateBtn', p2pHostCreate);
  bindP2P('p2pAcceptBtn', p2pJoinAccept);
  bindP2P('p2pJoinBtn', () => {
    p2pMsg('p2pJoinMsg', null);
    p2pStage('p2pStageJoin');
    const inp = $('p2pRoomCodeIn');
    if (inp) inp.focus();
  });
  const roomCodeIn = $('p2pRoomCodeIn');
  if (roomCodeIn) {
    roomCodeIn.addEventListener('input', () => {
      roomCodeIn.value = roomCodeIn.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    });
    roomCodeIn.addEventListener('keydown', ev => { if (ev.key === 'Enter') p2pJoinAccept(); });
  }
  bindP2P('roomCopyBtn', () => {
    if (!P2P.roomCode) return;
    const ok = () => p2pRoomMsg('已复制邀请码，发给好友吧', 'good');
    const bad = () => p2pRoomMsg('复制失败，请手动选中房间码', 'bad');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(P2P.roomCode).then(ok, bad);
    } else bad();
  });
  bindP2P('roomReadyBtn', p2pRoomToggleReady);
  bindP2P('roomLeaveBtn', () => {
    if (P2P.active) p2pTeardown('你退出了房间');
    switchScreen('start');
  });

  dom.speedBtn.addEventListener('click', () => {
    if (P2P.active) return;   // 联机锁 x1：双方节奏必须一致
    G.speedIdx = (G.speedIdx + 1) % SPEEDS.length;
    dom.speedBtn.textContent = '速度 x' + SPEEDS[G.speedIdx];
  });
  dom.soundBtn.addEventListener('click', () => {
    G.sound = !G.sound;
    dom.soundBtn.textContent = '音效 ' + (G.sound ? '开' : '关');
    if (G.sound) ensureAudio();
  });
  dom.rulesBtn.addEventListener('click', () => { dom.rulesModal.hidden = false; });
  dom.closeRulesBtn.addEventListener('click', () => { dom.rulesModal.hidden = true; });
  dom.rulesModal.addEventListener('click', ev => { if (ev.target === dom.rulesModal) dom.rulesModal.hidden = true; });

  // 战斗记录弹层：打开时刷新一次伤害统计摘要（平时由 recordDamage 实时更新）
  renderDmgSummary();
  dom.logBtn.addEventListener('click', () => { renderDmgSummary(); dom.logModal.hidden = false; });
  dom.logResultBtn.addEventListener('click', () => { renderDmgSummary(); dom.logModal.hidden = false; });
  dom.closeLogBtn.addEventListener('click', () => { dom.logModal.hidden = true; });
  dom.logModal.addEventListener('click', ev => { if (ev.target === dom.logModal) dom.logModal.hidden = true; });

  // 商店弹层
  if (dom.shopBtn) dom.shopBtn.addEventListener('click', openShop);
  if (dom.closeShopBtn) dom.closeShopBtn.addEventListener('click', closeShop);
  if (dom.shopModal) dom.shopModal.addEventListener('click', ev => { if (ev.target === dom.shopModal) closeShop(); });
  if (dom.shopDrawBtn) dom.shopDrawBtn.addEventListener('click', drawMarble);

  // 昵称弹层：首次进入强制输入，之后可从顶栏修改
  if (dom.nickBtn) dom.nickBtn.addEventListener('click', () => openNameModal(true));
  if (dom.nameConfirmBtn) dom.nameConfirmBtn.addEventListener('click', confirmName);
  if (dom.nameCancelBtn) dom.nameCancelBtn.addEventListener('click', closeNameModal);
  if (dom.closeNameBtn) dom.closeNameBtn.addEventListener('click', closeNameModal);
  if (dom.nameModal) dom.nameModal.addEventListener('click', ev => { if (ev.target === dom.nameModal) closeNameModal(); });
  if (dom.nameInput) dom.nameInput.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); confirmName(); }
    else if (ev.key === 'Escape') { ev.stopPropagation(); closeNameModal(); }
  });

  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') {
      if (dom.nameModal && !dom.nameModal.hidden) { closeNameModal(); return; }
      dom.rulesModal.hidden = true; dom.logModal.hidden = true;
      closeShop();
      return;
    }
    // 昵称弹窗打开时屏蔽所有对局快捷键，避免在输入框里打字误选技能 / 误发射
    if (dom.nameModal && !dom.nameModal.hidden) return;
    if (G.phase === 'aim' && (ev.key === ' ' || ev.key === 'Enter')) {
      ev.preventDefault();
      launchRound();
      return;
    }
    if (G.phase === 'draft' && ['1', '2', '3'].indexOf(ev.key) >= 0) {
      chooseSkill(Number(ev.key) - 1);
    }
  });

  window.addEventListener('resize', resizeCanvas);

  /* ---------------------------------------------------------
     20.5 配置状态展示与热更新提示
     --------------------------------------------------------- */
  function renderConfigStatus() {
    const rules = $('rulesList');
    if (rules) {
      const lines = [
        '选择一个职业，对手职业随机。双方各有一颗弹珠。',
        '<strong>战前准备</strong>：从随机出现的 ' + (CONFIG.DRAFT_OPTIONS + EFFECTS.extraDraft) + ' 个技能中选 1 个，对手也会随机获得 1 个。',
        '<strong>回合对撞</strong>：每回合开战前，在地图里拖动你弹珠上的箭头自由设定发射方向，点「发射弹珠」后弹珠以该方向出击；全程依靠墙壁与彼此反弹推进（力量不衰减），每次碰撞还会获得一段加速反弹；撞击按相对速度造成伤害。每回合 ' + CONFIG.ROUND_SECONDS + ' 秒，血量先归零者立即输掉该回合。',
        '<strong>回合判定</strong>：时间到时比较剩余血量百分比，高者赢下该回合；差距小于 ' + (CONFIG.DRAW_WINDOW * 100).toFixed(1) + '% 记为平局。',
        '<strong>休整</strong>：每回合结束后血量重置，再次随机选技能。已获得的技能会累积生效。',
        '<strong>胜负</strong>：' + CONFIG.TOTAL_ROUNDS + ' 回合后按赢下的回合数判定；数目相同则比较总剩余血量百分比。'
      ];
      if (SHOP.enabled) {
        lines.push('<strong>商店</strong>：每局结束后按胜负获得' + SHOP.currency + '，在首页「商店」里抽取弹珠；重复弹珠会返还部分' + SHOP.currency + '。');
      }
      rules.innerHTML = lines.map(t => '<li>' + t + '</li>').join('');
    }
  }
  window.addEventListener('storage', ev => {
    if (ev.key === window.WOWPINBALL_CONFIG_KEY) {
      const n = $('reloadNotice'); if (n) n.hidden = false;
    }
  });
  const reloadBtnEl = $('reloadBtn');
  if (reloadBtnEl) reloadBtnEl.addEventListener('click', () => window.location.reload());
  const dismissBtnEl = $('dismissReloadBtn');
  if (dismissBtnEl) dismissBtnEl.addEventListener('click', () => {
    const n = $('reloadNotice'); if (n) n.hidden = true;
  });

  /* ---------------------------------------------------------
     20.4 初始方向选择（在对局地图里、弹球上用鼠标拖动选择方向）
     --------------------------------------------------------- */
  // 瞄准阶段：选完技能后，弹球停在出生点，玩家在地图上拖动箭头设定发射方向
  function startAimPhase() {
    if (!G.player || !G.enemy) return;
    resetForRound();                 // 复位血量 / 出生位 / 速度
    G.player.vx = 0; G.player.vy = 0;
    G.enemy.vx = 0; G.enemy.vy = 0;  // 瞄准阶段弹珠静止
    G.aimPos = { p: { x: G.player.x, y: G.player.y }, e: { x: G.enemy.x, y: G.enemy.y } };
    G.phase = 'aim';
    // 联机（房主）：把双方出生位发给客机，客机进入同样的瞄准阶段
    if (P2P.active && P2P.role === 'host') {
      P2P.myLaunched = false; P2P.guestLaunched = false;
      p2pSend({ k: 'aim', r: G.round + 1, p: { p: { x: G.player.x, y: G.player.y }, e: { x: G.enemy.x, y: G.enemy.y } } });
    }
    const upcoming = G.round + 1;
    dom.phaseLabel.textContent = '瞄准 · 第 ' + upcoming + ' 回合';
    dom.timerText.textContent = CONFIG.ROUND_SECONDS.toFixed(1);
    showBanner('选择发射方向', '拖动弹球上的箭头，点击发射开始第 ' + upcoming + ' 回合', 0);
    if (dom.aimOverlay) dom.aimOverlay.hidden = false;
    if (dom.launchBtn) dom.launchBtn.hidden = false;
    updateScoreboard();
  }

  function launchRound() {
    if (G.phase !== 'aim') return;
    if (G.myPicks[G.round]) G.myPicks[G.round].aim = G.playerAim;   // 录制：这一回合我的发射角
    if (dom.aimOverlay) dom.aimOverlay.hidden = true;
    if (dom.launchBtn) dom.launchBtn.hidden = true;
    if (dom.banner) dom.banner.hidden = true;

    if (P2P.active) {
      if (P2P.role === 'guest') {
        // 客机：把瞄准角报给房主，等房主的 round_start 开打
        p2pSend({ k: 'launch', r: G.round + 1, aim: G.playerAim });
        G.phase = 'wait-launch';
        showBanner('已发射', '等待对方完成瞄准…', 0);
        return;
      }
      // 房主：上报自己的发射，双方都就位才开回合
      P2P.myLaunched = true;
      p2pSend({ k: 'launch', r: G.round + 1, aim: G.playerAim });
      if (!P2P.guestLaunched) {
        G.phase = 'wait-launch';
        showBanner('已发射', '等待对手完成瞄准…', 0);
        return;
      }
    }
    beginRound();
  }

  // 把指针坐标换算到竞技场世界坐标，并取相对玩家弹珠的角度
  function aimFromPointer(ev) {
    if (G.phase !== 'aim' || !G.player) return;
    const cv = dom.canvas;
    const rect = cv.getBoundingClientRect();
    const px = (ev.clientX - rect.left) * (cv.width / rect.width);
    const py = (ev.clientY - rect.top) * (cv.height / rect.height);
    const wx = (px - viewOffsetX) / viewScale;
    const wy = (py - viewOffsetY) / viewScale;
    G.playerAim = Math.atan2(wy - G.player.y, wx - G.player.x);
  }

  function setupArenaAim() {
    const cv = dom.canvas;
    if (!cv || cv.dataset.aimBound) return;
    cv.dataset.aimBound = '1';
    cv.style.touchAction = 'none';
    let dragging = false;
    cv.addEventListener('pointerdown', ev => {
      if (G.phase !== 'aim') return;
      dragging = true;
      try { cv.setPointerCapture(ev.pointerId); } catch (e) {}
      ensureAudio();
      aimFromPointer(ev);
    });
    cv.addEventListener('pointermove', ev => { if (dragging) aimFromPointer(ev); });
    cv.addEventListener('pointerup', () => { dragging = false; });
    cv.addEventListener('pointercancel', () => { dragging = false; });
  }

  // 在玩家弹球上绘制可拖动的发射方向箭头 + 呼吸光环
  /* 瞄准箭头：外观由界面编辑器「瞄准箭头（画布）」图层决定。
     绘制实现放在 ui-layout.js（后台预览与游戏共用同一份），这里只负责取位置与角度。 */
  function drawAimArrow() {
    const f = G.player;
    if (!f) return;
    const UI2 = window.WowPinballUI;
    if (!UI2 || !UI2.drawAim) return;
    UI2.drawAim(ctx, f.x, f.y, G.playerAim, UI2.canvasPatch('battle', 'aimArrow'), f.r);
  }

  /* ---------------------------------------------------------
     20.5 文案注入：把后台「文案编辑」里配置的内容写入对应 DOM
     --------------------------------------------------------- */
  function applyTexts() {
    const list = (DATA.texts && Array.isArray(DATA.texts)) ? DATA.texts : [];
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (!t || !t.selector) continue;
      const el = document.querySelector(t.selector);
      if (!el) continue;
      const v = t.value == null ? '' : String(t.value);
      if (t.mode === 'html') el.innerHTML = v; else el.textContent = v;
    }
  }

  /* 右下角私有版本号：只读配置里的 version 密钥串展示，无任何逻辑参与 */
  function applyVersionTag() {
    const el = document.getElementById('verTag');
    if (!el) return;
    const v = DATA.version ? String(DATA.version) : '';
    el.textContent = v;
    el.hidden = !v;
  }

  /* ---------------------------------------------------------
     21. 启动
     --------------------------------------------------------- */
  applyTexts();
  applyVersionTag();
  loadProfile();
  updateNickButton();
  syncSideNames();
  if (PREVIEW) {
    document.body.classList.add('preview-mode');
    const mm = previewMatchup();
    buildPreviewBar();
    renderConfigStatus();
    resizeCanvas();
    startPreviewMatch(mm[0].id, mm[1].id);
    requestAnimationFrame(loop);
  } else {
    loadWallet();
    renderClassGrid();
    p2pRoomBuildClasses();   // 房间页职业网格预建好，后台界面编辑器也能选到「首个职业按钮」
    renderConfigStatus();
    renderShop();
    resizeCanvas();
    setupArenaAim();
    switchScreen('start');
    requestAnimationFrame(loop);
    // 第一次打开游戏必须手动输入昵称，写进之后的每一份分享码
    if (!PROFILE.name && !UI_EDITOR) openNameModal(false);
  }
})();
