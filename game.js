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

  const SKILLS = DATA.skills.filter(s => s.enabled !== false).map(s => {
    const mods = s.mods || {};
    return {
      id: s.id, name: s.name, cls: s.cls || null, tier: s.tier, mods: mods,
      desc: Object.keys(mods).filter(k => MOD_LABEL[k]).map(k => MOD_LABEL[k](mods[k])).join(' / '),
      origin: s.cls ? ((CLASSES.find(c => c.id === s.cls) || { name: s.cls }).name + '专属') : '通用'
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
        (s.cls ? CONFIG.CLASS_SKILL_WEIGHT : 1) *
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
      (!s.cls || s.cls === cls.id) &&
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
    ghost: null,             // 异步对战中正在挑战的幽灵
    lastGhost: null,         // 上一局挑战的幽灵（再战沿用）
    myPicks: [],             // 本局我每回合的选择：{ skill, aim }，用于录制幽灵
    speedIdx: 0,
    sound: true,
    clock: 0,
    lastImpact: -10,
    trauma: 0,
    hitStopUntil: 0,
    flash: 0,
    particles: [],
    floaters: [],
    logLines: []
  };

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
    if (G.ghost) return G.ghost.nick || G.ghost.name || '幽灵对手';
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
     5.5 异步对战 · 幽灵（离线 PvP）
     一局结束后把「职业 + 每回合技能 + 每回合发射角」录成幽灵；
     挑战时对手按幽灵的决策出手，全程不需要联网。
     约定：幽灵里的 aim 记录「站在左侧时」的角度，作为右侧对手复用时镜像为 π - aim。
     --------------------------------------------------------- */
  const GHOST_KEY = 'wowpinball.ghosts.v1';
  const GHOST_MAX = 12;
  const GHOST_VER = 1;

  let GHOSTS = [];
  let RESULT_GHOST = null;   // 刚结束这一局录下的幽灵，结算页用它生成分享码

  function ghostNow() { return Date.now(); }
  function ghostId() {
    return 'gh_' + ghostNow().toString(36) + Math.random().toString(36).slice(2, 5);
  }
  function saveGhosts() {
    try { window.localStorage.setItem(GHOST_KEY, JSON.stringify(GHOSTS)); } catch (e) { /* 存储不可用时仅本局生效 */ }
  }
  function validGhost(g) {
    return !!g && typeof g === 'object' && typeof g.cls === 'string' &&
      Array.isArray(g.rounds) && g.rounds.length > 0;
  }
  // 统一清洗外部数据（本地存档 / 分享码），避免脏数据进战斗
  function normalizeGhost(g) {
    if (!validGhost(g)) return null;
    const rounds = g.rounds.slice(0, CONFIG.TOTAL_ROUNDS).map(r => ({
      skill: r && typeof r.skill === 'string' ? r.skill : null,
      aim: r && isFinite(r.aim) ? Number(r.aim) : 0
    }));
    while (rounds.length < CONFIG.TOTAL_ROUNDS) rounds.push({ skill: null, aim: 0 });
    return {
      v: GHOST_VER,
      id: typeof g.id === 'string' && g.id ? g.id : ghostId(),
      name: typeof g.name === 'string' && g.name ? g.name.slice(0, 16) : '匿名幽灵',
      nick: typeof g.nick === 'string' ? cleanNick(g.nick) : '',
      cls: g.cls,
      rounds: rounds,
      score: {
        player: (g.score && g.score.player) || 0,
        enemy: (g.score && g.score.enemy) || 0,
        draw: (g.score && g.score.draw) || 0
      },
      wins: Math.max(0, Math.round(g.wins || 0)),
      losses: Math.max(0, Math.round(g.losses || 0)),
      ts: g.ts || ghostNow(),
      src: g.src === 'preset' || g.src === 'import' ? g.src : 'self'
    };
  }
  // 同一份挑战的指纹：职业 + 每回合技能 + 每回合发射角。
  // 分享码是同一份内容逐字节复制，导入时据此判断「库里是不是已经有了」。
  function ghostSig(g) {
    const rounds = (g && Array.isArray(g.rounds)) ? g.rounds : [];
    return (g && g.cls ? g.cls : '?') + '|' + rounds.map(r =>
      (r && r.skill ? r.skill : '-') + '@' +
      (r && isFinite(r.aim) ? Number(r.aim).toFixed(3) : '0.000')).join(',');
  }
  function ghostBySig(sig) {
    for (let i = 0; i < GHOSTS.length; i++) {
      if (ghostSig(GHOSTS[i]) === sig) return GHOSTS[i];
    }
    return null;
  }
  // 空库时的陪练幽灵：按现有职业生成 3 个，玩家进来就能开一局
  function makePresetGhosts() {
    const out = [];
    if (!CLASSES.length) return out;
    for (let i = 0; i < Math.min(3, CLASSES.length); i++) {
      const cls = CLASSES[(i * 3 + 1) % CLASSES.length];
      const rounds = [];
      for (let r = 0; r < CONFIG.TOTAL_ROUNDS; r++) {
        const pick = drawSkills(cls, [], 1)[0];
        rounds.push({ skill: pick ? pick.id : null, aim: rand(-0.5, 0.5) });
      }
      out.push(normalizeGhost({
        v: GHOST_VER, id: 'gh_pre_' + cls.id, name: cls.name + '·老兵', cls: cls.id,
        rounds: rounds, score: { player: 2, enemy: 1, draw: 0 },
        ts: ghostNow() - (i + 1) * 86400000, src: 'preset'
      }));
    }
    return out;
  }
  function loadGhosts() {
    let list = null;
    try { list = JSON.parse(window.localStorage.getItem(GHOST_KEY)); } catch (e) { list = null; }
    const out = [], idxBySig = Object.create(null), seenId = Object.create(null);
    let changed = false;
    (Array.isArray(list) ? list : []).forEach(raw => {
      const g = normalizeGhost(raw);
      if (!g) { changed = true; return; }
      const sig = ghostSig(g);
      const prev = idxBySig[sig];
      if (prev !== undefined) {
        // 同一个挑战被重复导入过：只留一份，且「原件」优先于「导入的副本」
        changed = true;
        if (out[prev].src === 'import' && g.src !== 'import') out[prev] = g;
        return;
      }
      if (seenId[g.id]) { g.id = ghostId(); changed = true; }   // id 撞车会让「删一个」连带删掉另一个
      seenId[g.id] = 1;
      idxBySig[sig] = out.length;
      out.push(g);
    });
    GHOSTS = out.slice(0, GHOST_MAX);
    if (out.length > GHOST_MAX) changed = true;
    if (!GHOSTS.length) {
      GHOSTS = makePresetGhosts();
      saveGhosts();
    } else if (changed) {
      saveGhosts();   // 迁移结果写回，避免每次打开都重算
    }
    return GHOSTS;
  }
  function ghostRound(i) {
    if (!G.ghost || !G.ghost.rounds.length) return null;
    return G.ghost.rounds[clamp(i, 0, G.ghost.rounds.length - 1)];
  }
  function ghostSkill(id) {
    return id ? (SKILLS.find(s => s.id === id) || null) : null;
  }
  // 把这一局「我的选择」录成幽灵，供下一局或分享给别人挑战
  function recordGhost() {
    if (!G.playerClass || !G.myPicks.length) return null;
    const rounds = [];
    for (let i = 0; i < CONFIG.TOTAL_ROUNDS; i++) {
      const p = G.myPicks[i] || {};
      rounds.push({ skill: p.skill || null, aim: typeof p.aim === 'number' ? p.aim : 0 });
    }
    const g = normalizeGhost({
      v: GHOST_VER, id: ghostId(),
      name: nickName() + '·幽灵', nick: PROFILE.name,
      cls: G.playerClass.id, rounds: rounds,
      score: { player: G.scores.player, enemy: G.scores.enemy, draw: G.scores.draw },
      ts: ghostNow(), src: 'self'
    });
    // 同一构筑只保留最新一份，避免列表被同名幽灵刷满
    const sig = go => go.cls + '|' + go.rounds.map(r => r.skill || '-').join(',');
    const mySig = sig(g);
    GHOSTS = GHOSTS.filter(x => !(x.src === 'self' && sig(x) === mySig));
    GHOSTS.unshift(g);
    if (GHOSTS.length > GHOST_MAX) GHOSTS.length = GHOST_MAX;
    saveGhosts();
    return g;
  }
  function ghostToCode(g) {
    try { return window.btoa(unescape(encodeURIComponent(JSON.stringify(g)))); } catch (e) { return ''; }
  }
  function ghostFromCode(code) {
    const raw = String(code || '').trim().replace(/^WP-/i, '').replace(/\s+/g, '');
    if (!raw) return null;
    let json = '';
    try { json = decodeURIComponent(escape(window.atob(raw))); } catch (e) { return null; }
    let obj = null;
    try { obj = JSON.parse(json); } catch (e) { return null; }
    const g = normalizeGhost(obj);
    // 分享码里的 id 属于发送方本地库，导入端必须换成本地新 id；
    // 否则复制出来的两份共用一个 id，删一个会把另一个一起删掉。
    if (g) g.id = ghostId();
    return g;
  }

  /* ---------------------------------------------------------
     6. DOM
     --------------------------------------------------------- */
  const dom = {
    startScreen: $('startScreen'), battleScreen: $('battleScreen'), resultScreen: $('resultScreen'),
    classGrid: $('classGrid'), selectedClassName: $('selectedClassName'), selectedClassTrait: $('selectedClassTrait'),
    startBtn: $('startBtn'), speedBtn: $('speedBtn'), soundBtn: $('soundBtn'),
    rulesBtn: $('rulesBtn'), rulesModal: $('rulesModal'), closeRulesBtn: $('closeRulesBtn'),
    pClassName: $('pClassName'), eClassName: $('eClassName'),
    pNick: $('pNick'), eNick: $('eNick'),
    pHpBar: $('pHpBar'), eHpBar: $('eHpBar'), pShieldBar: $('pShieldBar'), eShieldBar: $('eShieldBar'),
    pHpText: $('pHpText'), eHpText: $('eHpText'), pScore: $('pScore'), eScore: $('eScore'),
    pSkills: $('pSkills'), eSkills: $('eSkills'), pPanel: document.querySelector('.player-panel'), ePanel: document.querySelector('.enemy-panel'),
    roundLabel: $('roundLabel'), roundPips: $('roundPips'), phaseLabel: $('phaseLabel'),
    canvas: $('arena'), arenaWrap: $('arenaWrap'), timerText: $('timerText'),
    banner: $('banner'), bannerTitle: $('bannerTitle'), bannerSub: $('bannerSub'),
    draftModal: $('draftModal'), draftTitle: $('draftTitle'), draftSub: $('draftSub'), draftCards: $('draftCards'),
    battleLog: $('battleLog'), logModal: $('logModal'), logBtn: $('logBtn'), closeLogBtn: $('closeLogBtn'),
    shopBtn: $('shopBtn'), shopModal: $('shopModal'), closeShopBtn: $('closeShopBtn'), shopDrawBtn: $('shopDrawBtn'),
    shopPool: $('shopPool'), shopCoin: $('shopCoin'), shopCostLabel: $('shopCostLabel'), shopHint: $('shopHint'),
    shopResult: $('shopResult'), coinChip: $('coinChip'),
    ghostBtn: $('ghostBtn'), ghostModal: $('ghostModal'), closeGhostBtn: $('closeGhostBtn'),
    ghostList: $('ghostList'), ghostCode: $('ghostCode'), ghostImportBtn: $('ghostImportBtn'), ghostMsg: $('ghostMsg'),
    asyncTag: $('asyncTag'),
    launchBtn: $('launchBtn'), aimOverlay: $('aimOverlay'),
    resultKicker: $('resultKicker'), resultTitle: $('resultTitle'), resultDesc: $('resultDesc'),
    roundReview: $('roundReview'), buildReview: $('buildReview'),
    shareResultBtn: $('shareResultBtn'), shareModal: $('shareModal'), closeShareBtn: $('closeShareBtn'),
    shareMeta: $('shareMeta'), sharePlays: $('sharePlays'), shareCode: $('shareCode'),
    shareCopyBtn: $('shareCopyBtn'), shareImportBtn: $('shareImportBtn'), shareMsg: $('shareMsg'),
    rematchBtn: $('rematchBtn'), changeBtn: $('changeBtn'),
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

  /* ---------------------------------------------------------
     8.6 异步对战弹层：幽灵列表 / 挑战 / 分享码
     --------------------------------------------------------- */
  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function setGhostMsg(text, kind) {
    if (!dom.ghostMsg) return;
    dom.ghostMsg.hidden = !text;
    dom.ghostMsg.className = 'ghost-msg' + (kind ? ' ' + kind : '');
    dom.ghostMsg.textContent = text || '';
  }
  function ghostDate(ts) {
    const d = new Date(ts || Date.now());
    return (d.getMonth() + 1) + '/' + d.getDate();
  }
  function renderGhostList() {
    if (!dom.ghostList) return;
    if (!GHOSTS.length) {
      dom.ghostList.innerHTML = '<div class="ghost-empty">还没有幽灵。打完一局后，系统会自动把你的这一局收录成幽灵；也可以粘贴朋友的分享码导入。</div>';
      return;
    }
    dom.ghostList.innerHTML = GHOSTS.map(g => {
      const cls = CLASSES.find(c => c.id === g.cls) || { name: g.cls, color: '#8899aa' };
      const rec = (g.wins || g.losses) ? ('守擂 ' + g.wins + ' 胜 ' + g.losses + ' 负') : '暂无战绩';
      const src = g.src === 'self' ? '我的' : (g.src === 'preset' ? '内置' : '导入');
      return '<div class="ghost-item" data-id="' + escHtml(g.id) + '" style="--gh-color:' + escHtml(cls.color) + '">' +
        '<span class="gh-orb"></span>' +
        '<div class="gh-body">' +
        '<span class="gh-name">' + escHtml(ghostDisplayName(g)) + '</span>' +
        '<span class="gh-meta">' + escHtml(cls.name) + ' · ' + escHtml(rec) + ' · ' + ghostDate(g.ts) + ' · ' + src + '</span>' +
        '</div>' +
        '<button class="ghost-btn gh-share" type="button" data-act="ghost-share" data-id="' + escHtml(g.id) + '">分享码</button>' +
        '<button class="ghost-btn gh-del" type="button" data-act="ghost-del" data-id="' + escHtml(g.id) + '">删除</button>' +
        '<button class="primary-btn gh-fight" type="button" data-act="ghost-fight" data-id="' + escHtml(g.id) + '">挑战</button>' +
        '</div>';
    }).join('');
  }
  function openGhosts() {
    if (!dom.ghostModal) return;
    loadGhosts();
    renderGhostList();
    setGhostMsg('');
    dom.ghostModal.hidden = false;
  }
  function challengeGhost(id) {
    const g = GHOSTS.find(x => x.id === id);
    if (!g) { setGhostMsg('幽灵不存在，可能已被删除', 'bad'); renderGhostList(); return; }
    if (!G.selectedClass) { setGhostMsg('请先在首页选择一个职业，再挑战幽灵', 'bad'); return; }
    if (dom.ghostModal) dom.ghostModal.hidden = true;
    startMatch(G.selectedClass, { ghost: g });
  }
  function shareGhost(id) {
    const g = GHOSTS.find(x => x.id === id);
    if (!g || !dom.ghostCode) return;
    const code = ghostToCode(g);
    if (!code) { setGhostMsg('分享码生成失败：当前环境不支持编码', 'bad'); return; }
    dom.ghostCode.value = code;
    dom.ghostCode.focus();
    dom.ghostCode.select();
    setGhostMsg('已生成「' + ghostDisplayName(g) + '」的分享码，复制后发给朋友即可', 'ok');
  }
  // 重复导入时把已有的那条闪一下，让玩家看清「就是它」
  function flashGhostRow(id) {
    if (!dom.ghostList) return;
    const row = dom.ghostList.querySelector('.ghost-item[data-id="' + id + '"]');
    if (!row) return;
    row.classList.remove('is-dup');
    void row.offsetWidth;   // 强制回流，保证连续两次也能重放动画
    row.classList.add('is-dup');
    if (row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
    window.setTimeout(() => row.classList.remove('is-dup'), 1400);
  }
  function importGhost() {
    if (!dom.ghostCode) return;
    const g = ghostFromCode(dom.ghostCode.value);
    if (!g) { setGhostMsg('分享码无法识别，请检查是否完整复制', 'bad'); return; }
    if (!CLASSES.some(c => c.id === g.cls)) { setGhostMsg('这份幽灵用的弹珠在当前版本里不存在', 'bad'); return; }
    const dup = ghostBySig(ghostSig(g));
    if (dup) {
      dom.ghostCode.value = '';
      renderGhostList();
      flashGhostRow(dup.id);
      setGhostMsg('库里已经有这份挑战了（' + ghostDisplayName(dup) + '），无需重复导入', 'warn');
      return;
    }
    g.src = 'import';
    GHOSTS.unshift(g);
    if (GHOSTS.length > GHOST_MAX) GHOSTS.length = GHOST_MAX;
    saveGhosts();
    dom.ghostCode.value = '';
    setGhostMsg('已导入「' + ghostDisplayName(g) + '」的挑战，可以开始对战了', 'ok');
    renderGhostList();
  }

  // 结算页分享：把这局录下的「职业 + 每回合技能 + 每回合方向」直接变成可复制的分享码
  function fmtAimDeg(rad) {
    const deg = Math.round((Number(rad) || 0) * 180 / Math.PI);
    return (deg > 0 ? '+' : '') + deg + '°';
  }
  function setShareMsg(text, kind) {
    if (!dom.shareMsg) return;
    dom.shareMsg.hidden = !text;
    dom.shareMsg.className = 'ghost-msg' + (kind ? ' ' + kind : '');
    dom.shareMsg.textContent = text || '';
  }
  function openShare() {
    if (!dom.shareModal) return;
    const g = RESULT_GHOST;
    if (!g) return;
    const code = ghostToCode(g);
    if (dom.shareCode) dom.shareCode.value = code;
    if (dom.shareMeta) {
      const cls = CLASSES.find(c => c.id === g.cls);
      const sc = g.score || {};
      dom.shareMeta.innerHTML =
        '<span class="sm-cls" style="color:' + escHtml(cls ? cls.color : '#8899aa') + '">' + escHtml(g.nick || nickName()) + ' · ' + escHtml(cls ? cls.name : g.cls) + '</span>' +
        '<span class="sm-sep">·</span><span>回合比分 ' + (sc.player || 0) + ' : ' + (sc.enemy || 0) + '</span>' +
        '<span class="sm-sep">·</span><span>' + g.rounds.length + ' 回合决策</span>';
    }
    if (dom.sharePlays) {
      dom.sharePlays.innerHTML = g.rounds.map((r, i) => {
        const sk = SKILLS.find(s => s.id === r.skill);
        return '<div class="share-play">' +
          '<span class="sp-no">第 ' + (i + 1) + ' 回合</span>' +
          '<span class="sp-skill" title="' + escHtml(sk ? sk.desc : '') + '">' + escHtml(sk ? sk.name : '未记录') + '</span>' +
          '<span class="sp-aim">方向 ' + fmtAimDeg(r.aim) + '</span>' +
          '</div>';
      }).join('');
    }
    setShareMsg(code ? '' : '当前环境不支持生成分享码', code ? '' : 'bad');
    dom.shareModal.hidden = false;
    if (dom.shareCode && code) { dom.shareCode.focus(); dom.shareCode.select(); }
  }
  function closeShare() { if (dom.shareModal) dom.shareModal.hidden = true; }
  function copyShareCode() {
    const code = dom.shareCode ? dom.shareCode.value : '';
    if (!code) { setShareMsg('还没有分享码，先打完一局再来', 'bad'); return; }
    const done = () => setShareMsg('已复制到剪贴板，发给好友就能开一局异步对战', 'ok');
    const manual = () => {
      try { dom.shareCode.focus(); dom.shareCode.select(); } catch (e) {}
      setShareMsg('已全选分享码，按 Ctrl+C（Mac 为 ⌘+C）复制', 'warn');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(done, manual);
      return;
    }
    try {
      dom.shareCode.focus(); dom.shareCode.select();
      if (document.execCommand && document.execCommand('copy')) { done(); return; }
    } catch (e) {}
    manual();
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
  // 幽灵的展示名：优先用分享码里带来的玩家昵称，旧码回落到幽灵名
  function ghostDisplayName(g) {
    if (!g) return '幽灵对手';
    return g.nick || g.name || '幽灵对手';
  }
  // 把昵称同步到 HUD 两侧（改名 / 开新局 / 异步挑战都会调）
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
      dotDps: 0, dotUntil: -1,
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

  // 异步对战：幽灵的上场朝向直接取录像；录像存的是「站在左侧」的角度，换到右侧要镜像
  function enemyLaunchAim() {
    const gr = ghostRound(G.round - 1);
    if (gr && typeof gr.aim === 'number') return Math.PI - gr.aim;
    return enemyAimAngle();
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
      // 初始发射：玩家用选定方向，敌方用指向玩家的朝向（异步对战时取幽灵录像）
      const aim = i === 0 ? G.playerAim : enemyLaunchAim();
      f.vx = Math.cos(aim) * CONFIG.LAUNCH_SPEED * f.speed;
      f.vy = Math.sin(aim) * CONFIG.LAUNCH_SPEED * f.speed;
      f.combo = 0;
      f.firstHitUsed = false;
      f.slowUntil = -1; f.slowFactor = 1;
      f.dotDps = 0; f.dotUntil = -1;
      f.squash = 0;
      f.trail = [];
      f.lastDmgAt = -10;
    });
    G.lastImpact = -10;
    G.particles = [];
    G.floaters = [];
    G.clock = 0;
  }

  /* ---------------------------------------------------------
     10. 技能选择（每颗弹珠各自获得技能）
     --------------------------------------------------------- */
  function openDraft(title, sub) {
    G.phase = 'draft';
    const draftCount = CONFIG.DRAFT_OPTIONS + EFFECTS.extraDraft;
    G.draftOptions = drawSkills(G.playerClass, G.playerSkills, draftCount);
    const enemyOptions = drawSkills(G.enemyClass, G.enemySkills, draftCount);
    // 异步对战：对手按幽灵录像选技能；失效（已拥有 / 已被删）时退回随机
    let forced = null;
    const gr = ghostRound(G.round);
    if (gr && gr.skill) {
      const cand = ghostSkill(gr.skill);
      if (cand && G.enemySkills.every(s => s.id !== cand.id)) forced = cand;
    }
    G.enemyDraftPick = forced || enemyOptions[randInt(enemyOptions.length)];

    dom.draftTitle.textContent = title;
    dom.draftSub.textContent = sub;
    dom.draftModal.hidden = false;
    dom.draftCards.innerHTML = G.draftOptions.map((s, i) =>
      '<button class="skill-card" type="button" data-i="' + i + '" data-tier="' + s.tier + '">' +
      '<div class="sc-top"><span class="sc-name">' + s.name + '</span><span class="sc-tier">' + TIER_NAME[s.tier] + '</span></div>' +
      '<div class="sc-origin">' + s.origin + '</div>' +
      '<div class="sc-effect">' + s.desc + '</div>' +
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
    if (G.enemyDraftPick) G.enemySkills.push(G.enemyDraftPick);
    recompute(G.player);
    recompute(G.enemy);
    sfx.pick();
    addLog('我方获得「' + s.name + '」，对手获得「' + (G.enemyDraftPick ? G.enemyDraftPick.name : '—') + '」', 'good');
    G.draftOptions = [];
    G.enemyDraftPick = null;
    dom.draftModal.hidden = true;
    dom.draftCards.innerHTML = '';
    setTimeout(startAimPhase, 260);
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
    dom.phaseLabel.textContent = '对撞中';
    showBanner('第 ' + G.round + ' 回合', G.playerClass.name + '  对阵  ' + G.enemyClass.name, 900);
    addLog('第 ' + G.round + ' 回合开始，双方血量重置', 'hl');
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
    addLog('第 ' + G.round + ' 回合结束 · ' + label + '（我方 ' + Math.round(pp * 100) + '% / 对手 ' + Math.round(ep * 100) + '%）',
      winner === 'player' ? 'good' : (winner === 'enemy' ? 'bad' : 'hl'));
    showBanner(label, reason === 'ko' ? '一方弹珠被击碎' : '按剩余生命百分比判定', 1350);
    sfx.round();
    updateScoreboard();
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
  function applyDamage(target, dmg, src, crit, isThorns) {
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
    addFloater(target.x, target.y - target.r - 6, '-' + Math.round(dmg),
      crit ? '#ffd76a' : (isThorns ? '#b9a0f0' : '#ff9a92'), crit ? 20 : 15);
    updateHud();
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
    mult /= 1 + Math.min(def.mods.armor, 0.65);

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
    if (!MAP || !MAP.obstacles || !MAP.obstacles.length) return;
    MAP.obstacles.forEach(ob => {
      const bounce = ob.bounce == null ? 0.9 : ob.bounce;
      if (ob.type === 'circle') {
        let dx = f.x - ob.x, dy = f.y - ob.y;
        let d = Math.hypot(dx, dy);
        const min = f.r + (ob.r || 0);
        if (d < min) {
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
  }

  function step(dt) {
    G.clock += dt;
    const p = G.player, e = G.enemy;
    const list = [p, e];

    list.forEach((f, i) => {
      // 无追踪加速度、无速度衰减：全程只靠初始发射方向与反弹推进
      const slowActive = G.clock < f.slowUntil ? f.slowFactor : 1;

      const sp = Math.hypot(f.vx, f.vy);
      const cap = CONFIG.MAX_SPEED * f.speed * slowActive;
      if (sp > cap) { f.vx = f.vx / sp * cap; f.vy = f.vy / sp * cap; }

      f.x += f.vx * dt;
      f.y += f.vy * dt;

      // 边界反弹
      if (f.x - f.r < 0) { f.x = f.r; f.vx = Math.abs(f.vx) * CONFIG.WALL_RESTITUTION; }
      if (f.x + f.r > CONFIG.ARENA_W) { f.x = CONFIG.ARENA_W - f.r; f.vx = -Math.abs(f.vx) * CONFIG.WALL_RESTITUTION; }
      if (f.y - f.r < 0) { f.y = f.r; f.vy = Math.abs(f.vy) * CONFIG.WALL_RESTITUTION; }
      if (f.y + f.r > CONFIG.ARENA_H) { f.y = CONFIG.ARENA_H - f.r; f.vy = -Math.abs(f.vy) * CONFIG.WALL_RESTITUTION; }

      resolveObstacles(f);

      // 持续回复
      if (f.mods.regen > 0 && f.hp > 0) f.hp = Math.min(f.maxHp, f.hp + f.maxHp * f.mods.regen * dt);
      // 持续伤害
      if (G.clock < f.dotUntil && f.dotDps > 0 && f.hp > 0) {
        let dot = f.dotDps * dt;
        if (f.shield > 0) {
          const a = Math.min(f.shield, dot);
          f.shield -= a; dot -= a;
        }
        f.hp = Math.max(0, f.hp - dot);
        if (Math.random() < dt * 8) spawnSparks(f.x + rand(-f.r, f.r), f.y + rand(-f.r, f.r), 0, -1, 1, '#a06ce0', '#a06ce0');
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
        const j = (1 + CONFIG.RESTITUTION) * vn / (1 / p.mass + 1 / e.mass);
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
        }
      }
    }
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

    // 背景（主题来自当前地图配置）
    const theme = (MAP && MAP.theme) || { bgTop: '#0d1420', bgBottom: '#080c14', grid: '#182233', border: '#26344a', accent: '#2b3a52' };
    const bg = ctx.createLinearGradient(0, 0, 0, AH);
    bg.addColorStop(0, theme.bgTop);
    bg.addColorStop(1, theme.bgBottom);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, AW, AH);

    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 1;
    for (let x = 0; x <= AW; x += 45) { ctx.beginPath(); ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, AH); ctx.stroke(); }
    for (let y = 0; y <= AH; y += 45) { ctx.beginPath(); ctx.moveTo(0, y + .5); ctx.lineTo(AW, y + .5); ctx.stroke(); }

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

    // 震屏只作用于视觉变换，不影响物理坐标
    const shake = G.trauma * G.trauma;
    const t = performance.now() / 1000;
    ctx.save();
    ctx.translate(shake * 11 * Math.sin(t * 37), shake * 8 * Math.sin(t * 29));

    [G.player, G.enemy].forEach(drawFighter);
    if (G.phase === 'aim' && G.player) drawAimArrow();
    drawParticles();
    drawFloaters();
    ctx.restore();

    if (G.flash > 0) {
      ctx.fillStyle = 'rgba(255,255,255,' + (G.flash * 0.35).toFixed(3) + ')';
      ctx.fillRect(0, 0, AW, AH);
    }
  }

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
  }

  function updateMeta() {
    if (!G.player || !G.enemy) return;
    dom.pSkills.innerHTML = renderMiniSkills(G.playerSkills);
    dom.eSkills.innerHTML = renderMiniSkills(G.enemySkills);
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
      return s
        ? '<span class="mini-skill" data-tier="' + s.tier + '" title="' + s.desc + '">' + s.name + '</span>'
        : '<span class="mini-skill empty">技能位 ' + (i + 1) + '</span>';
    });
    return slots.join('');
  }

  function addLog(text, kind) {
    G.logLines.unshift({ text: text, kind: kind || '' });
    if (G.logLines.length > 40) G.logLines.pop();
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

    // 异步对战：结算挑战结果并更新幽灵守擂战绩
    if (G.ghost) {
      const g = GHOSTS.find(x => x.id === G.ghost.id);
      if (g) {
        if (cls === 'win') g.losses += 1;
        else if (cls === 'lose') g.wins += 1;
        saveGhosts();
      }
      dom.resultDesc.textContent = '异步挑战「' + ghostDisplayName(G.ghost) + '」 · ' + dom.resultDesc.textContent;
    }
    // 无论普通还是异步对局，结束后都把「我的这一局」收录成幽灵
    RESULT_GHOST = recordGhost();
    if (RESULT_GHOST) dom.resultDesc.textContent += '  ·  已收录你的幽灵，可生成分享码发给好友';
    if (dom.shareResultBtn) {
      dom.shareResultBtn.disabled = !RESULT_GHOST;
      dom.shareResultBtn.title = RESULT_GHOST ? '把这局的技能与发射方向生成分享码' : '本局没有可分享的决策记录';
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
      skills.map(s => '<span class="mini-skill" data-tier="' + s.tier + '" title="' + s.desc + '">' + s.name + '</span>').join('') +
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
    if (name !== 'battle') dom.logModal.hidden = true;
  }

  function startMatch(cls, opts) {
    opts = opts || {};
    ensureAudio();
    RESULT_GHOST = null;   // 新对局开始，上一局的分享码作废
    closeShare();
    G.playerClass = cls;
    G.ghost = opts.ghost || null;
    G.lastGhost = G.ghost;
    const ghostCls = G.ghost ? (CLASSES.find(c => c.id === G.ghost.cls) || null) : null;
    G.enemyClass = ghostCls || CLASSES[randInt(CLASSES.length)];
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
    dom.battleLog.innerHTML = '';

    syncMatchNames(cls.name, G.enemyClass.name, cls.color, G.enemyClass.color);

    switchScreen('battle');
    resizeCanvas();   // 必须在面板可见后取尺寸，否则 clientWidth 为 0
    if (dom.asyncTag) {
      dom.asyncTag.hidden = !G.ghost;
      dom.asyncTag.textContent = G.ghost ? ('异步对战 · ' + ghostDisplayName(G.ghost)) : '';
    }
    addLog('对战开始：' + nickName() + '（' + cls.name + '） 对阵 ' + enemyNick() + '（' + G.enemyClass.name + '）', 'hl');
    if (G.ghost) addLog('对手是「' + ghostDisplayName(G.ghost) + '」的幽灵，会按它录下的技能与发射方向出手', 'hl');
    openDraft('战前准备 · 随机三选一', G.ghost ? '异步对战 · 对手由幽灵接管' : '选择一个技能，本局全程生效');
  }

  /* ---------------------------------------------------------
     18.5 预览模式（后台「实时编排」工作台内嵌引擎）
     --------------------------------------------------------- */
  function emitPreview(type, payload) {
    if (!PREVIEW) return;
    try { window.parent.postMessage(Object.assign({ kind: 'pb', type: type }, payload), '*'); } catch (e) { /* 跨域或父窗口缺失时忽略 */ }
  }

  function randSkillOf(cls) {
    const pool = SKILLS.filter(s => (!s.cls || s.cls === cls.id) && s.enabled !== false);
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

    if (G.screen === 'battle' && G.phase === 'fighting' && ts >= G.hitStopUntil) {
      const dt = realDt * SPEEDS[G.speedIdx];
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
  dom.startBtn.addEventListener('click', () => { if (G.selectedClass) startMatch(G.selectedClass); });
  if (dom.launchBtn) dom.launchBtn.addEventListener('click', () => launchRound());
  dom.rematchBtn.addEventListener('click', () => { ensureAudio(); startMatch(G.playerClass, G.lastGhost ? { ghost: G.lastGhost } : null); });
  dom.changeBtn.addEventListener('click', () => { switchScreen('start'); });

  dom.speedBtn.addEventListener('click', () => {
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

  // 战斗记录弹层
  dom.logBtn.addEventListener('click', () => { dom.logModal.hidden = false; });
  dom.closeLogBtn.addEventListener('click', () => { dom.logModal.hidden = true; });
  dom.logModal.addEventListener('click', ev => { if (ev.target === dom.logModal) dom.logModal.hidden = true; });

  // 商店弹层
  if (dom.shopBtn) dom.shopBtn.addEventListener('click', openShop);
  if (dom.closeShopBtn) dom.closeShopBtn.addEventListener('click', closeShop);
  if (dom.shopModal) dom.shopModal.addEventListener('click', ev => { if (ev.target === dom.shopModal) closeShop(); });
  if (dom.shopDrawBtn) dom.shopDrawBtn.addEventListener('click', drawMarble);

  // 异步对战弹层
  if (dom.ghostBtn) dom.ghostBtn.addEventListener('click', openGhosts);
  if (dom.closeGhostBtn) dom.closeGhostBtn.addEventListener('click', () => { dom.ghostModal.hidden = true; });
  if (dom.ghostModal) dom.ghostModal.addEventListener('click', ev => { if (ev.target === dom.ghostModal) dom.ghostModal.hidden = true; });
  if (dom.ghostImportBtn) dom.ghostImportBtn.addEventListener('click', importGhost);

  // 结算分享码弹层
  if (dom.shareResultBtn) dom.shareResultBtn.addEventListener('click', openShare);
  if (dom.closeShareBtn) dom.closeShareBtn.addEventListener('click', closeShare);
  if (dom.shareModal) dom.shareModal.addEventListener('click', ev => { if (ev.target === dom.shareModal) closeShare(); });
  if (dom.shareCopyBtn) dom.shareCopyBtn.addEventListener('click', copyShareCode);
  if (dom.shareImportBtn) dom.shareImportBtn.addEventListener('click', () => {
    closeShare();
    openGhosts();
    setGhostMsg('把朋友的分享码粘贴到下面，点「导入」就能挑战', 'ok');
    if (dom.ghostCode) { dom.ghostCode.focus(); dom.ghostCode.select(); }
  });
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

  if (dom.ghostList) dom.ghostList.addEventListener('click', ev => {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act, id = btn.dataset.id;
    if (act === 'ghost-fight') challengeGhost(id);
    else if (act === 'ghost-share') shareGhost(id);
    else if (act === 'ghost-del') {
      const idx = GHOSTS.findIndex(g => g.id === id);
      if (idx >= 0) GHOSTS.splice(idx, 1);   // 只删命中的这一条，不按 id 批量抹除
      saveGhosts();
      renderGhostList();
      setGhostMsg('已删除该幽灵', 'ok');
    }
  });

  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') {
      if (dom.nameModal && !dom.nameModal.hidden) { closeNameModal(); return; }
      dom.rulesModal.hidden = true; dom.logModal.hidden = true;
      if (dom.ghostModal) dom.ghostModal.hidden = true;
      closeShare();
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
        '<strong>异步对战</strong>：首页「异步对战」可挑战录像幽灵——对手按它录下的技能与发射方向出手，全程不需要联网；你每打完一局也会被自动收录成幽灵，可用分享码发给朋友。',
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
  function drawAimArrow() {
    const f = G.player;
    if (!f) return;
    const a = G.playerAim, L = 84;
    const ex = f.x + Math.cos(a) * L, ey = f.y + Math.sin(a) * L;
    ctx.save();
    ctx.setLineDash([5, 6]);
    ctx.strokeStyle = 'rgba(124,196,255,0.5)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = '#7cc4ff'; ctx.fillStyle = '#7cc4ff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(ex, ey); ctx.stroke();
    const ah = 13;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - Math.cos(a - 0.42) * ah, ey - Math.sin(a - 0.42) * ah);
    ctx.lineTo(ex - Math.cos(a + 0.42) * ah, ey - Math.sin(a + 0.42) * ah);
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(ex, ey, 8, 0, Math.PI * 2); ctx.fill();
    const t = performance.now() / 1000;
    const pr = f.r + 6 + Math.sin(t * 4) * 3;
    ctx.strokeStyle = 'rgba(124,196,255,0.55)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(f.x, f.y, pr, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  /* ---------------------------------------------------------
     21. 启动
     --------------------------------------------------------- */
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
    loadGhosts();
    renderClassGrid();
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
