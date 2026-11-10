/* =============================================================
   选技弹珠 · 默认配置（共享数据层）
   - 主游戏与后台工具都读取本文件
   - 后台保存后写入 localStorage: wowpinball.config.v1
   - 若启动 server.js，还会落盘到 data/game-config.json
   ============================================================= */
window.WOWPINBALL_DEFAULT = {
  meta: {
    schema: 1,
    gameName: '选技弹珠',
    updatedAt: '2026-11-06',
    note: 'v2 物理：无追踪加速度，开战前选定初始发射方向，全程靠反弹推进（力不衰减），碰撞时获得加速反弹'
  },

  /* 私有版本号：对外显示一串只有我们理解的密钥（tools/version-codec.js 编码），
     内部 versionSeq 是从 1 开始的构建计数，server.js 每次发布自动 +1 并重新编码。
     游戏端只读 version 字符串显示在右下角，不参与任何逻辑。 */
  version: '',
  versionSeq: 0,

  config: {
    arenaW: 900,
    arenaH: 400,
    roundSeconds: 9,
    totalRounds: 3,
    launchSpeed: 250,
    collisionBoost: 1.14,
    maxSpeed: 520,
    restitution: 1.0,
    wallRestitution: 1.0,
    impactCd: 0.22,
    minImpact: 48,
    drawWindow: 0.012,
    hitStopMs: 55,
    dmgBase: 0.022,
    dmgSpeed: 0.030,
    critBase: 0.04,
    critMultBase: 1.55,
    draftOptions: 3,
    maxSkills: 9,          // 拥有的技能最大数量：玩家至多拥有的技能数；总回合数大于该值时，超出回合不再弹出技能随机选项
    classSkillWeight: 1.35,
    speeds: [1, 2, 4]
  },

  tierWeights: { common: 1, rare: 0.62, epic: 0.28 },

  /* 对局天气：每回合进入对撞阶段（倒计时开始）时按权重随机抽取一次，含「无天气」。
     wind 大风：整回合给场内弹珠施加持续水平力（随机方向 + 正弦阵风波动），同受速度上限约束；
     rain 下雨：场地湿滑，弹珠互撞、墙壁与障碍反弹更有弹性（反弹系数乘 1+slip）；
              同时整回合给弹珠施加持续向下力（加速度，rainForce，每秒叠加到 vy），弹珠被雨往下压。
     后台「对局天气」页可调整开关、权重与全部参数。 */
  weather: {
    enabled: true,
    noneWeight: 5,
    types: [
      { id: 'wind', name: '大风', enabled: true, weight: 4,
        forceMin: 30, forceMax: 70, sway: 0.45,
        desc: '持续水平风力推动弹珠，阵风时强时弱，方向每回合随机' },
      { id: 'rain', name: '下雨', enabled: true, weight: 3,
        slip: 0.12, rainForce: 70,
        desc: '场地湿滑：互撞与墙壁、障碍反弹更有弹性，来回更快更难预判；雨幕持续向下压弹珠' }
    ]
  },

  /* 商店：抽取弹珠（职业）。starter 里的职业默认解锁，其余需要在商店抽取。
     后续在后台「职业管理」新增弹珠后，会自动进入卡池（默认未解锁），可在后台「商店」页调整稀有度/权重/是否上架。 */
  shop: {
    enabled: true,
    currency: '金币',
    initialCoins: 300,
    drawCost: 80,
    duplicateRefund: 30,
    rewards: { win: 120, draw: 80, lose: 50 },
    starter: ['warrior', 'paladin', 'hunter', 'rogue', 'priest', 'shaman', 'mage', 'warlock', 'druid'],
    pool: [
      { classId: 'warrior', rarity: 'common', weight: 12, listed: true },
      { classId: 'paladin', rarity: 'common', weight: 12, listed: true },
      { classId: 'hunter', rarity: 'common', weight: 12, listed: true },
      { classId: 'priest', rarity: 'common', weight: 12, listed: true },
      { classId: 'rogue', rarity: 'rare', weight: 6, listed: true },
      { classId: 'shaman', rarity: 'rare', weight: 6, listed: true },
      { classId: 'mage', rarity: 'rare', weight: 6, listed: true },
      { classId: 'warlock', rarity: 'rare', weight: 6, listed: true },
      { classId: 'druid', rarity: 'epic', weight: 2, listed: true }
    ]
  },

  classes: [
    { id: 'warrior', name: '战士', color: '#C69B6D', role: '坚韧 · 重撞', trait: '质量最大，撞击沉稳，靠硬碰硬磨掉对手。', hp: 150, power: 1.00, mass: 1.40, radius: 23, speed: 0.94, enabled: true },
    { id: 'paladin', name: '圣骑士', color: '#F48CBA', role: '护盾 · 持久', trait: '生命与减伤兼顾，越到后段越难被击倒。', hp: 155, power: 0.90, mass: 1.30, radius: 23, speed: 0.90, enabled: true },
    { id: 'hunter', name: '猎人', color: '#AAD372', role: '机动 · 精准', trait: '速度快、体积小，靠频繁撞击与暴击取胜。', hp: 115, power: 1.08, mass: 0.95, radius: 20, speed: 1.22, enabled: true },
    { id: 'rogue', name: '盗贼', color: '#FFF468', role: '爆发 · 先手', trait: '血量最低但爆发最高，抢首撞与暴击。', hp: 100, power: 1.26, mass: 0.85, radius: 19, speed: 1.34, enabled: true },
    { id: 'priest', name: '牧师', color: '#F2F2F2', role: '治疗 · 反伤', trait: '持续回复与护盾，把对撞拖成消耗战。', hp: 112, power: 0.94, mass: 1.00, radius: 21, speed: 1.00, enabled: true },
    { id: 'shaman', name: '萨满', color: '#3B8CE8', role: '连锁 · 增益', trait: '雷盾反伤，连撞越打越痛。', hp: 126, power: 1.06, mass: 1.10, radius: 21, speed: 1.06, enabled: true },
    { id: 'mage', name: '法师', color: '#3FC7EB', role: '控场 · 减速', trait: '冰霜压制对手速度，制造单方面的撞击。', hp: 102, power: 1.18, mass: 0.90, radius: 20, speed: 1.16, enabled: true },
    { id: 'warlock', name: '术士', color: '#9B8FEE', role: '吸血 · 持续伤害', trait: '暗影灼烧与吸血，把伤害转化为续航。', hp: 122, power: 1.10, mass: 1.05, radius: 21, speed: 1.00, enabled: true },
    { id: 'druid', name: '德鲁伊', color: '#FF7C0A', role: '变形 · 均衡', trait: '质量与恢复兼备，没有明显短板。', hp: 136, power: 0.99, mass: 1.20, radius: 22, speed: 1.00, enabled: true }
  ],

  skills: [
    { id: 'sk1', name: '钢铁意志', cls: null, tier: 'common', mods: { maxHp: 16 }, charge: 3, enabled: true },
    { id: 'sk2', name: '磨砺锋刃', cls: null, tier: 'common', mods: { power: 0.10 }, charge: 3, enabled: true },
    { id: 'sk3', name: '疾风步', cls: null, tier: 'common', mods: { speed: 0.16 }, charge: 3, enabled: true },
    { id: 'sk4', name: '磐石之躯', cls: null, tier: 'common', mods: { mass: 0.22, maxHp: 8 }, charge: 3, enabled: true },
    { id: 'sk5', name: '坚壁', cls: null, tier: 'common', mods: { armor: 0.12 }, charge: 3, enabled: true },
    { id: 'sk6', name: '精准打击', cls: null, tier: 'common', mods: { crit: 0.14 }, charge: 3, enabled: true },
    { id: 'sk7', name: '先发制人', cls: null, tier: 'common', mods: { firstStrike: 0.40 }, charge: 3, enabled: true },
    { id: 'sk8', name: '轻盈身法', cls: null, tier: 'common', mods: { dodge: 0.13 }, charge: 3, enabled: true },
    { id: 'sk9', name: '回春', cls: null, tier: 'common', mods: { regen: 0.012 }, charge: 3, enabled: true },
    { id: 'sk10', name: '势不可挡', cls: null, tier: 'rare', mods: { momentum: 0.40, speed: 0.08 }, charge: 3, enabled: true },
    { id: 'sk11', name: '嗜血', cls: null, tier: 'rare', mods: { lifesteal: 0.22 }, charge: 3, enabled: true },
    { id: 'sk12', name: '荆棘之甲', cls: null, tier: 'rare', mods: { thorns: 0.20, armor: 0.06 }, charge: 3, enabled: true },
    { id: 'sk13', name: '连击', cls: null, tier: 'rare', mods: { combo: 0.06 }, charge: 3, enabled: true },
    { id: 'sk14', name: '寒霜印记', cls: null, tier: 'rare', mods: { slow: 0.30, power: 0.06 }, charge: 3, enabled: true },
    { id: 'sk15', name: '能量护盾', cls: null, tier: 'rare', mods: { shield: 0.20 }, charge: 3, enabled: true },
    { id: 'sk16', name: '斩杀', cls: null, tier: 'epic', mods: { execute: 0.45, power: 0.08 }, charge: 3, enabled: true },
    { id: 'sk17', name: '灼烧之痛', cls: null, tier: 'epic', mods: { dot: 0.035, power: 0.06 }, charge: 3, enabled: true },
    { id: 'sk18', name: '致命节奏', cls: null, tier: 'epic', mods: { crit: 0.20, critMult: 0.5 }, charge: 3, enabled: true },
    { id: 'sk19', name: '巨力冲撞', cls: null, tier: 'epic', mods: { knock: 0.55, mass: 0.18, power: 0.10 }, charge: 3, enabled: true },
    { id: 'sk20', name: '冲锋', cls: 'warrior', tier: 'rare', mods: { speed: 0.22, firstStrike: 0.35 }, charge: 3, enabled: true },
    { id: 'sk21', name: '破釜沉舟', cls: 'warrior', tier: 'epic', mods: { execute: 0.35, armor: 0.12, maxHp: 10 }, charge: 3, enabled: true },
    { id: 'sk22', name: '圣光护佑', cls: 'paladin', tier: 'rare', mods: { shield: 0.22, regen: 0.008 }, charge: 3, enabled: true },
    { id: 'sk23', name: '正义之锤', cls: 'paladin', tier: 'epic', mods: { power: 0.16, knock: 0.30 }, charge: 3, enabled: true },
    { id: 'sk24', name: '猎豹守护', cls: 'hunter', tier: 'rare', mods: { speed: 0.24, dodge: 0.10 }, charge: 3, enabled: true },
    { id: 'sk25', name: '瞄准射击', cls: 'hunter', tier: 'epic', mods: { crit: 0.24, critMult: 0.4 }, charge: 3, enabled: true },
    { id: 'sk26', name: '伺机待发', cls: 'rogue', tier: 'rare', mods: { crit: 0.18, firstStrike: 0.30 }, charge: 3, enabled: true },
    { id: 'sk27', name: '冷血', cls: 'rogue', tier: 'epic', mods: { crit: 0.20, power: 0.14 }, charge: 3, enabled: true },
    { id: 'sk28', name: '真言术：韧', cls: 'priest', tier: 'rare', mods: { maxHp: 26, armor: 0.08 }, charge: 3, enabled: true },
    { id: 'sk29', name: '心灵之火', cls: 'priest', tier: 'epic', mods: { regen: 0.018, thorns: 0.18 }, charge: 3, enabled: true },
    { id: 'sk30', name: '闪电之盾', cls: 'shaman', tier: 'rare', mods: { thorns: 0.26, power: 0.06 }, charge: 3, enabled: true },
    { id: 'sk31', name: '嗜血术', cls: 'shaman', tier: 'epic', mods: { speed: 0.22, combo: 0.08 }, charge: 3, enabled: true },
    { id: 'sk32', name: '寒冰护体', cls: 'mage', tier: 'rare', mods: { armor: 0.16, shield: 0.12 }, charge: 3, enabled: true },
    { id: 'sk33', name: '冰霜新星', cls: 'mage', tier: 'epic', mods: { slow: 0.42, power: 0.10 }, charge: 3, enabled: true },
    { id: 'sk34', name: '生命分流', cls: 'warlock', tier: 'rare', mods: { lifesteal: 0.24, maxHp: 12 }, charge: 3, enabled: true },
    { id: 'sk35', name: '痛苦无常', cls: 'warlock', tier: 'epic', mods: { dot: 0.045, thorns: 0.12 }, charge: 3, enabled: true },
    { id: 'sk36', name: '熊形态', cls: 'druid', tier: 'rare', mods: { mass: 0.32, maxHp: 18 }, charge: 3, enabled: true },
    { id: 'sk37', name: '回春术', cls: 'druid', tier: 'epic', mods: { regen: 0.016, shield: 0.16 }, charge: 3, enabled: true }
  ],

  maps: [
    {
      id: 'arena_classic', name: '经典竞技场', enabled: true,
      width: 900, height: 400, spawnJitter: 55,
      theme: { bgTop: '#0d1420', bgBottom: '#080c14', grid: '#182233', border: '#26344a', accent: '#2b3a52' },
      spawns: [{ x: 216, y: 200 }, { x: 684, y: 200 }],
      obstacles: []
    },
    {
      id: 'arena_pillars', name: '石柱回廊', enabled: true,
      width: 900, height: 400, spawnJitter: 55,
      theme: { bgTop: '#141a16', bgBottom: '#0a0f0d', grid: '#1d2a22', border: '#35503f', accent: '#3c5a48' },
      spawns: [{ x: 150, y: 200 }, { x: 750, y: 200 }],
      obstacles: [
        { id: 'ob1', type: 'rect', x: 450, y: 110, w: 34, h: 110, r: 0, bounce: 0.88, color: '#3c5a48' },
        { id: 'ob2', type: 'rect', x: 450, y: 290, w: 34, h: 110, r: 0, bounce: 0.88, color: '#3c5a48' },
        { id: 'ob3', type: 'circle', x: 450, y: 200, w: 0, h: 0, r: 34, bounce: 0.92, color: '#4a6b55' }
      ]
    }
  ],
  activeMapId: 'arena_classic',

  // 界面布局覆盖：后台「界面编辑器」产出，游戏端由 ui-layout.js 应用
  // screens[screenId][elementKey] = { dx, dy, w, h, img, fit, bg, opacity, radius, z, hide }
  ui: { enabled: true, screens: {} },

  events: [
    {
      id: 'ev_bloodmoon', name: '血月', enabled: false, alwaysOn: false,
      start: '2026-11-01', end: '2026-11-30',
      description: '血月当空，所有撞击更痛，史诗技能更容易出现。',
      effects: {
        dmgScale: 1.15, hpScale: 1.0,
        tierMul: { common: 1, rare: 1, epic: 2.0 },
        extraDraft: 0, skillBan: [], skillBoost: []
      }
    },
    {
      id: 'ev_frostfire', name: '霜火节', enabled: false, alwaysOn: false,
      start: '2026-12-20', end: '2026-12-31',
      description: '节日祝福：所有弹珠更耐打，每次休整多一个技能选项。',
      effects: {
        dmgScale: 1.0, hpScale: 1.10,
        tierMul: { common: 1, rare: 1, epic: 1 },
        extraDraft: 1, skillBan: [], skillBoost: []
      }
    }
  ],

  /* 游戏内文案：后台「文案编辑」页可逐条修改，游戏加载时按 selector 写入对应 DOM。
     mode = 'text' 写入 textContent；mode = 'html' 写入 innerHTML（用于含简单说明文字）。
     selector 为 CSS 选择器，命中第一个匹配元素；value 为空字符串时清空该处文字。 */
  texts: [
    { id: 'brandTitle', label: '品牌标题（LOGO 文字）', group: '品牌与首页', selector: '.brand-text h1', mode: 'text', value: '选技弹珠' },
    { id: 'brandSub', label: '品牌副标题', group: '品牌与首页', selector: '.brand-text p', mode: 'text', value: '九职业 · 三回合 · 随机技能构筑' },
    { id: 'startTitle', label: '首页主标题', group: '品牌与首页', selector: '#startScreen .section-head h2', mode: 'text', value: '选择你的职业' },
    { id: 'startDesc', label: '首页说明文字', group: '品牌与首页', selector: '#startScreen .section-head p', mode: 'text', value: '每个职业的弹珠拥有不同的生命、力量、质量与速度。对手职业随机。' },

    { id: 'nickBtn', label: '顶栏「设置昵称」按钮', group: '按钮文字', selector: '#nickBtn', mode: 'text', value: '设置昵称' },
    { id: 'rulesBtn', label: '顶栏「规则」按钮', group: '按钮文字', selector: '#rulesBtn', mode: 'text', value: '规则' },
    { id: 'shopBtn', label: '底部「商店」按钮', group: '按钮文字', selector: '#shopBtn', mode: 'text', value: '商店' },
    { id: 'startBtn', label: '底部「开始对战」按钮', group: '按钮文字', selector: '#startBtn', mode: 'text', value: '开始对战' },

    { id: 'nameTitle', label: '昵称弹层标题', group: '弹层文案', selector: '#nameTitle', mode: 'text', value: '给自己起个名字' },
    { id: 'nameLabel', label: '昵称输入框标签', group: '弹层文案', selector: '.name-label', mode: 'text', value: '昵称' },
    { id: 'nameTip', label: '昵称弹层说明', group: '弹层文案', selector: '.name-tip', mode: 'text', value: '这个昵称会写进你的对局分享码，好友导入后能看到是谁的挑战；同职业对战时也会标在弹珠上，方便分清敌我。' },
    { id: 'rulesHead', label: '规则弹层标题', group: '弹层文案', selector: '#rulesModal .modal-head h3', mode: 'text', value: '规则' },
    { id: 'rulesFoot', label: '规则弹层脚注', group: '弹层文案', selector: '#rulesModal .modal-foot', mode: 'html', value: '技能中的百分比为相对目标最大生命的比例伤害加成，暴击、减伤、护盾、吸血等按公式叠加。本规则随后台配置自动生成。' },
    { id: 'logTitle', label: '战斗记录弹层标题', group: '弹层文案', selector: '#logModal .modal-head h3', mode: 'text', value: '战斗记录' },
    { id: 'draftTitle', label: '技能三选一标题', group: '弹层文案', selector: '#draftTitle', mode: 'text', value: '战前准备 · 随机三选一' },
    { id: 'draftSub', label: '技能三选一副标题', group: '弹层文案', selector: '#draftSub', mode: 'text', value: '选择一个技能，本局全程生效' },
    { id: 'shopTitle', label: '商店弹层标题', group: '弹层文案', selector: '#shopModal .modal-head h3', mode: 'text', value: '商店 · 抽取弹珠' },
    { id: 'shopCost', label: '商店单抽价格标签', group: '弹层文案', selector: '#shopCostLabel', mode: 'text', value: '单抽 80 金币' },
    { id: 'shopHint', label: '商店抽取说明', group: '弹层文案', selector: '#shopHint', mode: 'text', value: '每次随机获得一颗卡池中的弹珠，重复获得会返还金币' },
    { id: 'shopSection', label: '商店卡池标题', group: '弹层文案', selector: '.shop-section-title', mode: 'text', value: '卡池' }
  ],

  /* 对局双方卡片上的 BUFF / DEBUFF 图标栏配置（后台「状态图标」页可逐条编辑、上传自定义 PNG 图标）。
     source = 运行时自动采集的状态来源；source='custom' 时按 tag 匹配技能「事件状态」模块填写的自定义标签。
     icon 为空时用内置矢量图标；上传 PNG 后存内嵌 dataURL，不依赖外部文件。
     改 name / color / kind / desc / enabled / order 都会直接影响对局 HUD；新增条目可用自定义标签驱动。 */
  statuses: [
    { id: 'st_shield', name: '护盾', kind: 'buff', source: 'shield', tag: '', color: '#7fd1ff', icon: '', desc: '吸收即将到来的伤害', enabled: true, order: 1 },
    { id: 'st_aura', name: '光环', kind: 'buff', source: 'aura', tag: '', color: '#8de0b0', icon: '', desc: '领域增益生效中', enabled: true, order: 2 },
    { id: 'st_combo', name: '连击', kind: 'buff', source: 'combo', tag: '', color: '#ffd479', icon: '', desc: '连续撞击的伤害加成', enabled: true, order: 3 },
    { id: 'st_mark', name: '印记', kind: 'debuff', source: 'mark', tag: '', color: '#e8c85a', icon: '', desc: '每层提高受到的伤害', enabled: true, order: 4 },
    { id: 'st_slow', name: '迟滞', kind: 'debuff', source: 'slow', tag: '', color: '#8fb8ff', icon: '', desc: '移动速度下降', enabled: true, order: 5 },
    { id: 'st_dot', name: '撕裂', kind: 'debuff', source: 'dot', tag: '', color: '#ff8a5c', icon: '', desc: '持续损失生命', enabled: true, order: 6 },
    { id: 'st_stun', name: '眩晕', kind: 'debuff', source: 'stun', tag: '', color: '#c79bff', icon: '', desc: '几乎无法移动', enabled: true, order: 7 },
    { id: 'st_weaken', name: '易伤', kind: 'debuff', source: 'weaken', tag: '', color: '#ff7a9c', icon: '', desc: '受到的伤害提高', enabled: true, order: 8 }
  ]
};
