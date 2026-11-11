/* =============================================================
   果实弹珠 · 默认配置（共享数据层）
   - 主游戏与后台工具都读取本文件；后台保存后写 localStorage: wowpinball.config.v1
   - 若启动 server.js，还会落盘到 data/game-config.json 并导出 published-config.js
   -------------------------------------------------------------
   核心数据契约（v3）：
   · marble  : 全体玩家共用的弹珠数值，职业系统已移除，任何外观都不改变数值
   · skills  : 「果实池」。原技能池，每个技能即一种果实；name=果实名，icon=果实图标(dataURL)
   · themes  : 外观题材分组（魔兽主题 / 动漫主题 / …），后台可增删
   · skins   : 弹珠外观库，按 theme 归类；src 为空时用矢量兜底绘制
   · config.hatchEggs : 新玩家初始蛋数量，孵化后从果实池随机抽取入库
   · config.draftOptions : 每回合从玩家果实库抽取的候选果实数
   · maps[].spawns : 4 个出生点，1V1 用前 2 个，2V2 用全部 4 个
   ============================================================= */
window.WOWPINBALL_DEFAULT = {
  "meta": {
    "schema": 1,
    "gameName": "选技弹珠",
    "updatedAt": "2026-11-06",
    "note": "v2 物理：无追踪加速度，开战前选定初始发射方向，全程靠反弹推进（力不衰减），碰撞时获得加速反弹"
  },
  "version": "",
  "versionSeq": 0,
  "config": {
    "arenaW": 900,
    "arenaH": 400,
    "roundSeconds": 9,
    "totalRounds": 3,
    "launchSpeed": 250,
    "collisionBoost": 1.14,
    "maxSpeed": 520,
    "restitution": 1,
    "wallRestitution": 1,
    "impactCd": 0.22,
    "minImpact": 48,
    "drawWindow": 0.012,
    "hitStopMs": 55,
    "dmgBase": 0.022,
    "dmgSpeed": 0.03,
    "critBase": 0.04,
    "critMultBase": 1.55,
    "draftOptions": 3,
    "speeds": [
      1,
      2,
      4
    ],
    "hatchEggs": 5
  },
  "tierWeights": {
    "common": 1,
    "rare": 0.62,
    "epic": 0.28
  },
  "weather": {
    "enabled": true,
    "noneWeight": 5,
    "types": [
      {
        "id": "wind",
        "name": "大风",
        "enabled": true,
        "weight": 4,
        "forceMin": 30,
        "forceMax": 70,
        "sway": 0.45,
        "desc": "持续水平风力推动弹珠，阵风时强时弱，方向每回合随机"
      },
      {
        "id": "rain",
        "name": "下雨",
        "enabled": true,
        "weight": 3,
        "slip": 0.12,
        "rainForce": 70,
        "desc": "场地湿滑：互撞与墙壁、障碍反弹更有弹性，来回更快更难预判；雨幕持续向下压弹珠"
      }
    ]
  },
  "skills": [
    {
      "id": "sk1",
      "name": "钢铁意志",
      "tier": "common",
      "mods": {
        "maxHp": 16
      },
      "charge": 3,
      "enabled": true,
      "icon": ""
    },
    {
      "id": "sk2",
      "name": "磨砺锋刃",
      "tier": "common",
      "mods": {
        "power": 0.1
      },
      "charge": 3,
      "enabled": true,
      "icon": ""
    },
    {
      "id": "sk3",
      "name": "疾风步",
      "tier": "common",
      "mods": {
        "speed": 0.16
      },
      "charge": 3,
      "enabled": true,
      "icon": ""
    },
    {
      "id": "sk4",
      "name": "磐石之躯",
      "tier": "common",
      "mods": {
        "mass": 0.22,
        "maxHp": 8
      },
      "charge": 3,
      "enabled": true,
      "icon": ""
    },
    {
      "id": "sk5",
      "name": "坚壁",
      "tier": "common",
      "mods": {
        "armor": 0.12
      },
      "charge": 3,
      "enabled": true,
      "icon": ""
    },
    {
      "id": "sk6",
      "name": "精准打击",
      "tier": "common",
      "mods": {
        "crit": 0.14
      },
      "charge": 3,
      "enabled": true,
      "icon": ""
    },
    {
      "id": "sk7",
      "name": "先发制人",
      "tier": "common",
      "mods": {
        "firstStrike": 0.4
      },
      "charge": 3,
      "enabled": true,
      "icon": ""
    },
    {
      "id": "sk8",
      "name": "轻盈身法",
      "tier": "common",
      "mods": {
        "dodge": 0.13
      },
      "charge": 3,
      "enabled": true,
      "icon": ""
    },
    {
      "id": "sk9",
      "name": "回春",
      "tier": "common",
      "mods": {
        "regen": 0.012
      },
      "charge": 3,
      "enabled": true,
      "icon": ""
    },
    {
      "id": "sk10",
      "name": "势不可挡",
      "tier": "rare",
      "mods": {
        "momentum": 0.4,
        "speed": 0.08
      },
      "charge": 3,
      "enabled": true,
      "icon": ""
    },
    {
      "id": "sk11",
      "name": "嗜血",
      "tier": "rare",
      "mods": {
        "lifesteal": 0.22
      },
      "charge": 3,
      "enabled": true,
      "icon": ""
    },
    {
      "id": "sk12",
      "name": "荆棘之甲",
      "tier": "rare",
      "mods": {
        "thorns": 0.2,
        "armor": 0.06
      },
      "charge": 3,
      "enabled": true,
      "icon": ""
    },
    {
      "id": "sk13",
      "name": "连击",
      "tier": "rare",
      "mods": {
        "combo": 0.06
      },
      "charge": 3,
      "enabled": true,
      "icon": ""
    },
    {
      "id": "sk14",
      "name": "寒霜印记",
      "tier": "rare",
      "mods": {
        "slow": 0.3,
        "power": 0.06
      },
      "charge": 3,
      "enabled": true,
      "icon": ""
    },
    {
      "id": "sk15",
      "name": "能量护盾",
      "tier": "rare",
      "mods": {
        "shield": 0.2
      },
      "charge": 3,
      "enabled": true,
      "icon": ""
    },
    {
      "id": "sk16",
      "name": "斩杀",
      "tier": "epic",
      "mods": {
        "execute": 0.45,
        "power": 0.08
      },
      "charge": 3,
      "enabled": true,
      "icon": ""
    },
    {
      "id": "sk17",
      "name": "灼烧之痛",
      "tier": "epic",
      "mods": {
        "dot": 0.035,
        "power": 0.06
      },
      "charge": 3,
      "enabled": true,
      "icon": ""
    },
    {
      "id": "sk18",
      "name": "致命节奏",
      "tier": "epic",
      "mods": {
        "crit": 0.2,
        "critMult": 0.5
      },
      "charge": 3,
      "enabled": true,
      "icon": ""
    },
    {
      "id": "sk19",
      "name": "巨力冲撞",
      "tier": "epic",
      "mods": {
        "knock": 0.55,
        "mass": 0.18,
        "power": 0.1
      },
      "charge": 3,
      "enabled": true,
      "icon": ""
    },
    {
      "id": "sk20",
      "name": "冲锋",
      "tier": "rare",
      "mods": {
        "speed": 0.22,
        "firstStrike": 0.35
      },
      "charge": 3,
      "enabled": true,
      "icon": ""
    },
    {
      "id": "sk21",
      "name": "破釜沉舟",
      "tier": "epic",
      "mods": {
        "execute": 0.35,
        "armor": 0.12,
        "maxHp": 10
      },
      "charge": 3,
      "enabled": true,
      "icon": ""
    },
    {
      "id": "sk22",
      "name": "圣光护佑",
      "tier": "rare",
      "mods": {
        "shield": 0.22,
        "regen": 0.008
      },
      "charge": 3,
      "enabled": true,
      "icon": ""
    },
    {
      "id": "sk23",
      "name": "正义之锤",
      "tier": "epic",
      "mods": {
        "power": 0.16,
        "knock": 0.3
      },
      "charge": 3,
      "enabled": true,
      "icon": ""
    },
    {
      "id": "sk24",
      "name": "猎豹守护",
      "tier": "rare",
      "mods": {
        "speed": 0.24,
        "dodge": 0.1
      },
      "charge": 3,
      "enabled": true,
      "icon": ""
    },
    {
      "id": "sk25",
      "name": "瞄准射击",
      "tier": "epic",
      "mods": {
        "crit": 0.24,
        "critMult": 0.4
      },
      "charge": 3,
      "enabled": true,
      "icon": ""
    },
    {
      "id": "sk26",
      "name": "伺机待发",
      "tier": "rare",
      "mods": {
        "crit": 0.18,
        "firstStrike": 0.3
      },
      "charge": 3,
      "enabled": true,
      "icon": ""
    },
    {
      "id": "sk27",
      "name": "冷血",
      "tier": "epic",
      "mods": {
        "crit": 0.2,
        "power": 0.14
      },
      "charge": 3,
      "enabled": true,
      "icon": ""
    },
    {
      "id": "sk28",
      "name": "真言术：韧",
      "tier": "rare",
      "mods": {
        "maxHp": 26,
        "armor": 0.08
      },
      "charge": 3,
      "enabled": true,
      "icon": ""
    },
    {
      "id": "sk29",
      "name": "心灵之火",
      "tier": "epic",
      "mods": {
        "regen": 0.018,
        "thorns": 0.18
      },
      "charge": 3,
      "enabled": true,
      "icon": ""
    },
    {
      "id": "sk30",
      "name": "闪电之盾",
      "tier": "rare",
      "mods": {
        "thorns": 0.26,
        "power": 0.06
      },
      "charge": 3,
      "enabled": true,
      "icon": ""
    },
    {
      "id": "sk31",
      "name": "嗜血术",
      "tier": "epic",
      "mods": {
        "speed": 0.22,
        "combo": 0.08
      },
      "charge": 3,
      "enabled": true,
      "icon": ""
    },
    {
      "id": "sk32",
      "name": "寒冰护体",
      "tier": "rare",
      "mods": {
        "armor": 0.16,
        "shield": 0.12
      },
      "charge": 3,
      "enabled": true,
      "icon": ""
    },
    {
      "id": "sk33",
      "name": "冰霜新星",
      "tier": "epic",
      "mods": {
        "slow": 0.42,
        "power": 0.1
      },
      "charge": 3,
      "enabled": true,
      "icon": ""
    },
    {
      "id": "sk34",
      "name": "生命分流",
      "tier": "rare",
      "mods": {
        "lifesteal": 0.24,
        "maxHp": 12
      },
      "charge": 3,
      "enabled": true,
      "icon": ""
    },
    {
      "id": "sk35",
      "name": "痛苦无常",
      "tier": "epic",
      "mods": {
        "dot": 0.045,
        "thorns": 0.12
      },
      "charge": 3,
      "enabled": true,
      "icon": ""
    },
    {
      "id": "sk36",
      "name": "熊形态",
      "tier": "rare",
      "mods": {
        "mass": 0.32,
        "maxHp": 18
      },
      "charge": 3,
      "enabled": true,
      "icon": ""
    },
    {
      "id": "sk37",
      "name": "回春术",
      "tier": "epic",
      "mods": {
        "regen": 0.016,
        "shield": 0.16
      },
      "charge": 3,
      "enabled": true,
      "icon": ""
    }
  ],
  "maps": [
    {
      "id": "arena_classic",
      "name": "经典竞技场",
      "enabled": true,
      "width": 900,
      "height": 400,
      "spawnJitter": 55,
      "theme": {
        "bgTop": "#0d1420",
        "bgBottom": "#080c14",
        "grid": "#182233",
        "border": "#26344a",
        "accent": "#2b3a52"
      },
      "spawns": [
        {
          "x": 216,
          "y": 200
        },
        {
          "x": 684,
          "y": 200
        },
        {
          "x": 216,
          "y": 90
        },
        {
          "x": 684,
          "y": 310
        }
      ],
      "obstacles": []
    },
    {
      "id": "arena_pillars",
      "name": "石柱回廊",
      "enabled": true,
      "width": 900,
      "height": 400,
      "spawnJitter": 55,
      "theme": {
        "bgTop": "#141a16",
        "bgBottom": "#0a0f0d",
        "grid": "#1d2a22",
        "border": "#35503f",
        "accent": "#3c5a48"
      },
      "spawns": [
        {
          "x": 150,
          "y": 200
        },
        {
          "x": 750,
          "y": 200
        },
        {
          "x": 150,
          "y": 90
        },
        {
          "x": 750,
          "y": 310
        }
      ],
      "obstacles": [
        {
          "id": "ob1",
          "type": "rect",
          "x": 450,
          "y": 110,
          "w": 34,
          "h": 110,
          "r": 0,
          "bounce": 0.88,
          "color": "#3c5a48"
        },
        {
          "id": "ob2",
          "type": "rect",
          "x": 450,
          "y": 290,
          "w": 34,
          "h": 110,
          "r": 0,
          "bounce": 0.88,
          "color": "#3c5a48"
        },
        {
          "id": "ob3",
          "type": "circle",
          "x": 450,
          "y": 200,
          "w": 0,
          "h": 0,
          "r": 34,
          "bounce": 0.92,
          "color": "#4a6b55"
        }
      ]
    }
  ],
  "activeMapId": "arena_classic",
  "ui": {
    "enabled": true,
    "screens": {}
  },
  "events": [
    {
      "id": "ev_bloodmoon",
      "name": "血月",
      "enabled": false,
      "alwaysOn": false,
      "start": "2026-11-01",
      "end": "2026-11-30",
      "description": "血月当空，所有撞击更痛，史诗技能更容易出现。",
      "effects": {
        "dmgScale": 1.15,
        "hpScale": 1,
        "tierMul": {
          "common": 1,
          "rare": 1,
          "epic": 2
        },
        "extraDraft": 0,
        "skillBan": [],
        "skillBoost": []
      }
    },
    {
      "id": "ev_frostfire",
      "name": "霜火节",
      "enabled": false,
      "alwaysOn": false,
      "start": "2026-12-20",
      "end": "2026-12-31",
      "description": "节日祝福：所有弹珠更耐打，每次休整多一个技能选项。",
      "effects": {
        "dmgScale": 1,
        "hpScale": 1.1,
        "tierMul": {
          "common": 1,
          "rare": 1,
          "epic": 1
        },
        "extraDraft": 1,
        "skillBan": [],
        "skillBoost": []
      }
    }
  ],
  "texts": [
    {
      "id": "brandTitle",
      "label": "品牌标题（LOGO 文字）",
      "group": "品牌与首页",
      "selector": ".brand-text h1",
      "mode": "text",
      "value": "果实弹珠"
    },
    {
      "id": "brandSub",
      "label": "品牌副标题",
      "group": "品牌与首页",
      "selector": ".brand-text p",
      "mode": "text",
      "value": "果实构筑 · 每回合选一枚果实"
    },
    {
      "id": "startTitle",
      "label": "首页主标题",
      "group": "品牌与首页",
      "selector": "#startScreen .section-head h2",
      "mode": "text",
      "value": "我的果实库"
    },
    {
      "id": "startDesc",
      "label": "首页说明文字",
      "group": "品牌与首页",
      "selector": "#startScreen .section-head p",
      "mode": "text",
      "value": "所有玩家的弹珠数值相同；选择不同的果实，对战时弹珠技能不同。"
    },
    {
      "id": "nickBtn",
      "label": "顶栏「设置昵称」按钮",
      "group": "按钮文字",
      "selector": "#nickBtn",
      "mode": "text",
      "value": "设置昵称"
    },
    {
      "id": "rulesBtn",
      "label": "顶栏「规则」按钮",
      "group": "按钮文字",
      "selector": "#rulesBtn",
      "mode": "text",
      "value": "规则"
    },
    {
      "id": "startBtn",
      "label": "底部「开始对战」按钮",
      "group": "按钮文字",
      "selector": "#startBtn",
      "mode": "text",
      "value": "开始对战"
    },
    {
      "id": "nameTitle",
      "label": "昵称弹层标题",
      "group": "弹层文案",
      "selector": "#nameTitle",
      "mode": "text",
      "value": "给自己起个名字"
    },
    {
      "id": "nameLabel",
      "label": "昵称输入框标签",
      "group": "弹层文案",
      "selector": ".name-label",
      "mode": "text",
      "value": "昵称"
    },
    {
      "id": "nameTip",
      "label": "昵称弹层说明",
      "group": "弹层文案",
      "selector": ".name-tip",
      "mode": "text",
      "value": "昵称会显示在对战与联机房间里，方便好友认出你。"
    },
    {
      "id": "rulesHead",
      "label": "规则弹层标题",
      "group": "弹层文案",
      "selector": "#rulesModal .modal-head h3",
      "mode": "text",
      "value": "规则"
    },
    {
      "id": "rulesFoot",
      "label": "规则弹层脚注",
      "group": "弹层文案",
      "selector": "#rulesModal .modal-foot",
      "mode": "html",
      "value": "技能中的百分比为相对目标最大生命的比例伤害加成，暴击、减伤、护盾、吸血等按公式叠加。本规则随后台配置自动生成。"
    },
    {
      "id": "logTitle",
      "label": "战斗记录弹层标题",
      "group": "弹层文案",
      "selector": "#logModal .modal-head h3",
      "mode": "text",
      "value": "战斗记录"
    },
    {
      "id": "draftTitle",
      "label": "技能三选一标题",
      "group": "弹层文案",
      "selector": "#draftTitle",
      "mode": "text",
      "value": "本回合 · 果实三选一"
    },
    {
      "id": "draftSub",
      "label": "技能三选一副标题",
      "group": "弹层文案",
      "selector": "#draftSub",
      "mode": "text",
      "value": "从你的果实库抽取，选中的果实只在这一回合生效"
    },
    {
      "id": "hatchTitle",
      "label": "孵化弹层标题",
      "group": "弹层文案",
      "selector": "#hatchTitle",
      "mode": "text",
      "value": "初始果实 · 孵化"
    },
    {
      "id": "hatchSub",
      "label": "孵化弹层副标题",
      "group": "弹层文案",
      "selector": "#hatchSub",
      "mode": "text",
      "value": "5 枚蛋正在孵化…"
    },
    {
      "id": "hatchHint",
      "label": "孵化说明",
      "group": "弹层文案",
      "selector": ".hatch-tip",
      "mode": "text",
      "value": "每枚蛋都会随机开出一种果实，存入你的果实库"
    },
    {
      "id": "hatchConfirm",
      "label": "孵化「收下果实」按钮",
      "group": "按钮文字",
      "selector": "#hatchConfirmBtn",
      "mode": "text",
      "value": "收下果实"
    }
  ],
  "statuses": [
    {
      "id": "st_shield",
      "name": "护盾",
      "kind": "buff",
      "source": "shield",
      "tag": "",
      "color": "#7fd1ff",
      "icon": "",
      "desc": "吸收即将到来的伤害",
      "enabled": true,
      "order": 1
    },
    {
      "id": "st_aura",
      "name": "光环",
      "kind": "buff",
      "source": "aura",
      "tag": "",
      "color": "#8de0b0",
      "icon": "",
      "desc": "领域增益生效中",
      "enabled": true,
      "order": 2
    },
    {
      "id": "st_combo",
      "name": "连击",
      "kind": "buff",
      "source": "combo",
      "tag": "",
      "color": "#ffd479",
      "icon": "",
      "desc": "连续撞击的伤害加成",
      "enabled": true,
      "order": 3
    },
    {
      "id": "st_mark",
      "name": "印记",
      "kind": "debuff",
      "source": "mark",
      "tag": "",
      "color": "#e8c85a",
      "icon": "",
      "desc": "每层提高受到的伤害",
      "enabled": true,
      "order": 4
    },
    {
      "id": "st_slow",
      "name": "迟滞",
      "kind": "debuff",
      "source": "slow",
      "tag": "",
      "color": "#8fb8ff",
      "icon": "",
      "desc": "移动速度下降",
      "enabled": true,
      "order": 5
    },
    {
      "id": "st_dot",
      "name": "撕裂",
      "kind": "debuff",
      "source": "dot",
      "tag": "",
      "color": "#ff8a5c",
      "icon": "",
      "desc": "持续损失生命",
      "enabled": true,
      "order": 6
    },
    {
      "id": "st_stun",
      "name": "眩晕",
      "kind": "debuff",
      "source": "stun",
      "tag": "",
      "color": "#c79bff",
      "icon": "",
      "desc": "几乎无法移动",
      "enabled": true,
      "order": 7
    },
    {
      "id": "st_weaken",
      "name": "易伤",
      "kind": "debuff",
      "source": "weaken",
      "tag": "",
      "color": "#ff7a9c",
      "icon": "",
      "desc": "受到的伤害提高",
      "enabled": true,
      "order": 8
    }
  ],
  "marble": {
    "hp": 130,
    "power": 1.05,
    "mass": 1.1,
    "radius": 21,
    "speed": 1.05,
    "color": "#57c8ff"
  },
  "themes": [
    {
      "id": "wow",
      "name": "魔兽主题"
    },
    {
      "id": "anime",
      "name": "动漫主题"
    },
    {
      "id": "other",
      "name": "其它题材"
    }
  ],
  "skins": [
    {
      "id": "skin_warrior",
      "name": "战士 · 弹珠",
      "theme": "wow",
      "src": "",
      "scale": 1.05,
      "offsetX": 0,
      "offsetY": 0,
      "rotation": 0,
      "opacity": 1,
      "gloss": false,
      "label": false,
      "w": 0,
      "h": 0,
      "color": "#C69B6D",
      "enabled": true
    },
    {
      "id": "skin_paladin",
      "name": "圣骑士 · 弹珠",
      "theme": "wow",
      "src": "",
      "scale": 1.05,
      "offsetX": 0,
      "offsetY": 0,
      "rotation": 0,
      "opacity": 1,
      "gloss": false,
      "label": false,
      "w": 0,
      "h": 0,
      "color": "#F48CBA",
      "enabled": true
    },
    {
      "id": "skin_hunter",
      "name": "猎人 · 弹珠",
      "theme": "wow",
      "src": "",
      "scale": 1.05,
      "offsetX": 0,
      "offsetY": 0,
      "rotation": 0,
      "opacity": 1,
      "gloss": false,
      "label": false,
      "w": 0,
      "h": 0,
      "color": "#AAD372",
      "enabled": true
    },
    {
      "id": "skin_rogue",
      "name": "盗贼 · 弹珠",
      "theme": "wow",
      "src": "",
      "scale": 1.05,
      "offsetX": 0,
      "offsetY": 0,
      "rotation": 0,
      "opacity": 1,
      "gloss": false,
      "label": false,
      "w": 0,
      "h": 0,
      "color": "#FFF468",
      "enabled": true
    },
    {
      "id": "skin_priest",
      "name": "牧师 · 弹珠",
      "theme": "wow",
      "src": "",
      "scale": 1.05,
      "offsetX": 0,
      "offsetY": 0,
      "rotation": 0,
      "opacity": 1,
      "gloss": false,
      "label": false,
      "w": 0,
      "h": 0,
      "color": "#F2F2F2",
      "enabled": true
    },
    {
      "id": "skin_shaman",
      "name": "萨满 · 弹珠",
      "theme": "wow",
      "src": "",
      "scale": 1.05,
      "offsetX": 0,
      "offsetY": 0,
      "rotation": 0,
      "opacity": 1,
      "gloss": false,
      "label": false,
      "w": 0,
      "h": 0,
      "color": "#3B8CE8",
      "enabled": true
    },
    {
      "id": "skin_mage",
      "name": "法师 · 弹珠",
      "theme": "wow",
      "src": "",
      "scale": 1.05,
      "offsetX": 0,
      "offsetY": 0,
      "rotation": 0,
      "opacity": 1,
      "gloss": false,
      "label": false,
      "w": 0,
      "h": 0,
      "color": "#3FC7EB",
      "enabled": true
    },
    {
      "id": "skin_warlock",
      "name": "术士 · 弹珠",
      "theme": "wow",
      "src": "",
      "scale": 1.05,
      "offsetX": 0,
      "offsetY": 0,
      "rotation": 0,
      "opacity": 1,
      "gloss": false,
      "label": false,
      "w": 0,
      "h": 0,
      "color": "#9B8FEE",
      "enabled": true
    },
    {
      "id": "skin_druid",
      "name": "德鲁伊 · 弹珠",
      "theme": "wow",
      "src": "",
      "scale": 1.05,
      "offsetX": 0,
      "offsetY": 0,
      "rotation": 0,
      "opacity": 1,
      "gloss": false,
      "label": false,
      "w": 0,
      "h": 0,
      "color": "#FF7C0A",
      "enabled": true
    },
    {
      "id": "skin_default_blue",
      "name": "澄蓝弹珠",
      "theme": "other",
      "src": "",
      "scale": 1.05,
      "offsetX": 0,
      "offsetY": 0,
      "rotation": 0,
      "opacity": 1,
      "gloss": true,
      "label": false,
      "w": 0,
      "h": 0,
      "color": "#57c8ff",
      "enabled": true
    },
    {
      "id": "skin_default_amber",
      "name": "琥珀弹珠",
      "theme": "other",
      "src": "",
      "scale": 1.05,
      "offsetX": 0,
      "offsetY": 0,
      "rotation": 0,
      "opacity": 1,
      "gloss": true,
      "label": false,
      "w": 0,
      "h": 0,
      "color": "#f0b759",
      "enabled": true
    }
  ]
};
