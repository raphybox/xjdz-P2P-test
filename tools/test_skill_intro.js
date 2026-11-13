/* 技能介绍（intro）回归：从真实源码里抽出函数体在 vm 中执行，不做纸面猜测
   覆盖：SKILLS 映射透传 / 卡牌正文介绍优先 / 留空回退机制摘要 / 用户文案 HTML 转义 / 后台编辑链路静态断言 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const game = read('game.js'), admin = read('admin.js'), cssA = read('admin.css'), cssG = read('styles.css');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' → ' + extra : '')); }
}
function eq(name, got, want) { ok(name, got === want, 'got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
function seg(src, a, b) {
  const i = src.indexOf(a), j = src.indexOf(b, i);
  if (i < 0 || j < 0) throw new Error('抽取失败: ' + a);
  return src.slice(i, j + b.length);
}
/* 停在结束标记之前，用于「抽到下一个函数/注释为止」的场景，避免把未闭合的函数头带进 vm */
function segEnd(src, a, b) {
  const i = src.indexOf(a), j = src.indexOf(b, i);
  if (i < 0 || j < 0) throw new Error('抽取失败: ' + a);
  return src.slice(i, j);
}

console.log('1) game.js：SKILLS 映射把 intro 与自动生成的 desc 分开');
const mapCode = segEnd(game, 'const skillClsArr =', '\n  /* ---------------------------------------------------------\n     4. 工具');
const escCode = segEnd(game, 'function escHtml(s) {', '\n  /* ---------------------------------------------------------\n     8.7 昵称弹层');
const ctx = {
  DATA: {
    skills: [
      { id: 'a', name: '烈焰之径', cls: 'mage', tier: 'rare', mods: { maxHp: 16 }, charge: 2, enabled: true, intro: '  灼烧大地，留下火径  ' },
      { id: 'b', name: '寒霜印记', cls: null, tier: 'common', mods: { crit: 0.1 }, enabled: true },
      { id: 'c', name: '断筋', cls: null, tier: 'epic', mods: {}, enabled: true, intro: '<img src=x onerror=alert(1)>"&\'' }
    ]
  },
  MOD_LABEL: { maxHp: v => '生命 +' + v, crit: v => '暴击 +' + Math.round(v * 100) + '%' },
  CLASSES: [{ id: 'mage', name: '法师' }],
  TIER_NAME: { common: '普通', rare: '稀有', epic: '史诗' },
  window: { SkillModules: null },
  fruitIcon: x => (x && x.icon) ? x.icon : '',
  console: console
};
vm.createContext(ctx);
const fruitCardSrc = segEnd(game, '  function fruitCardHtml(x, i) {', '\n  function chooseSkill(i) {');
vm.runInContext(escCode + '\n' + fruitCardSrc + '\n' + mapCode +
  '\nthis.SKILLS = SKILLS; this.escHtml = escHtml;', ctx);
const S = ctx.SKILLS;
eq('介绍收尾空白被清理', S[0].intro, '灼烧大地，留下火径');
eq('旧技能无 intro → 空串', S[1].intro, '');
ok('自动机制摘要未被介绍覆盖', S[0].desc.indexOf('生命 +16') >= 0 && S[0].desc.indexOf('灼烧大地') < 0, S[0].desc);
eq('无 intro 技能仍有机制摘要', S[1].desc.indexOf('暴击 +10%') >= 0, true);

console.log('2) 选技能卡牌：介绍优先 + 留空回退 + 用户文案转义');
const cardCode = seg(game, 'dom.draftCards.innerHTML = G.draftOptions.map', ").join('');");
ctx.G = { draftOptions: S };
ctx.dom = { draftCards: { innerHTML: '', querySelectorAll: () => [] } };
vm.runInContext(cardCode + '\nthis.__html = dom.draftCards.innerHTML;', ctx);
const html = ctx.__html;
ok('卡牌正文显示自定义介绍', html.indexOf('灼烧大地，留下火径') >= 0);
ok('留空技能回退到机制摘要', html.indexOf('暴击 +10%') >= 0);
ok('恶意介绍被转义，不出现可执行标签', html.indexOf('<img src=x') < 0 && html.indexOf('&lt;img src=x') >= 0);
ok('双引号与 & 被转义', html.indexOf('&quot;&amp;&#39;') >= 0, html.slice(-500));
ok('有介绍时 title 附机制摘要', html.indexOf('【机制】') >= 0);
ok('技能名/稀有度也走转义', html.indexOf('class="sc-name">烈焰之径') >= 0);

console.log('3) 其它展示位同样带介绍且已转义');
const miniAt = game.indexOf('function renderMiniSkills(skills)');
const mini = game.slice(miniAt, game.indexOf('\n  function ', miniAt + 10));
ok('技能条 hover 使用 intro 且 escHtml', /s\.intro \?/.test(mini) && /escHtml\(tip\)/.test(mini));
const recap = game.slice(game.indexOf('function buildCol('), game.indexOf('function buildCol(') + 600);
ok('回合战报 hover 使用 intro 且 escHtml', /s\.intro/.test(recap) && /escHtml\(/.test(recap));

console.log('4) 后台编辑器：字段、写入、搜索、校验、旧表单');
ok('编辑器存在介绍输入框', admin.indexOf('data-semeta="intro"') >= 0 && admin.indexOf('id="seIntro"') >= 0);
ok('介绍收进工具栏（不独占一行）', admin.indexOf("introBar + '</div>'") >= 0 && !/toolbar \+ introBar/.test(admin));
const onInput = seg(admin, 'function seOnInput(e) {', '\n  function seAction(');
ok('输入介绍只写模型+列表，不重启试放', /if \(k === 'intro'\)[\s\S]{0,260}seRepaintList\(\); return true;/.test(onInput) && !/if \(k === 'intro'\)[\s\S]{0,260}seTouch\(\)/.test(onInput));
ok('列表显示介绍摘要与完整 title', admin.indexOf('se-item-intro') >= 0 && /title="' \+ esc\(intro\)/.test(admin));
ok('搜索覆盖介绍', /s\.name \+ s\.id \+ \(s\.intro \|\| ''\)/.test(admin));
ok('旧存档类型兜底', /if \(s\.intro != null && typeof s\.intro !== 'string'\)/.test(admin));
ok('校验介绍类型与长度', /介绍不是文本/.test(admin) && /介绍超过 300 字/.test(admin));
ok('新增/预设技能带空介绍', (admin.match(/intro: ''/g) || []).length >= 2);
ok('旧版技能表单可编辑介绍且保留节点图', /id="sf_intro"/.test(admin) && /Object\.assign\(\{\}, prev \|\| \{\}/.test(admin));

console.log('5) 样式与配平');
ok('介绍条样式存在', /\.se-intro \{/.test(cssA) && /\.se-item-intro \{/.test(cssA));
ok('卡牌支持多行且限制行数', /\.sc-effect \{[^}]*pre-line/.test(cssG) && /-webkit-line-clamp: 4/.test(cssG));
for (const [name, s] of [['admin.css', cssA], ['styles.css', cssG]]) {
  eq(name + ' 大括号配平', (s.match(/{/g) || []).length, (s.match(/}/g) || []).length);
}

console.log('\n' + (fail ? 'FAILED ' + fail + ' 项' : '全部通过 ' + pass + ' 项'));
process.exit(fail ? 1 : 0);
