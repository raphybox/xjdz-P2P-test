/* =============================================================
   魔兽弹珠 · 本地开发服务（零依赖）
   启动：node server.js        打开：http://127.0.0.1:8787/admin.html
   作用：托管游戏与后台，并把后台配置真正落盘到 data/game-config.json
   不启动本服务也可以：后台配置会写入 localStorage，游戏刷新即生效
   ============================================================= */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

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

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });

  if (url.startsWith('/api/')) {
    try {
      ensureDirs();
      if (req.method === 'GET' && url.startsWith('/api/config')) {
        if (!fs.existsSync(CONFIG_FILE)) return json(res, 200, { ok: true, data: null });
        return json(res, 200, { ok: true, data: JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) });
      }
      if (req.method === 'POST' && url.startsWith('/api/config')) {
        const raw = await readBody(req);
        let data;
        try { data = JSON.parse(raw); } catch (e) { return json(res, 400, { ok: false, error: 'JSON 解析失败' }); }
        if (!data || !data.config || !Array.isArray(data.classes) || !Array.isArray(data.skills)) {
          return json(res, 400, { ok: false, error: '配置结构不完整' });
        }
        if (fs.existsSync(CONFIG_FILE)) {
          fs.writeFileSync(path.join(HISTORY_DIR, stamp() + '.json'), fs.readFileSync(CONFIG_FILE));
        }
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
        // 同步刷新静态站副本；失败只告警，不影响本次发布结果
        try { require('./tools/export-static-config')(); }
        catch (e) { console.warn('静态配置副本生成失败：' + (e && e.message || e)); }
        return json(res, 200, { ok: true, savedAt: new Date().toISOString() });
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
  console.log('魔兽弹珠开发服务已启动');
  console.log('  后台工具： http://' + HOST + ':' + PORT + '/admin.html');
  console.log('  游戏预览： http://' + HOST + ':' + PORT + '/index.html');
  console.log('  配置文件： ' + CONFIG_FILE);
  console.log('按 Ctrl+C 停止');
});
