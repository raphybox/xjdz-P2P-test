/* =============================================================
   选技弹珠 · 本地开发服务（零依赖）
   启动：node server.js        打开：http://127.0.0.1:8787/admin.html
   作用：托管游戏与后台，并把后台配置真正落盘到 data/game-config.json
   不启动本服务也可以：后台配置会写入 localStorage，游戏刷新即生效
   ============================================================= */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'game-config.json');
const HISTORY_DIR = path.join(DATA_DIR, 'history');
const PORT = Number(process.env.PORT || 8787);
const HOST = '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.map': 'application/json; charset=utf-8'
};

/* 历史遗留清理：特效模块曾自带「持续伤害」字段（tickDamage/tickDps/tickRadius/tickInterval），
   现已统一归到「伤害·结算」模块。若后台仍持有迁移前的旧内存数据，保存时会把死字段写回，
   这里在落盘前统一剥掉，保证「持续伤害只存在于伤害模块」的口径不被旧草稿污染。 */
const FX_LEGACY_TICK_KEYS = ['tickDamage', 'tickDps', 'tickRadius', 'tickInterval'];
function stripLegacyFxTick(data) {
  if (!data || !Array.isArray(data.skills)) return data;
  data.skills.forEach(sk => {
    const nodes = (sk && sk.graph && Array.isArray(sk.graph.nodes)) ? sk.graph.nodes : [];
    nodes.forEach(n => {
      if (n && n.type === 'fx' && n.params) {
        FX_LEGACY_TICK_KEYS.forEach(k => { if (n.params[k] != null) delete n.params[k]; });
      }
    });
  });
  return data;
}

function send(res, code, body, type) {
  res.writeHead(code, {
    'Content-Type': type || 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  });
  res.end(body);
}
function json(res, code, obj) { send(res, code, JSON.stringify(obj)); }
function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 8 * 1024 * 1024) reject(new Error('配置过大')); });
    req.on('end', () => resolve(s));
    req.on('error', reject);
  });
}
function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });
}
function stamp() {
  const d = new Date();
  const p = n => (n < 10 ? '0' : '') + n;
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
    p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}
function safePath(urlPath) {
  const rel = decodeURIComponent(urlPath.split('?')[0]).replace(/^\/+/, '');
  const target = path.resolve(ROOT, rel || 'index.html');
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) return null;
  return target;
}

/* -------------------------------------------------------------
   发布即同步到 GitHub：把本次落盘的游戏文件提交并推送到远程。
   - 管理后台(admin.*)已在 .gitignore 排除，不会进入仓库。
   - 代理做 HTTPS 中间人，git 必须 http.sslVerify=false（内置）。
   - 非交互、带超时，避免弹窗卡死；失败不影响本地落盘结果。
   ------------------------------------------------------------- */
function isGitRepo() {
  try { return fs.existsSync(path.join(ROOT, '.git')); } catch (e) { return false; }
}
function runGit(args, timeoutMs) {
  return new Promise((resolve) => {
    const full = ['-c', 'http.sslVerify=false'].concat(args);
    const env = Object.assign({}, process.env, {
      GCM_INTERACTIVE: 'never',   // 无缓存凭据时直接失败，不弹窗
      GIT_TERMINAL_PROMPT: '0'
    });
    let settled = false;
    const p = execFile('git', full, { cwd: ROOT, timeout: timeoutMs || 120000, windowsHide: true, env },
      (err, stdout, stderr) => {
        if (settled) return; settled = true;
        resolve({
          ok: !err,
          code: err && err.code,
          killed: err && err.killed,
          stdout: String(stdout || ''),
          stderr: String(stderr || '')
        });
      });
    p.on('error', (e) => { if (!settled) { settled = true; resolve({ ok: false, error: String(e) }); } });
  });
}
async function gitSync() {
  const out = { ok: true, pushed: false, message: '' };
  if (!isGitRepo()) { out.ok = false; out.message = '未检测到 git 仓库，跳过 GitHub 同步'; return out; }
  try {
    const inside = await runGit(['rev-parse', '--is-inside-work-tree'], 30000);
    if (!inside.ok || inside.stdout.trim() !== 'true') {
      out.ok = false; out.message = '当前目录不是 git 工作区，跳过 GitHub 同步'; return out;
    }
    const add = await runGit(['add', '-A'], 60000);
    if (!add.ok) { out.ok = false; out.message = 'git add 失败：' + (add.stderr || add.error || '未知错误'); return out; }
    const st = await runGit(['status', '--porcelain'], 60000);
    if (!st.ok) { out.ok = false; out.message = 'git status 失败，跳过推送'; return out; }
    if (!st.stdout.trim()) { out.message = '没有需要同步的改动'; out.pushed = false; return out; }
    const msg = 'chore: 本地后台发布同步 ' + stamp();
    const commit = await runGit(['commit', '-m', msg], 60000);
    if (!commit.ok) { out.ok = false; out.message = 'commit 失败：' + (commit.stderr || commit.error || ''); return out; }
    const push = await runGit(['push', 'origin', 'main'], 100000);
    if (!push.ok) {
      const tail = (push.stderr || push.error || '未知错误').split('\n').map(s => s.trim()).filter(Boolean).pop() || 'push 失败';
      out.ok = false; out.message = '已提交但未推送：' + tail + '（本地配置已落盘，可稍后手动 git push）'; return out;
    }
    out.ok = true; out.pushed = true; out.message = '已同步到 GitHub'; return out;
  } catch (e) {
    out.ok = false; out.message = '同步异常：' + (e && e.message || e); return out;
  }
}

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });

  if (url.startsWith('/api/')) {
    try {
      ensureDirs();
      if (req.method === 'GET' && url.startsWith('/api/config')) {
        if (!fs.existsSync(CONFIG_FILE)) return json(res, 200, { ok: true, data: null });
        const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        stripLegacyFxTick(data);   // 读取时也剥一次：旧页面即使缓存了死字段，回写也不会再带回来
        return json(res, 200, { ok: true, data: data });
      }
      if (req.method === 'POST' && url.startsWith('/api/config')) {
        // push=1 同步 GitHub（正式发布，版本号 +1）；否则仅本地预览（不推远程、不涨版本）
        const wantPush = /[?&]push=1/.test(url);
        const raw = await readBody(req);
        let data;
        try { data = JSON.parse(raw); } catch (e) { return json(res, 400, { ok: false, error: 'JSON 解析失败' }); }
        if (!data || !data.config || !Array.isArray(data.classes) || !Array.isArray(data.skills)) {
          return json(res, 400, { ok: false, error: '配置结构不完整' });
        }
        if (fs.existsSync(CONFIG_FILE)) {
          fs.writeFileSync(path.join(HISTORY_DIR, stamp() + '.json'), fs.readFileSync(CONFIG_FILE));
        }
        // 私有版本号：以「已落盘文件」里的计数作为权威，不信任浏览器草稿回传，避免重复计数。
        // 正式同步 GitHub：严格 +1 重编码；本地预览：沿用已落盘的版本号（测试不消耗版本）。
        // 编码格式只有我们自己理解（见 tools/version-codec.js）。
        let verInfo;
        try {
          const prevObj = fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) : null;
          if (wantPush) {
            verInfo = require('./tools/version-codec').nextVersion(prevObj || data);
          } else {
            verInfo = {
              version: (prevObj && prevObj.version) || data.version || '',
              versionSeq: (prevObj && prevObj.versionSeq) || data.versionSeq || 0
            };
          }
        } catch (e) { verInfo = wantPush ? { versionSeq: 1, version: 'WJ-DEV' } : { versionSeq: 0, version: '' }; }
        data.versionSeq = verInfo.versionSeq;
        data.version = verInfo.version;
        stripLegacyFxTick(data);   // 剥掉特效模块的历史 tick 死字段，防止旧草稿回潮
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
        // 同步刷新静态站副本；失败只告警，不影响本次发布结果
        try { require('./tools/export-static-config')(); }
        catch (e) { console.warn('静态配置副本生成失败：' + (e && e.message || e)); }
        // 同步到 GitHub（后台文件已 gitignore，不会进仓库）；本地预览跳过，失败仅告警
        let github = null;
        if (wantPush) {
          try { github = await gitSync(); }
          catch (e) { github = { ok: false, message: '同步未执行：' + (e && e.message || e) }; }
          if (github) {
            if (github.ok && github.pushed) console.log('[github] 已同步到远程');
            else console.warn('[github] ' + (github.message || '未同步'));
          }
        } else {
          github = { ok: true, pushed: false, message: '本地预览已更新，未同步 GitHub' };
        }
        return json(res, 200, { ok: true, savedAt: new Date().toISOString(), github: github,
          version: data.version, versionSeq: data.versionSeq });
      }
      if (req.method === 'GET' && url.startsWith('/api/history')) {
        const files = fs.existsSync(HISTORY_DIR)
          ? fs.readdirSync(HISTORY_DIR).filter(f => f.endsWith('.json')).sort().reverse().slice(0, 30)
          : [];
        return json(res, 200, { ok: true, files: files });
      }
      return json(res, 404, { ok: false, error: '未知接口' });
    } catch (e) {
      return json(res, 500, { ok: false, error: String(e && e.message || e) });
    }
  }

  const target = safePath(url);
  if (!target) return json(res, 403, { ok: false, error: '禁止访问' });
  let file = target;
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return send(res, 404, 'Not Found', 'text/plain; charset=utf-8');
  }
  const ext = path.extname(file).toLowerCase();
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 500, 'Read Error', 'text/plain; charset=utf-8');
    send(res, 200, buf, MIME[ext] || 'application/octet-stream');
  });
});

server.listen(PORT, HOST, () => {
  ensureDirs();
  console.log('选技弹珠开发服务已启动');
  console.log('  后台工具： http://' + HOST + ':' + PORT + '/admin.html');
  console.log('  游戏预览： http://' + HOST + ':' + PORT + '/index.html');
  console.log('  配置文件： ' + CONFIG_FILE);
  console.log('按 Ctrl+C 停止');
});
