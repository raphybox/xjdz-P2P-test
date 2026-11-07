/* =============================================================
   选技弹珠 · 私有版本号编解码
   -------------------------------------------------------------
   对外只显示一串「只有我们自己理解」的长密钥；内部是一个从 1 开始的
   整型计数，每次「发布」自动 +1。

   显示格式（以 1 号构建为例）：
     WJ-7QK2-M9F3-00A1BZ-2M8P-5B6T-KZ9V-R3W1-XX4L

   分段含义（只有我们知道）：
     WJ        项目固定前缀（We/J 之间约定，外人看不出含义）
     A,B,C,D,E,F  由计数 n 经 LCG 散列出的伪随机段，纯装饰、混淆观感
     SEQ(6位)  真正的构建计数，但用「乱序字母表 + 固定宽度」编码：
               外人看是一段普通字符，我们按 base-31（字母表 A..Y/2..9）
               倒推即可知它是第几个构建，每次 +1 仅末位前进一格
     CHK(4位)  基于前几段的 FNV-1a 校验段，保证字符串自洽

   用法：
     encodeVersion(n)        -> 给定计数返回对应密钥串
     nextVersion(obj)        -> 基于已有配置里的 versionSeq 求出下一个（没有则是 1）
   ============================================================= */
'use strict';

// 去掉了易混字符 0/O/1/I，仅 31 个符号
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const W = ALPHA.length;

function lcg(seed) { return (seed * 1103515245 + 12345) >>> 0; }
// 第 idx 段（idx 从 0 起）：把段序号混进种子与每一步，避免各段首字符雷同
function hashSeg(seed, len, idx) {
  let s = (seed ^ Math.imul(idx + 1, 0x9e3779b1)) >>> 0;
  let out = '';
  for (let i = 0; i < len; i++) {
    s = (lcg(s) ^ Math.imul(idx + 1, 0x85ebca6b) ^ (i * 0x27d4eb2f)) >>> 0;
    out += ALPHA[s % W];
  }
  return out;
}

// 把计数 n 编成固定宽度（width）的私有段：以 base-31 表示，高位补 'A'
function encodeSeq(n, width) {
  n = Math.max(0, n | 0);
  let x = n;
  let out = '';
  for (let i = 0; i < width; i++) { out = ALPHA[x % W] + out; x = Math.floor(x / W); }
  return out;
}

// 用计数 n 与固定盐派生一个充分混合的种子（FNV-1a 风格），
// 保证哪怕 n 很小，各伪随机段也呈现明显差异，不会全是占位符
function deriveSeed(n) {
  const SALT = 'xjpb';
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < SALT.length; i++) { h ^= SALT.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  let nn = (n >>> 0);
  for (let i = 0; i < 4; i++) { h ^= (nn & 0xff); h = Math.imul(h, 0x01000193) >>> 0; nn >>= 8; }
  return h >>> 0;
}

function encodeVersion(n) {
  n = Math.max(1, n | 0);
  const seed = deriveSeed(n);

  const a = hashSeg(seed, 4, 0);
  const b = hashSeg(seed, 4, 1);
  const seq = encodeSeq(n, 6);
  const c = hashSeg(seed, 4, 2);
  const d = hashSeg(seed, 4, 3);
  const e = hashSeg(seed, 4, 4);
  const f = hashSeg(seed, 4, 5);

  const core = a + b + seq + c + d + e + f;
  let cs = 0x811c9dc5 >>> 0; // FNV-1a 32-bit offset basis
  for (let i = 0; i < core.length; i++) { cs ^= core.charCodeAt(i); cs = Math.imul(cs, 0x01000193) >>> 0; }
  const chk = hashSeg(cs, 4, 6);

  return ['WJ', a, b, seq, c, d, e, f, chk].join('-');
}

// 基于已有配置里的 versionSeq 求出下一个版本（没有则是 1）
function nextVersion(obj) {
  const cur = (obj && typeof obj === 'object' && Number.isFinite(obj.versionSeq)) ? (obj.versionSeq | 0) : 0;
  const next = (cur || 0) + 1;
  return { versionSeq: next, version: encodeVersion(next) };
}

module.exports = { encodeVersion, nextVersion, encodeSeq, ALPHA };
