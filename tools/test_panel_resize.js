/* 后台版块尺寸可拖拽调节：源码结构回归
   node tools/test_panel_resize.js */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let fail = 0;
const ok = (n, c) => { if (c) console.log('  ok  ', n); else { fail++; console.log('  FAIL', n); } };

const admin = fs.readFileSync(path.join(ROOT, 'admin.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'admin.css'), 'utf8');

console.log('1) 四条分隔条与变量');
{
  ['left', 'right', 'preview', 'log'].forEach(k =>
    ok('存在 data-split="' + k + '"', admin.indexOf('data-split="' + k + '"') >= 0));
  ok('四条都有默认值', /SE_SIZE_DEF = \{ left: 340, right: 326, preview: 340, log: 110 \}/.test(admin));
  ok('四条都有上下限', /SE_SIZE_LIMIT = \{ left: \[160, 560\], right: \[220, 640\], preview: \[180, 900\], log: \[48, 520\] \}/.test(admin));
  ok('CSS 变量映射齐全', /SE_SIZE_VAR = \{ left: '--se-left-w', right: '--se-right-w', preview: '--se-preview-h', log: '--se-log-h' \}/.test(admin));
  ok('渲染时把尺寸写进 .se-wrap', /class="se-wrap' \+ \(S\.skillEd\.pvZoom[\s\S]{0,80}seSizeStyle\(\)/.test(admin));
}

console.log('\n2) 交互与持久化');
{
  ok('pointerdown 委托绑定', /addEventListener\('pointerdown'[\s\S]{0,200}data-split/.test(admin));
  ok('拖动改尺寸并夹到上下限', /Math\.max\(lim\[0\], Math\.min\(hi, Math\.round\(v\)\)\)/.test(admin));
  ok('试放区上限随窗口高度收敛', /avail - 240/.test(admin));
  ok('pointerup 移除监听并保存', /window\.removeEventListener\('pointerup', up\)[\s\S]{0,120}seSaveSizes\(\)/.test(admin));
  ok('localStorage 持久化', /localStorage\.setItem\('se-panel-sizes'/.test(admin));
  ok('读取时容错', /JSON\.parse\(localStorage\.getItem\('se-panel-sizes'[\s\S]{0,80}catch \(e\)/.test(admin));
  ok('双击恢复默认', /seSizes\(\)\[k\] = SE_SIZE_DEF\[k\]/.test(admin));
  ok('窗口 resize 同步卡片高度', /addEventListener\('resize'[\s\S]{0,120}seSyncCardHeight/.test(admin));
  ok('拖拽时禁止选中文字', /document\.body\.classList\.add\('se-resizing'\)/.test(admin));
}

console.log('\n2b) 流水线视图下试放必须照常启动（本轮发现并修掉的回归）');
{
  ok('initSkillEditor 不再强制依赖 #seStage',
    /const host = stage \|\| \$\('sePipelineHost'\); if \(!host\) return;/.test(admin));
  ok('节点拖拽监听只在模块图视图绑定', /if \(stage\) \{\s*stage\.addEventListener\('pointerdown'/.test(admin));
  ok('试放启动在 host 判断之后', admin.indexOf('seStartPreview(); seStartFxPreview();') > admin.indexOf("const host = stage || $('sePipelineHost')"));
}

console.log('\n2c) 参考式三栏重排与特效预览恢复');
{
  ok('主区只剩工具栏 / 画布区（介绍已收进工具栏）', /const main = '<div class="se-main">' \+ toolbar \+ stageArea \+ '<\/div>';/.test(admin));
  ok('试放区改为左栏内容', /const left = leftBase \+ previewHtml \+ '<\/div>';/.test(admin));
  ok('介绍栏折叠成 details', /<details class="se-intro"/.test(admin));
  ok('左栏内有 preview 分隔条', /data-act="se-pv-zoom"/.test(admin));
  ok('试放可一键放大', /if \(act === 'se-pv-zoom'\)/.test(admin));
  ok('CSS 放大态', /\.se-wrap\.pv-zoom \.se-left/.test(fs.readFileSync(path.join(ROOT, 'admin.css'), 'utf8')));

  // 特效预览：流水线视图没有选中节点，必须有独立的 fx 节点解析与入口
  ok('存在 seFxNode 解析器', /function seFxNode\(\)/.test(admin));
  ok('流水线 fxPick 用 @pl: 标记', /'@pl:' \+ \(b\.dataset\.pstage/.test(admin));
  ok('特效槽有「打开特效库」按钮', /data-act="se-p-open-fx"/.test(admin));
  ok('特效库相关调用改用 seFxNode', (admin.match(/const n = seFxNode\(\)/g) || []).length >= 6);
  ok('选定特效后同步回流水线 graph', /if \(n\._pl\) \{ seApplyPipeline\(\); seRepaintPipeline\(\); seTouch\(\); \}/.test(admin));
}

console.log('\n3) CSS 变量真正作用到面板');
{
  ok('左栏用变量', /\.se-left \{ flex: 0 0 var\(--se-left-w\)/.test(css));
  ok('右栏用变量', /\.se-right \{ flex: 0 0 var\(--se-right-w\)/.test(css));
  ok('试放区用变量', /\.se-preview \{[^}]*flex: 0 0 var\(--se-preview-h\)/.test(css));
  ok('事件记录用变量', /\.se-dbg-rows \{ max-height: var\(--se-log-h\)/.test(css));
  ok('流水线卡片高度跟随上区', /\.pl-body \{[^}]*var\(--se-card-h, 620px\)/.test(css));
  ok('横向分隔条 col-resize', /\.se-splitter\.x \{[^}]*cursor: col-resize/.test(css));
  ok('纵向分隔条 row-resize', /\.se-splitter\.y \{[^}]*cursor: row-resize/.test(css));
  let o = 0, c = 0; for (const ch of css) { if (ch === '{') o++; else if (ch === '}') c++; }
  ok('CSS 大括号配平', o === c);
}

console.log(fail ? '\nFAILED ' + fail + ' 项' : '\nALL PASS');
process.exit(fail ? 1 : 0);
