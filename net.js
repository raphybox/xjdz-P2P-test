/* =============================================================
   选技弹珠 · P2P 传输层（net.js）
   从 net-test.html 提炼的已验证链路：
   - 手动信令：offer/answer 压缩成邀请码 / 应答码（deflate-raw + base64url）
   - 双 DataChannel：ctrl（可靠有序，走对局事件）/ game（不可靠，走 20Hz 快照）
   - TURN 凭证：优先同域 /api/turn（wrangler Worker 签发），回落到 xjdz.de5.net
   ============================================================= */
(function () {
  'use strict';

  /* ---------- 信令编解码 ---------- */

  function u8ToB64(u8) {
    var CH = 0x8000;
    var s = '';
    for (var i = 0; i < u8.length; i += CH) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    }
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function b64ToU8(b64) {
    var s = b64.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s);
    var u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }

  function pack(obj) {
    var raw = new TextEncoder().encode(JSON.stringify(obj));
    if (typeof CompressionStream === 'function') {
      return new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw')))
        .arrayBuffer()
        .then(function (buf) { return 'z.' + u8ToB64(new Uint8Array(buf)); })
        .catch(function () { return 'r.' + u8ToB64(raw); });
    }
    return Promise.resolve('r.' + u8ToB64(raw));
  }

  function unpack(text) {
    var s = String(text || '').trim();
    var m = s.match(/[#?&](?:o|a)=([^&\s]+)/);
    if (m) s = m[1];
    s = s.replace(/\s+/g, '');
    s = s.replace(/[^A-Za-z0-9\-_\.]+$/, '');
    if (s.length < 8) return Promise.reject(new Error('内容太短，不是有效的邀请码或应答码'));
    var zipped = s.charAt(0) === 'z';
    if (!zipped && s.charAt(0) !== 'r') return Promise.reject(new Error('无法识别的编码格式'));
    var body = s.slice(2);
    var u8;
    try { u8 = b64ToU8(body); }
    catch (e) { return Promise.reject(new Error('内容已损坏，请重新完整复制')); }
    if (!zipped) {
      try { return Promise.resolve(JSON.parse(new TextDecoder().decode(u8))); }
      catch (e) { return Promise.reject(new Error('内容解析失败，请重新完整复制')); }
    }
    if (typeof DecompressionStream !== 'function') {
      return Promise.reject(new Error('当前浏览器不支持解压，请让对端换用 Chrome 或 Edge'));
    }
    return new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw')))
      .arrayBuffer()
      .then(function (buf) { return JSON.parse(new TextDecoder().decode(buf)); })
      .catch(function () { return Promise.reject(new Error('解压失败，内容可能被截断')); });
  }

  /* ---------- ICE 配置 ---------- */

  var LS_TURN = 'wbnet.turn';
  var LS_POLICY = 'wbnet.policy';
  // 同域优先（部署在 xjdz.de5.net 时 /api/turn 直接可达），本地开发回落到线上签发服务
  var TURN_SVC_LIST = ['/api/turn', 'https://xjdz.de5.net/api/turn'];

  var remoteTurn = null;

  function loadTurn() {
    try {
      var t = JSON.parse(localStorage.getItem(LS_TURN) || 'null');
      if (t && t.urls && t.urls.length) return t;
    } catch (e) {}
    return null;
  }

  function effectiveTurn() { return remoteTurn || loadTurn(); }

  function parseIceServers(j) {
    var arr = Object.prototype.toString.call(j) === '[object Array]' ? j : (j && j.iceServers) || [j];
    var urls = [], user = '', cred = '';
    (arr || []).forEach(function (item) {
      if (!item || !item.urls) return;
      var list = Object.prototype.toString.call(item.urls) === '[object Array]' ? item.urls : [item.urls];
      list.forEach(function (u) { if (/^turns?:/i.test(String(u))) urls.push(String(u)); });
      if (item.username && !user) user = item.username;
      if (item.credential && !cred) cred = item.credential;
    });
    if (!urls.length) throw new Error('凭证里没有 turn: 或 turns: 地址');
    return { urls: urls, username: user, credential: cred };
  }

  /* 依次尝试凭证服务地址：任何一个成功即用，全失败回落手工凭证（不阻塞建连） */
  async function fetchTurn() {
    if (remoteTurn) return remoteTurn;
    for (var i = 0; i < TURN_SVC_LIST.length; i++) {
      try {
        var r = await fetch(TURN_SVC_LIST[i], { cache: 'no-store' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var j = await r.json();
        if (j && j.error) throw new Error(j.error);
        remoteTurn = parseIceServers(j);
        return remoteTurn;
      } catch (e) { /* 尝试下一个 */ }
    }
    return null;
  }

  function iceServers() {
    var list = [
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ];
    var t = effectiveTurn();
    if (t) list.push({ urls: t.urls, username: t.username || '', credential: t.credential || '' });
    return list;
  }

  function peerOptions() {
    var policy = localStorage.getItem(LS_POLICY) === 'relay' ? 'relay' : 'all';
    if (policy === 'relay' && !effectiveTurn()) policy = 'all';
    return { iceServers: iceServers(), iceTransportPolicy: policy, bundlePolicy: 'max-bundle' };
  }

  function waitIce(p, timeout) {
    return new Promise(function (resolve) {
      if (p.iceGatheringState === 'complete') return resolve();
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        p.removeEventListener('icegatheringstatechange', onChange);
        resolve();
      }
      function onChange() { if (p.iceGatheringState === 'complete') finish(); }
      p.addEventListener('icegatheringstatechange', onChange);
      setTimeout(finish, timeout || 3500);
    });
  }

  /* ---------- 会话 ---------- */

  /* opts: { onReady(), onCtrl(obj), onGame(obj|string), onClose(), onState(text) } */
  function Session(opts) {
    this.opts = opts || {};
    this.pc = null;
    this.ctrl = null;
    this.game = null;
    this.ready = false;
    this.closed = false;
    this.stats = { host: 0, srflx: 0, relay: 0 };
  }

  Session.prototype._state = function (text) {
    if (typeof this.opts.onState === 'function') this.opts.onState(text);
  };

  Session.prototype._bind = function (ch, kind) {
    var self = this;
    if (kind === 'ctrl') this.ctrl = ch; else this.game = ch;
    ch.onopen = function () { self._checkReady(); };
    ch.onclose = function () { self._teardown('通道关闭'); };
    ch.onerror = function () { /* 交给 connectionState 处理 */ };
    ch.onmessage = function (e) {
      if (kind !== 'ctrl' && typeof e.data === 'string' && e.data.charAt(0) === '{') {
        try { self.opts.onGame(JSON.parse(e.data)); return; } catch (err) {}
      }
      if (kind === 'ctrl') {
        try { self.opts.onCtrl(JSON.parse(e.data)); } catch (err) {}
      } else if (typeof self.opts.onGame === 'function') {
        self.opts.onGame(e.data);
      }
    };
  };

  Session.prototype._checkReady = function () {
    if (this.ctrl && this.game && this.ctrl.readyState === 'open' && this.game.readyState === 'open') {
      this.ready = true;
      this._state('已连接 · 双向通道就绪');
      if (typeof this.opts.onReady === 'function') this.opts.onReady();
    }
  };

  Session.prototype._teardown = function (why) {
    if (this.closed) return;
    this.closed = true;
    this.ready = false;
    if (typeof this.opts.onClose === 'function') this.opts.onClose(why);
  };

  Session.prototype.sendCtrl = function (obj) {
    if (this.ctrl && this.ctrl.readyState === 'open') {
      try { this.ctrl.send(JSON.stringify(obj)); } catch (e) {}
    }
  };

  Session.prototype.sendGame = function (str) {
    if (this.game && this.game.readyState === 'open') {
      try { this.game.send(str); } catch (e) {}
    }
  };

  Session.prototype.close = function () {
    this.sendCtrl({ k: 'bye' });
    var self = this;
    setTimeout(function () {
      self.closed = true;
      try { if (self.ctrl) self.ctrl.close(); } catch (e) {}
      try { if (self.game) self.game.close(); } catch (e) {}
      try { if (self.pc) self.pc.close(); } catch (e) {}
    }, 120);
  };

  Session.prototype._newPeer = function () {
    var self = this;
    var p = new RTCPeerConnection(peerOptions());
    p.onicecandidate = function (e) {
      if (!e.candidate) return;
      var m = e.candidate.candidate.match(/ typ (\w+)/);
      var type = m ? m[1] : 'host';
      if (self.stats[type] != null) self.stats[type]++;
    };
    p.onconnectionstatechange = function () {
      var s = p.connectionState;
      if (s === 'failed') self._teardown('连接失败');
      else if (s === 'disconnected') self._state('连接中断 · 正在尝试恢复');
      else if (s === 'connected') self._state('链路已建立');
    };
    p.oniceconnectionstatechange = function () {
      if (p.iceConnectionState === 'failed') self._teardown('连接失败');
    };
    return p;
  };

  /* ---------- 房主：生成邀请码 ---------- */

  Session.createHost = async function (opts) {
    var s = new Session(opts);
    s._state('正在获取中继凭证…');
    await fetchTurn();
    s._state('正在收集网络候选地址，请稍候…');
    var pc = s._newPeer();
    s.pc = pc;
    s._bind(pc.createDataChannel('ctrl', { ordered: true }), 'ctrl');
    try {
      s._bind(pc.createDataChannel('game', { ordered: false, maxRetransmits: 0 }), 'game');
    } catch (e) {
      s._bind(pc.createDataChannel('game'), 'game');   // 老浏览器兜底：可靠通道
    }
    try {
      var offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      // 配了 TURN 就放宽收集窗口：中继分配在慢网络下可能超过 3.5s
      await waitIce(pc, effectiveTurn() ? 10000 : 3500);
      var code = await pack({ t: 'offer', sdp: pc.localDescription.sdp, ty: pc.localDescription.type });
      s._state('邀请码已生成 · 中继候选 ' + s.stats.relay + ' 个');
      return { session: s, code: code };
    } catch (e) {
      s._teardown('创建失败：' + e.message);
      throw e;
    }
  };

  /* ---------- 房主：应用好友回传的应答码 ---------- */

  Session.hostFinish = async function (session, answerCode) {
    var ans = await unpack(answerCode);
    if (ans.t !== 'answer') throw new Error('这不是应答码，请确认复制的是好友回传的那段');
    await session.pc.setRemoteDescription({ type: 'answer', sdp: ans.sdp });
    session._state('应答码已应用，等待连接建立…');
    return session;
  };

  /* ---------- 好友：解析邀请码，生成应答码 ---------- */

  Session.createGuest = async function (offerCode, opts) {
    var off = await unpack(offerCode);
    if (off.t !== 'offer') throw new Error('这不是邀请码，请确认复制的是房主发来的那段');
    var s = new Session(opts);
    s._state('正在获取中继凭证…');
    await fetchTurn();
    s._state('正在生成应答码…');
    var pc = s._newPeer();
    s.pc = pc;
    pc.ondatachannel = function (e) {
      s._bind(e.channel, e.channel.label === 'ctrl' ? 'ctrl' : 'game');
    };
    await pc.setRemoteDescription({ type: 'offer', sdp: off.sdp });
    var answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitIce(pc, effectiveTurn() ? 10000 : 3500);
    var code = await pack({ t: 'answer', sdp: pc.localDescription.sdp, ty: pc.localDescription.type });
    s._state('应答码已生成，请复制发给房主');
    // 兜底：连接迟迟建不起来时给出提示
    setTimeout(function () {
      if (!s.closed && pc.connectionState !== 'connected') {
        s._state('连接还没建起来 · 把应答码发给房主后请耐心等待');
      }
    }, 25000);
    return { session: s, code: code };
  };

  window.WowPinballNet = {
    Session: Session,
    pack: pack,
    unpack: unpack
  };
})();
