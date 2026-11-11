# -*- coding: utf-8 -*-
"""基于真实 admin.js / admin.html / admin.css 生成打了链路守卫补丁的可替换文件。
每个替换都断言原文唯一命中，避免静默漏改。"""
import os, io

SRC = '/data/inputs'
OUT = '/data/workspace/果实编辑器_真实代码补丁'
os.makedirs(OUT, exist_ok=True)

js = io.open(os.path.join(SRC, 'admin.js'), encoding='utf-8').read()
htm = io.open(os.path.join(SRC, 'admin.html'), encoding='utf-8').read()
css = io.open(os.path.join(SRC, 'admin.css'), encoding='utf-8').read()

patches = []


def sub(name, old, new, text, count=1):
    n = text.count(old)
    assert n == count, '[%s] 命中 %d 次（期望 %d）\n--- old ---\n%s' % (name, n, count, old[:400])
    patches.append({'name': name, 'old': old, 'new': new})
    return text.replace(old, new, count)


# ---------------------------------------------------------------- P1 全局引用
js = sub('P1 引入链路守卫全局引用', r'''  const DEFAULT = window.WOWPINBALL_DEFAULT;
  const SKIN = window.WowPinballSkin;
  const UI = window.WowPinballUI;
  const TIERS = { common: '普通', rare: '稀有', epic: '史诗' };''',
         r'''  const DEFAULT = window.WOWPINBALL_DEFAULT;
  const SKIN = window.WowPinballSkin;
  const UI = window.WowPinballUI;
  const SG = window.SkillGraphGuard;   // 链路守卫：连线校验 / 图体检 / 编译层对照
  const TIERS = { common: '普通', rare: '稀有', epic: '史诗' };''', js)

# ---------------------------------------------------------------- P2 辅助函数
GUARD_HELPERS = r'''  /* -------- 链路守卫（SkillGraphGuard）辅助 --------
     不改动 skill.graph 的存档结构，只在编辑期做三件事：
       1) 体检出结构问题（悬空边 / 成环 / 多入边归属冲突 / 孤立模块）
       2) 把守卫的确定性判断与 SM.compile() 的实际结果对照，报出「后台 vs 运行时」差异
       3) 连线前置拦截，避免加模块 / 加联动时把图连成不可裁决的状态 */
  function seGuardRefresh() {
    if (!SG || !window.SkillModules) { S.skillEd.guard = []; return; }
    const sk = seSkill();
    try { S.skillEd.guard = sk ? SG.check(sk, window.SkillModules) : []; }
    catch (e) { S.skillEd.guard = [{ code: 'GUARD_ERROR', level: 'warn', msg: String(e && e.message || e) }]; }
  }
  function seGuardBad(id) {
    return (S.skillEd.guard || []).some(x => x.level === 'error' && x.node === id);
  }
  function seGuardIssuesHtml() {
    const list = S.skillEd.guard || [];
    if (!list.length) return '<span class="sg-ok" title="链路结构与编译层结果一致">链路正常</span>';
    const errs = list.filter(x => x.level === 'error');
    const tips = list.slice(0, 6).map(x => x.msg + (x.hint ? '｜' + x.hint : '')).join('；');
    return '<span class="sg-issues' + (errs.length ? ' bad' : '') + '" title="' + esc(tips) + '">' +
      (errs.length ? '链路 ' + errs.length + ' 个错误' : '链路 ' + list.length + ' 项提示') + '</span>';
  }
  function seRepaintEdges() {
    const eh = $('seEdgesHost'); if (eh) eh.innerHTML = seEdgesHtml();
  }

'''
js = sub('P2 插入守卫辅助函数', r'''  function seBezier(a, b) {''', GUARD_HELPERS + r'''  function seBezier(a, b) {''', js)

# ---------------------------------------------------------------- P3 边引用改为稳定标识
js = sub('P3 删除连线改用稳定引用（不再靠数组下标）', r'''        return '<path class="se-edge-line" d="' + d + '" marker-end="url(#seArrow)"></path>' +
          '<path class="se-edge-hit" d="' + d + '" data-act="se-del-edge" data-id="' + i + '"><title>' + esc(tip) + '</title></path>';''',
         r'''        const eref = esc(e.from + (SG ? SG.SEP : '|') + e.to);
        return '<path class="se-edge-line" d="' + d + '" marker-end="url(#seArrow)"></path>' +
          '<path class="se-edge-hit" d="' + d + '" data-act="se-del-edge" data-id="' + eref + '"><title>' + esc(tip) + '</title></path>';''', js)

# ---------------------------------------------------------------- P4 问题节点红框 / 多选高亮
js = sub('P4 节点渲染接入体检结果', r'''      return '<div class="se-node' + (sel ? ' sel' : '') + (on ? '' : ' off') + '" data-node="' + esc(n.id) + '" style="left:' + (n.x || 0) + 'px;top:' + (n.y || 0) + 'px;--nc:' + d.color + '">' +''',
         r'''      return '<div class="se-node' + (sel ? ' sel' : '') + (on ? '' : ' off') +
        (seGuardBad(n.id) ? ' sg-bad' : '') +
        ((S.skillEd.multi || []).indexOf(n.id) >= 0 && n.id !== S.skillEd.sel ? ' sg-multi' : '') +
        '" data-node="' + esc(n.id) + '" style="left:' + (n.x || 0) + 'px;top:' + (n.y || 0) + 'px;--nc:' + d.color + '">' +''', js)

# ---------------------------------------------------------------- P5 组合链路栏追加体检
js = sub('P5 组合链路栏显示体检结果', r'''      (pubCount ? '<span class="se-combo-pub">公共模块 ' + pubCount + '</span>' : '') + issues;''',
         r'''      (pubCount ? '<span class="se-combo-pub">公共模块 ' + pubCount + '</span>' : '') + issues +
      seGuardIssuesHtml();''', js)

# ---------------------------------------------------------------- P6 seTouch 刷新体检
js = sub('P6 每次编辑后刷新体检与组合栏', r'''  function seTouch() { markDirty('skill-editor'); clearTimeout(S.skillEd.pvTimer); S.skillEd.pvTimer = setTimeout(seStartPreview, 350); }''',
         r'''  function seTouch() {
    markDirty('skill-editor');
    seGuardRefresh(); seRepaintCombo();
    clearTimeout(S.skillEd.pvTimer);
    S.skillEd.pvTimer = setTimeout(seStartPreview, 350);
  }''', js)

# ---------------------------------------------------------------- P7 删除连线
js = sub('P7 删除连线：按引用删 + 重绘边层', r'''    if (act === 'se-del-edge') { sk.graph.edges.splice(Number(id), 1); markDirty(); seRepaintNodes(); seTouch(); return; }''',
         r'''    if (act === 'se-del-edge') {
      const removed = SG ? SG.removeEdge(sk, id) : (sk.graph.edges.splice(Number(id), 1), 1);
      if (!removed) { toast('这条连线已不存在', 'bad'); return; }
      markDirty('se-del-edge');
      seGuardRefresh(); seRepaintNodes(); seRepaintEdges(); seRepaintCombo(); seTouch();
      return;
    }''', js)

# ---------------------------------------------------------------- P8 连线前置校验
OLD_LINK = r'''      if (node && node.dataset.node !== S.skillEd.link.from) {
        const sk = seSkill();
        const a = S.skillEd.link.from, b = node.dataset.node;
        if (!sk.graph.edges.some(x => x.from === a && x.to === b)) {
          sk.graph.edges.push({ from: a, to: b });
          const CC = SM.compile(sk);
          const owner = CC.bindings && CC.bindings.byNode && CC.bindings.byNode[b];
          const host = owner ? (CC.hosts || []).find(h => h.id === owner) : null;
          const nd = sk.graph.nodes.find(n => n.id === b);
          const what = nd ? (SM.MODULES[nd.type].short || SM.MODULES[nd.type].label) : '模块';
          markDirty('se-link');
          toast(host ? '已连接：' + what + ' 的属性作用于 ' + host.label : '已连接：' + what + ' 作用于技能整体', 'ok');
        }
        seRepaintNodes(); seTouch();
      }'''
NEW_LINK = r'''      if (node && node.dataset.node !== S.skillEd.link.from) {
        const sk = seSkill();
        const a = S.skillEd.link.from, b = node.dataset.node;
        const res = SG ? SG.connect(sk, SM, a, b) : (function () {
          if (sk.graph.edges.some(x => x.from === a && x.to === b)) return { ok: false, code: 'DUP_EDGE', msg: '这两个模块已经连过了' };
          sk.graph.edges.push({ from: a, to: b });
          return { ok: true };
        })();
        if (!res.ok) {
          toast(res.msg, 'bad');
        } else {
          const CC = SM.compile(sk);
          const owner = CC.bindings && CC.bindings.byNode && CC.bindings.byNode[b];
          const host = owner ? (CC.hosts || []).find(h => h.id === owner) : null;
          const nd = sk.graph.nodes.find(n => n.id === b);
          const what = nd ? (SM.MODULES[nd.type].short || SM.MODULES[nd.type].label) : '模块';
          markDirty('se-link');
          toast(host ? '已连接：' + what + ' 的属性作用于 ' + host.label : '已连接：' + what + ' 作用于技能整体', 'ok');
          seGuardRefresh();
          const bads = (S.skillEd.guard || []).filter(x => x.level === 'error');
          if (bads.length) toast('链路体检：' + bads[0].msg, 'bad');
        }
        seRepaintNodes(); seRepaintEdges(); seRepaintCombo(); seTouch();
      }'''
js = sub('P8 连线前做结构校验（核心修复）', OLD_LINK, NEW_LINK, js)

# ---------------------------------------------------------------- P9 复制：支持多选 + 保留内部连线
OLD_COPY = r'''  function seCopyNode() {
    const sk = seSkill(); if (!sk) return false;
    const sel = S.skillEd.sel;
    if (!sel) { toast('先选中一个模块再复制（Ctrl+C）', 'bad'); return false; }
    const nodes = (sk.graph.nodes || []).filter(n => n.id === sel);
    if (!nodes.length) return false;
    S.skillEd.clip = { nodes: clone(nodes), edges: [] };
    toast('已复制「' + (SM.MODULES[nodes[0].type].short || '模块') + '」，Ctrl+V 粘贴', 'ok');
    return true;
  }'''
NEW_COPY = r'''  function seCopyNode() {
    const sk = seSkill(); if (!sk) return false;
    const sel = S.skillEd.sel;
    if (!sel) { toast('先选中一个模块再复制（Ctrl+C）；按住 Shift 点选可多选', 'bad'); return false; }
    const ids = (S.skillEd.multi && S.skillEd.multi.length) ? S.skillEd.multi.slice() : [sel];
    const nodes = (sk.graph.nodes || []).filter(n => ids.indexOf(n.id) >= 0);
    if (!nodes.length) return false;
    // 多选时保留「被选中模块之间」的连线；指向外部模块的线一律不复制
    S.skillEd.clip = SG ? SG.cloneSelection(sk, ids, uid) : { nodes: clone(nodes), edges: [] };
    const c = S.skillEd.clip;
    toast('已复制 ' + c.nodes.length + ' 个模块' + (c.edges.length ? '（含 ' + c.edges.length + ' 条内部连线）' : '') + '，Ctrl+V 粘贴', 'ok');
    return true;
  }'''
js = sub('P9 复制模块支持多选并保留内部连线', OLD_COPY, NEW_COPY, js)

# ---------------------------------------------------------------- P10 粘贴：id 重映射
OLD_PASTE = r'''  function sePasteNode() {
    const sk = seSkill(); if (!sk) return false;
    const clip = S.skillEd.clip;
    if (!clip || !clip.nodes.length) { toast('剪贴板是空的：先选中模块按 Ctrl+C', 'bad'); return false; }
    const idMap = {}, added = [];
    clip.nodes.forEach(src => {
      const n = clone(src);
      const nid = uid(n.type);
      idMap[src.id] = nid;
      n.id = nid;
      n.x = Math.max(0, (Number(n.x) || 0) + 28);
      n.y = Math.max(0, (Number(n.y) || 0) + 28);
      added.push(n);
    });
    sk.graph.nodes = (sk.graph.nodes || []).concat(added);
    (clip.edges || []).forEach(e => {
      const from = idMap[e.from], to = idMap[e.to];
      if (from && to && !(sk.graph.edges || []).some(x => x.from === from && x.to === to)) sk.graph.edges.push({ from: from, to: to });
    });
    S.skillEd.sel = added[0].id;
    S.skillEd.fxPick = added[0].type === 'fx' ? added[0].id : null;
    markDirty('se-paste');
    seRepaintAll();
    toast('已粘贴「' + (SM.MODULES[added[0].type].short || '模块') + '」，记得连线', 'ok');
    return true;
  }'''
NEW_PASTE = r'''  function sePasteNode() {
    const sk = seSkill(); if (!sk) return false;
    const clip = S.skillEd.clip;
    if (!clip || !clip.nodes.length) { toast('剪贴板是空的：先选中模块按 Ctrl+C', 'bad'); return false; }
    let added = [];
    if (SG) {
      const ids = SG.paste(sk, clip, { uid: uid, dx: 28, dy: 28 });
      added = ids.map(id => (sk.graph.nodes || []).find(n => n.id === id)).filter(Boolean);
    } else {
      const idMap = {};
      clip.nodes.forEach(src => {
        const n = clone(src), nid = uid(n.type);
        idMap[src.id] = nid; n.id = nid;
        n.x = Math.max(0, (Number(n.x) || 0) + 28);
        n.y = Math.max(0, (Number(n.y) || 0) + 28);
        added.push(n);
      });
      sk.graph.nodes = (sk.graph.nodes || []).concat(added);
      (clip.edges || []).forEach(e => {
        const from = idMap[e.from], to = idMap[e.to];
        if (from && to && !(sk.graph.edges || []).some(x => x.from === from && x.to === to)) sk.graph.edges.push({ from: from, to: to });
      });
    }
    if (!added.length) return false;
    S.skillEd.sel = added[0].id;
    S.skillEd.fxPick = added[0].type === 'fx' ? added[0].id : null;
    S.skillEd.multi = added.map(n => n.id);
    markDirty('se-paste');
    seGuardRefresh(); seRepaintAll();
    toast('已粘贴 ' + added.length + ' 个模块' +
      (clip.edges && clip.edges.length ? '（' + clip.edges.length + ' 条内部连线已还原）' : '，记得连线'), 'ok');
    return true;
  }'''
js = sub('P10 粘贴保留内部绑定关系', OLD_PASTE, NEW_PASTE, js)

# ---------------------------------------------------------------- P11 发布校验接入图体检
OLD_VAL = r'''      if (!hasGraphFx && (!describeMods(s.mods) || describeMods(s.mods) === '无效果')) warn('技能「' + esc(s.name) + '」没有任何效果');'''
NEW_VAL = r'''      if (!hasGraphFx && (!describeMods(s.mods) || describeMods(s.mods) === '无效果')) warn('技能「' + esc(s.name) + '」没有任何效果');
      /* 链路守卫：图结构问题与「编辑器判断 vs 编译层实际」差异，发布前拦一道。
         用 window.* 而非模块级常量，避免函数定义位置早于常量初始化。 */
      if (window.SkillGraphGuard && window.SkillModules) {
        try {
          window.SkillGraphGuard.check(s, window.SkillModules).forEach(it => {
            const line = '果实「' + esc(s.name) + '」链路：' + esc(it.msg) +
              (it.hint ? '（' + esc(it.hint) + '）' : '');
            (it.level === 'error' ? err : warn)(line);
          });
        } catch (e) { warn('果实「' + esc(s.name) + '」链路体检异常：' + esc(String(e && e.message || e))); }
      }'''
js = sub('P11 校验与发布页接入图体检', OLD_VAL, NEW_VAL, js)

# ---------------------------------------------------------------- P12 渲染入口刷新体检
js = sub('P12 打开编辑器即刷新体检', r'''  function renderSkillEditor() {
    if (!SM) return renderSkills();
    const sk = seSkill();''',
         r'''  function renderSkillEditor() {
    if (!SM) return renderSkills();
    seGuardRefresh();
    const sk = seSkill();''', js)

# ---------------------------------------------------------------- P13 试放前探测旧编译层缓存
js = sub('P13 试放前检测编译层版本，避免后台与游戏端走不同分支', r'''  function seStartPreview() {
    if (S.skillEd.stopPreview) { S.skillEd.stopPreview(); S.skillEd.stopPreview = null; }
    const cv = $('sePreviewCanvas'); if (!cv || !window.SkillEffects || !SM) return;''',
         r'''  function seStartPreview() {
    if (SG) {
      const bt = SG.buildTag(SM);
      if (!bt.fresh && !S.skillEd._buildWarned) { S.skillEd._buildWarned = true; toast(bt.advice, 'bad'); }
    }
    if (S.skillEd.stopPreview) { S.skillEd.stopPreview(); S.skillEd.stopPreview = null; }
    const cv = $('sePreviewCanvas'); if (!cv || !window.SkillEffects || !SM) return;''', js)

# ---------------------------------------------------------------- P14 载入存档时清理无效连线
js = sub('P14 载入配置时自动清理悬空/重复/自连边', r'''    (d.skills || []).forEach(s => {
      s.mods = s.mods || {};''',
         r'''    (d.skills || []).forEach(s => {
      s.mods = s.mods || {};
      // 清掉指向已删除模块的悬空边与重复边：旧存档里这类线在画布上不可见、删不掉，
      // 但编译层仍会读到，是「加模块后逻辑不对」的隐形来源。
      if (window.SkillGraphGuard && s.graph) {
        const cr = window.SkillGraphGuard.clean(s);
        if (cr.removed) console.info('[链路守卫] 果实「' + s.name + '」载入时清理了 ' + cr.removed + ' 条无效连线');
      }''', js)

# ---------------------------------------------------------------- P15 新增模块后提示未接入
js = sub('P15 新增模块后即时体检', r'''      markDirty(); refresh(); toast('已添加「' + SM.MODULES[id].label + '」，记得连线到触发节点', 'ok'); return;''',
         r'''      markDirty(); seGuardRefresh(); refresh();
      const orphan = (S.skillEd.guard || []).some(x => x.code === 'ORPHAN' && x.node === n.id);
      toast('已添加「' + SM.MODULES[id].label + '」' +
        (orphan ? '，当前未接入（运行时不会执行），请连到触发节点或载体上' : '，记得检查连线'), 'ok');
      return;''', js)

# ---------------------------------------------------------------- P16 Shift 多选
OLD_SEL = r'''      if (ne) {
        S.skillEd.sel = ne.dataset.node;
        const n = seNode(S.skillEd.sel);
        S.skillEd.fxPick = (n && n.type === 'fx') ? n.id : null;
        seRepaintNodes(); seRepaintRight();
      }'''
NEW_SEL = r'''      if (ne) {
        const nid = ne.dataset.node;
        if (e.shiftKey) {
          S.skillEd.multi = S.skillEd.multi || [];
          const i = S.skillEd.multi.indexOf(nid);
          if (i >= 0) S.skillEd.multi.splice(i, 1); else S.skillEd.multi.push(nid);
        } else S.skillEd.multi = [nid];
        S.skillEd.sel = nid;
        const n = seNode(S.skillEd.sel);
        S.skillEd.fxPick = (n && n.type === 'fx') ? n.id : null;
        seRepaintNodes(); seRepaintRight();
      }'''
js = sub('P16 Shift 点选多模块（配合多路复制）', OLD_SEL, NEW_SEL, js)

# ---------------------------------------------------------------- P17 html 引入守卫
htm = sub('P17 admin.html 引入 skill-graph-guard.js', r'''<script src="skill-modules.js"></script>
<script src="skill-effects.js"></script>''',
          r'''<script src="skill-modules.js"></script>
<!-- 链路守卫：连线前置校验 / 图体检 / 编译层对照；须在 skill-modules 之后、admin.js 之前 -->
<script src="skill-graph-guard.js"></script>
<script src="skill-effects.js"></script>''', htm)

# ---------------------------------------------------------------- P18 css
CSS_ADD = r'''

/* ---------- 链路守卫（SkillGraphGuard）---------- */
.se-node.sg-bad { outline: 2px solid #e06666; outline-offset: 2px; }
.se-node.sg-multi { box-shadow: 0 0 0 2px #6f9ede; }
.sg-issues, .sg-ok {
  display: inline-block; font-size: 10.5px; padding: 3px 8px; border-radius: 5px;
  border: 1px solid; margin-left: 6px; white-space: nowrap; cursor: help;
}
.sg-ok { color: #6fd39b; background: #14281f; border-color: #2f6249; }
.sg-issues { color: #e8c26a; background: #2a2414; border-color: #6b542a; }
.sg-issues.bad { color: #f0a4a4; background: #2a1a1e; border-color: #7a4149; }
'''
css = css + CSS_ADD
patches.append({'name': 'P18 追加问题节点 / 体检徽标样式', 'old': '（文件末尾追加）', 'new': CSS_ADD.strip()})

# ---------------------------------------------------------------- 输出
io.open(os.path.join(OUT, 'admin.patched.js'), 'w', encoding='utf-8').write(js)
io.open(os.path.join(OUT, 'admin.patched.html'), 'w', encoding='utf-8').write(htm)
io.open(os.path.join(OUT, 'admin.patched.css'), 'w', encoding='utf-8').write(css)

lines = ['# admin.js / admin.html / admin.css 补丁对照', '',
         '共 %d 处替换，全部断言原文唯一命中。可直接用 `admin.patched.*` 覆盖同名文件。' % len(patches), '',
         '> 新增文件 `skill-graph-guard.js` 需放到站点静态根目录，与 admin.js 同级。', '']
for i, p in enumerate(patches, 1):
    lines += ['---', '', '## %s' % p['name'], '', '**改前**', '', '```js', p['old'].strip()[:900], '```', '',
              '**改后**', '', '```js', p['new'].strip()[:900], '```', '']
io.open(os.path.join(OUT, '补丁对照.md'), 'w', encoding='utf-8').write('\n'.join(lines))

print('补丁数:', len(patches))
print('admin.patched.js 行数:', js.count('\n') + 1, '字节:', len(js.encode('utf-8')))
print('admin.patched.html 字节:', len(htm.encode('utf-8')))
print('admin.patched.css 字节:', len(css.encode('utf-8')))
