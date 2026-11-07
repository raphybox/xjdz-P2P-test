/* =============================================================
   魔兽弹珠 · 内容管理后台
   模块：总览 / 职业 / 技能 / 数值平衡 / 地图编辑器 / 活动事件 / 校验发布
   数据流：编辑内存 -> 保存 localStorage -> 发布写入 data/game-config.json
   ============================================================= */
(function () {
  'use strict';

  const KEY = 'wowpinball.config.v1';
  const SNAP_KEY = 'wowpinball.snapshots.v1';
  const DEFAULT = window.WOWPINBALL_DEFAULT;
  const SKIN = window.WowPinballSkin;
  const UI = window.WowPinballUI;
  const TIERS = { common: '普通', rare: '稀有', epic: '史诗' };

  /* ---------------- 元数据 ---------------- */
  const MOD_META = [
    { k: 'maxHp', label: '生命', min: 0, max: 300, step: 1 },
    { k: 'power', label: '伤害', min: 0, max: 2, step: 0.01, pct: true },
    { k: 'speed', label: '速度', min: 0, max: 2, step: 0.01, pct: true },
    { k: 'mass', label: '质量', min: 0, max: 3, step: 0.01, dec: 2 },
    { k: 'armor', label: '减伤', min: 0, max: 1, step: 0.01, pct: true },
    { k: 'crit', label: '暴击率', min: 0, max: 1, step: 0.01, pct: true },
    { k: 'critMult', label: '暴击倍率', min: 0, max: 5, step: 0.1, dec: 1 },
    { k: 'lifesteal', label: '吸血', min: 0, max: 1, step: 0.01, pct: true },
    { k: 'thorns', label: '反伤', min: 0, max: 1, step: 0.01, pct: true },
    { k: 'regen', label: '每秒回复', min: 0, max: 0.2, step: 0.002, pct: true, dec: 1 },
    { k: 'shield', label: '每回合护盾', min: 0, max: 1, step: 0.01, pct: true },
    { k: 'firstStrike', label: '首次撞击加成', min: 0, max: 3, step: 0.05, pct: true },
    { k: 'execute', label: '斩杀加成', min: 0, max: 3, step: 0.05, pct: true },
    { k: 'combo', label: '连撞每层加成', min: 0, max: 1, step: 0.01, pct: true },
    { k: 'slow', label: '命中减速', min: 0, max: 1, step: 0.01, pct: true },
    { k: 'dot', label: '持续伤害', min: 0, max: 0.2, step: 0.005, pct: true, dec: 1 },
    { k: 'knock', label: '击退强度', min: 0, max: 3, step: 0.05, pct: true },
    { k: 'dodge', label: '闪避', min: 0, max: 1, step: 0.01, pct: true },
    { k: 'momentum', label: '高速撞击加成', min: 0, max: 3, step: 0.05, pct: true }
  ];

  const CONFIG_GROUPS = [
    { title: '回合与判定', items: [
      { k: 'totalRounds', label: '总回合数', min: 1, max: 9, step: 1, hint: '改大后技能选择次数会随回合数增加' },
      { k: 'roundSeconds', label: '每回合时长（秒）', min: 3, max: 60, step: 1 },
      { k: 'drawWindow', label: '平局判定窗口', min: 0, max: 0.2, step: 0.002, pct: true, hint: '剩余血量差小于该比例记平局' },
      { k: 'draftOptions', label: '每次备选技能数', min: 1, max: 6, step: 1 }
    ] },
    { title: '物理手感', items: [
      { k: 'launchSpeed', label: '初始发射速度', min: 60, max: 800, step: 10, hint: '开局弹珠沿选定方向发射的速度' },
      { k: 'maxSpeed', label: '速度上限', min: 100, max: 1500, step: 10 },
      { k: 'collisionBoost', label: '碰撞加速反弹', min: 1.0, max: 2.0, step: 0.02, hint: '双方碰撞后速度倍率，1.0 不加速，>1 碰撞后加速' },
      { k: 'restitution', label: '弹珠互撞弹性', min: 0.2, max: 1.2, step: 0.01 },
      { k: 'wallRestitution', label: '边界反弹弹性', min: 0.2, max: 1.2, step: 0.01, hint: '设为 1.0 时墙壁反弹不损失力量（力不衰减）' },
      { k: 'impactCd', label: '撞击结算冷却（秒）', min: 0.05, max: 1, step: 0.01 },
      { k: 'minImpact', label: '最小有效撞击速度', min: 0, max: 300, step: 5 },
      { k: 'hitStopMs', label: '命中定格（毫秒）', min: 0, max: 200, step: 5 }
    ] },
    { title: '伤害公式', items: [
      { k: 'dmgBase', label: '基础比例伤害', min: 0, max: 0.2, step: 0.002, pct: true, dec: 1, hint: '每次撞击至少造成目标最大生命该比例的伤害' },
      { k: 'dmgSpeed', label: '速度附加比例伤害', min: 0, max: 0.2, step: 0.002, pct: true, dec: 1 },
      { k: 'critBase', label: '基础暴击率', min: 0, max: 1, step: 0.01, pct: true },
      { k: 'critMultBase', label: '基础暴击倍率', min: 1, max: 5, step: 0.05 }
    ] },
    { title: '抽取与场地兜底', items: [
      { k: 'classSkillWeight', label: '职业专属技能权重', min: 0.1, max: 5, step: 0.05 },
      { k: 'arenaW', label: '默认场地宽', min: 400, max: 1600, step: 10, hint: '实际以启用地图的宽高为准' },
      { k: 'arenaH', label: '默认场地高', min: 240, max: 900, step: 10 }
    ] },
    { title: '稀有度抽取权重', items: [
      { k: 'tierWeights.common', label: '普通', min: 0, max: 5, step: 0.05 },
      { k: 'tierWeights.rare', label: '稀有', min: 0, max: 5, step: 0.05 },
      { k: 'tierWeights.epic', label: '史诗', min: 0, max: 5, step: 0.05 }
    ] }
  ];

  const TAB_INFO = {
    dashboard: ['总览', '内容配置与发布状态'],
    classes: ['职业管理', '新增或编辑弹珠职业、颜色与基础数值'],
    skins: ['弹珠外观', '上传 PNG 替换弹珠贴图，可视化微调尺寸与位置'],
    skills: ['技能管理', '编辑随机技能池、稀有度与全部效果数值'],
    balance: ['数值平衡', '全局参数调整与批量对战试算'],
    maps: ['地图编辑器', '可视化编辑竞技场、障碍与出生点'],
    events: ['活动事件', '限时活动、全局倍率与技能权重干预'],
    shop: ['商店', '弹珠抽取卡池、价格与对战金币奖励'],
    studio: ['实时编排', '拖拽连线编排技能，右侧真引擎实时预览'],
    ui: ['界面编辑器', '全游戏 UI 可视化拖拽排版，任意元素上传 PNG 素材'],
    release: ['校验与发布', '数据校验、快照、导入导出与落盘']
  };

  /* ---------------- 状态 ---------------- */
  const S = {
    data: null, saved: null, dirty: false, tab: 'dashboard',
    serverMode: false, serverData: null, source: 'default',
    filters: { skillQ: '', tier: '', cls: '', classQ: '', showDisabled: true },
    map: { id: null, tool: 'select', sel: null, drag: null, preview: null, snap: false, mirror: false },
    hist: { undo: [], redo: [], current: null, lastKey: null, lastAt: 0, label: null, mute: false },
    sim: { n: 200, stage: 3, result: null },
    studio: { opened: false, pvP: null, pvE: null, node: null, previewDirtyAt: 0 },
    skin: { sel: null, file: null },
    ui: { screen: 'start', key: null, scale: 0.6, ready: false, frame: null },
    drawerSave: null, confirmResolve: null
  };

  /* ---------------- 工具 ---------------- */
  const $ = id => document.getElementById(id);
  const clone = o => JSON.parse(JSON.stringify(o));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = p => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const n2 = v => Number(v.toFixed(2));
  function val(id) { const e = $(id); return e ? e.value : ''; }
  function numv(id, d) { const v = parseFloat(val(id)); return isNaN(v) ? d : v; }
  function chk(id) { const e = $(id); return !!(e && e.checked); }
  function getPath(o, p) { return p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o); }
  function setPath(o, p, v) {
    const ks = p.split('.'); const last = ks.pop();
    const t = ks.reduce((a, k) => (a[k] = a[k] || {}), o);
    t[last] = v;
  }
  function fmtNum(v, dec) { return Number(v).toFixed(dec == null ? 2 : dec).replace(/\.?0+$/, ''); }
  function modText(k, v) {
    const m = MOD_META.find(x => x.k === k);
    if (!m) return k + ' +' + v;
    const s = m.pct ? Math.round(v * 100) + '%' : (m.dec != null ? Number(v).toFixed(m.dec) : v);
    return m.label + ' +' + s;
  }
  function describeMods(mods) {
    const t = MOD_META.filter(m => mods && mods[m.k]).map(m => modText(m.k, mods[m.k])).join(' / ');
    return t || '无效果';
  }
  function toast(msg, kind) {
    const d = document.createElement('div');
    d.className = 'toast ' + (kind || '');
    d.textContent = msg;
    $('toastWrap').appendChild(d);
    setTimeout(() => d.remove(), 3200);
  }
  function confirmBox(title, text) {
    $('confirmTitle').textContent = title;
    $('confirmText').textContent = text;
    $('confirmModal').hidden = false;
    return new Promise(res => { S.confirmResolve = res; });
  }
  function closeConfirm(ok) {
    $('confirmModal').hidden = true;
    if (S.confirmResolve) S.confirmResolve(ok);
    S.confirmResolve = null;
  }
  function valid(d) {
    return d && d.config && d.meta && d.meta.schema === DEFAULT.meta.schema &&
      Array.isArray(d.classes) && Array.isArray(d.skills) &&
      Array.isArray(d.maps) && Array.isArray(d.events);
  }
  function markDirty(key) {
    S.dirty = true;
    $('dirtyBadge').hidden = false;
    // 地图页所有写操作都经过这里，撤销栈统一在此挂钩
    if (S.tab === 'maps' && !S.hist.mute && S.data) pushHistory(S.hist.label || histLabel(key), key);
    S.hist.label = null;
    // 编辑任意页签后，若已打开过实时编排，自动把最新配置推给预览引擎（防抖）
    if (S.studio.opened) schedulePreviewPush();
  }
  function clearDirty() {
    S.dirty = false;
    $('dirtyBadge').hidden = true;
  }

  /* ---------------- 操作历史（撤销 / 重做） ----------------
     只快照地图相关状态，避免把其它页签的编辑卷进地图历史。
     快照是 JSON 字符串：恢复时解析出全新对象，不会和 S.saved 互相引用。 */
  const HIST_LIMIT = 60;
  const HIST_COALESCE_MS = 900;
  function mapState() {
    return JSON.stringify({
      maps: S.data.maps,
      activeMapId: S.data.activeMapId,
      mapId: S.map.id,
      sel: S.map.sel
    });
  }
  function histLabel(key) {
    if (!key) return '地图编辑';
    if (key.indexOf('theme') === 0) return '主题配色';
    if (key.indexOf('obprop') === 0) return '障碍属性';
    if (key.indexOf('spawn') === 0) return '出生点坐标';
    if (key === 'nudge') return '键盘微调';
    return '属性编辑';
  }
  function resetHistory() {
    S.hist.undo.length = 0;
    S.hist.redo.length = 0;
    S.hist.current = S.data ? mapState() : null;
    S.hist.lastKey = null;
    S.hist.lastAt = 0;
    S.hist.label = null;
    updateHistoryUI();
  }
  function pushHistory(label, key) {
    const snap = mapState();
    if (S.hist.current == null) { S.hist.current = snap; updateHistoryUI(); return; }
    if (snap === S.hist.current) return;
    const now = Date.now();
    // 连续输入 / 连续方向键合并成一步，保留该组操作之前的状态
    if (key && S.hist.lastKey === key && now - S.hist.lastAt < HIST_COALESCE_MS && S.hist.undo.length) {
      S.hist.current = snap;
      S.hist.lastAt = now;
      updateHistoryUI();
      return;
    }
    S.hist.undo.push({ state: S.hist.current, label: label || '地图编辑' });
    if (S.hist.undo.length > HIST_LIMIT) S.hist.undo.shift();
    S.hist.redo.length = 0;
    S.hist.current = snap;
    S.hist.lastKey = key || null;
    S.hist.lastAt = now;
    updateHistoryUI();
  }
  function applyHistory(state) {
    const s = typeof state === 'string' ? JSON.parse(state) : state;
    S.data.maps = s.maps;
    S.data.activeMapId = s.activeMapId;
    S.map.id = s.mapId;
    S.map.sel = s.sel || null;
    S.map.drag = null;
    S.map.preview = null;
    S.hist.mute = true;
    markDirty();
    S.hist.mute = false;
    if (S.tab !== 'maps') switchTab('maps'); else refresh();
    updateHistoryUI();
  }
  function stepHistory(dir) {
    const from = dir === 'undo' ? S.hist.undo : S.hist.redo;
    const to = dir === 'undo' ? S.hist.redo : S.hist.undo;
    if (!from.length) {
      toast(dir === 'undo' ? '没有可撤销的操作' : '没有可重做的操作', 'bad');
      return;
    }
    const entry = from.pop();
    to.push({ state: S.hist.current, label: entry.label });
    S.hist.current = entry.state;
    S.hist.lastKey = null;
    S.hist.lastAt = 0;
    applyHistory(entry.state);
    toast((dir === 'undo' ? '已撤销：' : '已重做：') + entry.label, 'ok');
  }
  function updateHistoryUI() {
    const u = $('btnMapUndo'), r = $('btnMapRedo'), info = $('histInfo'), sn = $('snapInfo');
    if (u) u.disabled = !S.hist.undo.length;
    if (r) r.disabled = !S.hist.redo.length;
    if (info) info.textContent = '可撤销 ' + S.hist.undo.length + ' 步 / 可重做 ' + S.hist.redo.length + ' 步';
    if (sn) {
      sn.textContent = '网格吸附 ' + (S.map.snap ? '开 (10px)' : '关');
      sn.className = 'badge ' + (S.map.snap ? 'badge-ok' : 'badge-mute');
    }
  }
  function activeMap() { return S.data.maps.find(m => m.id === S.data.activeMapId) || S.data.maps[0]; }
  function cfgPath(it) { return it.k.indexOf('.') >= 0 ? it.k : 'config.' + it.k; }
  function normalize(d) {
    (d.maps || []).forEach(m => {
      m.spawns = (m.spawns && m.spawns.length >= 2) ? m.spawns :
        [{ x: Math.round(m.width * .24), y: Math.round(m.height / 2) }, { x: Math.round(m.width * .76), y: Math.round(m.height / 2) }];
      m.obstacles = m.obstacles || []; m.theme = m.theme || {};
    });
    (d.skills || []).forEach(s => { s.mods = s.mods || {}; });
    (d.events || []).forEach(e => { e.effects = e.effects || {}; e.effects.tierMul = e.effects.tierMul || {}; });
    // 外观：有图才保留 skin 字段，避免 9 个职业都写入一份空对象
    (d.classes || []).forEach(c => {
      if (c.skin && c.skin.src) c.skin = SKIN ? SKIN.normalize(c.skin) : c.skin;
      else delete c.skin;
    });
    d.tierWeights = d.tierWeights || clone(DEFAULT.tierWeights);
    // 界面编辑器：清洗覆盖数据（只保留 schema 内的元素与合法字段）
    // 先同步职业列表，新增职业的 card_<id> 图层才不会被当成脏字段清掉
    if (UI && UI.setClasses) UI.setClasses(d.classes);
    d.ui = UI ? UI.normalize(d.ui) : (d.ui || { enabled: true, screens: {} });
    // 商店：补齐默认设置 + 为每个职业保证一条货架数据（旧存档也能直接用）
    d.shop = Object.assign({}, clone(DEFAULT.shop), d.shop || {});
    d.shop.rewards = Object.assign({}, DEFAULT.shop.rewards, d.shop.rewards || {});
    d.shop.starter = Array.isArray(d.shop.starter) ? d.shop.starter : DEFAULT.shop.starter.slice();
    d.shop.pool = Array.isArray(d.shop.pool) ? d.shop.pool : [];
    d.shop.pool = d.shop.pool.filter(p => p && (d.classes || []).some(c => c.id === p.classId));
    (d.classes || []).forEach(c => {
      if (!d.shop.pool.some(p => p.classId === c.id)) {
        d.shop.pool.push({ classId: c.id, rarity: 'common', weight: 10, listed: true });
      }
    });
    return d;
  }

  /* ---------------- 数据装载 / 保存 ---------------- */
  async function detectServer() {
    try {
      const r = await fetch('api/config', { cache: 'no-store' });
      const ct = r.headers.get('content-type') || '';
      if (!r.ok || ct.indexOf('json') < 0) throw new Error('no server');
      const j = await r.json();
      S.serverMode = true;
      if (j && valid(j.data)) S.serverData = j.data;
      $('serverDot').className = 'dot on';
      $('serverStatus').textContent = '本地服务已连接';
    } catch (e) {
      S.serverMode = false;
      $('serverDot').className = 'dot off';
      $('serverStatus').textContent = '浏览器本地模式';
    }
  }

  function loadData() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(KEY)); } catch (e) { d = null; }
    if (valid(d)) S.source = 'local';
    else if (valid(S.serverData)) {
      d = clone(S.serverData); S.source = 'server';
      // 首次从服务端文件载入时同步进浏览器存储，保证游戏页（同域）能读到同一份配置
      writeConfig(JSON.stringify(d));
    }
    else { d = clone(DEFAULT); S.source = 'default'; }
    S.data = normalize(d);
    S.saved = clone(S.data);
    clearDirty();
  }

  /* 浏览器 localStorage 约 10 MiB/站点（约 5.2M 个 UTF-16 字符）。
     旧版快照把含 base64 贴图的完整配置整份复制 10 份，几次发布后就把配额吃满；
     此时上传界面大图再点保存，setItem 会抛 QuotaExceededError：
     保存静默失败，发布会中断在 await 处，连 POST 都不会发出。
     快照因此只存「配置结构」，恢复时素材沿用当前数据（含贴图的完整备份由服务端 data/history 保留）。 */
  const PREVIEW_KEY = 'wowpinball.preview.v1';

  function stripAssets(d) {
    const c = clone(d);
    (c.classes || []).forEach(x => { if (x.skin) delete x.skin.src; });
    if (c.ui && c.ui.screens) Object.keys(c.ui.screens).forEach(sid => {
      const sc = c.ui.screens[sid] || {};
      Object.keys(sc).forEach(k => { if (sc[k]) delete sc[k].img; });
    });
    return c;
  }
  function restoreAssets(snap, cur) {
    const c = clone(snap);
    const curClasses = (cur && cur.classes) || [];
    (c.classes || []).forEach(x => {
      if (!x.skin || x.skin.src) return;
      const m = curClasses.find(y => y.id === x.id);
      if (m && m.skin && m.skin.src) x.skin.src = m.skin.src;
    });
    const curUi = (cur && cur.ui && cur.ui.screens) || {};
    if (c.ui && c.ui.screens) Object.keys(c.ui.screens).forEach(sid => {
      const sc = c.ui.screens[sid] || {}, cs = curUi[sid] || {};
      Object.keys(sc).forEach(k => {
        if (sc[k] && !sc[k].img && cs[k] && cs[k].img) sc[k].img = cs[k].img;
      });
    });
    return c;
  }
  /* 把旧版「整份含贴图」的快照就地瘦身，并清掉预览缓存；历史条目保留，只剥离素材。 */
  function reclaimStorage() {
    let freed = 0;
    try {
      const raw = localStorage.getItem(SNAP_KEY);
      if (raw && raw.length > 200000) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          const slim = JSON.stringify(arr.map(s => s && s.data
            ? Object.assign({}, s, { data: stripAssets(s.data) }) : s));
          localStorage.setItem(SNAP_KEY, slim);
          freed += raw.length - slim.length;
        }
      }
    } catch (e) {
      try { localStorage.removeItem(SNAP_KEY); } catch (e2) { /* 忽略 */ }
    }
    try {
      const pv = localStorage.getItem(PREVIEW_KEY);
      if (pv) { localStorage.removeItem(PREVIEW_KEY); freed += pv.length; }
    } catch (e) { /* 忽略 */ }
    return freed;
  }
  function writeConfig(str) {
    try { localStorage.setItem(KEY, str); return { ok: true, reclaimed: 0 }; }
    catch (e) {
      const freed = reclaimStorage();
      try { localStorage.setItem(KEY, str); return { ok: true, reclaimed: freed }; }
      catch (e2) { return { ok: false, reclaimed: freed }; }
    }
  }
  function pushSnapshot(label) {
    let arr = [];
    try { arr = JSON.parse(localStorage.getItem(SNAP_KEY)) || []; } catch (e) { arr = []; }
    if (!Array.isArray(arr)) arr = [];
    // 旧格式快照顺带瘦身，避免历史数据继续占着配额
    arr = arr.slice(0, 9).map(s => s && s.data
      ? Object.assign({}, s, { data: stripAssets(s.data) }) : s);
    arr.unshift({ label: label, at: new Date().toISOString(), data: stripAssets(S.data) });
    let str = JSON.stringify(arr);
    while (arr.length > 1 && str.length > 900000) { arr.pop(); str = JSON.stringify(arr); }
    try { localStorage.setItem(SNAP_KEY, str); }
    catch (e) {
      try { localStorage.setItem(SNAP_KEY, JSON.stringify(arr.slice(0, 1))); }
      catch (e2) { try { localStorage.removeItem(SNAP_KEY); } catch (e3) { /* 忽略 */ } }
    }
  }

  async function saveToLocal(silent) {
    const v = validate(S.data);
    if (v.errors.length) { toast('存在 ' + v.errors.length + ' 个错误，请先修复', 'bad'); return false; }
    const str = JSON.stringify(S.data);
    const w = writeConfig(str);
    if (!w.ok) {
      toast('保存失败：浏览器存储空间不足（配置 ' + (str.length / 1048576).toFixed(1) +
        ' MB）。请移除几张已上传的大素材，或导出 JSON 备份后清理站点数据', 'bad');
      return false;
    }
    S.saved = clone(S.data);
    clearDirty();
    if (!silent) toast(w.reclaimed
      ? '已保存到浏览器（自动清理旧快照缓存释放空间），游戏刷新后生效'
      : '已保存到浏览器，游戏刷新后生效', 'ok');
    return true;
  }

  async function publish() {
    const v = validate(S.data);
    if (v.errors.length) { toast('发布中止：存在 ' + v.errors.length + ' 个数据错误', 'bad'); switchTab('release'); return; }
    pushSnapshot('发布前快照');
    S.data.meta.updatedAt = new Date().toISOString().slice(0, 10);
    // 本地存储满也不能阻断落盘：以前这里抛异常会直接跳过 fetch
    const localOk = await saveToLocal(true);
    if (S.serverMode) {
      try {
        const r = await fetch('api/config', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(S.data)
        });
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || '写入失败');
        toast(localOk ? '已发布：配置写入 data/game-config.json'
          : '已发布到 data/game-config.json；但浏览器存储不足，游戏页请移除了大素材后再点「保存」',
          localOk ? 'ok' : 'bad');
      } catch (e) { toast('服务端写入失败：' + e.message, 'bad'); }
    } else {
      toast(localOk ? '已保存到浏览器。启动 node server.js 后可落盘到文件'
        : '保存失败：浏览器存储空间不足，请减小已上传的素材', localOk ? 'ok' : 'bad');
    }
    refresh();
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(S.data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'wowpinball-config-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('配置已导出', 'ok');
  }

  function importJson(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = JSON.parse(reader.result);
        if (!valid(d)) throw new Error('结构或 schema 版本不匹配');
        S.data = normalize(d);
        S.map.id = S.data.activeMapId;
        S.map.sel = null;
        resetHistory();
        markDirty();
        refresh();
        toast('导入成功，记得保存或发布', 'ok');
      } catch (e) { toast('导入失败：' + e.message, 'bad'); }
    };
    reader.readAsText(file);
  }

  /* ---------------- 校验 ---------------- */
  function validate(d) {
    const errors = [], warnings = [], oks = [];
    const err = t => errors.push({ text: t }), warn = t => warnings.push({ text: t });
    const isColor = c => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);
    const ids = arr => arr.map(x => x.id);

    // 职业
    const cIds = ids(d.classes);
    if (!d.classes.length) err('至少需要一个职业');
    if (new Set(cIds).size !== cIds.length) err('职业 id 存在重复');
    d.classes.forEach(c => {
      if (!c.id || !c.name) err('职业存在空 id 或空名称');
      if (!isColor(c.color)) err('职业「' + esc(c.name) + '」颜色不是 #RRGGBB');
      if (c.skin && c.skin.src) {
        if (c.skin.src.indexOf('data:image/png;base64,') !== 0) err('职业「' + esc(c.name) + '」外观图片不是内嵌 PNG');
        if (c.skin.src.length > 1200000) warn('职业「' + esc(c.name) + '」外观图片较大，建议压缩后再发布');
      }
      ['hp', 'power', 'mass', 'radius', 'speed'].forEach(k => {
        if (!(Number(c[k]) > 0)) err('职业「' + esc(c.name) + '」的 ' + k + ' 必须大于 0');
      });
    });
    if (!d.classes.some(c => c.enabled !== false)) err('至少需要启用一个职业');
    try {
      const bytes = JSON.stringify(d).length;
      if (bytes > 3.5 * 1024 * 1024) warn('配置体积 ' + (bytes / 1048576).toFixed(1) + ' MB，接近浏览器存储上限，建议减少外观图片数量或尺寸');
    } catch (e) { /* 序列化失败由后续保存流程处理 */ }

    // 技能
    const sIds = ids(d.skills);
    if (!d.skills.length) err('至少需要一个技能');
    if (new Set(sIds).size !== sIds.length) err('技能 id 存在重复');
    d.skills.forEach(s => {
      if (!s.id || !s.name) err('技能存在空 id 或空名称');
      if (!TIERS[s.tier]) err('技能「' + esc(s.name) + '」稀有度非法');
      if (s.cls && cIds.indexOf(s.cls) < 0) err('技能「' + esc(s.name) + '」引用了不存在的职业 ' + esc(s.cls));
      Object.keys(s.mods || {}).forEach(k => {
        if (!MOD_META.some(m => m.k === k)) err('技能「' + esc(s.name) + '」含未知效果 ' + k);
        if (!isFinite(s.mods[k])) err('技能「' + esc(s.name) + '」效果 ' + k + ' 不是数字');
      });
      if (!describeMods(s.mods) || describeMods(s.mods) === '无效果') warn('技能「' + esc(s.name) + '」没有任何效果');
    });
    if (!d.skills.some(s => s.enabled !== false)) err('至少需要启用一个技能');
    const need = (d.config.draftOptions || 3) * (d.config.totalRounds || 3);
    if (d.skills.filter(s => s.enabled !== false).length < need) {
      warn('启用技能数少于「每次备选数 × 回合数」，后期抽卡可能不足');
    }
    d.classes.forEach(c => {
      const pool = d.skills.filter(s => s.enabled !== false && (!s.cls || s.cls === c.id));
      if (pool.length < (d.config.draftOptions || 3)) warn('职业「' + esc(c.name) + '」可选技能少于 ' + (d.config.draftOptions || 3) + ' 个');
    });

    // 数值
    const c = d.config;
    if (!(c.roundSeconds > 0)) err('每回合时长必须大于 0');
    if (!(c.totalRounds >= 1)) err('总回合数至少为 1');
    if (!(c.dmgBase >= 0 && c.dmgSpeed >= 0)) err('伤害系数不能为负');
    if (!(c.drawWindow >= 0 && c.drawWindow < 1)) err('平局窗口需在 0 ~ 1 之间');
    if (!(c.draftOptions >= 1)) err('备选技能数至少为 1');
    if (!c.speeds || !c.speeds.length) err('倍速列表不能为空');
    ['common', 'rare', 'epic'].forEach(t => {
      if (!d.tierWeights || !(d.tierWeights[t] > 0)) warn('稀有度 ' + TIERS[t] + ' 权重为 0，将不会被抽到');
    });

    // 地图
    if (!d.maps.length) err('至少需要一个地图');
    if (new Set(ids(d.maps)).size !== ids(d.maps).length) err('地图 id 存在重复');
    const active = d.maps.find(m => m.id === d.activeMapId);
    if (!active) err('主地图 activeMapId 指向不存在的地图');
    if (active && active.enabled === false) err('主地图当前被禁用');
    if (!d.maps.some(m => m.enabled !== false)) err('至少需要启用一个地图');
    d.maps.forEach(m => {
      if (!(m.width > 0 && m.height > 0)) err('地图「' + esc(m.name) + '」宽高非法');
      if (!m.spawns || m.spawns.length < 2) err('地图「' + esc(m.name) + '」缺少两个出生点');
      (m.spawns || []).forEach((p, i) => {
        if (p.x < 0 || p.x > m.width || p.y < 0 || p.y > m.height) warn('地图「' + esc(m.name) + '」出生点 ' + (i + 1) + ' 在场地外');
      });
      (m.obstacles || []).forEach(ob => {
        if (ob.type === 'circle' && !(ob.r > 0)) err('地图「' + esc(m.name) + '」圆形障碍半径非法');
        if (ob.type !== 'circle' && !(ob.w > 0 && ob.h > 0)) err('地图「' + esc(m.name) + '」矩形障碍尺寸非法');
      });
      if (m.theme) Object.keys(m.theme).forEach(k => { if (!isColor(m.theme[k])) err('地图「' + esc(m.name) + '」主题色 ' + k + ' 非法'); });
    });

    // 活动
    if (new Set(ids(d.events)).size !== ids(d.events).length) err('活动 id 存在重复');
    d.events.forEach(ev => {
      if (!ev.id || !ev.name) err('活动存在空 id 或空名称');
      if (ev.start && ev.end && ev.start > ev.end) err('活动「' + esc(ev.name) + '」开始日期晚于结束日期');
      const f = ev.effects || {};
      if (!(f.dmgScale > 0) || !(f.hpScale > 0)) err('活动「' + esc(ev.name) + '」倍率必须大于 0');
      (f.skillBan || []).concat(f.skillBoost || []).forEach(id => {
        if (sIds.indexOf(id) < 0) warn('活动「' + esc(ev.name) + '」引用了不存在的技能 ' + esc(id));
      });
    });

    // 商店
    const sh = d.shop;
    if (sh) {
      if (!(sh.drawCost > 0)) err('商店单抽价格必须大于 0');
      if (!(sh.duplicateRefund >= 0)) err('商店重复返还不能为负');
      if (sh.initialCoins != null && !(sh.initialCoins >= 0)) err('商店初始赠送不能为负');
      const poolIds = (sh.pool || []).map(p => p && p.classId);
      if (new Set(poolIds).size !== poolIds.length) err('商店卡池存在重复的弹珠');
      (sh.pool || []).forEach(p => {
        if (!p) return;
        if (cIds.indexOf(p.classId) < 0) warn('商店卡池引用了不存在的弹珠 ' + esc(p.classId));
        if (!(p.weight >= 0)) err('商店卡池「' + esc(p.classId) + '」权重不能为负');
      });
      (sh.starter || []).forEach(id => {
        if (cIds.indexOf(id) < 0) warn('商店「初始解锁」引用了不存在的弹珠 ' + esc(id));
      });
      if (sh.enabled !== false && !(sh.pool || []).some(p => p && p.listed !== false && p.weight > 0)) {
        warn('商店已启用但卡池没有上架弹珠，玩家无法抽取');
      }
    }

    // 界面编辑器：素材格式与总体积
    if (d.ui && d.ui.screens) {
      let uiBytes = 0, uiImgs = 0;
      Object.keys(d.ui.screens).forEach(sid => {
        const sc = d.ui.screens[sid] || {};
        Object.keys(sc).forEach(k => {
          const p = sc[k] || {};
          if (p.img) {
            uiImgs++; uiBytes += p.img.length;
            if (p.img.indexOf('data:image/png;base64,') !== 0) err('界面「' + sid + ' / ' + k + '」的素材不是内嵌 PNG');
            if (p.img.length > 1600000) warn('界面「' + sid + ' / ' + k + '」素材偏大，可能影响配置加载速度');
          }
        });
      });
      if (uiImgs) oks.push({ text: '界面素材 ' + uiImgs + ' 张，合计约 ' + (uiBytes * 0.75 / 1024 / 1024).toFixed(2) + ' MB' });
      if (uiBytes > 4200000) warn('界面素材总体积较大，建议压缩后再发布');
    }

    if (!errors.length) oks.push({ text: '结构、引用与数值范围检查全部通过' });
    return { errors: errors, warnings: warnings, oks: oks };
  }

  function activeEvents() {
    const d = new Date(); const p = n => (n < 10 ? '0' : '') + n;
    const today = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    return (S.data.events || []).filter(ev => {
      if (ev.enabled === false) return false;
      if (ev.alwaysOn) return true;
      return (!ev.start || today >= ev.start) && (!ev.end || today <= ev.end);
    });
  }
  function mergedEffects() {
    const eff = { dmgScale: 1, hpScale: 1, tierMul: { common: 1, rare: 1, epic: 1 }, extraDraft: 0, ban: 0, boost: 0 };
    activeEvents().forEach(ev => {
      const f = ev.effects || {};
      eff.dmgScale *= f.dmgScale == null ? 1 : f.dmgScale;
      eff.hpScale *= f.hpScale == null ? 1 : f.hpScale;
      ['common', 'rare', 'epic'].forEach(t => { if (f.tierMul && f.tierMul[t]) eff.tierMul[t] *= f.tierMul[t]; });
      eff.extraDraft += f.extraDraft || 0;
      eff.ban += (f.skillBan || []).length;
      eff.boost += (f.skillBoost || []).length;
    });
    return eff;
  }
  function describeEffects(ev) {
    const f = ev.effects || {}, out = [];
    if (f.dmgScale && f.dmgScale !== 1) out.push('伤害 x' + f.dmgScale);
    if (f.hpScale && f.hpScale !== 1) out.push('生命 x' + f.hpScale);
    if (f.tierMul) ['common', 'rare', 'epic'].forEach(t => { if (f.tierMul[t] && f.tierMul[t] !== 1) out.push(TIERS[t] + '权重 x' + f.tierMul[t]); });
    if (f.extraDraft) out.push('备选 +' + f.extraDraft);
    if ((f.skillBan || []).length) out.push('禁用 ' + f.skillBan.length + ' 个技能');
    if ((f.skillBoost || []).length) out.push('精选 ' + f.skillBoost.length + ' 个技能');
    return out.length ? out.join(' / ') : '无额外效果';
  }

  /* ---------------- 通用片段 ---------------- */
  function numRow(id, label, value, min, max, step, hint) {
    return '<div class="field"><label>' + esc(label) + '</label><div class="num-row">' +
      '<input type="range" data-num="' + id + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + value + '">' +
      '<input class="input num" id="' + id + '" type="number" min="' + min + '" max="' + max + '" step="' + step + '" value="' + value + '">' +
      '</div>' + (hint ? '<div class="hint">' + esc(hint) + '</div>' : '') + '</div>';
  }
  function bindNumRows(root) {
    (root || document).querySelectorAll('[data-num]').forEach(r => {
      const t = document.getElementById(r.dataset.num);
      if (!t) return;
      const sync = v => {
        const item = r.closest('.mod-item');
        if (item) item.classList.toggle('on', Number(v) !== 0);
      };
      r.addEventListener('input', () => {
        t.value = r.value; sync(r.value);
        t.dispatchEvent(new Event('input', { bubbles: true }));
      });
      t.addEventListener('input', () => { r.value = t.value; sync(t.value); });
    });
  }
  function openDrawer(title, body, onSave) {
    $('drawerTitle').textContent = title;
    $('drawerBody').innerHTML = body;
    S.drawerSave = onSave;
    $('drawer').hidden = false;
    bindNumRows($('drawerBody'));
    const ci = $('cf_color'), ct = $('cf_colorText');
    if (ci && ct) {
      ci.addEventListener('input', () => { ct.value = ci.value; });
      ct.addEventListener('input', () => { if (/^#[0-9a-fA-F]{6}$/.test(ct.value)) ci.value = ct.value; });
    }
  }
  function closeDrawer() { $('drawer').hidden = true; S.drawerSave = null; }

  function cardHead(title, sub, actions) {
    return '<div class="card-head"><div><h2>' + esc(title) + '</h2>' + (sub ? '<p>' + esc(sub) + '</p>' : '') + '</div>' +
      '<div class="actions">' + (actions || '') + '</div></div>';
  }

  /* ---------------- 页签渲染 ---------------- */
  function switchTab(name) {
    S.tab = name;
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    refresh();
  }
  function refresh() {
    $('pageTitle').textContent = TAB_INFO[S.tab][0];
    $('pageSub').textContent = TAB_INFO[S.tab][1];
    $('navCountClasses').textContent = S.data.classes.filter(c => c.enabled !== false).length;
    $('navCountSkills').textContent = S.data.skills.filter(s => s.enabled !== false).length;
    $('navCountMaps').textContent = S.data.maps.length;
    $('navCountEvents').textContent = activeEvents().length;
    $('navCountSkins').textContent = S.data.classes.filter(c => SKIN && SKIN.hasSkin(c.skin)).length;
    const R = { dashboard: renderDashboard, classes: renderClasses, skins: renderSkins, skills: renderSkills, balance: renderBalance, maps: renderMaps, events: renderEvents, shop: renderShop, studio: renderStudio, ui: renderUiEditor, release: renderRelease };
    $('content').innerHTML = R[S.tab]();
    bindNumRows($('content'));
    paintAdminOrbs();
    if (S.tab === 'maps') { initMapEditor(); updateHistoryUI(); paintSliders(); }
    if (S.tab === 'studio') initStudio();
    if (S.tab === 'skins') initSkins();
    if (S.tab === 'ui') initUiEditor();
    if (S.tab === 'balance' && S.sim.result) renderSimResult();
  }

  // 职业卡上的小弹珠：与游戏端、外观页共用同一套渲染
  function paintAdminOrbs() {
    if (!SKIN) return;
    document.querySelectorAll('#content canvas[data-orb]').forEach(cv => {
      const c = S.data.classes.find(x => x.id === cv.dataset.orb);
      if (!c) return;
      SKIN.paintThumb(cv, c.color, c.skin, c.name.charAt(0), 26);
      if (SKIN.hasSkin(c.skin)) {
        const rec = SKIN.image(c.skin.src);
        if (rec && !rec.ready && !rec.failed) SKIN.ready(c.skin.src, paintAdminOrbs);
      }
    });
  }

  function renderDashboard() {
    const v = validate(S.data), evs = activeEvents(), mp = activeMap(), eff = mergedEffects();
    const health = v.errors.length ? '<span class="badge badge-bad">' + v.errors.length + ' 个错误</span>' :
      (v.warnings.length ? '<span class="badge badge-warn">' + v.warnings.length + ' 条提醒</span>' : '<span class="badge badge-ok">健康</span>');
    return '<div class="grid grid-4">' +
      statCard('启用职业', S.data.classes.filter(c => c.enabled !== false).length, '共 ' + S.data.classes.length + ' 个', 'accent') +
      statCard('启用技能', S.data.skills.filter(s => s.enabled !== false).length, '共 ' + S.data.skills.length + ' 个', 'blue') +
      statCard('竞技地图', S.data.maps.length, '当前：' + (mp ? mp.name : '无'), 'green') +
      statCard('生效活动', evs.length, '共 ' + S.data.events.length + ' 个活动', 'purple') +
      '</div>' +

      '<div class="grid grid-2 section-gap">' +
      '<div class="card">' + cardHead('数据健康', '发布前会自动校验', health) +
      '<div class="check-list">' +
      (v.errors.length ? v.errors.slice(0, 4).map(e => '<div class="check-item err"><span class="cdot"></span><span>' + e.text + '</span></div>').join('') : '') +
      (v.warnings.length ? v.warnings.slice(0, 3).map(e => '<div class="check-item warn"><span class="cdot"></span><span>' + e.text + '</span></div>').join('') : '') +
      (!v.errors.length && !v.warnings.length ? '<div class="check-item ok"><span class="cdot"></span><span>结构、引用与数值范围检查全部通过</span></div>' : '') +
      '</div><div class="divider"></div>' +
      '<div class="row" style="justify-content:space-between"><span class="muted">当前主地图</span><strong>' + esc(mp ? mp.name : '未设置') + '</strong></div>' +
      '<div class="row" style="justify-content:space-between;margin-top:8px"><span class="muted">全局伤害 / 生命</span><strong>x' + n2(eff.dmgScale) + ' / x' + n2(eff.hpScale) + '</strong></div>' +
      '<div class="row" style="justify-content:space-between;margin-top:8px"><span class="muted">每次备选技能</span><strong>' + (S.data.config.draftOptions + eff.extraDraft) + ' 个</strong></div>' +
      '</div>' +

      '<div class="card">' + cardHead('当前生效活动', '按今天日期与「忽略日期」开关判定') +
      (evs.length ? evs.map(ev => '<div class="check-item ok" style="margin-bottom:7px"><span class="cdot"></span><span><strong>' + esc(ev.name) + '</strong><br><span class="faint">' + esc(describeEffects(ev)) + '</span></span></div>').join('')
        : '<div class="faint" style="padding:14px 0">当前没有生效的活动。可在「活动事件」中启用，或勾选「忽略日期」强制生效。</div>') +
      '<div class="divider"></div>' +
      '<div class="row" style="justify-content:space-between"><span class="muted">配置来源</span><span class="badge badge-mute">' +
      (S.source === 'local' ? '浏览器本地' : S.source === 'server' ? '服务端文件' : '内置默认') + '</span></div>' +
      '<div class="row" style="justify-content:space-between;margin-top:8px"><span class="muted">最近更新</span><span>' + esc(S.data.meta.updatedAt || '—') + '</span></div>' +
      '<div class="row" style="justify-content:space-between;margin-top:8px"><span class="muted">服务状态</span><span>' + (S.serverMode ? '已连接（可落盘）' : '未启动（仅本地）') + '</span></div>' +
      '</div></div>' +

      '<div class="card section-gap">' + cardHead('快捷入口', '点模块名直接跳转') +
      '<div class="grid grid-3">' +
      [['classes', '职业管理', '增改职业与五维数值'], ['skins', '弹珠外观', '上传 PNG 并可视化微调贴图'],
       ['skills', '技能管理', '编辑 19 种效果与稀有度'],
       ['balance', '数值平衡', '改公式并批量试算'], ['maps', '地图编辑器', '拖拽障碍与出生点'],
       ['events', '活动事件', '限时倍率与技能池干预'], ['release', '校验与发布', '校验、快照、导入导出']]
        .map(([t, n, d]) => '<button type="button" class="stat" data-act="goto" data-id="' + t + '" style="text-align:left;cursor:pointer">' +
          '<div class="k" style="color:var(--accent-2);font-size:12.5px">' + n + '</div><div class="d" style="margin-top:7px">' + d + '</div></button>').join('') +
      '</div></div>';
  }
  function statCard(k, v, d, cls) {
    return '<div class="stat"><div class="k">' + k + '</div><div class="v ' + (cls || '') + '">' + v + '</div><div class="d">' + esc(d) + '</div></div>';
  }

  /* ---------------- 职业 ---------------- */
  function renderClasses() {
    const q = S.filters.classQ.toLowerCase();
    const list = S.data.classes.filter(c => (S.filters.showDisabled || c.enabled !== false) &&
      (!q || (c.name + c.id + c.role).toLowerCase().indexOf(q) >= 0));
    const max = {
      hp: Math.max(1, ...S.data.classes.map(c => c.hp)), power: Math.max(.01, ...S.data.classes.map(c => c.power)),
      mass: Math.max(.01, ...S.data.classes.map(c => c.mass)), radius: Math.max(1, ...S.data.classes.map(c => c.radius)),
      speed: Math.max(.01, ...S.data.classes.map(c => c.speed))
    };
    const tools = '<div class="tools">' +
      '<input class="input" style="width:220px" placeholder="搜索职业名称 / id" value="' + esc(S.filters.classQ) + '" data-input="classQ">' +
      '<label class="switch"><input type="checkbox" data-change="showDisabled" ' + (S.filters.showDisabled ? 'checked' : '') + '><i></i>显示禁用</label>' +
      '<span class="spacer"></span><span class="faint">共 ' + list.length + ' 个</span>' +
      '<button class="primary-btn" data-act="class-new" type="button">新增职业</button></div>';
    const cards = list.length ? list.map(c => {
      const bars = [['生命', c.hp / max.hp], ['力量', c.power / max.power], ['质量', c.mass / max.mass], ['体积', c.radius / max.radius], ['速度', c.speed / max.speed]]
        .map(([l, v]) => '<div class="cc-stat"><label>' + l + '</label><div class="bar"><i style="width:' + Math.round(clamp(v, 0, 1) * 100) + '%"></i></div></div>').join('');
      return '<div class="class-card ' + (c.enabled === false ? 'disabled' : '') + '" style="--cc:' + esc(c.color) + '">' +
        '<div class="cc-head"><canvas class="cc-orb" data-orb="' + esc(c.id) + '"></canvas><span class="cc-name">' + esc(c.name) + '</span><span class="cc-id">' + esc(c.id) + '</span></div>' +
        '<div class="cc-role">' + esc(c.role) + '</div><div class="cc-trait">' + esc(c.trait) + '</div>' +
        '<div class="cc-stats">' + bars + '</div>' +
        '<div class="cc-foot">' +
        (c.enabled === false ? '<span class="badge badge-mute">已禁用</span>' : '<span class="badge badge-ok">已启用</span>') +
        '<span class="spacer"></span>' +
        '<button class="mini-btn" data-act="class-edit" data-id="' + esc(c.id) + '" type="button">编辑</button>' +
        '<button class="mini-btn" data-act="class-copy" data-id="' + esc(c.id) + '" type="button">复制</button>' +
        '<button class="mini-btn danger" data-act="class-del" data-id="' + esc(c.id) + '" type="button">删除</button>' +
        '</div></div>';
    }).join('') : '<div class="table-empty">没有匹配的职业</div>';
    return '<div class="card">' + cardHead('职业列表', '颜色、五维数值与启用状态都可编辑，改动在保存后进入游戏') + tools +
      '<div class="grid grid-3">' + cards + '</div></div>';
  }

  function classForm(c) {
    const isNew = !c;
    const o = c || { id: '', name: '', color: '#88AACC', role: '新职业', trait: '', hp: 120, power: 1, mass: 1, radius: 21, speed: 1, enabled: true };
    const f = (id, label, v, type, extra) => '<div class="field"><label>' + label + '</label><input class="input" id="' + id + '" type="' + (type || 'text') + '" value="' + esc(v) + '" ' + (extra || '') + '></div>';
    return (isNew ? f('cf_id', '职业 id（英文，保存后不可改）', o.id) : '<div class="field"><label>职业 id</label><input class="input" value="' + esc(o.id) + '" disabled></div>') +
      f('cf_name', '职业名称', o.name) +
      '<div class="field"><label>职业色</label><div class="color-row"><input type="color" id="cf_color" value="' + esc(o.color) + '"><input class="input" id="cf_colorText" value="' + esc(o.color) + '"></div><div class="hint">用于弹珠光晕、HUD 与职业卡</div></div>' +
      f('cf_role', '定位标签', o.role) +
      '<div class="field"><label>特性描述</label><textarea class="textarea" id="cf_trait">' + esc(o.trait) + '</textarea></div>' +
      '<div class="sub-title">基础数值</div>' +
      numRow('cf_hp', '生命', o.hp, 40, 500, 1) +
      numRow('cf_power', '力量（伤害系数）', o.power, 0.2, 3, 0.01) +
      numRow('cf_mass', '质量（碰撞动量）', o.mass, 0.3, 3, 0.01) +
      numRow('cf_radius', '半径（碰撞体积）', o.radius, 10, 45, 1) +
      numRow('cf_speed', '速度系数', o.speed, 0.4, 2.5, 0.01) +
      '<label class="switch"><input type="checkbox" id="cf_enabled" ' + (o.enabled !== false ? 'checked' : '') + '><i></i>启用该职业</label>';
  }
  function saveClassForm(id) {
    const isNew = !id;
    const cid = isNew ? val('cf_id').trim() : id;
    if (!cid) { toast('请填写职业 id', 'bad'); return false; }
    if (!val('cf_name').trim()) { toast('请填写职业名称', 'bad'); return false; }
    if (isNew && S.data.classes.some(c => c.id === cid)) { toast('职业 id 已存在', 'bad'); return false; }
    const o = {
      id: cid, name: val('cf_name').trim(), color: val('cf_colorText').trim() || val('cf_color'),
      role: val('cf_role').trim(), trait: val('cf_trait').trim(),
      hp: numv('cf_hp', 120), power: numv('cf_power', 1), mass: numv('cf_mass', 1),
      radius: numv('cf_radius', 21), speed: numv('cf_speed', 1), enabled: chk('cf_enabled')
    };
    // 外观贴图不在职业表单里，编辑其它字段时必须原样保留
    const prev = isNew ? null : S.data.classes.find(x => x.id === id);
    if (prev && prev.skin) o.skin = clone(prev.skin);
    if (isNew) { S.data.classes.push(o); shopMeta(o.id); }
    else S.data.classes[S.data.classes.findIndex(c => c.id === id)] = o;
    markDirty(); refresh(); toast('职业已' + (isNew ? '新增' : '更新'), 'ok');
    return true;
  }

  /* ---------------- 弹珠外观（可视化贴图替换） ---------------- */
  function skinOf(c) {
    if (!c.skin || !c.skin.src) c.skin = SKIN.defaults();
    return c.skin;
  }
  function currentSkinClass() {
    if (!S.skin.sel || !S.data.classes.some(c => c.id === S.skin.sel)) {
      S.skin.sel = S.data.classes.length ? S.data.classes[0].id : null;
    }
    return S.data.classes.find(c => c.id === S.skin.sel) || null;
  }
  function skinMetaHtml(c, s) {
    if (!c) return '当前没有可编辑的职业';
    if (!s || !s.src) return '当前：<strong>' + esc(c.name) + '</strong> · 默认玻璃弹珠，尚未上传图片';
    const kb = (s.src.length * 0.75 / 1024).toFixed(1);
    return '当前：<strong>' + esc(c.name) + '</strong> · 已替换贴图 · 原图 ' + (s.w || '?') + ' × ' + (s.h || '?') +
      ' px · 内嵌约 ' + kb + ' KB';
  }
  function renderSkins() {
    if (!SKIN) return '<div class="card">共用渲染脚本 skin-render.js 未加载，请刷新页面重试</div>';
    const c = currentSkinClass(), s = c ? skinOf(c) : SKIN.defaults();
    const replaced = S.data.classes.filter(x => SKIN.hasSkin(x.skin)).length;
    const gallery = S.data.classes.map(x => {
      const on = SKIN.hasSkin(x.skin), sel = c && c.id === x.id;
      return '<button type="button" class="skin-item' + (sel ? ' selected' : '') + '" data-act="skin-select" data-id="' + esc(x.id) + '">' +
        '<canvas class="skin-thumb" data-skin-orb="' + esc(x.id) + '"></canvas>' +
        '<span class="skin-nm">' + esc(x.name) + '</span>' +
        '<span class="skin-tag' + (on ? ' on' : '') + '">' + (on ? '已替换' : '默认外观') + '</span></button>';
    }).join('');
    return '<div class="card">' + cardHead('弹珠外观', '上传本地 PNG 替换贴图，参数实时可视化；保存或发布后游戏刷新即生效') +
      '<div class="skin-topbar"><span class="faint">已替换 <strong>' + replaced + '</strong> / ' + S.data.classes.length +
        ' 颗 · 点左侧弹珠切换编辑对象</span><span class="spacer"></span>' +
        '<button class="ghost-btn" type="button" data-act="skin-open-game">保存并在游戏中查看</button></div>' +
      '<div class="skin-layout">' +
        '<div class="skin-gallery">' + gallery + '</div>' +
        '<div class="skin-editor">' +
          '<div id="skinDrop" class="skin-drop">' +
            '<canvas id="skinPreview" width="1040" height="560"></canvas>' +
            '<div class="skin-drop-hint">把 PNG 图片拖到这里上传</div>' +
          '</div>' +
          '<div class="skin-real-row"><canvas id="skinReal" width="440" height="150"></canvas>' +
            '<div class="skin-real-txt"><strong>实战尺寸对照</strong><span>左：替换后　右：默认外观<br>按半径 ' + (c ? c.radius : 21) + ' px 绘制，与竞技场一致</span></div></div>' +
          '<div class="skin-file-row">' +
            '<label class="primary-btn skin-file-btn">上传 PNG 图片<input type="file" id="skinFile" accept="image/png,.png" hidden></label>' +
            '<button class="ghost-btn" type="button" data-act="skin-reset">重置参数</button>' +
            '<button class="ghost-btn" type="button" data-act="skin-remove">移除图片</button>' +
          '</div>' +
          '<div id="skinMeta" class="skin-meta">' + skinMetaHtml(c, s) + '</div>' +
          '<div class="sub-title">外观微调</div>' +
          '<div class="skin-controls">' +
          numRow('sk_scale', '图片缩放', s.scale, 0.3, 3, 0.01, '1.00 = 图片长边贴合弹珠直径') +
          numRow('sk_offsetX', '水平偏移（% 半径）', s.offsetX, -100, 100, 1) +
          numRow('sk_offsetY', '垂直偏移（% 半径）', s.offsetY, -100, 100, 1) +
          numRow('sk_rotation', '旋转（度）', s.rotation, -180, 180, 1) +
          numRow('sk_opacity', '不透明度', s.opacity, 0.1, 1, 0.01) +
          '</div>' +
          '<div class="skin-switches">' +
            '<label class="switch"><input type="checkbox" id="sk_gloss" data-change="skin-gloss" ' + (s.gloss ? 'checked' : '') + '><i></i>保留玻璃高光</label>' +
            '<label class="switch"><input type="checkbox" id="sk_label" data-change="skin-label" ' + (s.label ? 'checked' : '') + '><i></i>显示职业首字</label>' +
          '</div>' +
          '<div class="hint">图片自动等比缩到最长边 256 px 内并内嵌进配置；透明处透出职业底色。职业卡与实战画面使用同一套渲染参数。</div>' +
        '</div>' +
      '</div></div>';
  }

  // canvas 统一按 2 倍分辨率绘制，逻辑坐标保持整数好对齐
  function skinCtx(cv, w, h) {
    if (cv.width !== w * 2 || cv.height !== h * 2) { cv.width = w * 2; cv.height = h * 2; }
    const c = cv.getContext('2d');
    c.setTransform(2, 0, 0, 2, 0, 0);
    c.clearRect(0, 0, w, h);
    return c;
  }
  function paintSkinGallery() {
    if (!SKIN) return;
    document.querySelectorAll('canvas[data-skin-orb]').forEach(cv => {
      const c = S.data.classes.find(x => x.id === cv.dataset.skinOrb);
      if (!c) return;
      SKIN.paintThumb(cv, c.color, c.skin, c.name.charAt(0), 64);
      if (SKIN.hasSkin(c.skin)) {
        const rec = SKIN.image(c.skin.src);
        if (rec && !rec.ready && !rec.failed) SKIN.ready(c.skin.src, paintSkinGallery);
      }
    });
  }
  function paintSkinReal() {
    const cv = $('skinReal'); if (!cv || !SKIN) return;
    const c = skinCtx(cv, 220, 75);
    c.fillStyle = '#0b0e14'; c.fillRect(0, 0, 220, 75);
    c.strokeStyle = '#212b3b'; c.beginPath(); c.moveTo(110, 4); c.lineTo(110, 71); c.stroke();
    const cls = currentSkinClass(); if (!cls) return;
    const r = Number(cls.radius) || 21;
    SKIN.paint(c, 52, 35, r, cls.color, skinOf(cls), cls.name.charAt(0), { glow: true });
    SKIN.paint(c, 168, 35, r, cls.color, null, cls.name.charAt(0), { glow: true });
    c.fillStyle = '#66748a'; c.font = '10px "Segoe UI","PingFang SC",sans-serif'; c.textAlign = 'center';
    c.fillText('替换后', 52, 68); c.fillText('默认外观', 168, 68);
  }
  function paintSkinPreview() {
    const cv = $('skinPreview'); if (!cv || !SKIN) return;
    const c = skinCtx(cv, 520, 280);
    c.fillStyle = '#0f1621'; c.fillRect(0, 0, 520, 280);
    for (let y = 0; y < 280; y += 20) {
      for (let x = 0; x < 520; x += 20) {
        if ((x / 20 + y / 20) % 2) { c.fillStyle = '#141d2b'; c.fillRect(x, y, 20, 20); }
      }
    }
    c.strokeStyle = 'rgba(255,255,255,0.05)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(260, 0); c.lineTo(260, 280); c.moveTo(0, 150); c.lineTo(520, 150); c.stroke();
    const cls = currentSkinClass(); if (!cls) return;
    const s = skinOf(cls), R = 96;
    SKIN.paint(c, 260, 150, R, cls.color, s, cls.name.charAt(0), { glow: true });
    c.beginPath(); c.arc(260, 150, R, 0, Math.PI * 2);
    c.setLineDash([5, 5]); c.strokeStyle = 'rgba(217,164,65,0.5)'; c.lineWidth = 1; c.stroke(); c.setLineDash([]);
    c.textAlign = 'center'; c.fillStyle = '#9aa7bb';
    c.font = '11px "Segoe UI","PingFang SC",sans-serif';
    c.fillText('放大预览 · 实际半径 ' + (Number(cls.radius) || 21) + ' px', 260, 18);
    const rec = s.src ? SKIN.image(s.src) : null;
    if (!s.src) c.fillText('尚未上传图片 · 当前为默认玻璃弹珠', 260, 268);
    else if (rec && !rec.ready && !rec.failed) c.fillText('图片解码中…', 260, 268);
    else if (rec && rec.failed) { c.fillStyle = '#e08b93'; c.fillText('图片无法解码，请重新上传 PNG', 260, 268); }
    paintSkinReal();
  }
  function repaintSkin() { paintSkinPreview(); paintSkinGallery(); }
  function applySkinForm() {
    const cls = currentSkinClass(); if (!cls) return;
    const s = skinOf(cls);
    s.scale = clamp(numv('sk_scale', s.scale), 0.3, 3);
    s.offsetX = clamp(numv('sk_offsetX', s.offsetX), -100, 100);
    s.offsetY = clamp(numv('sk_offsetY', s.offsetY), -100, 100);
    s.rotation = clamp(numv('sk_rotation', s.rotation), -180, 180);
    s.opacity = clamp(numv('sk_opacity', s.opacity), 0.1, 1);
    s.gloss = chk('sk_gloss'); s.label = chk('sk_label');
    const meta = $('skinMeta'); if (meta) meta.innerHTML = skinMetaHtml(cls, s);
    repaintSkin();
    markDirty('skin:' + cls.id);
  }
  function initSkins() {
    if (!SKIN) return;
    const fi = $('skinFile');
    if (fi) fi.addEventListener('change', e => {
      const f = e.target.files && e.target.files[0];
      if (f) skinLoadFile(f);
      e.target.value = '';
    });
    const dz = $('skinDrop');
    if (dz) {
      dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag'); });
      dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
      dz.addEventListener('drop', e => {
        e.preventDefault(); dz.classList.remove('drag');
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) skinLoadFile(f);
      });
    }
    const cls = currentSkinClass();
    if (cls && SKIN.hasSkin(cls.skin)) SKIN.ready(cls.skin.src, repaintSkin);
    repaintSkin();
  }
  // 本地 PNG → 等比缩到最长边 256 px → 内嵌 dataURL（配置里不依赖外部文件）
  function skinLoadFile(file) {
    if (!/\.png$/i.test(file.name) && !/image\/png/i.test(file.type)) { toast('只支持 PNG 图片', 'bad'); return; }
    if (file.size > 4 * 1024 * 1024) { toast('原图超过 4 MB，请先压缩再上传', 'bad'); return; }
    const fr = new FileReader();
    fr.onerror = () => toast('图片读取失败', 'bad');
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => toast('不是有效的 PNG 图片', 'bad');
      img.onload = () => {
        const cls = currentSkinClass(); if (!cls) return;
        const maxSide = 256;
        const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        let src = '';
        try { src = cv.toDataURL('image/png'); } catch (e) { toast('图片转换失败', 'bad'); return; }
        if (src.length > 1200000) { toast('图片内容过大，请换一张更简单的 PNG', 'bad'); return; }
        const s = skinOf(cls);
        s.src = src; s.w = img.naturalWidth; s.h = img.naturalHeight;
        s.label = false;   // 上传贴图后默认不压职业首字，保持画面干净
        markDirty('skin-upload:' + cls.id);
        refresh();
        toast('已替换「' + cls.name + '」的外观（' + w + '×' + h + '）', 'ok');
      };
      img.src = String(fr.result);
    };
    fr.readAsDataURL(file);
  }

  /* ---------------- 界面编辑器（全游戏 UI 可视化排版） ----------------
     预览是同域 iframe（index.html?uiEditor=1），内部铺可拖拽选择框；
     所有改动写进 S.data.ui.screens[screen][key] 的稀疏 patch，
     保存 / 发布后由 ui-layout.js 在游戏端应用。刷新内容区会重建 iframe，
     所以本页所有交互都走局部刷新，绝不调用全局 refresh()。 */
  const UI_W = 1280, UI_H = 860;
  function uiData() {
    if (UI && UI.setClasses && S.data.classes) UI.setClasses(S.data.classes);
    if (!S.data.ui || !S.data.ui.screens) S.data.ui = UI.normalize(S.data.ui);
    return S.data.ui;
  }
  function uiSchema() {
    // 职业管理页新增 / 删除职业后，界面编辑器的图层列表要立刻跟着变
    if (UI && UI.setClasses && S.data && S.data.classes) UI.setClasses(S.data.classes);
    return UI ? UI.schema() : [];
  }
  function uiScreenDef() { return uiSchema().find(s => s.id === S.ui.screen) || uiSchema()[0] || { id: 'start', name: '', items: [] }; }
  function uiItemDef(key) { const s = uiScreenDef(); return s.items.find(it => it.k === (key || S.ui.key)) || null; }
  function uiFrameEl() { return $('uiFrame'); }
  function uiPost(msg) {
    const f = uiFrameEl();
    if (!f || !f.contentWindow) return;
    try { f.contentWindow.postMessage(Object.assign({ __wowUi: 1 }, msg), '*'); } catch (e) { /* 跨域时忽略 */ }
  }
  function uiEl(key) {
    const it = uiItemDef(key), f = uiFrameEl();
    if (!it || !f || !f.contentDocument) return null;
    try { return f.contentDocument.querySelector(it.sel); } catch (e) { return null; }
  }
  function uiMeasure() {
    const f = uiFrameEl(), e = uiEl();
    if (!e || !f || !f.contentWindow) return { w: 0, h: 0, radius: 0 };
    const r = e.getBoundingClientRect();
    let radius = 0;
    try { radius = parseFloat(f.contentWindow.getComputedStyle(e).borderRadius) || 0; } catch (x) {}
    return { w: Math.round(r.width), h: Math.round(r.height), radius: Math.round(radius) };
  }
  function uiPatch(create) {
    if (!S.ui.key) return {};
    const d = uiData();
    const sc = d.screens[S.ui.screen] || (create ? (d.screens[S.ui.screen] = {}) : null);
    if (!sc) return {};
    const p = sc[S.ui.key] || (create ? (sc[S.ui.key] = {}) : null);
    return p || {};
  }
  /* ref 引用：属性面板要显示「实际生效」的样式，写入仍用 sparse patch，
     这样跟随卡只存一个 ref，不把被引用卡的 PNG 复制一份。 */
  function uiResolve(key, seen) {
    const sc = uiData().screens[S.ui.screen] || {};
    const p = sc[key];
    if (!p || (seen || []).indexOf(key) >= 0) return p || {};
    if (!p.ref) return p;
    const base = uiResolve(p.ref, (seen || []).concat([key])) || {}, out = {};
    Object.keys(base).forEach(k => { if (k !== 'ref') out[k] = base[k]; });
    Object.keys(p).forEach(k => { if (k !== 'ref') out[k] = p[k]; });
    return out;
  }
  function uiViewPatch() { return S.ui.key ? uiResolve(S.ui.key, []) : {}; }
  function uiFollowing(key) {
    const p = (uiData().screens[S.ui.screen] || {})[key || S.ui.key];
    return !!(p && p.ref);
  }
  function uiFirstName() {
    const c = (S.data.classes && S.data.classes[0]) || (UI.classList && UI.classList()[0]);
    return c ? c.name : '战士';
  }
  function uiStatus(text) { const e = $('uiStatus'); if (e) e.textContent = text; }
  function uiSyncLayers() { const e = $('uiLayers'); if (e) e.innerHTML = uiLayersHtml(); }
  function uiSyncProps() {
    const e = $('uiProps'); if (!e) return;
    e.innerHTML = uiPropsHtml(); bindNumRows(e);
  }
  function uiSync() { uiSyncLayers(); uiSyncProps(); }

  function uiLayersHtml() {
    uiSchema();   // 先按当前职业列表展开动态图层
    const sc = uiData().screens[S.ui.screen] || {};
    let group = '';
    return uiScreenDef().items.map(it => {
      let head = '';
      if (it.group && it.group !== group) {
        group = it.group;
        head = '<div class="ui-layer-group">' + esc(it.group) + '</div>';
      }
      const p = sc[it.k], changed = p && Object.keys(p).length;
      return head + '<button type="button" class="ui-layer' + (S.ui.key === it.k ? ' on' : '') + (changed ? ' changed' : '') +
        '" data-act="ui-select" data-id="' + esc(it.k) + '">' +
        '<span class="ul-dot"></span><span class="ul-nm">' + esc(it.label) + '</span>' +
        (p && p.img ? '<span class="ul-img">图</span>' : '') +
        (p && p.ref ? '<span class="ul-ref">跟随</span>' : '') +
        (it.multi ? '<span class="ul-lock">全部</span>' : '') +
        (it.lock ? '<span class="ul-lock">锁</span>' : '') + '</button>';
    }).join('');
  }
  function uiNum(field, label, value, min, max, step, hint) {
    const id = 'uip_' + field;
    return '<div class="field"><label>' + esc(label) + '</label><div class="num-row">' +
      '<input type="range" data-num="' + id + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + value + '">' +
      '<input class="input num" id="' + id + '" data-ui-field="' + field + '" type="number" min="' + min + '" max="' + max + '" step="' + step + '" value="' + value + '">' +
      '</div>' + (hint ? '<div class="hint">' + esc(hint) + '</div>' : '') + '</div>';
  }
  function uiPropsHtml() {
    if (!S.ui.key) {
      return '<div class="ui-empty">在左侧图层列表，或中间预览里点选一个元素。<br><br>' +
        '虚线框可直接拖动改位置，四角与四边手柄拖动改尺寸；右侧可上传 PNG 替换任意元素的背景素材。</div>';
    }
    const it = uiItemDef(), p = uiViewPatch(), raw = uiPatch(false), m = uiMeasure();
    const following = !!(raw && raw.ref);
    const V = (k, d) => (p[k] !== undefined ? p[k] : d);
    const kb = p.img ? (p.img.length * 0.75 / 1024).toFixed(0) + ' KB' : '';
    const fits = [['cover', '铺满裁切'], ['contain', '完整显示'], ['stretch', '拉伸填满'], ['tile', '平铺'], ['center', '居中原始']]
      .map(x => '<option value="' + x[0] + '"' + ((p.fit || 'cover') === x[0] ? ' selected' : '') + '>' + x[1] + '</option>').join('');
    const scopeTip = following
      ? '<div class="ui-scope-tip">当前跟随「' + esc(uiFirstName()) + ' · 卡片背景」的统一样式，共用同一份 PNG，不额外占用存档体积。' +
        '在此改动只覆盖对应项；点「恢复跟随」可清除本卡的单独覆盖。</div>'
      : (it.group
        ? '<div class="ui-scope-tip">只改「' + esc(String(it.label).replace(' · 卡片背景', '')) +
          '」这一张职业卡。想让 9 张卡共用一份素材，点工具栏「一键同步到其它职业卡」。</div>'
        : (it.multi ? '<div class="ui-scope-tip">这是一组元素，改动会同时应用到全部职业卡的弹珠头像。</div>' : ''));
    return '<div class="ui-prop-head"><strong>' + esc(it.label) + '</strong>' +
      '<span class="faint">' + esc(it.sel) + (it.lock ? ' · 仅素材/样式可编辑' : '') + '</span></div>' +
      scopeTip +
      '<div id="uiDrop" class="ui-drop' + (p.img ? ' has' : '') + '">' +
        (p.img ? '<img class="ui-thumb" src="' + esc(p.img) + '" alt="素材预览">' : '<span>把 PNG 拖到这里替换背景</span>') +
      '</div>' +
      '<div class="ui-file-row">' +
        '<label class="primary-btn ui-file-btn">上传 PNG<input type="file" id="uiFile" accept="image/png,.png" hidden></label>' +
        (following && !raw.img
          ? '<button class="ghost-btn" type="button" data-act="ui-reset-el">恢复跟随</button>'
          : (p.img ? '<button class="ghost-btn" type="button" data-act="ui-remove-img">移除素材</button>' : '')) +
        '<span class="faint">' + kb + '</span></div>' +
      '<div class="field"><label>图片填充方式</label><select class="input" data-ui-field="fit" data-change="ui-field">' + fits + '</select></div>' +
      '<div class="ui-controls">' +
        uiNum('bgX', '图片水平位置 %', V('bgX', 50), 0, 100, 1) +
        uiNum('bgY', '图片垂直位置 %', V('bgY', 50), 0, 100, 1) +
      '</div>' +
      '<div class="field"><label>背景色（无图片时也生效）</label><input class="input ui-color" type="color" data-ui-field="bg" data-change="ui-field" value="' + esc(p.bg || '#0f1621') + '"></div>' +
      '<div class="sub-title">位置与尺寸</div>' +
      (it.lock ? '<div class="hint">页面根元素 / 画布已锁定位置与尺寸，避免破坏布局与物理坐标。</div>' :
        '<div class="ui-controls">' +
        uiNum('dx', '水平位移 X', V('dx', 0), -800, 800, 1) +
        uiNum('dy', '垂直位移 Y', V('dy', 0), -800, 800, 1) +
        uiNum('w', '宽度（0=原始）', V('w', m.w || 300), 0, 2000, 1) +
        uiNum('h', '高度（0=原始）', V('h', m.h || 80), 0, 1600, 1) +
        '</div>') +
      '<div class="sub-title">外观</div>' +
      '<div class="ui-controls">' +
        uiNum('opacity', '不透明度', V('opacity', 1), 0.1, 1, 0.01) +
        uiNum('radius', '圆角', V('radius', m.radius || 0), 0, 120, 1) +
        uiNum('z', '叠放层级', V('z', 0), -10, 200, 1) +
      '</div>' +
      '<label class="switch ui-hide-switch"><input type="checkbox" data-ui-field="hide" data-change="ui-field" ' + (p.hide ? 'checked' : '') + '><i></i>隐藏此元素</label>' +
      '<div class="ui-prop-actions"><button class="ghost-btn" type="button" data-act="ui-reset-el">' +
        (following ? '恢复跟随统一样式' : '重置此元素') + '</button></div>' +
      '<div class="hint">留白或设为 0 的项不会写进配置，游戏端保持默认外观。改动即时显示在左侧预览里。</div>';
  }

  function uiCommit(label) {
    const d = uiData(), sc = d.screens[S.ui.screen];
    if (sc && S.ui.key && sc[S.ui.key] && !Object.keys(sc[S.ui.key]).length) delete sc[S.ui.key];
    if (sc && !Object.keys(sc).length) delete d.screens[S.ui.screen];
    markDirty('ui:' + S.ui.screen + ':' + S.ui.key);
    uiPost({ type: 'patch', screen: S.ui.screen, key: S.ui.key, patch: uiPatch(false) });
    uiSyncLayers();
    uiStatus(label || '改动已同步到预览');
  }
  function uiSetField(field, raw) {
    if (!S.ui.key) return;
    const p = uiPatch(true);
    if (field === 'fit') { if (raw) p.fit = raw; else delete p.fit; }
    else if (field === 'bg') { if (/^#[0-9a-fA-F]{6}$/.test(raw)) p.bg = raw; else delete p.bg; }
    else if (field === 'hide') { if (raw) p.hide = true; else delete p.hide; }
    else {
      const n = parseFloat(raw);
      if (!isFinite(n)) delete p[field];
      else if ((field === 'w' || field === 'h') && n <= 0) delete p[field];
      else if ((field === 'dx' || field === 'dy') && n === 0) delete p[field];
      else if ((field === 'bgX' || field === 'bgY') && n === 50) delete p[field];
      else if (field === 'opacity' && n >= 1) delete p[field];
      else p[field] = n;
    }
    uiCommit();
  }
  function uiSyncPropsValues() {
    const box = $('uiProps'); if (!box) return;
    const p = uiViewPatch(), m = uiMeasure();
    const defs = { dx: 0, dy: 0, w: m.w || 300, h: m.h || 80, opacity: 1, radius: m.radius || 0, z: 0, bgX: 50, bgY: 50 };
    box.querySelectorAll('[data-ui-field]').forEach(t => {
      const f = t.dataset.uiField;
      if (t.type === 'checkbox') { t.checked = !!p.hide; return; }
      let v;
      if (f === 'fit') v = p.fit || 'cover';
      else if (f === 'bg') v = p.bg || '#0f1621';
      else v = p[f] !== undefined ? p[f] : defs[f];
      if (document.activeElement !== t) t.value = v;
      const r = box.querySelector('[data-num="' + t.id + '"]'); if (r) r.value = v;
    });
  }
  function uiSelect(key) {
    S.ui.key = key || null;
    uiPost({ type: 'select', key: S.ui.key });
    uiSync();
  }
  function uiSetScreen(id) {
    if (!uiSchema().some(s => s.id === id)) return;
    S.ui.screen = id; S.ui.key = null;
    uiPost({ type: 'screen', screen: id });
    uiSync();
    uiStatus('已切换到「' + uiScreenDef().name + '」');
  }
  function uiResetEl() {
    if (!S.ui.key) return;
    const d = uiData(), sc = d.screens[S.ui.screen];
    const prev = sc && sc[S.ui.key], ref = prev && prev.ref;
    if (sc) {
      // 跟随卡「重置」= 清掉单独覆盖，回到跟随状态，而不是把引用一起删掉
      if (ref) sc[S.ui.key] = { ref: ref };
      else delete sc[S.ui.key];
    }
    if (sc && !Object.keys(sc).length) delete d.screens[S.ui.screen];
    if (ref) uiPost({ type: 'patch', screen: S.ui.screen, key: S.ui.key, patch: { ref: ref } });
    else uiPost({ type: 'reset', screen: S.ui.screen, key: S.ui.key });
    markDirty('ui-reset-el');
    uiSync(); uiStatus('已重置「' + (uiItemDef() || {}).label + '」');
  }
  function uiResetScreen() {
    const name = uiScreenDef().name;
    confirmBox('重置界面', '确定清空「' + name + '」里所有元素的位置、尺寸与素材改动？其它界面不受影响。').then(yes => {
      if (!yes) return;
      delete uiData().screens[S.ui.screen];
      uiPost({ type: 'ui', ui: clone(uiData()) });
      markDirty('ui-reset-screen');
      uiSync(); uiStatus('已重置整个「' + name + '」');
      toast('已重置该界面', 'ok');
    });
  }
  /* 一键同步：以第一张职业卡（战士）为唯一样式源，其它卡片只存 {ref}。
     配置里只保留一份 PNG，9 张卡不再各存一份 base64（12 MB → 约 2.6 MB）。 */
  function uiSyncCards() {
    const ud = uiData();
    const classes = S.data.classes || [];
    const first = classes[0] || (UI.classList && UI.classList()[0]);
    if (!first) { toast('没有可用的职业', 'bad'); return; }
    const master = 'card_' + first.id;
    const sc = ud.screens.start || (ud.screens.start = {});
    const base = sc[master];
    if (!base || !Object.keys(base).length || base.ref) {
      toast('请先给「' + first.name + ' · 卡片背景」上传 PNG 或设置样式', 'bad'); return;
    }
    const keys = (UI.schema()[0] || { items: [] }).items
      .filter(it => it.k.indexOf('card_') === 0 && it.group).map(it => it.k);
    let n = 0;
    keys.forEach(k => { if (k !== master) { sc[k] = { ref: master }; n++; } });
    if (!n) { toast('没有需要同步的其它职业卡', 'bad'); return; }
    markDirty('ui-sync-cards');
    uiPost({ type: 'ui', ui: clone(ud), classes: classes.map(c => ({ id: c.id, name: c.name })) });
    uiSync();
    uiStatus('已把「' + first.name + '」卡样式同步到 ' + n + ' 张职业卡（共用 1 份 PNG）');
    toast('已同步到其它 ' + n + ' 张职业卡，配置只保留一份背景图', 'ok');
  }
  function uiUploadFile(file) {
    if (!S.ui.key) { toast('请先选中一个 UI 元素', 'bad'); return; }
    if (!file) return;
    if (!/\.png$/i.test(file.name) && !/image\/png/i.test(file.type)) { toast('只支持 PNG 图片', 'bad'); return; }
    if (file.size > 6 * 1024 * 1024) { toast('原图超过 6 MB，请先压缩', 'bad'); return; }
    const fr = new FileReader();
    fr.onerror = () => toast('图片读取失败', 'bad');
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => toast('不是有效的 PNG 图片', 'bad');
      img.onload = () => {
        const maxSide = 1400;
        const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(img.naturalWidth * k));
        cv.height = Math.max(1, Math.round(img.naturalHeight * k));
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        let src = '';
        try { src = cv.toDataURL('image/png'); } catch (e) { toast('图片转换失败', 'bad'); return; }
        if (src.length > 1600000) { toast('图片内容过大，请换一张更简单的 PNG', 'bad'); return; }
        const p = uiPatch(true);
        p.img = src; if (!p.fit) p.fit = 'cover';
        uiCommit('已替换素材');
        uiSyncProps();
        toast('已上传素材（' + cv.width + '×' + cv.height + '）', 'ok');
      };
      img.src = String(fr.result);
    };
    fr.readAsDataURL(file);
  }
  function applyUiScale() {
    const inner = $('uiStageInner'); if (!inner) return;
    const s = S.ui.scale || 1;
    inner.style.width = (UI_W * s) + 'px';
    inner.style.height = (UI_H * s) + 'px';
    inner.style.transform = 'scale(' + s + ')';
  }
  function renderUiEditor() {
    if (!UI) return '<div class="card">界面布局脚本 ui-layout.js 未加载，请刷新页面重试</div>';
    const opts = uiSchema().map(s => '<option value="' + esc(s.id) + '"' + (s.id === S.ui.screen ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('');
    const scales = [0.5, 0.6, 0.75, 0.9, 1].map(v => '<option value="' + v + '"' + (v === S.ui.scale ? ' selected' : '') + '>' + Math.round(v * 100) + '%</option>').join('');
    return '<div class="card ui-card">' + cardHead('界面编辑器', '真实游戏界面 · 鼠标拖拽排版 · 任意元素上传 PNG 素材') +
      '<div class="ui-toolbar">' +
        '<label class="ui-tb-label">编辑界面 <select class="input" id="uiScreen" data-change="ui-screen">' + opts + '</select></label>' +
        '<label class="ui-tb-label">预览缩放 <select class="input" id="uiScale" data-change="ui-scale">' + scales + '</select></label>' +
        '<span class="spacer"></span>' +
        (S.ui.screen === 'start'
          ? '<button class="ghost-btn ui-sync-btn" type="button" data-act="ui-sync-cards">一键同步到其它职业卡（以' + esc(uiFirstName()) + '为准）</button>'
          : '') +
        '<button class="ghost-btn" type="button" data-act="ui-reset-screen">重置本界面</button>' +
        '<button class="ghost-btn" type="button" data-act="ui-open-game">保存并在游戏中查看</button>' +
      '</div>' +
      '<div class="ui-layout">' +
        '<div class="ui-layers"><div class="sub-title">图层 / 元素</div><div id="uiLayers">' + uiLayersHtml() + '</div></div>' +
        '<div class="ui-stage"><div id="uiStageInner" class="ui-stage-inner">' +
          '<iframe id="uiFrame" class="ui-frame" src="index.html?uiEditor=1" title="游戏界面实时预览"></iframe>' +
        '</div><div id="uiStatus" class="ui-status">正在载入游戏界面…</div></div>' +
        '<div class="ui-props"><div class="sub-title">元素属性</div><div id="uiProps">' + uiPropsHtml() + '</div></div>' +
      '</div>' +
      '<div class="hint ui-foot-hint">改动先保存在后台配置里，点顶部「保存」写入浏览器，点「发布配置」写入 data/game-config.json；游戏刷新后即生效。' +
      '位置用相对原始布局的位移实现，清空覆盖即可回到默认排版。</div>' +
      '</div>';
  }
  function initUiEditor() {
    S.ui.ready = false;
    applyUiScale();
    const props = $('uiProps');
    if (props) {
      props.addEventListener('dragover', e => { e.preventDefault(); props.classList.add('drag'); });
      props.addEventListener('dragleave', () => props.classList.remove('drag'));
      props.addEventListener('drop', e => {
        e.preventDefault(); props.classList.remove('drag');
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) uiUploadFile(f);
      });
    }
    bindNumRows($('uiProps'));
  }
  function onUiMessage(ev) {
    const d = ev.data;
    if (!d || d.__wowUi !== 1) return;
    if (d.type === 'needInit') {
      S.ui.ready = true;
      // 把后台当前（含未保存的新增职业）的职业表一起发给预览，图层与卡片一一对应
      const classes = (S.data.classes || []).map(c => ({ id: c.id, name: c.name }));
      uiPost({ type: 'init', ui: clone(uiData()), classes: classes, screen: S.ui.screen, key: S.ui.key });
      uiStatus('预览已就绪 · 点选元素，拖动虚线框或手柄调整');
      return;
    }
    if (S.tab !== 'ui') return;
    if (d.type === 'select') { S.ui.key = d.key; uiSync(); }
    else if (d.type === 'change') {
      const ud = uiData();
      const sc = ud.screens[d.screen] || (ud.screens[d.screen] = {});
      if (d.patch && Object.keys(d.patch).length) sc[d.key] = clone(d.patch); else delete sc[d.key];
      if (!Object.keys(sc).length) delete ud.screens[d.screen];
      markDirty('ui-drag:' + d.screen + ':' + d.key);
      if (S.ui.screen === d.screen && S.ui.key === d.key) uiSyncPropsValues();
      uiSyncLayers();
      uiStatus('拖拽调整已同步');
    }
  }

  /* ---------------- 技能 ---------------- */
  function renderSkills() {
    const f = S.filters, q = f.skillQ.toLowerCase();
    const list = S.data.skills.filter(s =>
      (!q || (s.name + s.id + describeMods(s.mods)).toLowerCase().indexOf(q) >= 0) &&
      (!f.tier || s.tier === f.tier) && (!f.cls || (f.cls === '__all' ? !s.cls : s.cls === f.cls)));
    const opts = S.data.classes.map(c => '<option value="' + esc(c.id) + '" ' + (f.cls === c.id ? 'selected' : '') + '>' + esc(c.name) + '专属</option>').join('');
    const tools = '<div class="tools">' +
      '<input class="input" style="width:210px" placeholder="搜索技能 / 效果" value="' + esc(f.skillQ) + '" data-input="skillQ">' +
      '<select class="select" style="width:120px" data-change="tier"><option value="">全部稀有度</option>' +
      Object.keys(TIERS).map(t => '<option value="' + t + '" ' + (f.tier === t ? 'selected' : '') + '>' + TIERS[t] + '</option>').join('') + '</select>' +
      '<select class="select" style="width:140px" data-change="cls"><option value="">全部归属</option><option value="__all" ' + (f.cls === '__all' ? 'selected' : '') + '>仅通用</option>' + opts + '</select>' +
      '<span class="spacer"></span><span class="faint">' + list.length + ' / ' + S.data.skills.length + ' 个</span>' +
      '<button class="primary-btn" data-act="skill-new" type="button">新增技能</button></div>';
    const rows = list.length ? list.map(s => {
      const owner = s.cls ? (S.data.classes.find(c => c.id === s.cls) || { name: s.cls }).name + '专属' : '通用';
      return '<tr><td><input type="checkbox" data-sel="' + esc(s.id) + '"></td>' +
        '<td><strong>' + esc(s.name) + '</strong><div class="faint" style="font-size:10px">' + esc(s.id) + '</div></td>' +
        '<td>' + esc(owner) + '</td><td><span class="tag ' + s.tier + '">' + TIERS[s.tier] + '</span></td>' +
        '<td style="max-width:340px">' + esc(describeMods(s.mods)) + '</td>' +
        '<td>' + (s.enabled === false ? '<span class="badge badge-mute">禁用</span>' : '<span class="badge badge-ok">启用</span>') + '</td>' +
        '<td><div class="ops"><button class="mini-btn" data-act="skill-edit" data-id="' + esc(s.id) + '">编辑</button>' +
        '<button class="mini-btn" data-act="skill-copy" data-id="' + esc(s.id) + '">复制</button>' +
        '<button class="mini-btn danger" data-act="skill-del" data-id="' + esc(s.id) + '">删除</button></div></td></tr>';
    }).join('') : '<tr><td colspan="7" class="table-empty">没有匹配的技能</td></tr>';
    const batch = '<div class="tools" style="margin-top:12px">' +
      '<button class="ghost-btn" data-act="batch-on" type="button">批量启用</button>' +
      '<button class="ghost-btn" data-act="batch-off" type="button">批量禁用</button>' +
      '<button class="ghost-btn" data-act="batch-del" type="button">批量删除</button>' +
      '<span class="spacer"></span><span class="faint">勾选左侧复选框后操作</span></div>';
    return '<div class="card">' + cardHead('技能池', '每个技能可叠加任意效果；描述由数值自动生成，改完保存即进入随机抽取') + tools +
      '<div class="table-wrap"><table><thead><tr><th style="width:34px"></th><th>技能</th><th>归属</th><th>稀有度</th><th>效果</th><th>状态</th><th style="width:180px">操作</th></tr></thead><tbody>' + rows + '</tbody></table></div>' + batch + '</div>';
  }

  function skillForm(s) {
    const o = s || { id: '', name: '', cls: '', tier: 'common', mods: {}, enabled: true };
    const ownerOpts = '<option value="">通用（所有职业可抽）</option>' +
      S.data.classes.map(c => '<option value="' + esc(c.id) + '" ' + (o.cls === c.id ? 'selected' : '') + '>' + esc(c.name) + '专属</option>').join('');
    const mods = MOD_META.map(m => {
      const v = (o.mods && o.mods[m.k]) || 0;
      return '<div class="mod-item ' + (v ? 'on' : '') + '" data-moditem="' + m.k + '">' +
        '<label>' + m.label + '<span>' + (m.pct ? '百分比' : '数值') + '</span></label>' +
        '<div class="num-row"><input type="range" data-num="md_' + m.k + '" min="' + m.min + '" max="' + m.max + '" step="' + m.step + '" value="' + v + '">' +
        '<input class="input num" id="md_' + m.k + '" type="number" min="' + m.min + '" max="' + m.max + '" step="' + m.step + '" value="' + v + '"></div></div>';
    }).join('');
    return '<div class="field"><label>技能名称</label><input class="input" id="sf_name" value="' + esc(o.name) + '"></div>' +
      '<div class="form-grid"><div class="field"><label>归属</label><select class="select" id="sf_cls">' + ownerOpts + '</select></div>' +
      '<div class="field"><label>稀有度</label><select class="select" id="sf_tier">' +
      Object.keys(TIERS).map(t => '<option value="' + t + '" ' + (o.tier === t ? 'selected' : '') + '>' + TIERS[t] + '（权重 ' + (S.data.tierWeights[t] || 0) + '）</option>').join('') + '</select></div></div>' +
      '<label class="switch"><input type="checkbox" id="sf_enabled" ' + (o.enabled !== false ? 'checked' : '') + '><i></i>启用该技能</label>' +
      '<div class="sub-title">效果数值（0 表示不生效，可叠加任意多个）</div><div class="mods-grid">' + mods + '</div>' +
      '<div class="divider"></div><button class="ghost-btn" id="sf_clear" type="button">清空全部效果</button>' +
      '<div class="hint" style="margin-top:8px">提示：百分比类填 0.1 即 +10%；生命 / 质量为绝对数值。</div>';
  }
  function saveSkillForm(id) {
    const name = val('sf_name').trim();
    if (!name) { toast('请填写技能名称', 'bad'); return false; }
    const mods = {};
    MOD_META.forEach(m => { const v = numv('md_' + m.k, 0); if (v) mods[m.k] = v; });
    const o = { id: id || uid('sk'), name: name, cls: val('sf_cls') || null, tier: val('sf_tier'), mods: mods, enabled: chk('sf_enabled') };
    if (id) S.data.skills[S.data.skills.findIndex(s => s.id === id)] = o;
    else S.data.skills.push(o);
    markDirty(); refresh(); toast('技能已' + (id ? '更新' : '新增'), 'ok');
    return true;
  }
  function selectedSkillIds() {
    return Array.from(document.querySelectorAll('[data-sel]:checked')).map(e => e.dataset.sel);
  }

  /* ---------------- 商店 ---------------- */
  function shopCfg() {
    if (!S.data.shop) S.data.shop = clone(DEFAULT.shop);
    if (!Array.isArray(S.data.shop.pool)) S.data.shop.pool = [];
    if (!Array.isArray(S.data.shop.starter)) S.data.shop.starter = [];
    if (!S.data.shop.rewards) S.data.shop.rewards = { win: 120, draw: 80, lose: 50 };
    return S.data.shop;
  }
  function shopMeta(classId) {
    const sh = shopCfg();
    let m = sh.pool.find(p => p.classId === classId);
    if (!m) {
      m = { classId: classId, rarity: 'common', weight: 10, listed: true };
      sh.pool.push(m);
    }
    return m;
  }
  function applyShopForm() {
    const sh = shopCfg();
    sh.currency = (val('shop_currency') || '').trim() || '金币';
    sh.initialCoins = Math.max(0, Math.round(numv('shop_initialCoins', sh.initialCoins)));
    sh.drawCost = Math.max(1, Math.round(numv('shop_drawCost', sh.drawCost)));
    sh.duplicateRefund = Math.max(0, Math.round(numv('shop_duplicateRefund', sh.duplicateRefund)));
    sh.rewards.win = Math.max(0, Math.round(numv('shop_win', sh.rewards.win)));
    sh.rewards.draw = Math.max(0, Math.round(numv('shop_draw', sh.rewards.draw)));
    sh.rewards.lose = Math.max(0, Math.round(numv('shop_lose', sh.rewards.lose)));
  }
  function renderShop() {
    const sh = shopCfg();
    const rows = S.data.classes.length ? S.data.classes.map(c => {
      const m = shopMeta(c.id);
      const starter = sh.starter.indexOf(c.id) >= 0;
      return '<tr>' +
        '<td><strong style="color:' + esc(c.color) + '">' + esc(c.name) + '</strong>' +
        '<div class="faint" style="font-size:10px">' + esc(c.id) + '</div></td>' +
        '<td><label class="switch"><input type="checkbox" data-change="shop-starter" data-id="' + esc(c.id) + '" ' + (starter ? 'checked' : '') + '><i></i></label></td>' +
        '<td><label class="switch"><input type="checkbox" data-change="shop-listed" data-id="' + esc(c.id) + '" ' + (m.listed !== false ? 'checked' : '') + '><i></i></label></td>' +
        '<td><select class="select" style="width:110px" data-change="shop-rarity" data-id="' + esc(c.id) + '">' +
        Object.keys(TIERS).map(t => '<option value="' + t + '" ' + (m.rarity === t ? 'selected' : '') + '>' + TIERS[t] + '</option>').join('') +
        '</select></td>' +
        '<td><input class="input" style="width:92px" type="number" min="0" max="100" step="1" data-input="shop-weight" data-id="' + esc(c.id) + '" value="' + (m.weight == null ? 10 : m.weight) + '"></td>' +
        '<td>' + (starter ? '<span class="badge badge-ok">初始解锁</span>' : '<span class="badge badge-mute">需抽取</span>') + '</td>' +
        '</tr>';
    }).join('') : '<tr><td colspan="6" class="table-empty">还没有职业，请先到「职业管理」新增弹珠</td></tr>';
    const listed = sh.pool.filter(p => p.listed !== false && p.weight > 0).length;

    return '<div class="grid grid-2">' +
      '<div class="card">' + cardHead('商店与货币', '金币来源：每局对战按胜负结算；玩家钱包存在浏览器本地') +
      '<label class="switch"><input type="checkbox" data-change="shop-enabled" ' + (sh.enabled !== false ? 'checked' : '') + '><i></i>启用商店抽取</label>' +
      '<div class="form-grid"><div class="field"><label>货币名称</label>' +
      '<input class="input" id="shop_currency" value="' + esc(sh.currency || '金币') + '"></div>' +
      '<div class="field"><label>初始赠送</label>' +
      '<input class="input" id="shop_initialCoins" type="number" min="0" max="5000" step="10" value="' + (sh.initialCoins == null ? 300 : sh.initialCoins) + '"></div></div>' +
      numRow('shop_drawCost', '单抽价格', sh.drawCost == null ? 80 : sh.drawCost, 1, 2000, 1) +
      numRow('shop_duplicateRefund', '重复返还', sh.duplicateRefund == null ? 30 : sh.duplicateRefund, 0, 2000, 1, '抽到已拥有的弹珠时返还的金额') +
      '<div class="sub-title">对战奖励</div>' +
      numRow('shop_win', '胜利奖励', sh.rewards.win, 0, 2000, 5) +
      numRow('shop_draw', '平局奖励', sh.rewards.draw, 0, 2000, 5) +
      numRow('shop_lose', '失败奖励', sh.rewards.lose, 0, 2000, 5) +
      '<div class="divider"></div>' +
      '<div class="faint" style="line-height:1.7">「初始解锁」勾选的弹珠开局即可选用；取消勾选后，玩家需要在游戏首页的「商店」里抽到才能使用。改完记得保存并发布。</div>' +
      '</div>' +

      '<div class="card">' + cardHead('弹珠货架', '共 ' + S.data.classes.length + ' 颗 · 上架且权重 > 0 的 ' + listed + ' 颗') +
      '<div class="table-wrap"><table class="shop-table"><thead><tr><th>弹珠</th><th>初始解锁</th><th>上架</th><th>稀有度</th><th>抽取权重</th><th>状态</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="hint" style="margin-top:10px">在「职业管理」新增弹珠后会自动出现在这里（默认未解锁、已上架）。实际抽中概率 = 该弹珠权重 ÷ 全部上架弹珠权重之和。</div>' +
      '</div></div>';
  }

  /* ---------------- 数值平衡 ---------------- */
  function renderBalance() {
    const cfg = S.data.config;
    const groups = CONFIG_GROUPS.map(g =>
      '<div class="sub-title">' + g.title + '</div>' +
      g.items.map(it => numRow('cfg_' + it.k.replace('.', '_'), it.label + (it.pct ? '（比例）' : ''), getPath(S.data, cfgPath(it)),
        it.min, it.max, it.step, it.hint)).join('')).join('');
    return '<div class="grid grid-2">' +
      '<div class="card">' + cardHead('全局参数', '改动会直接进入主游戏公式') + groups +
      '<div class="sub-title">倍速档位</div><div class="field"><label>逗号分隔，例如 1,2,4</label>' +
      '<input class="input" id="cfg_speeds" value="' + esc((cfg.speeds || []).join(',')) + '"></div>' +
      '<div class="divider"></div><button class="ghost-btn" data-act="cfg-reset" type="button">恢复本页默认值</button></div>' +

      '<div class="card">' + cardHead('批量对战试算', '用当前参数与技能池模拟若干局，空场计算') +
      '<div class="tools"><select class="select" style="width:150px" data-change="simStage">' +
      '<option value="0" ' + (S.sim.stage === 0 ? 'selected' : '') + '>首回合（无技能）</option>' +
      '<option value="3" ' + (S.sim.stage === 3 ? 'selected' : '') + '>后期（3 个技能）</option></select>' +
      '<select class="select" style="width:120px" data-change="simN">' +
      [100, 200, 500].map(n => '<option value="' + n + '" ' + (S.sim.n === n ? 'selected' : '') + '>' + n + ' 局</option>').join('') + '</select>' +
      '<button class="primary-btn" data-act="sim-run" type="button">运行试算</button></div>' +
      '<div id="simResult"><div class="faint" style="padding:22px 0">点击「运行试算」查看平均撞击次数、剩余生命、KO 率、平局率与胜率。</div></div>' +
      '<div class="divider"></div>' +
      '<div class="faint" style="line-height:1.7">试算复刻了主游戏的无追踪发射、弹性碰撞与比例伤害公式，随机职业与随机技能构筑。含障碍的地图会改变实际节奏，以游戏内实测为准。' +
      '<br>物理已改为「初始方向发射 + 无衰减 + 碰撞加速反弹」，试算结果随参数与构筑变化，可用来对比不同配置的强度。</div>' +
      '</div></div>';
  }

  function applyConfigForm() {
    CONFIG_GROUPS.forEach(g => g.items.forEach(it => {
      const id = 'cfg_' + it.k.replace('.', '_');
      const v = numv(id, getPath(DEFAULT, cfgPath(it)));
      setPath(S.data, cfgPath(it), v);
    }));
    const sp = val('cfg_speeds').split(',').map(x => parseFloat(x.trim())).filter(x => x > 0);
    S.data.config.speeds = sp.length ? sp : [1, 2, 4];
  }

  function renderSimResult() {
    const r = S.sim.result, box = $('simResult');
    if (!r || !box) return;
    const items = [
      ['平均撞击', r.hits.toFixed(1), clamp(r.hits / 20, 0, 1)],
      ['平均剩余生命', (r.pp * 100).toFixed(1) + '%', r.pp],
      ['提前 KO 率', (r.ko * 100).toFixed(0) + '%', r.ko],
      ['平局率', (r.draw * 100).toFixed(0) + '%', r.draw],
      ['我方胜率', (r.pwin * 100).toFixed(0) + '%', r.pwin]
    ];
    box.innerHTML = '<div class="sim-metrics">' + items.map(([k, v, p]) =>
      '<div class="sim-metric"><div class="k">' + k + '</div><div class="v">' + v + '</div>' +
      '<div class="sim-bar"><i style="width:' + Math.round(clamp(p, 0, 1) * 100) + '%"></i></div></div>').join('') + '</div>' +
      '<div class="hint" style="margin-top:12px">样本 ' + r.n + ' 局 · 平均回合时长 ' + r.dur.toFixed(1) + ' 秒 · ' +
      (r.ko > 0.35 ? 'KO 率偏高，可下调伤害系数或提高生命' : r.pp > 0.8 ? '伤害偏低，回合缺少紧张感' : '节奏在合理区间') + '</div>';
  }

  function runSim() {
    applyConfigForm();
    const c = S.data.config, pool = S.data.skills.filter(s => s.enabled !== false),
      classes = S.data.classes.filter(x => x.enabled !== false), N = S.sim.n, stage = S.sim.stage;
    if (!classes.length || !pool.length) { toast('需要至少一个启用的职业和技能', 'bad'); return; }
    const W = c.arenaW, H = c.arenaH, dt = 1 / 120;
    const rand = (a, b) => a + Math.random() * (b - a);
    let hits = 0, ko = 0, pp = 0, ep = 0, draw = 0, pwin = 0, dur = 0;
    for (let i = 0; i < N; i++) {
      const mk = base => {
        const m = {};
        MOD_META.forEach(x => { m[x.k] = 0; });
        for (let j = 0; j < stage; j++) {
          const s = pool[Math.floor(Math.random() * pool.length)];
          Object.keys(s.mods || {}).forEach(k => { m[k] += s.mods[k]; });
        }
        return {
          maxHp: Math.round(base.hp + m.maxHp), hp: 0, shield: 0,
          power: base.power * (1 + m.power), mass: base.mass + m.mass, speed: base.speed * (1 + m.speed),
          r: base.radius, m: m, x: 0, y: 0, vx: 0, vy: 0, combo: 0, first: false,
          slowUntil: -1, slowF: 1, dotDps: 0, dotUntil: -1
        };
      };
      const p = mk(classes[Math.floor(Math.random() * classes.length)]);
      const e = mk(classes[Math.floor(Math.random() * classes.length)]);
      [p, e].forEach((f, k) => {
        f.hp = f.maxHp; f.shield = f.maxHp * f.m.shield;
        f.x = k === 0 ? W * 0.24 : W * 0.76; f.y = H / 2 + rand(-50, 50);
        const aim = k === 0 ? 0 : Math.PI + rand(-0.5, 0.5);
        const ls = c.launchSpeed || 250;
        f.vx = Math.cos(aim) * ls * f.speed; f.vy = Math.sin(aim) * ls * f.speed;
      });
      let clock = 0, last = -10, h = 0;
      while (clock < c.roundSeconds && p.hp > 0 && e.hp > 0) {
        clock += dt;
        [p, e].forEach((f, k) => {
          const sa = clock < f.slowUntil ? f.slowF : 1;
          const sp = Math.hypot(f.vx, f.vy), cap = c.maxSpeed * f.speed * sa;
          if (sp > cap) { f.vx = f.vx / sp * cap; f.vy = f.vy / sp * cap; }
          f.x += f.vx * dt; f.y += f.vy * dt;
          if (f.x - f.r < 0) { f.x = f.r; f.vx = Math.abs(f.vx) * c.wallRestitution; }
          if (f.x + f.r > W) { f.x = W - f.r; f.vx = -Math.abs(f.vx) * c.wallRestitution; }
          if (f.y - f.r < 0) { f.y = f.r; f.vy = Math.abs(f.vy) * c.wallRestitution; }
          if (f.y + f.r > H) { f.y = H - f.r; f.vy = -Math.abs(f.vy) * c.wallRestitution; }
          if (f.m.regen > 0) f.hp = Math.min(f.maxHp, f.hp + f.maxHp * f.m.regen * dt);
          if (clock < f.dotUntil && f.dotDps > 0) {
            let q = f.dotDps * dt;
            if (f.shield > 0) { const a = Math.min(f.shield, q); f.shield -= a; q -= a; }
            f.hp = Math.max(0, f.hp - q);
          }
        });
        let dx = e.x - p.x, dy = e.y - p.y, dist = Math.hypot(dx, dy), min = p.r + e.r;
        if (dist < min) {
          if (dist < 0.001) { dx = 1; dy = 0; dist = 1; }
          const nx = dx / dist, ny = dy / dist, ov = min - dist, tm = p.mass + e.mass;
          p.x -= nx * ov * (e.mass / tm); p.y -= ny * ov * (e.mass / tm);
          e.x += nx * ov * (p.mass / tm); e.y += ny * ov * (p.mass / tm);
          const vn = (p.vx - e.vx) * nx + (p.vy - e.vy) * ny;
          if (vn > 0) {
            const j = (1 + c.restitution) * vn / (1 / p.mass + 1 / e.mass);
            p.vx -= j / p.mass * nx; p.vy -= j / p.mass * ny;
            e.vx += j / e.mass * nx; e.vy += j / e.mass * ny;
            if (p.m.knock > 0) { e.vx += nx * vn * p.m.knock * .35; e.vy += ny * vn * p.m.knock * .35; }
            if (e.m.knock > 0) { p.vx -= nx * vn * e.m.knock * .35; p.vy -= ny * vn * e.m.knock * .35; }
            const boost = c.collisionBoost || 1.14;
            p.vx *= boost; p.vy *= boost; e.vx *= boost; e.vy *= boost;
            if (vn > c.minImpact && clock - last > c.impactCd) {
              last = clock; h++;
              const pv = Math.max(0, p.vx * nx + p.vy * ny), ev = Math.max(0, -(e.vx * nx + e.vy * ny));
              const share = pv + ev > 0 ? pv / (pv + ev) : .5, t = clamp(vn / 700, 0, 1.3);
              const base = c.dmgBase + t * c.dmgSpeed;
              hit(p, e, base * (.55 + .9 * share), t, c, clock);
              hit(e, p, base * (.55 + .9 * (1 - share)), t, c, clock);
            }
          }
        }
      }
      const a = p.hp / p.maxHp, b = e.hp / e.maxHp;
      hits += h; pp += a; ep += b; dur += clock;
      if (p.hp <= 0 || e.hp <= 0) ko++;
      else if (Math.abs(a - b) < c.drawWindow) draw++;
      else if (a > b) pwin++;
    }
    S.sim.result = { n: N, hits: hits / N, pp: pp / N, ep: ep / N, ko: ko / N, draw: draw / N, pwin: pwin / N, dur: dur / N };
    markDirty();
    renderSimResult();
    toast('试算完成：' + N + ' 局', 'ok');
  }

  function hit(att, def, base, t, c, clock) {
    if (def.m.dodge > 0 && Math.random() < def.m.dodge) return;
    let mult = att.power;
    if (Math.random() < c.critBase + att.m.crit) mult *= c.critMultBase + att.m.critMult;
    if (!att.first) { mult *= 1 + att.m.firstStrike; att.first = true; }
    if (def.hp / def.maxHp < .4) mult *= 1 + att.m.execute;
    mult *= 1 + Math.min(att.combo, 6) * att.m.combo;
    mult *= 1 + t * att.m.momentum;
    mult /= 1 + Math.min(def.m.armor, .65);
    const dmg = def.maxHp * base * mult;
    let left = dmg;
    if (def.shield > 0) { const a = Math.min(def.shield, left); def.shield -= a; left -= a; }
    def.hp = Math.max(0, def.hp - left);
    if (def.m.thorns > 0) att.hp = Math.max(0, att.hp - dmg * def.m.thorns);
    if (att.m.lifesteal > 0) att.hp = Math.min(att.maxHp, att.hp + dmg * att.m.lifesteal);
    if (att.m.slow > 0) { def.slowUntil = clock + 1.3; def.slowF = 1 - Math.min(att.m.slow, .6); }
    if (att.m.dot > 0) { def.dotDps = Math.min(def.maxHp * .09, def.dotDps + def.maxHp * att.m.dot); def.dotUntil = clock + 3.2; }
    att.combo = Math.min(6, att.combo + 1);
  }

  /* ---------------- 地图编辑器 ---------------- */
  function currentMap() {
    return S.data.maps.find(m => m.id === S.map.id) || activeMap() || S.data.maps[0];
  }
  function renderMaps() {
    const m = currentMap();
    if (!m) return '<div class="card"><div class="table-empty">尚无地图，点击「新增地图」创建</div></div>';
    S.map.id = m.id;
    const opts = S.data.maps.map(x => '<option value="' + esc(x.id) + '" ' + (x.id === m.id ? 'selected' : '') + '>' + esc(x.name) + (x.id === S.data.activeMapId ? '（主地图）' : '') + '</option>').join('');
    const toolbar = '<div class="map-toolbar">' +
      '<select class="select" style="width:190px" data-change="mapSelect">' + opts + '</select>' +
      '<button class="ghost-btn" data-act="map-setactive" type="button">设为主地图</button>' +
      '<button class="ghost-btn" data-act="map-rename" type="button">重命名</button>' +
      '<button class="ghost-btn" data-act="ob-dup" type="button" title="复制选中的障碍 (Ctrl+D)">复制障碍</button>' +
      '<button class="ghost-btn' + (S.map.mirror ? ' mirror-on' : '') + '" data-act="map-mirror" type="button" title="对称轴：画一侧自动在对侧生成镜像 (M)">对称：' + (S.map.mirror ? '开' : '关') + '</button>' +
      '<button class="ghost-btn" data-act="map-new" type="button">新增</button>' +
      '<button class="ghost-btn" data-act="map-copy" type="button">复制地图</button>' +
      '<button class="ghost-btn" data-act="map-del" type="button">删除</button>' +
      '<span class="spacer"></span>' +
      '<button class="ghost-btn" data-act="map-undo" id="btnMapUndo" type="button" title="撤销 (Ctrl+Z)" disabled>撤销</button>' +
      '<button class="ghost-btn" data-act="map-redo" id="btnMapRedo" type="button" title="重做 (Ctrl+Shift+Z / Ctrl+Y)" disabled>重做</button>' +
      '<button class="ghost-btn" data-act="map-help" type="button" title="查看全部快捷键 (? 或 F1)">快捷键</button>' +
      '<label class="switch"><input type="checkbox" data-change="map-enabled" ' + (m.enabled !== false ? 'checked' : '') + '><i></i>启用</label>' +
      '<span class="badge ' + (m.id === S.data.activeMapId ? 'badge-ok' : 'badge-mute') + '">' + (m.id === S.data.activeMapId ? '游戏中生效' : '未启用') + '</span>' +
      '<span class="badge badge-mute" id="snapInfo">网格吸附 关</span>' +
      '<span class="faint" id="histInfo"></span></div>';
    const tools = '<div class="map-tools">' +
      [['select', '选择', 'V'], ['rect', '矩形', 'R'], ['circle', '圆形', 'C'], ['spawn1', '出生1', '1'], ['spawn2', '出生2', '2'], ['delete', '删除', 'D']]
        .map(([t, n, k]) => '<button class="tool-btn ' + (S.map.tool === t ? 'active' : '') + '" data-act="map-tool" data-id="' + t + '" type="button" title="' + n + '工具 (' + k + ')">' + n + '<span class="tool-key">' + k + '</span></button>').join('') +
      '</div>';
    const props = '<div class="map-props" id="mapProps">' + mapPropsHtml(m) + '</div>';
    return '<div class="card">' + cardHead('竞技场编辑', '拖拽绘制障碍、拖动出生点；右侧改属性即时预览') + toolbar +
      '<div class="map-layout">' + tools +
      '<div class="map-canvas-wrap"><canvas id="mapCanvas" width="' + m.width + '" height="' + m.height + '"></canvas>' +
      '<div class="map-hint" id="mapHint">拖拽绘制障碍，拖动可移动对象 · Ctrl+Z 撤销 / Ctrl+Shift+Z 重做 · ? 查看全部快捷键</div></div>' + props + '</div></div>';
  }

  function mapPropsHtml(m) {
    const sel = S.map.sel;
    const f = (label, prop, v, type, min, max, step) => {
      if (type !== 'number') {
        return '<div class="field"><label>' + label + '</label><input class="input" type="text" data-mapprop="' + prop + '" value="' + esc(v) + '"></div>';
      }
      return '<div class="field">' +
        '<div class="f-row"><label>' + label + '</label>' +
          '<input class="f-num" type="number" data-mapprop="' + prop + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + esc(v) + '">' +
        '</div>' +
        '<input class="slider" type="range" data-mapprop="' + prop + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + esc(v) + '">' +
      '</div>';
    };
    let objHtml = '<div class="faint">未选中对象。用「选择」工具点击障碍或出生点。</div>';
    if (sel && sel.type === 'ob') {
      const ob = (m.obstacles || []).find(o => o.id === sel.id);
      if (ob) {
        objHtml = (ob.pair ? '<div class="faint" style="margin-bottom:10px">该障碍已配对镜像：移动 / 删除会同步对侧</div>' : '') +
          '<div class="field"><label>类型</label><select class="select" data-obprop="type"><option value="rect" ' + (ob.type === 'rect' ? 'selected' : '') + '>矩形</option><option value="circle" ' + (ob.type === 'circle' ? 'selected' : '') + '>圆形</option></select></div>' +
          '<div class="form-grid">' +
          f('中心 X', 'x', ob.x, 'number', 0, m.width, 1).replace(/data-mapprop/g, 'data-obprop') +
          f('中心 Y', 'y', ob.y, 'number', 0, m.height, 1).replace(/data-mapprop/g, 'data-obprop') +
          (ob.type === 'circle'
            ? f('半径', 'r', ob.r, 'number', 4, 300, 1).replace(/data-mapprop/g, 'data-obprop')
            : f('宽', 'w', ob.w, 'number', 4, 800, 1).replace(/data-mapprop/g, 'data-obprop') + f('高', 'h', ob.h, 'number', 4, 800, 1).replace(/data-mapprop/g, 'data-obprop')) +
          '</div>' +
          f('反弹系数', 'bounce', ob.bounce == null ? 0.9 : ob.bounce, 'number', 0, 1.2, 0.01).replace(/data-mapprop/g, 'data-obprop') +
          '<div class="field"><label>颜色</label><div class="color-row"><input type="color" data-obprop="color" value="' + esc(ob.color || '#2b3a52') + '"></div></div>' +
          '<button class="mini-btn danger" data-act="ob-del" type="button">删除该障碍</button>' +
          (ob.pair ? '' : '<button class="mini-btn" data-act="ob-mirror" type="button" title="在对侧生成一份镜像并配对">生成对称镜像</button>');
      }
    } else if (sel && sel.type === 'spawn') {
      const p = m.spawns[sel.index];
      objHtml = '<div class="faint" style="margin-bottom:10px">出生点 ' + (sel.index + 1) + '（' + (sel.index === 0 ? '我方' : '对手') + '）</div>' +
        '<div class="form-grid">' +
        f('X', 'x', p.x, 'number', 0, m.width, 1).replace(/data-mapprop/g, 'data-spawnprop') +
        f('Y', 'y', p.y, 'number', 0, m.height, 1).replace(/data-mapprop/g, 'data-spawnprop') + '</div>';
    }
    const obs = (m.obstacles || []).map((o, i) =>
      '<div class="ob-item ' + (sel && sel.type === 'ob' && sel.id === o.id ? 'sel' : '') + '" data-act="ob-select" data-id="' + esc(o.id) + '">' +
      '<span class="swatch" style="background:' + esc(o.color || '#2b3a52') + '"></span><span>' + (o.type === 'circle' ? '圆形' : '矩形') + ' ' + (i + 1) + '</span><span class="spacer"></span>' +
      (o.pair ? '<span class="pair-tag">镜像</span>' : '') +
      '<span class="faint">' + Math.round(o.x) + ',' + Math.round(o.y) + '</span></div>').join('') || '<div class="faint">暂无障碍</div>';
    const th = m.theme || {};
    const colors = [['bgTop', '背景上'], ['bgBottom', '背景下'], ['grid', '网格'], ['border', '边框'], ['accent', '装饰']].map(([k, n]) =>
      '<div class="color-row"><input type="color" data-theme="' + k + '" value="' + esc(th[k] || '#182233') + '"><span>' + n + '</span></div>').join('');
    return '<h3>地图属性</h3>' +
      '<div class="field"><label>名称</label><input class="input" data-mapprop="name" value="' + esc(m.name) + '"></div>' +
      '<div class="form-grid">' + f('宽', 'width', m.width, 'number', 400, 1600, 10) + f('高', 'height', m.height, 'number', 240, 900, 10) + '</div>' +
      f('出生点随机偏移', 'spawnJitter', m.spawnJitter == null ? 0 : m.spawnJitter, 'number', 0, 200, 5) +
      '<div class="sub-title">主题配色</div><div class="theme-grid">' + colors + '</div>' +
      '<div class="sub-title">选中对象</div>' + objHtml +
      '<div class="sub-title">障碍列表（' + (m.obstacles || []).length + '）</div><div class="ob-list">' + obs + '</div>';
  }

  function initMapEditor() {
    const cv = $('mapCanvas');
    if (!cv) return;
    const cx = cv.getContext('2d');
    S.map.drag = null; S.map.preview = null;
    const snapN = v => S.map.snap ? Math.round(v / 10) * 10 : v;
    const pos = e => {
      const r = cv.getBoundingClientRect(), m = currentMap();
      return {
        x: snapN((e.clientX - r.left) / r.width * m.width),
        y: snapN((e.clientY - r.top) / r.height * m.height)
      };
    };
    const hitTest = p => {
      const m = currentMap();
      for (let i = 0; i < m.spawns.length; i++) {
        if (Math.hypot(p.x - m.spawns[i].x, p.y - m.spawns[i].y) < 20) return { type: 'spawn', index: i };
      }
      for (let i = (m.obstacles || []).length - 1; i >= 0; i--) {
        const o = m.obstacles[i];
        if (o.type === 'circle' ? Math.hypot(p.x - o.x, p.y - o.y) < o.r :
          (Math.abs(p.x - o.x) <= o.w / 2 && Math.abs(p.y - o.y) <= o.h / 2)) return { type: 'ob', id: o.id };
      }
      return null;
    };
    const redrawProps = () => { const p = $('mapProps'); if (p) { p.innerHTML = mapPropsHtml(currentMap()); paintSliders(p); } };
    cv.addEventListener('mousedown', e => {
      const p = pos(e), m = currentMap(), tool = S.map.tool;
      if (tool === 'spawn1' || tool === 'spawn2') {
        const i = tool === 'spawn1' ? 0 : 1;
        m.spawns[i] = { x: Math.round(clamp(p.x, 0, m.width)), y: Math.round(clamp(p.y, 0, m.height)) };
        S.map.sel = { type: 'spawn', index: i }; S.hist.label = '设置出生点';
        markDirty(); redrawProps(); drawMap(); return;
      }
      if (tool === 'delete') {
        const h = hitTest(p);
        if (h && h.type === 'ob') {
          deleteObstacle(m, h.id); S.map.sel = null;
          S.hist.label = '删除障碍'; markDirty(); redrawProps(); drawMap();
        }
        return;
      }
      if (tool === 'rect' || tool === 'circle') { S.map.drag = { type: 'create', start: p }; S.map.preview = { tool: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y }; return; }
      const h = hitTest(p);
      S.map.sel = h;
      if (h) {
        const obj = h.type === 'ob' ? m.obstacles.find(o => o.id === h.id) : m.spawns[h.index];
        const twin = h.type === 'ob' ? twinOf(m, obj) : null;
        S.map.drag = { type: 'move', start: p, orig: { x: obj.x, y: obj.y }, sel: h,
          twinOrig: twin ? { x: twin.x, y: twin.y } : null };
      }
      redrawProps(); drawMap();
    });
    cv.addEventListener('mousemove', e => {
      if (!S.map.drag) return;
      const p = pos(e), m = currentMap(), d = S.map.drag;
      if (d.type === 'create') { S.map.preview.x2 = p.x; S.map.preview.y2 = p.y; drawMap(); return; }
      const obj = d.sel.type === 'ob' ? m.obstacles.find(o => o.id === d.sel.id) : m.spawns[d.sel.index];
      obj.x = Math.round(clamp(d.orig.x + p.x - d.start.x, 0, m.width));
      obj.y = Math.round(clamp(d.orig.y + p.y - d.start.y, 0, m.height));
      if (d.sel.type === 'ob') syncTwin(m, obj);
      drawMap();
    });
    const endDrag = () => {
      const d = S.map.drag;
      if (!d) return;
      if (d.type === 'create' && S.map.preview) {
        const m = currentMap(), q = S.map.preview;
        const w = Math.abs(q.x2 - q.x1), h = Math.abs(q.y2 - q.y1);
        if (w > 8 || h > 8) {
          const ob = {
            id: uid('ob'), type: q.tool,
            x: Math.round((q.x1 + q.x2) / 2), y: Math.round((q.y1 + q.y2) / 2),
            w: q.tool === 'rect' ? Math.round(Math.max(w, 8)) : 0,
            h: q.tool === 'rect' ? Math.round(Math.max(h, 8)) : 0,
            r: q.tool === 'circle' ? Math.round(Math.max(w, h) / 2) : 0,
            bounce: 0.9, color: (m.theme && m.theme.accent) || '#2b3a52'
          };
          m.obstacles = m.obstacles || [];
          m.obstacles.push(ob);
          S.hist.label = '绘制' + (q.tool === 'circle' ? '圆形' : '矩形') + '障碍';
          if (S.map.mirror) {
            m.obstacles.push(makeMirrorTwin(m, ob));
            S.hist.label += '（对称）';
          }
          S.map.sel = { type: 'ob', id: ob.id };
          markDirty();
        }
      } else if (d.type === 'move') { S.hist.label = '移动对象'; markDirty(); }
      S.map.drag = null; S.map.preview = null;
      redrawProps(); drawMap();
    };
    cv.addEventListener('mouseup', endDrag);
    cv.addEventListener('mouseleave', endDrag);
    drawMap();
  }

  function drawMap() {
    const cv = $('mapCanvas'); if (!cv) return;
    const cx = cv.getContext('2d'), m = currentMap();
    if (!m) return;
    if (cv.width !== m.width || cv.height !== m.height) { cv.width = m.width; cv.height = m.height; }
    const W = m.width, H = m.height, th = m.theme || {};
    const g = cx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, th.bgTop || '#0d1420'); g.addColorStop(1, th.bgBottom || '#080c14');
    cx.fillStyle = g; cx.fillRect(0, 0, W, H);
    cx.strokeStyle = th.grid || '#182233'; cx.lineWidth = 1;
    for (let x = 0; x <= W; x += 45) { cx.beginPath(); cx.moveTo(x + .5, 0); cx.lineTo(x + .5, H); cx.stroke(); }
    for (let y = 0; y <= H; y += 45) { cx.beginPath(); cx.moveTo(0, y + .5); cx.lineTo(W, y + .5); cx.stroke(); }
    cx.strokeStyle = th.border || '#26344a'; cx.lineWidth = 2; cx.strokeRect(1, 1, W - 2, H - 2);
    cx.setLineDash([6, 9]);
    if (S.map.mirror) { cx.strokeStyle = '#f0c874'; cx.lineWidth = 2; cx.globalAlpha = 0.9; }
    else cx.strokeStyle = th.accent || '#2b3a52';
    cx.beginPath(); cx.moveTo(W / 2, 12); cx.lineTo(W / 2, H - 12); cx.stroke();
    cx.beginPath(); cx.arc(W / 2, H / 2, 62, 0, Math.PI * 2); cx.stroke();
    cx.globalAlpha = 1; cx.setLineDash([]);
    (m.obstacles || []).forEach(o => {
      const sel = S.map.sel && S.map.sel.type === 'ob' && S.map.sel.id === o.id;
      cx.fillStyle = o.color || '#2b3a52'; cx.strokeStyle = sel ? '#f0c874' : 'rgba(255,255,255,.18)'; cx.lineWidth = sel ? 2.5 : 1.5;
      cx.beginPath();
      if (o.type === 'circle') cx.arc(o.x, o.y, o.r || 0, 0, Math.PI * 2);
      else cx.rect(o.x - (o.w || 0) / 2, o.y - (o.h || 0) / 2, o.w || 0, o.h || 0);
      cx.fill(); cx.stroke();
    });
    if (S.map.preview) {
      const q = S.map.preview;
      cx.fillStyle = 'rgba(240,200,116,.25)'; cx.strokeStyle = '#f0c874'; cx.lineWidth = 1.5; cx.setLineDash([4, 4]);
      cx.beginPath();
      if (q.tool === 'circle') cx.arc((q.x1 + q.x2) / 2, (q.y1 + q.y2) / 2, Math.max(Math.abs(q.x2 - q.x1), Math.abs(q.y2 - q.y1)) / 2, 0, Math.PI * 2);
      else cx.rect(Math.min(q.x1, q.x2), Math.min(q.y1, q.y2), Math.abs(q.x2 - q.x1), Math.abs(q.y2 - q.y1));
      cx.fill(); cx.stroke(); cx.setLineDash([]);
    }
    m.spawns.forEach((p, i) => {
      const sel = S.map.sel && S.map.sel.type === 'spawn' && S.map.sel.index === i;
      cx.beginPath(); cx.arc(p.x, p.y, 13, 0, Math.PI * 2);
      cx.fillStyle = i === 0 ? 'rgba(240,200,116,.85)' : 'rgba(111,158,222,.85)'; cx.fill();
      cx.strokeStyle = sel ? '#ffffff' : 'rgba(0,0,0,.5)'; cx.lineWidth = sel ? 2.5 : 1.5; cx.stroke();
      cx.fillStyle = '#101722'; cx.font = '700 11px "Segoe UI",sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
      cx.fillText(i === 0 ? 'P1' : 'P2', p.x, p.y);
    });
    cx.fillStyle = 'rgba(255,255,255,.35)'; cx.font = '11px "Segoe UI",sans-serif'; cx.textAlign = 'left';
    cx.fillText(m.name + '  ' + W + ' x ' + H, 12, 20);
  }

  function onMapPropInput(e) {
    const t = e.target, m = currentMap();
    let group = null, prop = null;
    if (t.dataset.mapprop) { group = 'mapprop'; prop = t.dataset.mapprop; }
    else if (t.dataset.obprop) { group = 'obprop'; prop = t.dataset.obprop; }
    else if (t.dataset.spawnprop) { group = 'spawnprop'; prop = t.dataset.spawnprop; }
    if (t.dataset.mapprop) {
      const k = t.dataset.mapprop;
      m[k] = (k === 'name') ? t.value : numv2(t.value, m[k]);
      if (k === 'width' || k === 'height') { m[k] = Math.max(200, m[k]); drawMap(); }
      S.hist.label = '编辑地图属性'; markDirty('prop:' + k); drawMap();
    } else if (t.dataset.theme) {
      m.theme = m.theme || {}; m.theme[t.dataset.theme] = t.value;
      S.hist.label = '修改主题配色'; markDirty('theme:' + t.dataset.theme); drawMap();
    } else if (t.dataset.obprop) {
      const sel = S.map.sel; if (!sel || sel.type !== 'ob') return;
      const ob = (m.obstacles || []).find(o => o.id === sel.id); if (!ob) return;
      const k = t.dataset.obprop;
      ob[k] = (k === 'type' || k === 'color') ? t.value : numv2(t.value, ob[k]);
      // 形状互转时补齐缺失尺寸：矩形→圆按等面积取半径，圆→矩形按直径取边长
      if (k === 'type' && ob.type === 'circle' && !(ob.r >= 4)) {
        const area = Math.max(1, (ob.w || 40) * (ob.h || 40));
        ob.r = Math.round(clamp(Math.sqrt(area / Math.PI), 4, 300));
      }
      if (k === 'type' && ob.type === 'rect') {
        const d = Math.round((ob.r || 0) * 2);
        if (!(ob.w >= 4)) ob.w = Math.round(clamp(d || 40, 4, 800));
        if (!(ob.h >= 4)) ob.h = Math.round(clamp(d || 40, 4, 800));
      }
      S.hist.label = '编辑障碍属性'; markDirty('obprop:' + sel.id + ':' + k); drawMap();
      if (k === 'type') { const p = $('mapProps'); if (p) { p.innerHTML = mapPropsHtml(m); paintSliders(p); } }
    } else if (t.dataset.spawnprop) {
      const sel = S.map.sel; if (!sel || sel.type !== 'spawn') return;
      m.spawns[sel.index][t.dataset.spawnprop] = numv2(t.value, 0);
      S.hist.label = '编辑出生点'; markDirty('spawn:' + sel.index + ':' + t.dataset.spawnprop); drawMap();
    }
    // 输入框被清空等非法中间态不同步，避免滑轨误跳到最小值
    if (group && prop && t.value !== '' && !isNaN(parseFloat(t.value))) syncPropFields(group, prop, t.value, t);
  }
  function numv2(v, d) { const n = parseFloat(v); return isNaN(n) ? d : n; }

  // 滑块 ↔ 数值框 双向同步（拖动滑轨或输入数字都实时反映，并重绘进度填充）
  function syncPropFields(group, prop, value, self) {
    paintSlider(self); // 拖动滑轨时自身填充也要跟着走
    const root = $('mapProps'); if (!root) return;
    root.querySelectorAll('[data-' + group + '="' + prop + '"]').forEach(el => {
      if (el === self) return;
      if (el.classList.contains('slider') || el.type === 'number') { el.value = value; paintSlider(el); }
    });
  }
  function paintSlider(el) {
    if (!el || !el.classList || !el.classList.contains('slider')) return;
    const min = parseFloat(el.min) || 0, max = parseFloat(el.max) || 1;
    const val = parseFloat(el.value);
    const pct = max > min ? clamp(((val - min) / (max - min)) * 100, 0, 100) : 0;
    el.style.setProperty('--pct', pct + '%');
  }
  function paintSliders(scope) {
    const root = scope || document;
    root.querySelectorAll('.slider').forEach(paintSlider);
  }

  /* ---------------- 地图快捷键动作 ---------------- */
  /* ---------------- 对称轴（镜像）辅助 ----------------
     配对约定：ob.pair 指向镜像体的 id，镜像体 x = 地图宽 - ob.x，y 相同。
     对称开启时：绘制/复制会自动生成镜像；移动/微调/删除会同步镜像体。 */
  function mirrorX(m, x) { return Math.round(clamp(m.width - x, 0, m.width)); }
  function twinOf(m, ob) {
    if (!ob || !ob.pair) return null;
    return (m.obstacles || []).find(o => o.id === ob.pair && o.id !== ob.id) || null;
  }
  function makeMirrorTwin(m, ob) {
    const twin = clone(ob);
    twin.id = uid('ob');
    twin.x = mirrorX(m, ob.x);
    ob.pair = twin.id;
    twin.pair = ob.id;
    return twin;
  }
  function syncTwin(m, ob) {
    const twin = twinOf(m, ob);
    if (!twin) return;
    twin.x = mirrorX(m, ob.x);
    twin.y = ob.y;
  }
  function deleteObstacle(m, id) {
    const ob = (m.obstacles || []).find(o => o.id === id);
    const ids = [id];
    if (ob && ob.pair) ids.push(ob.pair);
    m.obstacles = (m.obstacles || []).filter(o => ids.indexOf(o.id) < 0);
  }
  function toggleMirror() {
    S.map.mirror = !S.map.mirror;
    refresh();
    toast('对称绘制已' + (S.map.mirror ? '开启：画一侧自动生成镜像' : '关闭'), 'ok');
  }

  function duplicateSelected() {
    const m = currentMap(), sel = S.map.sel;
    if (!sel || sel.type !== 'ob') { toast('请先用选择工具点中一个障碍', 'bad'); return; }
    const src = (m.obstacles || []).find(o => o.id === sel.id);
    if (!src) return;
    const ob = clone(src);
    ob.id = uid('ob');
    delete ob.pair; // 复制品默认独立，对称模式下再重新配对
    ob.x = Math.round(clamp(ob.x + 24, 0, m.width));
    ob.y = Math.round(clamp(ob.y + 24, 0, m.height));
    m.obstacles.push(ob);
    let label = '复制障碍', msg = '已复制障碍（右下偏移 24px）';
    if (S.map.mirror) {
      m.obstacles.push(makeMirrorTwin(m, ob));
      label = '复制障碍（对称）';
      msg = '已复制障碍并生成镜像（右下偏移 24px）';
    }
    S.map.sel = { type: 'ob', id: ob.id };
    S.hist.label = label;
    markDirty();
    refresh();
    toast(msg, 'ok');
  }
  function nudgeSelected(dx, dy) {
    const sel = S.map.sel, m = currentMap();
    if (!sel || !m) return;
    const obj = sel.type === 'ob'
      ? (m.obstacles || []).find(o => o.id === sel.id)
      : m.spawns[sel.index];
    if (!obj) return;
    obj.x = Math.round(clamp(obj.x + dx, 0, m.width));
    obj.y = Math.round(clamp(obj.y + dy, 0, m.height));
    if (sel.type === 'ob') syncTwin(m, obj);
    S.hist.label = '键盘微调';
    markDirty('nudge');
    const p = $('mapProps'); if (p) { p.innerHTML = mapPropsHtml(m); paintSliders(p); }
    drawMap();
  }
  function toggleSnap() {
    S.map.snap = !S.map.snap;
    refresh();
    toast('网格吸附已' + (S.map.snap ? '开启（10px）' : '关闭'), 'ok');
  }
  function openShortcuts() { $('shortcutModal').hidden = false; }
  function closeShortcuts() { $('shortcutModal').hidden = true; }

  /* ---------------- 活动事件 ---------------- */
  function renderEvents() {
    const eff = mergedEffects(), live = activeEvents();
    const effCard = '<div class="card">' + cardHead('当前合并效果', '所有生效活动的倍率相乘、加成相加') +
      '<div class="grid grid-4">' +
      statCard('伤害倍率', 'x' + n2(eff.dmgScale), '影响每次撞击', 'accent') +
      statCard('生命倍率', 'x' + n2(eff.hpScale), '影响回合开始血量', 'blue') +
      statCard('备选技能', S.data.config.draftOptions + eff.extraDraft, '含活动加成', 'green') +
      statCard('技能干预', eff.ban + eff.boost, '禁用 + 精选', 'purple') +
      '</div><div class="faint" style="margin-top:12px">生效活动：' + (live.length ? live.map(e => esc(e.name)).join('、') : '无') +
      ' · 史诗权重 x' + n2(eff.tierMul.epic) + '</div></div>';
    const cards = S.data.events.length ? S.data.events.map(ev => {
      const on = live.indexOf(ev) >= 0;
      return '<div class="event-card ' + (on ? 'live' : '') + '">' +
        '<div class="ev-head"><strong>' + esc(ev.name) + '</strong>' +
        (on ? '<span class="badge badge-ok">生效中</span>' : ev.enabled === false ? '<span class="badge badge-mute">已停用</span>' : '<span class="badge badge-warn">未生效</span>') +
        '<span class="spacer"></span><span class="faint">' + esc(ev.id) + '</span></div>' +
        '<div class="ev-desc">' + esc(ev.description || '无描述') + '</div>' +
        '<div class="ev-time">' + esc(ev.start || '不限') + ' 至 ' + esc(ev.end || '不限') + (ev.alwaysOn ? ' · 忽略日期强制生效' : '') + '</div>' +
        '<div class="ev-effects">' + describeEffects(ev).split(' / ').map(x => '<span class="tag">' + esc(x) + '</span>').join('') + '</div>' +
        '<div class="ev-foot"><label class="switch"><input type="checkbox" data-change="ev-enabled" data-id="' + esc(ev.id) + '" ' + (ev.enabled !== false ? 'checked' : '') + '><i></i>启用</label>' +
        '<span class="spacer"></span><button class="mini-btn" data-act="ev-edit" data-id="' + esc(ev.id) + '">编辑</button>' +
        '<button class="mini-btn" data-act="ev-copy" data-id="' + esc(ev.id) + '">复制</button>' +
        '<button class="mini-btn danger" data-act="ev-del" data-id="' + esc(ev.id) + '">删除</button></div></div>';
    }).join('') : '<div class="table-empty">暂无活动</div>';
    return effCard + '<div class="card section-gap">' + cardHead('活动列表', '同一时间可有多个活动叠加',
      '<button class="primary-btn" data-act="ev-new" type="button">新增活动</button>') +
      '<div class="grid grid-2">' + cards + '</div></div>';
  }

  function eventForm(ev) {
    const o = ev || {
      id: '', name: '', enabled: true, alwaysOn: false, start: '', end: '', description: '',
      effects: { dmgScale: 1, hpScale: 1, tierMul: { common: 1, rare: 1, epic: 1 }, extraDraft: 0, skillBan: [], skillBoost: [] }
    };
    const f = (ev && ev.effects) || o.effects, tm = f.tierMul || {};
    const picker = (key, label, selected) => '<div class="field"><label>' + label + '</label>' +
      '<div style="max-height:150px;overflow-y:auto;border:1px solid var(--line-soft);border-radius:7px;padding:8px;background:#101824">' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 10px">' +
      S.data.skills.map(s => '<label style="font-size:11px;display:flex;align-items:center;gap:5px;color:var(--text-dim)">' +
        '<input type="checkbox" data-pick="' + key + '" value="' + esc(s.id) + '" ' + (selected.indexOf(s.id) >= 0 ? 'checked' : '') + '>' + esc(s.name) + '</label>').join('') +
      '</div></div></div>';
    return '<div class="form-grid">' +
      '<div class="field"><label>活动名称</label><input class="input" id="ef_name" value="' + esc(o.name) + '"></div>' +
      '<div class="field"><label>启用</label><label class="switch" style="margin-top:6px"><input type="checkbox" id="ef_enabled" ' + (o.enabled !== false ? 'checked' : '') + '><i></i>启用活动</label></div></div>' +
      '<div class="field"><label>描述</label><textarea class="textarea" id="ef_desc">' + esc(o.description || '') + '</textarea></div>' +
      '<div class="form-grid">' +
      '<div class="field"><label>开始日期</label><input class="input" type="date" id="ef_start" value="' + esc(o.start || '') + '"></div>' +
      '<div class="field"><label>结束日期</label><input class="input" type="date" id="ef_end" value="' + esc(o.end || '') + '"></div></div>' +
      '<label class="switch"><input type="checkbox" id="ef_always" ' + (o.alwaysOn ? 'checked' : '') + '><i></i>忽略日期，强制生效（便于测试）</label>' +
      '<div class="sub-title">全局倍率</div>' +
      numRow('ef_dmg', '伤害倍率', f.dmgScale == null ? 1 : f.dmgScale, 0.1, 3, 0.05) +
      numRow('ef_hp', '生命倍率', f.hpScale == null ? 1 : f.hpScale, 0.1, 3, 0.05) +
      numRow('ef_extra', '额外备选技能数', f.extraDraft || 0, 0, 4, 1) +
      '<div class="sub-title">稀有度权重倍率</div><div class="form-grid">' +
      numRow('ef_tm_common', '普通 x', tm.common == null ? 1 : tm.common, 0, 5, 0.1) +
      numRow('ef_tm_rare', '稀有 x', tm.rare == null ? 1 : tm.rare, 0, 5, 0.1) +
      numRow('ef_tm_epic', '史诗 x', tm.epic == null ? 1 : tm.epic, 0, 5, 0.1) + '</div>' +
      '<div class="sub-title">技能池干预</div>' +
      picker('skillBan', '禁用技能（不会出现在随机池）', f.skillBan || []) +
      picker('skillBoost', '精选技能（抽取权重 x2.5）', f.skillBoost || []);
  }
  function saveEventForm(id) {
    const name = val('ef_name').trim();
    if (!name) { toast('请填写活动名称', 'bad'); return false; }
    const picks = k => Array.from(document.querySelectorAll('[data-pick="' + k + '"]:checked')).map(e => e.value);
    const o = {
      id: id || uid('ev'), name: name, enabled: chk('ef_enabled'), alwaysOn: chk('ef_always'),
      start: val('ef_start'), end: val('ef_end'), description: val('ef_desc').trim(),
      effects: {
        dmgScale: numv('ef_dmg', 1), hpScale: numv('ef_hp', 1), extraDraft: numv('ef_extra', 0),
        tierMul: { common: numv('ef_tm_common', 1), rare: numv('ef_tm_rare', 1), epic: numv('ef_tm_epic', 1) },
        skillBan: picks('skillBan'), skillBoost: picks('skillBoost')
      }
    };
    if (id) S.data.events[S.data.events.findIndex(e => e.id === id)] = o;
    else S.data.events.push(o);
    markDirty(); refresh(); toast('活动已' + (id ? '更新' : '新增'), 'ok');
    return true;
  }

  /* ---------------- 校验与发布 ---------------- */
  function diffData(a, b) {
    const out = [];
    const cmp = (name, key) => {
      const A = a[key] || [], B = b[key] || [];
      const ai = new Set(A.map(x => x.id)), bi = new Set(B.map(x => x.id));
      B.filter(x => !ai.has(x.id)).forEach(x => out.push('新增' + name + '：' + esc(x.name || x.id)));
      A.filter(x => !bi.has(x.id)).forEach(x => out.push('删除' + name + '：' + esc(x.name || x.id)));
      B.forEach(x => {
        const old = A.find(y => y.id === x.id);
        if (old && JSON.stringify(old) !== JSON.stringify(x)) out.push('修改' + name + '：' + esc(x.name || x.id));
      });
    };
    cmp('职业', 'classes'); cmp('技能', 'skills'); cmp('地图', 'maps'); cmp('活动', 'events');
    if (JSON.stringify(a.config) !== JSON.stringify(b.config)) out.push('修改：全局数值参数');
    if (JSON.stringify(a.tierWeights) !== JSON.stringify(b.tierWeights)) out.push('修改：稀有度权重');
    if (a.activeMapId !== b.activeMapId) out.push('修改：主地图');
    return out.length ? out : ['与上次保存相比没有变更'];
  }

  function renderRelease() {
    const v = validate(S.data), diff = diffData(S.saved, S.data);
    let snaps = [];
    try { snaps = JSON.parse(localStorage.getItem(SNAP_KEY)) || []; } catch (e) { snaps = []; }
    const checks = v.errors.map(e => '<div class="check-item err"><span class="cdot"></span><span>' + e.text + '</span></div>').join('') +
      v.warnings.map(e => '<div class="check-item warn"><span class="cdot"></span><span>' + e.text + '</span></div>').join('') +
      v.oks.map(e => '<div class="check-item ok"><span class="cdot"></span><span>' + e.text + '</span></div>').join('');
    const size = (JSON.stringify(S.data).length / 1024).toFixed(1);
    return '<div class="grid grid-2">' +
      '<div class="card">' + cardHead('数据校验', '发布前自动执行；有错误时禁止发布',
        '<span class="badge ' + (v.errors.length ? 'badge-bad' : 'badge-ok') + '">' + (v.errors.length ? v.errors.length + ' 错误' : '通过') + '</span>') +
      '<div class="check-list">' + checks + '</div>' +
      '<div class="divider"></div>' +
      '<div class="row" style="justify-content:space-between"><span class="muted">职业 / 技能 / 地图 / 活动</span><strong>' +
      S.data.classes.length + ' / ' + S.data.skills.length + ' / ' + S.data.maps.length + ' / ' + S.data.events.length + '</strong></div>' +
      '<div class="row" style="justify-content:space-between;margin-top:8px"><span class="muted">配置体积</span><strong>' + size + ' KB</strong></div>' +
      '<div class="row" style="justify-content:space-between;margin-top:8px"><span class="muted">schema 版本</span><strong>v' + S.data.meta.schema + '</strong></div>' +
      '</div>' +

      '<div class="card">' + cardHead('发布操作', '浏览器本地保存即时生效；启动服务后可写入项目文件') +
      '<div class="tools" style="flex-wrap:wrap">' +
      '<button class="primary-btn" data-act="do-publish" type="button">发布配置</button>' +
      '<button class="ghost-btn" data-act="do-save" type="button">仅保存到浏览器</button>' +
      '<button class="ghost-btn" data-act="do-export" type="button">导出 JSON</button>' +
      '<button class="ghost-btn" data-act="do-import" type="button">导入 JSON</button>' +
      '<button class="ghost-btn" data-act="do-reset" type="button">恢复默认</button></div>' +
      '<div class="faint" style="line-height:1.7;margin-bottom:12px">' +
      (S.serverMode ? '本地服务已连接：发布会写入 <strong>data/game-config.json</strong>，并自动留一份历史快照。'
        : '当前未启动本地服务：保存写入浏览器 localStorage，游戏刷新即生效。若需要把配置落到项目文件，在项目目录运行 <strong>node server.js</strong> 后打开后台。') + '</div>' +
      '<div class="sub-title">本次变更（对比上次保存）</div>' +
      diff.slice(0, 18).map(d => '<div class="diff-line">' + d + '</div>').join('') +
      (diff.length > 18 ? '<div class="faint" style="margin-top:8px">另有 ' + (diff.length - 18) + ' 条变更</div>' : '') +
      '<div class="sub-title">本地快照（最近 10 次发布）</div>' +
      '<div class="faint" style="line-height:1.6;margin:-2px 0 8px">快照只保存配置结构，素材沿用当前版本；含贴图的完整备份见 data/history。</div>' +
      (snaps.length ? snaps.map((s, i) => '<div class="snap-item"><span>' + esc(s.label) + '</span><span class="spacer">' + esc(s.at.slice(0, 19).replace('T', ' ')) + '</span>' +
        '<button class="mini-btn" data-act="snap-restore" data-id="' + i + '">恢复</button></div>').join('')
        : '<div class="faint">尚无快照，每次发布会自动生成一份</div>') +
      '</div></div>';
  }

  /* ---------------- 动作分发 ---------------- */
  function handleAction(act, id, btn) {
    const find = (arr, key) => S.data[arr].find(x => x.id === key);
    switch (act) {
      case 'goto': switchTab(id); break;
      // 职业
      case 'class-new': openDrawer('新增职业', classForm(null), () => saveClassForm(null)); break;
      case 'class-edit': openDrawer('编辑职业 · ' + (find('classes', id) || {}).name, classForm(find('classes', id)), () => saveClassForm(id)); break;
      case 'class-copy': {
        const c = clone(find('classes', id)); c.id = uid('cls'); c.name = c.name + ' 副本'; c.enabled = false;
        S.data.classes.push(c); shopMeta(c.id); markDirty(); refresh(); toast('已复制职业（默认禁用，已上架商店）', 'ok'); break;
      }
      case 'class-del': confirmBox('删除职业', '确定删除该职业？引用它的技能会变成悬空引用，校验会报错。').then(ok => {
        if (!ok) return;
        S.data.classes = S.data.classes.filter(c => c.id !== id);
        const sh = shopCfg();
        sh.pool = sh.pool.filter(p => p.classId !== id);
        sh.starter = sh.starter.filter(x => x !== id);
        markDirty(); refresh(); toast('已删除', 'ok');
      }); break;
      // 弹珠外观
      case 'skin-select': S.skin.sel = id; refresh(); break;
      case 'skin-reset': {
        const c = currentSkinClass(); if (!c) break;
        const old = skinOf(c), s = SKIN.defaults();
        s.src = old.src; s.w = old.w; s.h = old.h; s.label = old.src ? false : true;
        c.skin = s;
        markDirty('skin-reset:' + c.id); refresh(); toast('已重置为默认参数', 'ok'); break;
      }
      case 'skin-remove': {
        const c = currentSkinClass(); if (!c) break;
        delete c.skin;
        markDirty('skin-remove:' + c.id); refresh(); toast('已移除「' + c.name + '」的外观图片', 'ok'); break;
      }
      case 'skin-open-game':
        saveToLocal(true).then(okSave => {
          if (okSave) { toast('已保存，游戏页读取最新配置', 'ok'); window.open('index.html', '_blank'); }
        });
        break;
      // 界面编辑器
      case 'ui-select': uiSelect(id); break;
      case 'ui-sync-cards': uiSyncCards(); break;
      case 'ui-reset-el': uiResetEl(); break;
      case 'ui-reset-screen': uiResetScreen(); break;
      case 'ui-remove-img': {
        if (!S.ui.key) break;
        delete uiPatch(true).img;
        uiCommit('已移除素材'); uiSyncProps();
        toast('已移除该元素的 PNG 素材', 'ok'); break;
      }
      case 'ui-open-game':
        saveToLocal(true).then(okSave => {
          if (okSave) { toast('界面配置已保存，游戏页刷新后生效', 'ok'); window.open('index.html', '_blank'); }
        });
        break;
      // 技能
      case 'skill-new': openDrawer('新增技能', skillForm(null), () => saveSkillForm(null)); break;
      case 'skill-edit': openDrawer('编辑技能 · ' + (find('skills', id) || {}).name, skillForm(find('skills', id)), () => saveSkillForm(id)); break;
      case 'skill-copy': {
        const s = clone(find('skills', id)); s.id = uid('sk'); s.name = s.name + ' 副本'; s.enabled = false;
        S.data.skills.push(s); markDirty(); refresh(); toast('已复制技能（默认禁用）', 'ok'); break;
      }
      case 'skill-del': confirmBox('删除技能', '确定删除该技能？活动中的引用需要同步清理。').then(ok => {
        if (!ok) return; S.data.skills = S.data.skills.filter(s => s.id !== id); markDirty(); refresh(); toast('已删除', 'ok');
      }); break;
      case 'batch-on': case 'batch-off': case 'batch-del': {
        const ids = selectedSkillIds();
        if (!ids.length) { toast('请先勾选技能', 'bad'); break; }
        const doIt = () => {
          if (act === 'batch-del') S.data.skills = S.data.skills.filter(s => ids.indexOf(s.id) < 0);
          else S.data.skills.forEach(s => { if (ids.indexOf(s.id) >= 0) s.enabled = act === 'batch-on'; });
          markDirty(); refresh(); toast('批量操作完成', 'ok');
        };
        if (act === 'batch-del') confirmBox('批量删除', '确定删除选中的 ' + ids.length + ' 个技能？').then(ok => { if (ok) doIt(); });
        else doIt();
        break;
      }
      // 数值
      case 'cfg-reset': confirmBox('恢复默认参数', '仅恢复全局数值参数，职业、技能、地图与活动保持不变。').then(ok => {
        if (!ok) return; S.data.config = clone(DEFAULT.config); S.data.tierWeights = clone(DEFAULT.tierWeights);
        markDirty(); refresh(); toast('已恢复默认参数', 'ok');
      }); break;
      case 'sim-run': runSim(); break;
      // 地图
      case 'map-tool': S.map.tool = id; refresh(); break;
      case 'ob-dup': duplicateSelected(); break;
      case 'ob-mirror': {
        const sel = S.map.sel; if (!sel || sel.type !== 'ob') break;
        const m = currentMap();
        const ob = (m.obstacles || []).find(o => o.id === sel.id);
        if (!ob) break;
        if (ob.pair) { toast('该障碍已有镜像配对', 'bad'); break; }
        m.obstacles.push(makeMirrorTwin(m, ob));
        S.hist.label = '生成对称镜像'; markDirty(); refresh();
        toast('已在对侧生成镜像障碍', 'ok'); break;
      }
      case 'map-mirror': toggleMirror(); break;
      case 'map-undo': stepHistory('undo'); break;
      case 'map-redo': stepHistory('redo'); break;
      case 'map-help': openShortcuts(); break;
      case 'map-snap': toggleSnap(); break;
      case 'map-duplicate': duplicateSelected(); break;
      case 'map-new': {
        const m = clone(S.data.maps[0] || DEFAULT.maps[0]);
        m.id = uid('map'); m.name = '新地图 ' + (S.data.maps.length + 1); m.obstacles = []; m.enabled = true;
        S.data.maps.push(m); S.map.id = m.id; S.map.sel = null;
        S.hist.label = '新增地图'; markDirty(); refresh(); toast('已新增地图', 'ok'); break;
      }
      case 'map-copy': {
        const m = clone(currentMap()); m.id = uid('map'); m.name = m.name + ' 副本'; m.enabled = false;
        S.data.maps.push(m); S.map.id = m.id;
        S.hist.label = '复制地图'; markDirty(); refresh(); toast('已复制地图（默认禁用）', 'ok'); break;
      }
      case 'map-del': confirmBox('删除地图', '若删除的是主地图，请先在下拉框切换并设为新的主地图。').then(ok => {
        if (!ok) return;
        S.data.maps = S.data.maps.filter(m => m.id !== currentMap().id);
        if (!S.data.maps.length) S.data.maps.push(clone(DEFAULT.maps[0]));
        if (!S.data.maps.some(m => m.id === S.data.activeMapId)) S.data.activeMapId = S.data.maps[0].id;
        S.map.id = S.data.activeMapId; S.map.sel = null;
        S.hist.label = '删除地图'; markDirty(); refresh(); toast('已删除', 'ok');
      }); break;
      case 'map-setactive':
        S.data.activeMapId = currentMap().id; S.hist.label = '切换主地图';
        markDirty(); refresh(); toast('已设为主地图，游戏刷新后生效', 'ok'); break;
      case 'map-rename': {
        const curName = currentMap().name;
        openDrawer('重命名地图',
          '<div class="field"><label>地图名称</label><input class="input" id="mapRenameInput" value="' + esc(curName) + '" maxlength="40"></div>',
          () => {
            const v = (($('mapRenameInput') && $('mapRenameInput').value) || '').trim();
            if (!v) { toast('名称不能为空', 'bad'); return false; }
            currentMap().name = v;
            S.hist.label = '重命名地图'; markDirty(); refresh();
            toast('已重命名为「' + v + '」', 'ok');
          });
        setTimeout(() => { const el = $('mapRenameInput'); if (el) { el.focus(); el.select(); } }, 30);
        break;
      }
      case 'ob-select': {
        S.map.sel = { type: 'ob', id: id };
        const p = $('mapProps'); if (p) { p.innerHTML = mapPropsHtml(currentMap()); paintSliders(p); }
        drawMap(); break;
      }
      case 'ob-del': {
        const sel = S.map.sel; if (!sel || sel.type !== 'ob') break;
        const m = currentMap(); deleteObstacle(m, sel.id);
        S.map.sel = null; S.hist.label = '删除障碍';
        markDirty();
        const p2 = $('mapProps'); if (p2) { p2.innerHTML = mapPropsHtml(m); paintSliders(p2); }
        drawMap(); break;
      }
      // 活动
      case 'ev-new': openDrawer('新增活动', eventForm(null), () => saveEventForm(null)); break;
      case 'ev-edit': openDrawer('编辑活动 · ' + (find('events', id) || {}).name, eventForm(find('events', id)), () => saveEventForm(id)); break;
      case 'ev-copy': {
        const ev = clone(find('events', id)); ev.id = uid('ev'); ev.name = ev.name + ' 副本'; ev.enabled = false;
        S.data.events.push(ev); markDirty(); refresh(); toast('已复制活动（默认停用）', 'ok'); break;
      }
      case 'ev-del': confirmBox('删除活动', '确定删除该活动？').then(ok => {
        if (!ok) return; S.data.events = S.data.events.filter(e => e.id !== id); markDirty(); refresh(); toast('已删除', 'ok');
      }); break;
      // 发布
      case 'do-publish': publish(); break;
      case 'do-save': saveToLocal(); refresh(); break;
      case 'do-export': exportJson(); break;
      case 'do-import': $('importFile').click(); break;
      case 'node-add-class': if (S.tab === 'studio') addNode('class'); break;
      case 'node-add-skill': if (S.tab === 'studio') addNode('skill'); break;
      case 'node-reset': if (S.tab === 'studio') { S.studio.node = defaultGraph(); refreshGraph(); toast('已重置为示例连线', 'ok'); } break;
      case 'pv-apply': if (S.tab === 'studio') pushPreviewConfig(); break;
      case 'do-reset': confirmBox('恢复默认配置', '将丢弃当前所有编辑，恢复为 game-data.js 的内置默认配置。建议先导出备份。').then(ok => {
        if (!ok) return;
        S.data = clone(DEFAULT); S.map.id = S.data.activeMapId; S.map.sel = null;
        resetHistory(); markDirty(); refresh(); toast('已恢复默认，记得保存或发布', 'ok');
      }); break;
      case 'snap-restore': confirmBox('恢复快照', '用该快照覆盖当前编辑内容。').then(ok => {
        if (!ok) return;
        let snaps = []; try { snaps = JSON.parse(localStorage.getItem(SNAP_KEY)) || []; } catch (e) { }
        if (snaps[Number(id)]) {
          S.data = restoreAssets(snaps[Number(id)].data, S.data);
          S.map.id = S.data.activeMapId; S.map.sel = null;
          resetHistory(); markDirty(); refresh(); toast('快照已载入，记得保存或发布', 'ok');
        }
      }); break;
    }
  }

  function handleChange(e) {
    const t = e.target;
    if (t.id === 'uiFile') {
      uiUploadFile(t.files && t.files[0]); t.value = ''; return;
    }
    const a = t.dataset.change, id = t.dataset.id;
    if (!a) return;
    switch (a) {
      case 'ui-screen': uiSetScreen(t.value); return;
      case 'ui-scale': S.ui.scale = Number(t.value) || 1; applyUiScale(); return;
      case 'ui-field':
        uiSetField(t.dataset.uiField, t.type === 'checkbox' ? (t.checked || null) : t.value);
        return;
      case 'showDisabled': S.filters.showDisabled = t.checked; refresh(); break;
      case 'skin-gloss': case 'skin-label': applySkinForm(); break;
      case 'tier': S.filters.tier = t.value; refresh(); break;
      case 'cls': S.filters.cls = t.value; refresh(); break;
      case 'simStage': S.sim.stage = Number(t.value); break;
      case 'simN': S.sim.n = Number(t.value); break;
      case 'mapSelect': S.map.id = t.value; S.map.sel = null; refresh(); break;
      case 'map-enabled':
        currentMap().enabled = t.checked; S.hist.label = '切换地图启用状态';
        markDirty(); refresh(); break;
      case 'ev-enabled': {
        const ev = S.data.events.find(x => x.id === id); if (ev) ev.enabled = t.checked;
        markDirty(); refresh(); break;
      }
      case 'shop-enabled': shopCfg().enabled = t.checked; markDirty(); refresh(); break;
      case 'shop-starter': {
        const sh = shopCfg();
        const i = sh.starter.indexOf(id);
        if (t.checked && i < 0) sh.starter.push(id);
        if (!t.checked && i >= 0) sh.starter.splice(i, 1);
        markDirty(); refresh(); break;
      }
      case 'shop-listed': shopMeta(id).listed = t.checked; markDirty(); refresh(); break;
      case 'shop-rarity': shopMeta(id).rarity = t.value; markDirty(); refresh(); break;
    }
  }

  function handleInput(e) {
    const t = e.target;
    if (S.tab === 'ui' && t.dataset.uiField) {
      uiSetField(t.dataset.uiField, t.value); return;
    }
    if (t.dataset.input === 'classQ') {
      S.filters.classQ = t.value;
      const p = t.selectionStart; refresh();
      const el = document.querySelector('[data-input="classQ"]'); if (el) { el.focus(); el.setSelectionRange(p, p); }
      return;
    }
    if (t.dataset.input === 'skillQ') {
      S.filters.skillQ = t.value;
      const p = t.selectionStart; refresh();
      const el = document.querySelector('[data-input="skillQ"]'); if (el) { el.focus(); el.setSelectionRange(p, p); }
      return;
    }
    const ikey = t.id || t.dataset.num || '';
    if (S.tab === 'skins' && ikey.indexOf('sk_') === 0) { applySkinForm(); return; }
    if (S.tab === 'maps') { onMapPropInput(e); return; }
    if (S.tab === 'shop') {
      if (t.dataset.input === 'shop-weight' && t.dataset.id) {
        shopMeta(t.dataset.id).weight = Math.max(0, numv2(t.value, 10));
        markDirty('shopweight:' + t.dataset.id);
        return;
      }
      if (t.id && t.id.indexOf('shop_') === 0) { applyShopForm(); markDirty(); }
      return;
    }
    if (S.tab === 'balance' && t.id && t.id.indexOf('cfg_') === 0) {
      applyConfigForm(); markDirty();
    }
  }

  /* ---------------- 事件绑定 ---------------- */
  $('nav').addEventListener('click', e => {
    const b = e.target.closest('[data-tab]'); if (b) switchTab(b.dataset.tab);
  });
  $('content').addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (b) { handleAction(b.dataset.act, b.dataset.id, b); return; }
    if (e.target.id === 'sf_clear') {
      MOD_META.forEach(m => { const el = $('md_' + m.k); if (el) el.value = 0; const r = document.querySelector('[data-num="md_' + m.k + '"]'); if (r) r.value = 0; });
      document.querySelectorAll('.mod-item').forEach(x => x.classList.remove('on'));
    }
  });
  $('content').addEventListener('change', handleChange);
  $('content').addEventListener('input', handleInput);
  window.addEventListener('message', onUiMessage);

  $('saveBtn').addEventListener('click', () => { if (S.tab === 'balance') applyConfigForm(); saveToLocal(); });
  $('publishBtn').addEventListener('click', () => { if (S.tab === 'balance') applyConfigForm(); publish(); });
  $('openGameBtn').addEventListener('click', () => window.open('index.html', '_blank'));
  $('importFile').addEventListener('change', e => { if (e.target.files[0]) importJson(e.target.files[0]); e.target.value = ''; });

  $('drawerClose').addEventListener('click', closeDrawer);
  $('drawerMask').addEventListener('click', closeDrawer);
  $('drawerCancel').addEventListener('click', closeDrawer);
  $('drawerSave').addEventListener('click', () => { if (S.drawerSave && S.drawerSave() !== false) closeDrawer(); });
  $('confirmCancel').addEventListener('click', () => closeConfirm(false));
  $('confirmOk').addEventListener('click', () => closeConfirm(true));
  $('helpBtn').addEventListener('click', openShortcuts);
  $('shortcutClose').addEventListener('click', closeShortcuts);
  $('shortcutModal').addEventListener('click', e => { if (e.target === $('shortcutModal')) closeShortcuts(); });

  function isTyping(t) {
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }
  function onKeyDown(e) {
    const k = e.key, mod = e.ctrlKey || e.metaKey, typing = isTyping(e.target);
    // 帮助面板最优先，任何状态下 Esc / ? / F1 都能关掉它
    if (!$('shortcutModal').hidden) {
      if (k === 'Escape' || k === '?' || k === 'F1') { e.preventDefault(); closeShortcuts(); }
      return;
    }
    // 抽屉或确认框打开时，只响应 Esc，避免误触发地图编辑
    if (!$('confirmModal').hidden || !$('drawer').hidden) {
      if (k === 'Escape') {
        e.preventDefault();
        if (!$('confirmModal').hidden) closeConfirm(false); else closeDrawer();
      }
      return;
    }
    // 全局保存：输入框内也生效
    if (mod && (k === 's' || k === 'S')) {
      e.preventDefault();
      if (S.tab === 'balance') applyConfigForm();
      saveToLocal();
      return;
    }
    // 输入框内保留浏览器原生的撤销、方向键、删除等编辑行为
    if (typing) return;
    if (mod && (k === 'z' || k === 'Z')) {
      e.preventDefault();
      if (S.tab === 'maps') stepHistory(e.shiftKey ? 'redo' : 'undo');
      return;
    }
    if (mod && (k === 'y' || k === 'Y')) {
      e.preventDefault();
      if (S.tab === 'maps') stepHistory('redo');
      return;
    }
    if (k === '?' || k === 'F1') { e.preventDefault(); openShortcuts(); return; }
    if (S.tab === 'studio' && (k === 'Delete' || k === 'Backspace')) { e.preventDefault(); deleteSelectedNode(); return; }
    if (S.tab !== 'maps') return;

    if (k === 'Escape') {
      e.preventDefault();
      if (S.map.drag || S.map.preview) {
        const d = S.map.drag;
        // 移动对象时坐标在 mousemove 里已改，取消必须还原，否则会留下未入历史栈的改动
        if (d && d.type === 'move') {
          const m = currentMap();
          const obj = d.sel.type === 'ob'
            ? (m.obstacles || []).find(o => o.id === d.sel.id)
            : m.spawns[d.sel.index];
          if (obj) {
            obj.x = d.orig.x; obj.y = d.orig.y;
            if (d.sel.type === 'ob' && d.twinOrig) {
              const twin = twinOf(m, obj);
              if (twin) { twin.x = d.twinOrig.x; twin.y = d.twinOrig.y; }
            }
          }
        }
        S.map.drag = null; S.map.preview = null;
        const p = $('mapProps'); if (p) { p.innerHTML = mapPropsHtml(currentMap()); paintSliders(p); }
        drawMap(); toast('已取消本次操作', 'ok');
      } else if (S.map.sel) {
        S.map.sel = null;
        const p = $('mapProps'); if (p) { p.innerHTML = mapPropsHtml(currentMap()); paintSliders(p); }
        drawMap();
      }
      return;
    }
    const toolKeys = { v: 'select', r: 'rect', c: 'circle', '1': 'spawn1', '2': 'spawn2', d: 'delete', x: 'delete' };
    const lk = String(k).toLowerCase();
    if (!mod && toolKeys[lk]) { e.preventDefault(); handleAction('map-tool', toolKeys[lk]); return; }
    if (!mod && lk === 'g') { e.preventDefault(); toggleSnap(); return; }
    if (!mod && lk === 'm') { e.preventDefault(); toggleMirror(); return; }
    if ((k === 'Delete' || k === 'Backspace') && S.map.sel && S.map.sel.type === 'ob') {
      e.preventDefault(); handleAction('ob-del'); return;
    }
    if (mod && lk === 'd') { e.preventDefault(); duplicateSelected(); return; }
    const step = e.shiftKey ? 10 : 1;
    const dirs = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (!mod && dirs[k]) { e.preventDefault(); nudgeSelected(dirs[k][0], dirs[k][1]); return; }
  }
  document.addEventListener('keydown', onKeyDown);

  /* ============================================================
     实时编排工作台：左侧拖拽连线式技能蓝图 + 右侧真引擎预览 + 实时事件日志
     ============================================================ */
  const NODE_W = 200, PORT_Y = 28;
  function className(id) { const c = S.data.classes.find(x => x.id === id); return c ? c.name : ''; }
  function classColor(id) { const c = S.data.classes.find(x => x.id === id); return c ? c.color : '#888'; }
  function skillById(id) { return S.data.skills.find(x => x.id === id); }
  function skillColor(id) { const s = skillById(id); if (!s) return '#888'; return s.cls ? classColor(s.cls) : '#9aa7bd'; }

  function defaultGraph() {
    const en = S.data.classes.filter(c => c.enabled !== false);
    const sk = S.data.skills.filter(s => s.enabled !== false);
    const c0 = en[0] ? en[0].id : null, c1 = en[1] ? en[1].id : (en[0] ? en[0].id : null);
    const s0 = sk[0] ? sk[0].id : null, s1 = sk[1] ? sk[1].id : null;
    return {
      nodes: [
        { id: 'n_class', type: 'class', x: 24, y: 48, classId: c0 },
        { id: 'n_skill1', type: 'skill', x: 320, y: 36, skillId: s0 },
        { id: 'n_skill2', type: 'skill', x: 320, y: 240, skillId: s1 },
        { id: 'n_result', type: 'result', x: 628, y: 130 }
      ],
      links: s0 ? [{ id: 'lk1', from: 'n_class', to: 'n_skill1' }, { id: 'lk2', from: 'n_skill1', to: 'n_result' }] : []
    };
  }

  function renderStudio() {
    const en = S.data.classes.filter(c => c.enabled !== false);
    const opts = en.map(c => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('');
    return '<div class="studio">' +
      '<div class="studio-top">' +
        '<div class="studio-left">' +
          '<div class="studio-toolbar">' +
            '<span class="st-tip">拖标题移动 · 从右侧圆点拖到左侧圆点连线 · 点连线删除 · Delete 删节点</span>' +
            '<span class="spacer"></span>' +
            '<button class="ghost-btn" data-act="node-add-class" type="button">+ 职业</button>' +
            '<button class="ghost-btn" data-act="node-add-skill" type="button">+ 技能</button>' +
            '<button class="ghost-btn" data-act="node-reset" type="button">重置连线</button>' +
          '</div>' +
          '<div class="node-canvas" id="nodeCanvas"><svg id="nodeLinks" class="node-links"></svg></div>' +
        '</div>' +
        '<div class="studio-right">' +
          '<div class="preview-head">' +
            '对阵 <select id="pvP" class="input">' + opts + '</select>' +
            '<span class="vs">VS</span>' +
            '<select id="pvE" class="input">' + opts + '</select>' +
            '<button class="ghost-btn" data-act="pv-apply" type="button">应用到预览</button>' +
            '<span id="pvStatus" class="badge badge-mute">待应用</span>' +
          '</div>' +
          '<iframe id="previewFrame" class="preview-frame" title="实时引擎预览"></iframe>' +
          '<div class="preview-note">右侧为真实游戏引擎实时运行（三回合自动循环）。左侧技能蓝图连线变化会即时反映到预览与下方事件日志。</div>' +
        '</div>' +
      '</div>' +
      '<div class="studio-bottom">' +
        '<div class="log-head">实时命中事件 <span id="logStats" class="badge badge-mute"></span></div>' +
        '<div class="event-log" id="eventLog"><div class="el-empty">对战中……命中事件会实时滚动到这里</div></div>' +
      '</div>' +
    '</div>';
  }

  function initStudio() {
    S.studio.opened = true;
    const en = S.data.classes.filter(c => c.enabled !== false);
    if (!S.studio.pvP || !en.some(c => c.id === S.studio.pvP)) S.studio.pvP = en[0] && en[0].id;
    if (!S.studio.pvE || !en.some(c => c.id === S.studio.pvE)) S.studio.pvE = (en[1] && en[1].id) || (en[0] && en[0].id);
    if (!S.studio.node) S.studio.node = defaultGraph();
    const pvP = $('pvP'), pvE = $('pvE');
    if (pvP) { pvP.value = S.studio.pvP; pvP.onchange = () => { S.studio.pvP = pvP.value; pushPreviewConfig(); }; }
    if (pvE) { pvE.value = S.studio.pvE; pvE.onchange = () => { S.studio.pvE = pvE.value; pushPreviewConfig(); }; }
    bindNodeCanvas();
    refreshGraph();
    pushPreviewConfig();
  }

  function bindNodeCanvas() {
    const cn = $('nodeCanvas'); if (!cn || cn.dataset.bound) return; cn.dataset.bound = '1';
    cn.addEventListener('mousedown', onCanvasMouseDown);
    cn.addEventListener('click', e => { const lk = e.target.closest('.node-link'); if (lk) { deleteLink(lk.dataset.link); } });
    cn.addEventListener('change', e => {
      const sel = e.target.closest('.node-sel'); if (!sel) return;
      const nd = S.studio.node.nodes.find(n => n.id === sel.dataset.node); if (!nd) return;
      nd[sel.dataset.field] = sel.value; markDirty(); refreshGraph();
    });
  }

  function nodeHtml(n) {
    const headColor = n.type === 'class' ? (classColor(n.classId) || '#888') : n.type === 'skill' ? (skillColor(n.skillId) || '#888') : '#7a8aa0';
    let body = '';
    if (n.type === 'class') {
      body = '<select class="node-sel" data-node="' + n.id + '" data-field="classId">' +
        S.data.classes.filter(c => c.enabled !== false).map(c => '<option value="' + c.id + '"' + (c.id === n.classId ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('') + '</select>';
    } else if (n.type === 'skill') {
      body = '<select class="node-sel" data-node="' + n.id + '" data-field="skillId">' +
        S.data.skills.filter(s => s.enabled !== false).map(s => '<option value="' + s.id + '"' + (s.id === n.skillId ? ' selected' : '') + '>' + esc(s.name) + ' · ' + (s.cls ? className(s.cls) : '通用') + '</option>').join('') + '</select>' +
        '<div class="' + (n._active ? 'node-active' : 'node-inactive') + '">' + (n._active ? '● 已接入' : '○ 未接入') + '</div>';
    } else {
      body = '<div class="result-stats" id="resultStats"></div>';
    }
    const inPort = n.type !== 'class' ? '<div class="port in" data-node="' + n.id + '"></div>' : '';
    const outPort = n.type !== 'result' ? '<div class="port out" data-node="' + n.id + '"></div>' : '';
    const title = n.type === 'class' ? '职业 · 来源' : n.type === 'skill' ? '技能 · 模块' : '结算 · 属性';
    return '<div class="node node-' + n.type + (S.studio.node.sel === n.id ? ' sel' : '') + '" data-id="' + n.id + '" style="left:' + n.x + 'px;top:' + n.y + 'px;width:' + NODE_W + 'px">' +
      '<div class="node-head" style="background:' + headColor + '">' + title + '</div>' + inPort + outPort +
      '<div class="node-body">' + body + '</div></div>';
  }

  function portCenter(id, kind) {
    const nd = S.studio.node.nodes.find(n => n.id === id); if (!nd) return null;
    return { x: nd.x + (kind === 'out' ? NODE_W : 0), y: nd.y + PORT_Y };
  }
  function pathBetween(a, b) {
    const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
    return '<path class="node-link" data-link="" d="M' + a.x + ',' + a.y + ' C' + (a.x + dx) + ',' + a.y + ' ' + (b.x - dx) + ',' + b.y + ' ' + b.x + ',' + b.y + '" marker-end="url(#arrow)"></path>';
  }
  function drawNodeLinks() {
    const svg = document.getElementById('nodeLinks'); if (!svg) return;
    const cn = $('nodeCanvas'); const W = cn ? cn.getBoundingClientRect().width : 800, H = cn ? cn.getBoundingClientRect().height : 500;
    svg.setAttribute('width', W); svg.setAttribute('height', H);
    let d = '<defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="#5fd0c5"></path></marker></defs>';
    S.studio.node.links.forEach(l => { const a = portCenter(l.from, 'out'), b = portCenter(l.to, 'in'); if (a && b) d += pathBetween(a, b).replace('data-link=""', 'data-link="' + l.id + '"'); });
    const lk = S.studio.node.linking;
    if (lk) { const a = portCenter(lk.from, 'out'); if (a) d += '<path class="node-link temp" d="M' + a.x + ',' + a.y + ' C' + (a.x + 60) + ',' + a.y + ' ' + (lk.x - 60) + ',' + lk.y + ' ' + lk.x + ',' + lk.y + '"></path>'; }
    svg.innerHTML = d;
  }
  function renderNodes() {
    const cn = $('nodeCanvas'); if (!cn) return;
    cn.innerHTML = '<svg id="nodeLinks" class="node-links"></svg>' + S.studio.node.nodes.map(nodeHtml).join('');
    drawNodeLinks();
  }
  function refreshGraph() {
    const r = studioCompute();
    (S.studio.node.nodes || []).forEach(n => { n._active = false; });
    if (r && r.activeNodeIds) r.activeNodeIds.forEach(id => { const nd = S.studio.node.nodes.find(n => n.id === id); if (nd) nd._active = true; });
    renderNodes();
    renderNodeStats(r);
  }
  function studioCompute() {
    const cn = S.studio.node.nodes.find(n => n.type === 'class');
    const rn = S.studio.node.nodes.find(n => n.type === 'result');
    if (!cn || !rn) return null;
    const cls = S.data.classes.find(c => c.id === cn.classId); if (!cls) return null;
    const eff = mergedEffects();
    // 技能要同时有「职业→技能」与「技能→结算」两条连线才算接入（真正的链接式工作流）
    const toResult = S.studio.node.links.filter(l => l.to === rn.id).map(l => l.from);
    const fromClass = S.studio.node.links.filter(l => l.from === cn.id).map(l => l.to);
    const activeNodeIds = toResult.filter(id => fromClass.indexOf(id) >= 0 && S.studio.node.nodes.find(n => n.id === id && n.type === 'skill'));
    const activeSkillIds = activeNodeIds.map(id => { const nd = S.studio.node.nodes.find(n => n.id === id); return nd ? nd.skillId : null; }).filter(Boolean).slice(0, 3);
    const m = {}; MOD_META.forEach(x => m[x.k] = 0);
    activeSkillIds.forEach(id => { const s = skillById(id); if (s) Object.keys(s.mods).forEach(k => { if (m[k] != null) m[k] += s.mods[k]; }); });
    const maxHp = Math.round((cls.hp + m.maxHp) * eff.hpScale);
    const power = cls.power * (1 + m.power);
    const speed = cls.speed * (1 + m.speed);
    const mass = cls.mass + m.mass;
    return { cls: cls, activeNodeIds: activeNodeIds, activeIds: activeSkillIds, m: m, maxHp: maxHp, power: power, speed: speed, mass: mass, crit: m.crit, shield: m.shield, hpScale: eff.hpScale, dmgScale: eff.dmgScale };
  }
  function renderNodeStats(r) {
    const box = document.getElementById('resultStats'); if (!box) return;
    if (!r) { box.innerHTML = '<div class="rs-empty">请选择职业节点</div>'; return; }
    const bar = (label, val, max, suffix) => {
      const pct = max ? clamp(val / max * 100, 0, 100) : 0;
      return '<div class="rs-row"><span class="rs-label">' + label + '</span><span class="rs-bar"><i style="width:' + pct + '%"></i></span><span class="rs-val">' + val + (suffix || '') + '</span></div>';
    };
    let h = '<div class="rs-class" style="color:' + r.cls.color + '">' + esc(r.cls.name) + '</div>';
    h += '<div class="rs-skills">' + (r.activeIds.length ? r.activeIds.map(id => { const s = skillById(id); return '<span class="mini-skill" data-tier="' + s.tier + '">' + esc(s.name) + '</span>'; }).join('') : '<span class="rs-none">未接入技能</span>') + '</div>';
    h += bar('生命', r.maxHp, 260, '');
    h += bar('伤害', r.power.toFixed(2), 1.8, '×');
    h += bar('速度', r.speed.toFixed(2), 1.8, '×');
    h += bar('质量', r.mass.toFixed(2), 2.6, '');
    h += bar('暴击率', Math.round(r.crit * 100), 70, '%');
    h += bar('护盾', Math.round(r.shield * 100), 70, '%');
    if (r.hpScale !== 1 || r.dmgScale !== 1) h += '<div class="rs-eff">活动倍率 · 生命×' + r.hpScale + ' 伤害×' + r.dmgScale + '</div>';
    box.innerHTML = h;
  }

  function onCanvasMouseDown(e) {
    const portOut = e.target.closest('.port.out');
    const head = e.target.closest('.node-head');
    if (portOut) {
      e.preventDefault();
      const node = portOut.closest('.node');
      S.studio.node.linking = { from: node.dataset.id, x: 0, y: 0 };
      const cn = $('nodeCanvas').getBoundingClientRect();
      S.studio.node.linking.x = e.clientX - cn.left; S.studio.node.linking.y = e.clientY - cn.top;
      document.addEventListener('mousemove', onLinkMove);
      document.addEventListener('mouseup', onLinkUp);
      return;
    }
    if (head) {
      e.preventDefault();
      const node = head.closest('.node'); const id = node.dataset.id;
      const cn = $('nodeCanvas').getBoundingClientRect();
      const nd = S.studio.node.nodes.find(n => n.id === id);
      S.studio.node.sel = id;
      S.studio.node.drag = { id: id, dx: e.clientX - (cn.left + nd.x), dy: e.clientY - (cn.top + nd.y) };
      document.addEventListener('mousemove', onNodeMouseMove);
      document.addEventListener('mouseup', onNodeMouseUp);
      // 仅刷新选中高亮，不重建整图
      document.querySelectorAll('.node').forEach(el => el.classList.toggle('sel', el.dataset.id === id));
    }
  }
  function onNodeMouseMove(e) {
    const d = S.studio.node.drag; if (!d) return;
    const cn = $('nodeCanvas').getBoundingClientRect();
    const nd = S.studio.node.nodes.find(n => n.id === d.id); if (!nd) return;
    nd.x = clamp(e.clientX - cn.left - d.dx, 0, cn.width - NODE_W);
    nd.y = clamp(e.clientY - cn.top - d.dy, 0, cn.height - 48);
    const el = document.querySelector('.node[data-id="' + d.id + '"]');
    if (el) { el.style.left = nd.x + 'px'; el.style.top = nd.y + 'px'; }
    drawNodeLinks();
  }
  function onNodeMouseUp() { S.studio.node.drag = null; document.removeEventListener('mousemove', onNodeMouseMove); document.removeEventListener('mouseup', onNodeMouseUp); }
  function onLinkMove(e) {
    const l = S.studio.node.linking; if (!l) return;
    const cn = $('nodeCanvas').getBoundingClientRect();
    l.x = e.clientX - cn.left; l.y = e.clientY - cn.top; drawNodeLinks();
  }
  function onLinkUp(e) {
    const l = S.studio.node.linking; S.studio.node.linking = null;
    document.removeEventListener('mousemove', onLinkMove); document.removeEventListener('mouseup', onLinkUp);
    if (!l) return;
    const tgt = document.elementFromPoint(e.clientX, e.clientY);
    const portIn = tgt && tgt.closest && tgt.closest('.port.in');
    if (portIn) { const toId = portIn.closest('.node').dataset.id; if (toId !== l.from) createLink(l.from, toId); }
    drawNodeLinks();
  }
  function createLink(from, to) {
    const f = S.studio.node.nodes.find(n => n.id === from), t = S.studio.node.nodes.find(n => n.id === to);
    if (!f || !t) return;
    if (f.type === 'result' || t.type === 'class') return;            // 出口只在职业/技能，入口只在技能/结算
    if (S.studio.node.links.some(l => l.from === from && l.to === to)) return;
    S.studio.node.links.push({ id: uid('lk'), from: from, to: to });
    markDirty(); refreshGraph();
  }
  function deleteLink(id) {
    S.studio.node.links = S.studio.node.links.filter(l => l.id !== id);
    markDirty(); refreshGraph();
  }
  function addNode(type) {
    const en = S.data.classes.filter(c => c.enabled !== false);
    const sk = S.data.skills.filter(s => s.enabled !== false);
    const nd = { id: uid('n'), type: type, x: 120 + Math.random() * 80, y: 60 + Math.random() * 120 };
    if (type === 'class') nd.classId = en[0] && en[0].id; else nd.skillId = sk[0] && sk[0].id;
    S.studio.node.nodes.push(nd); markDirty(); refreshGraph();
  }
  function deleteSelectedNode() {
    const id = S.studio.node.sel; if (!id) return;
    const nd = S.studio.node.nodes.find(n => n.id === id); if (!nd) return;
    if (nd.type === 'class' || nd.type === 'result') { toast('职业 / 结算节点不可删除', 'warn'); return; }
    S.studio.node.nodes = S.studio.node.nodes.filter(n => n.id !== id);
    S.studio.node.links = S.studio.node.links.filter(l => l.from !== id && l.to !== id);
    S.studio.node.sel = null; markDirty(); refreshGraph();
  }

  let _pvTimer = null;
  function schedulePreviewPush() {
    const st = $('pvStatus'); if (st) { st.textContent = '待应用'; st.className = 'badge badge-mute'; }
    if (_pvTimer) clearTimeout(_pvTimer);
    _pvTimer = setTimeout(pushPreviewConfig, 600);
  }
  function pushPreviewConfig() {
    try { localStorage.setItem('wowpinball.preview.v1', JSON.stringify(S.data)); } catch (e) { /* 存储不可用忽略 */ }
    const f = $('previewFrame');
    if (f) f.src = 'index.html?preview=1#matchup=' + (S.studio.pvP || '') + ',' + (S.studio.pvE || '');
    const st = $('pvStatus'); if (st) { st.textContent = '已应用'; st.className = 'badge badge-ok'; }
  }

  function appendEventLog(d) {
    const box = $('eventLog'); if (!box) return;
    const empty = box.querySelector('.el-empty'); if (empty) empty.remove();
    if (!S.studio._log) S.studio._log = { hits: 0, crits: 0, thorns: 0, dodges: 0 };
    const L = S.studio._log;
    let srcName = d.src === 'player' ? '我方' : '对手';
    let typeTxt = '命中', cls = 'el-hit';
    if (d.type === 'crit') { typeTxt = '暴击'; cls = 'el-crit'; L.crits++; }
    else if (d.type === 'thorns') { typeTxt = '反伤'; cls = 'el-thorns'; L.thorns++; }
    else if (d.type === 'dodge') { typeTxt = '闪避'; cls = 'el-dodge'; }
    else if (d.type === 'hit') { L.hits++; }
    if (d.type === 'dodge') L.dodges++;
    const row = document.createElement('div');
    row.className = 'el-row ' + cls;
    const pctColor = d.targetPct > 50 ? '#7fe0a8' : (d.targetPct > 25 ? '#f0d479' : '#ff9a92');
    row.innerHTML = '<span class="el-t">' + (d.round || '-') + '</span>' +
      '<span class="el-src ' + (d.src === 'player' ? 'src-p' : 'src-e') + '">' + srcName + '</span>' +
      '<span class="el-type">' + typeTxt + '</span>' +
      '<span class="el-dmg">' + (d.type === 'dodge' ? '—' : '-' + d.dmg) + '</span>' +
      '<span class="el-hp" style="color:' + pctColor + '">' + (d.targetPct != null ? d.targetPct + '%' : '') + '</span>';
    box.appendChild(row);
    while (box.children.length > 220) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
    const st = $('logStats'); if (st) st.textContent = '命中 ' + L.hits + ' · 暴击 ' + L.crits + ' · 反伤 ' + L.thorns + ' · 闪避 ' + L.dodges;
  }
  window.addEventListener('message', e => {
    const d = e.data; if (!d || d.kind !== 'pb') return;
    if (S.tab !== 'studio') return;
    appendEventLog(d);
  });

  /* ---------------- 启动 ---------------- */
  (async function boot() {
    await detectServer();
    loadData();
    S.map.id = S.data.activeMapId;
    resetHistory();
    refresh();
  })();
})();
