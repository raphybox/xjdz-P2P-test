/* 投射物 PNG 素材回归测试
   覆盖：字段定义 / 编译透传 / 弹体携带 / 两端共用绘制 / 100KB 口径 / 快照剥离 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SM = require(path.join(ROOT, 'skill-modules.js'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  [' + extra + ']' : '')); }
}
function loadEngine(extraWindow) {
  const code = fs.readFileSync(path.join(ROOT, 'skill-effects.js'), 'utf8');
  const ctx = { window: Object.assign({}, extraWindow || {}), console, Math, Object, Number, String, Array, JSON, isFinite };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return ctx.window.SkillEffects;
}

console.log('\n1) 字段定义');
const fields = SM.MODULES.projectile.fields;
const fImg = fields.find(f => f.key === 'image');
ok('投射物模块有「投射物图片」字段', !!fImg, JSON.stringify(Object.keys(fImg || {})));
ok('字段类型 = image', fImg && fImg.type === 'image');
ok('默认值为空字符串（缺省不改变外观）', fImg && fImg.def === '');
ok('说明写明 PNG 与 100 KB 上限', !!fImg && /PNG/.test(fImg.hint || '') && /100\s*KB/.test(fImg.hint || ''));
ok('说明写明留空回退元素颜色圆', !!fImg && /留空/.test(fImg.hint || ''));
const iSize = fields.findIndex(f => f.key === 'size');
const iImg = fields.findIndex(f => f.key === 'image');
ok('位次紧跟「投射物半径」（外观紧挨大小）', iImg === iSize + 1, 'size=' + iSize + ' image=' + iImg);
ok('模块说明列出外观（PNG 素材）', /外观（PNG 素材）/.test(SM.MODULES.projectile.desc || ''));
ok('defaults() 带出空 image', SM.defaults('projectile').image === '');

console.log('\n2) 编译透传');
const DATA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const graph = {
  nodes: [
    { id: 's', type: 'source', params: { triggerEvent: 'onCast' } },
    { id: 'p', type: 'projectile', x: 200, y: 100, params: { count: 1, speed: 300, size: 12, image: DATA } },
    { id: 'm', type: 'motion', x: 400, y: 100, params: { scope: 'projectile', track: 'orbitSelf', distance: 120, duration: 0.6 } }
  ],
  edges: [{ from: 's', to: 'p' }, { from: 'p', to: 'm' }]
};
const C = SM.compile({ id: 'sk_t', name: '贴图测试', graph });
ok('C.projectile.image 透传素材', C.projectile.image === DATA);
const hostP = (C.hosts || []).find(h => h.type === 'projectile');
ok('载体 cfg 也带素材（多投射物各有自己的图）', !!hostP && hostP.cfg.image === DATA);
const view = SM.viewFor ? SM.viewFor(C, hostP.id) : null;
ok('载体视图的 projectile.image 一致', !view || view.projectile.image === DATA);

console.log('\n3) 弹体携带');
const SE = loadEngine();
const caster = { x: 100, y: 100, r: 16, side: 'player', hp: 100 };
const target = { x: 500, y: 100, r: 16, side: 'enemy', hp: 100 };
const shots = SE.spawnProjectiles(C, caster, target);
ok('发射出的弹体 params.image 就是素材', shots.length === 1 && shots[0].params.image === DATA);
ok('弹体半径仍按 size 走（素材不参与判定）', shots[0].r === 12, 'r=' + shots[0].r);

console.log('\n4) 绘制：无素材 / 未解码回退画圆');
function mkCtx() {
  const calls = [];
  return {
    calls,
    save: () => calls.push(['save']),
    restore: () => calls.push(['restore']),
    translate: (x, y) => calls.push(['translate', x, y]),
    rotate: (a) => calls.push(['rotate', a]),
    drawImage: function () { calls.push(['drawImage'].concat(Array.prototype.slice.call(arguments, 1))); }
  };
}
{
  const q = Object.assign({}, shots[0], { params: Object.assign({}, shots[0].params, { image: '' }) });
  const cx = mkCtx();
  ok('没上传素材 → drawShotImage 返回 false（调用方画圆）', SE.drawShotImage(cx, q) === false);
  ok('没上传素材 → 一次 drawImage 也不调用', cx.calls.filter(c => c[0] === 'drawImage').length === 0);
}
{
  // WowPinballSkin 存在但图片尚未解码完
  const q = Object.assign({}, shots[0]);
  const cx = mkCtx();
  const SE2 = loadEngine({ WowPinballSkin: { image: () => ({ ready: false, img: {}, w: 0, h: 0 }) } });
  ok('图片还没解码完 → 回退画圆，不抛错', SE2.drawShotImage(cx, q) === false);
}
{
  // 解码失败
  const q = Object.assign({}, shots[0]);
  const cx = mkCtx();
  const SE2 = loadEngine({ WowPinballSkin: { image: () => ({ ready: true, failed: true, img: {}, w: 0, h: 0 }) } });
  ok('图片解码失败 → 回退画圆', SE2.drawShotImage(cx, q) === false);
}

console.log('\n5) 绘制：有素材按「最长边 = 半径×2」等比居中');
function drawWith(w, h, r, rot) {
  const painted = [];
  const ctx = {
    save() { }, restore() { }, translate(x, y) { painted.push({ t: 'translate', x, y }); },
    rotate(a) { painted.push({ t: 'rotate', a }); },
    drawImage(img, dx, dy, dw, dh) { painted.push({ t: 'drawImage', dx, dy, dw, dh }); }
  };
  const SE2 = loadEngine({ WowPinballSkin: { image: () => ({ ready: true, failed: false, img: { id: 'img' }, w, h }) } });
  const q = { x: 30, y: 40, r, rot: rot || 0, params: { image: DATA } };
  const ret = SE2.drawShotImage(ctx, q);
  return { ret, painted };
}
{
  const r1 = drawWith(64, 64, 10);
  const d = r1.painted.find(p => p.t === 'drawImage');
  ok('正方形素材：边长 = 半径×2', r1.ret === true && Math.abs(d.dw - 20) < 1e-6 && Math.abs(d.dh - 20) < 1e-6,
    'dw=' + d && d.dw);
  ok('居中绘制（左上角 = -边长/2）', Math.abs(d.dx + 10) < 1e-6 && Math.abs(d.dy + 10) < 1e-6);
  const tr = r1.painted.find(p => p.t === 'translate');
  ok('以弹体坐标为原点', tr && tr.x === 30 && tr.y === 40);
}
{
  const r2 = drawWith(80, 40, 10);
  const d = r2.painted.find(p => p.t === 'drawImage');
  ok('宽图：最长边（宽）= 半径×2，高按比例', Math.abs(d.dw - 20) < 1e-6 && Math.abs(d.dh - 10) < 1e-6,
    'dw=' + d.dw + ' dh=' + d.dh);
}
{
  const r3 = drawWith(20, 100, 15);
  const d = r3.painted.find(p => p.t === 'drawImage');
  ok('竖图：最长边（高）= 半径×2，宽按比例', Math.abs(d.dh - 30) < 1e-6 && Math.abs(d.dw - 6) < 1e-6,
    'dw=' + d.dw + ' dh=' + d.dh);
}
{
  const r4 = drawWith(64, 64, 10, 90);
  const rot = r4.painted.find(p => p.t === 'rotate');
  ok('随自转角度旋转（q.rot 度 → 弧度）', rot && Math.abs(rot.a - Math.PI / 2) < 1e-6, rot && rot.a);
  const r5 = drawWith(64, 64, 10, 0);
  ok('rot=0 时不额外旋转（省一次变换）', !r5.painted.some(p => p.t === 'rotate'));
}

console.log('\n6) 100 KB 口径与上传逻辑（源码断言）');
const adminSrc = fs.readFileSync(path.join(ROOT, 'admin.js'), 'utf8');
ok('体积上限常量 = 100 × 1024', /PROJ_IMG_MAX_BYTES\s*=\s*100\s*\*\s*1024/.test(adminSrc));
ok('原图最长边上限 512（避免贴图过大拖慢绘制）', /PROJ_IMG_MAX_SIDE\s*=\s*512/.test(adminSrc));
ok('原文件上限 8 MB（读图前先挡掉超大文件）', /PROJ_IMG_MAX_FILE\s*=\s*8\s*\*\s*1024\s*\*\s*1024/.test(adminSrc));
ok('只接受 PNG（按扩展名 / MIME 双重判断）', /\\\.png\$/.test(adminSrc) && /image\\\/png/.test(adminSrc));
ok('超限时逐步降采样（每次 ×0.8）', /k \*= 0\.8/.test(adminSrc));
ok('降采样后再校验一次体积', /bytes <= PROJ_IMG_MAX_BYTES/.test(adminSrc));
ok('上传控件按节点类型守卫（只有投射物可写）', /n\.type !== 'projectile'/.test(adminSrc));
ok('清除按钮存在', /se-img-clear/.test(adminSrc));
ok('属性面板渲染 image 类型', /f\.type === 'image'/.test(adminSrc) && /seImgFieldHtml/.test(adminSrc));
ok('文件选择走 change（input 不抛 input 事件）', /dataset\.seimg/.test(adminSrc) && /seProjImageUpload\(/.test(adminSrc));
ok('节点摘要标出「贴图」', /' · 贴图'/.test(adminSrc));
ok('发布前校验：非内嵌 PNG 报错、超 100 KB 告警',
  /的投射物图片不是内嵌 PNG/.test(adminSrc) && /超过 100 KB 上限/.test(adminSrc));

console.log('\n6b) 属性面板 HTML（提取真实函数执行）');
function loadImgField() {
  const a = adminSrc.indexOf('function seDataUrlBytes');
  const b = adminSrc.indexOf('function seProjImageUpload');
  if (a < 0 || b < 0 || b < a) return null;
  const src = adminSrc.slice(a, b);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fakeWindow = { WowPinballSkin: { image: () => ({ ready: true, w: 96, h: 48 }) } };
  try {
    return new Function('esc', 'window', src + '\n return seImgFieldHtml;')(esc, fakeWindow);
  } catch (e) { return { __error: e }; }
}
{
  const fn = loadImgField();
  ok('函数可独立执行（无隐藏依赖）', typeof fn === 'function', fn && fn.__error && fn.__error.message);
  if (typeof fn === 'function') {
    const f = Object.assign({}, fImg);
    const empty = fn(f, '');
    ok('未上传：给出「未上传 · 按元素颜色画圆」提示', /未上传 · 按元素颜色画圆/.test(empty));
    ok('未上传：只出现上传按钮、没有清除按钮', /上传 PNG/.test(empty) && !/se-img-clear/.test(empty));
    ok('未上传：不渲染 <img>', !/<img /.test(empty));
    const filled = fn(f, DATA);
    ok('已上传：渲染 <img src="data:image/png;base64,', /<img src="data:image\/png;base64,/.test(filled));
    ok('已上传：显示尺寸与体积读数', /96×48 · 0\.1 KB \/ 100 KB/.test(filled), filled.match(/se-imgmeta[^>]*>[^<]*/));
    ok('已上传：出现「替换 PNG」与「清除」', /替换 PNG/.test(filled) && /se-img-clear/.test(filled));
    ok('上传控件带 data-seimg（change 事件靠它识别）', /data-seimg="image"/.test(filled));
    ok('只接受 PNG（accept）', /accept="image\/png,\.png"/.test(filled));
  }
}

console.log('\n7) dataURL 字节数换算（与后台同口径）');
function dataUrlBytes(src) {
  const s = String(src || '');
  const i = s.indexOf(',');
  if (i < 0) return 0;
  const b64 = s.slice(i + 1).replace(/\s/g, '');
  if (!b64) return 0;
  const pad = b64.charAt(b64.length - 1) === '=' ? (b64.charAt(b64.length - 2) === '=' ? 2 : 1) : 0;
  return Math.max(0, Math.floor(b64.length * 3 / 4) - pad);
}
const realBytes = Buffer.from(DATA.slice(DATA.indexOf(',') + 1), 'base64').length;
ok('1×1 透明 PNG 字节数换算与 Buffer 解码一致（' + realBytes + ' B）', dataUrlBytes(DATA) === realBytes, 'got=' + dataUrlBytes(DATA));
ok('空串 / 非法串 = 0', dataUrlBytes('') === 0 && dataUrlBytes('abc') === 0);
ok('后台源码使用同一套换算（base64 长度 × 3/4 减 padding）',
  /b64\.length \* 3 \/ 4/.test(adminSrc));

console.log('\n8) 快照剥离 / 恢复（避免贴图吃光 localStorage 配额）');
const stripBlock = adminSrc.slice(adminSrc.indexOf('function stripAssets'), adminSrc.indexOf('function restoreAssets'));
ok('stripAssets 会剔除投射物素材', /n\.type === 'projectile'/.test(stripBlock) && /delete n\.params\.image/.test(stripBlock));
const restoreBlock = adminSrc.slice(adminSrc.indexOf('function restoreAssets'), adminSrc.indexOf('/* 把旧版'));
ok('restoreAssets 按「技能 id + 节点 id」取回素材', /curSkills/.test(restoreBlock) && /mn\.params\.image/.test(restoreBlock));

console.log('\n9) 两端绘制接入（源码断言）');
const gameSrc = fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8');
ok('对局端调用 drawShotImage，返回 false 才画圆', /SE\.drawShotImage\(ctx, q\)/.test(gameSrc));
ok('试放端同样接入', /SE\.drawShotImage\(cx, q\)/.test(adminSrc));
ok('试放靶弹（敌弹）不吃当前技能的贴图', /!foeShot && SE\.drawShotImage/.test(adminSrc));
const seSrc = fs.readFileSync(path.join(ROOT, 'skill-effects.js'), 'utf8');
ok('绘制函数导出为 drawShotImage', /drawShotImage: drawShotImage/.test(seSrc));
ok('图片走 WowPinballSkin 全局缓存（同一 dataURL 只解码一次）', /root\.WowPinballSkin/.test(seSrc));
ok('拖尾仍按元素颜色绘制（与贴图解耦）', /drawShotTrail\(ctx, q, col\)/.test(gameSrc));

console.log('\n10) 贴图不跟随发射方向旋转（noRotFollow）');
const fNoRot = fields.find(f => f.key === 'noRotFollow');
ok('投射物模块有「贴图不跟随发射方向旋转」字段', !!fNoRot);
ok('类型 = bool，默认 false（老技能行为不变）', !!fNoRot && fNoRot.type === 'bool' && fNoRot.def === false);
ok('位次紧跟「投射物图片」', fields.findIndex(f => f.key === 'noRotFollow') === iImg + 1,
  'img=' + iImg + ' noRot=' + fields.findIndex(f => f.key === 'noRotFollow'));
ok('说明写明不随发射方向 / 自转仍生效 / 没图看不出效果',
  /发射方向/.test(fNoRot.hint || '') && /自转/.test(fNoRot.hint || '') && /没上传图片/.test(fNoRot.hint || ''));
function noRotGraph(noRot, spin) {
  const params = { count: 1, speed: 300, size: 10, image: DATA };
  if (noRot != null) params.noRotFollow = noRot;
  if (spin != null) params.spin = spin;
  return {
    nodes: [
      { id: 's', type: 'source', params: { triggerEvent: 'onCast' } },
      { id: 'p', type: 'projectile', params: params }
    ],
    edges: [{ from: 's', to: 'p' }]
  };
}
{
  const C0 = SM.compile({ name: 't', graph: noRotGraph() });
  const s0 = SE.spawnProjectiles(C0, caster, target, Math.PI / 2);
  ok('未勾选：贴图朝向 = 发射方向（90°）', Math.abs(s0[0].rot - 90) < 1e-6, 'rot=' + s0[0].rot);
}
{
  const C1 = SM.compile({ name: 't', graph: noRotGraph(true) });
  const s1 = SE.spawnProjectiles(C1, caster, target, Math.PI / 2);
  ok('勾选：贴图朝向 = 素材原始朝向（0°）', s1[0].rot === 0, 'rot=' + s1[0].rot);
  ok('编译透传 noRotFollow', C1.projectile.noRotFollow === true);
  ok('多端视图一致（载体 cfg 也带）',
    (C1.hosts || []).every(h => h.type !== 'projectile' || h.cfg.noRotFollow === true));
}
{
  const C2 = SM.compile({ name: 't', graph: noRotGraph(true, 180) });
  const s2 = SE.spawnProjectiles(C2, caster, target, Math.PI / 2);
  const list = s2.slice();
  SE.advance(list, 0.5, { w: 1200, h: 700, targets: [], walls: [], onHit() { }, onExpire() { } });
  ok('勾选后「自转速度」仍然叠加（180°/s × 0.5s = 90°）', Math.abs(list[0].rot - 90) < 1e-6, 'rot=' + list[0].rot);
  const r = drawWith(64, 64, 10, list[0].rot);
  ok('绘制跟随该角度旋转（不是恒不转）',
    r.painted.some(p => p.t === 'rotate' && Math.abs(p.a - Math.PI / 2) < 1e-6));
}
{
  const C3 = SM.compile({ name: 't', graph: noRotGraph(true, 0) });
  const s3 = SE.spawnProjectiles(C3, caster, target, Math.PI / 2);
  ok('勾选 + 自转 0 = 完全固定（绘制不产生 rotate）',
    !drawWith(64, 64, 10, s3[0].rot).painted.some(p => p.t === 'rotate'));
}
ok('节点摘要标出「(固定朝向)」', /\(固定朝向\)/.test(adminSrc));
ok('引擎在出生时按 noRotFollow 决定初始朝向',
  /rot: p\.noRotFollow \? 0 : a \* 180 \/ Math\.PI/.test(seSrc));

console.log('\n结果: 通过 ' + pass + '，失败 ' + fail);
process.exit(fail ? 1 : 0);
