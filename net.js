/* =============================================================
   选技弹珠 · P2P 传输层（net.js）
   从 net-test.html 提炼的已验证链路：
   - 手动信令：offer/answer 压缩成邀请码 / 应答码（deflate-raw + base64url）
   - 双 DataChannel：ctrl（可靠有序，走对局事件）/ game（不可靠，走 20Hz 快照）
   - TURN 凭证：优先同域 /api/turn（wrangler Worker 签发），回落到 xjdz.de5.net
   - 2V2 星形拓扑：房主 seat0 与 seat1..N-1 各一条 PeerConnection，
     每条都带 ctrl + game 双通道；客机只有一条到房主的 PeerConnection
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
  /* 房间信令服务：同域优先，本地开发回落到线上服务 */
  var ROOM_API_LIST = ['/api/room', 'https://xjdz.de5.net/api/room'];

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
      list.forEach(function (u) {
        if (!/^turns?:/i.test(String(u))) return;
        u = String(u);
        urls.push(u);
        // 补 TCP 传输变体：部分网络 UDP 高位端口被封，中继分配成功但检查全挂
        if (/^turn:/i.test(u) && !/transport=/i.test(u) && urls.indexOf(u + '?transport=tcp') < 0) {
          urls.push(u + '?transport=tcp');
        }
      });
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

  /* 从对端 SDP 里数候选类型（诊断用） */
  function countCand(sdp) {
    var stats = { host: 0, srflx: 0, prflx: 0, relay: 0 };
    String(sdp || '').split(/[\r\n]+/).forEach(function (line) {
      var m = line.match(/^a=candidate:.* typ (\w+)/);
      if (m && stats[m[1]] != null) stats[m[1]]++;
    });
    return stats;
  }

  /* ---------- 会话 ---------- */

  /* 模式归一化：不传 / 非法值一律按 1v1（seats=2），与旧版等价 */
  function normalizeMode(v) {
    return (v === '2v2' || v === 4 || v === '4') ? '2v2' : '1v1';
  }
  function seatsFromMode(v) {
    return normalizeMode(v) === '2v2' ? 4 : 2;
  }

  /* opts: { onReady(), onCtrl(msg,seat), onGame(data,seat), onClose(), onState(text),
            onFail(text), onRoom(ev), onSeats(members), mode, nick, roomMode } */
  function Session(opts) {
    this.opts = opts || {};
    /* peers: Map(远端 seat -> { pc, ctrl, game })；
       房主持有 seat1..N-1，客机只持有房主 seat0 */
    this.peers = new Map();
    this.ready = false;
    this.closed = false;
    this.stats = { host: 0, srflx: 0, relay: 0 };
    this._remoteSdp = null;
    this._watchdog = null;
    this._finishedSeats = new Set();   // 已应用应答的座位（房主用）

    this.roomCode = null;              // 8 位房间码（短码模式）
    this.roomRole = null;              // 'host' | 'guest'
    this.roomMode = !!(opts && opts.roomMode);
    this._roomClosed = false;

    /* 新协议字段 */
    this.mode = normalizeMode(opts && opts.mode);
    this.seats = seatsFromMode(this.mode);
    this.mySeat = 0;

    /* 兼容旧字段：指向第一条 peer，旧代码若访问 .pc/.ctrl/.game 仍可用 */
    this.pc = null;
    this.ctrl = null;
    this.game = null;
  }

  Session.prototype._state = function (text) {
    if (typeof this.opts.onState === 'function') this.opts.onState(text);
  };

  Session.prototype._fail = function (text) {
    if (typeof this.opts.onFail === 'function') this.opts.onFail(text);
  };

  /* 预期要建连的远端座位：房主为 seat1..seats-1，客机只有房主 seat0 */
  Session.prototype._expectedSeats = function () {
    if (this.roomRole === 'host') {
      var arr = [];
      for (var i = 1; i < this.seats; i++) arr.push(i);
      return arr;
    }
    return [0];
  };

  /* 取第一条 peer 的 pc，供超时诊断 getStats 用 */
  Session.prototype._firstPc = function () {
    var first = this.peers.values().next().value;
    return first ? first.pc : null;
  };

  /* 没有候选可配时 Chrome 会一直停在 connecting、不触发 failed，
     所以必须有超时兜底。房主在「应用应答码后」上 20s 看门狗；
     客机两段式：20s 只提醒，45s 才判死，避免房主尚未完成连接就误报。 */
  Session.prototype._armWatchdog = function (isGuest) {
    var self = this;
    this._cancelWatchdog();
    var alive = function () {
      if (self.closed || self.ready) return true;
      var connected = false;
      self.peers.forEach(function (peer) {
        if (!peer.pc) return;
        var cs = peer.pc.connectionState, is = peer.pc.iceConnectionState;
        if (cs === 'connected' || is === 'connected' || is === 'completed') connected = true;
      });
      return connected;
    };
    var hard = function () {
      self._watchdog = null;
      if (alive()) return;
      self._hardFail();
    };
    if (isGuest) {
      this._watchdog = setTimeout(function () {
        if (alive()) return;
        self._state(self.roomMode
          ? '还没连上 · 正在等链路建立（继续等待中）…'
          : '还没连上 · 请确认房主已粘贴你的应答码并点了「完成连接」…（继续等待中）');
        self._watchdog = setTimeout(hard, 25000);
      }, 20000);
    } else {
      this._watchdog = setTimeout(hard, 20000);
    }
  };

  /* 判死前先取真实链路数据：连接检查收发计数能区分「对方根本没应答」
     和「双方在互发但都通不过」两种完全不同的故障 */
  Session.prototype._hardFail = async function () {
    var L = this.stats, R = countCand(this._remoteSdp);
    var candText = '本端 host ' + L.host + ' / srflx ' + L.srflx + ' / relay ' + L.relay +
      '；对端 host ' + R.host + ' / srflx ' + R.srflx + ' / relay ' + R.relay;
    var msg;
    if (L.host + L.srflx + L.relay === 0 || R.host + R.srflx + R.relay === 0) {
      msg = '连接超时 · 有一端连候选地址都没收集到（网络被严格限制）。请两端刷新页面后重新创建房间。';
    } else {
      var d = null;
      try {
        var pc = this._firstPc();
        var rep = pc ? await pc.getStats() : null;
        var sent = 0, recv = 0;
        if (rep) rep.forEach(function (r) {
          if (r.type === 'candidate-pair' && r.state && r.state !== 'succeeded') {
            sent += r.requestsSent || 0;
            recv += r.requestsReceived || 0;
          }
        });
        d = { sent: sent, recv: recv };
      } catch (e) {}
      if (d && d.recv > 0) {
        msg = '连接超时 · 双方都在互发连接检查但始终通不过（' + candText +
          '）。多半是当前网络封锁了 TURN 端口，建议换一个网络（如手机热点）再试。';
      } else {
        msg = '连接超时 · 一直没收到对方的连接检查（' + candText + '）。' +
          (this.roomMode
            ? '请双方刷新页面，用新的房间码重新建连。'
            : '最常见的原因：房主还没点「完成连接」，或应用的是旧应答码——请房主确认连接状态区显示「应答码已应用」，然后重新生成邀请码走一遍。');
      }
    }
    this._state('连接超时');
    this._fail(msg);
  };

  Session.prototype._cancelWatchdog = function () {
    if (this._watchdog) { clearTimeout(this._watchdog); this._watchdog = null; }
  };

  /* 建一条 RTCPeerConnection（每条 peer 各自独立收集 ICE 候选） */
  Session.prototype._newPc = function () {
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

  /* 把一条 DataChannel 绑定到某个 seat 的 peer，并挂好带来源 seat 的回调 */
  Session.prototype._bind = function (ch, kind, seat) {
    var self = this;
    var peer = this.peers.get(seat);
    if (!peer) {
      peer = { pc: null, ctrl: null, game: null };
      this.peers.set(seat, peer);
    }
    if (kind === 'ctrl') peer.ctrl = ch; else peer.game = ch;
    // 兼容旧字段：始终指向最近绑定的通道（旧 1v1 代码可能直接访问）
    if (kind === 'ctrl') this.ctrl = ch; else this.game = ch;
    ch.onopen = function () { self._checkReady(); };
    ch.onclose = function () { self._teardown('通道关闭'); };
    ch.onerror = function () { /* 交给 connectionState 处理 */ };
    ch.onmessage = function (e) {
      if (kind === 'ctrl') {
        var msg;
        try { msg = JSON.parse(e.data); } catch (err) { return; }
        if (typeof self.opts.onCtrl === 'function') self.opts.onCtrl(msg, seat);
        return;
      }
      var data = e.data;
      if (typeof data === 'string' && data.charCodeAt(0) === 123) {   // 123 = JSON 起始的左花括号
        try { data = JSON.parse(data); } catch (err) {}
      }
      if (typeof self.opts.onGame === 'function') self.opts.onGame(data, seat);
    };
  };

  /* 房主侧：为某个客机座位创建一条 PC 与 ctrl/game 双通道 */
  Session.prototype._makeHostPeer = function (seat) {
    var pc = this._newPc();
    var peer = { pc: pc, ctrl: null, game: null };
    this.peers.set(seat, peer);
    this._bind(pc.createDataChannel('ctrl', { ordered: true }), 'ctrl', seat);
    try {
      this._bind(pc.createDataChannel('game', { ordered: false, maxRetransmits: 0 }), 'game', seat);
    } catch (e) {
      this._bind(pc.createDataChannel('game'), 'game', seat);   // 老浏览器兜底：可靠通道
    }
    this.pc = pc;                 // 兼容旧字段
    this.ctrl = peer.ctrl;
    this.game = peer.game;
    return peer;
  };

  /* 所有预期 seat 的 ctrl+game 都 open 才算就绪（房主=全部客机，客机=到房主那条） */
  Session.prototype._checkReady = function () {
    var self = this;
    var expected = this._expectedSeats();
    var allOpen = expected.length > 0;
    expected.forEach(function (seat) {
      var peer = self.peers.get(seat);
      if (!peer || !peer.ctrl || !peer.game ||
          peer.ctrl.readyState !== 'open' || peer.game.readyState !== 'open') {
        allOpen = false;
      }
    });
    if (!allOpen || this.ready) return;
    this.ready = true;
    this._cancelWatchdog();
    this._roomClose();               // 房主全部就绪后销毁房间信令（客机内部会跳过）
    this._state('已连接 · 双向通道就绪');
    if (typeof this.opts.onReady === 'function') this.opts.onReady();
  };

  Session.prototype._teardown = function (why) {
    if (this.closed) return;
    this.closed = true;
    this.ready = false;
    this._cancelWatchdog();
    this._roomClose();
    if (typeof this.opts.onClose === 'function') this.opts.onClose(why);
  };

  /* 关闭服务端房间（只删信令，不影响已建立的 P2P 连接）。
     只有房主能销毁房间：2V2 里客机若抢先删会连累其它还没加入的座位。 */
  Session.prototype._roomClose = function () {
    if (this.roomRole !== 'host') return;
    if (!this.roomCode || this._roomClosed) return;
    this._roomClosed = true;
    try {
      roomCall('close', { method: 'POST', body: { code: this.roomCode } }).catch(function () {});
    } catch (e) {}
  };

  /* 按 seat 发送：seat 省略 = 广播给全部 peer；客机只有一条到房主的连接，
     因此无论目标 seat 都走那条。payload 已是序列化后的字符串。 */
  Session.prototype._sendTo = function (kind, payload, seat) {
    var targets = [];
    if (seat == null) {
      this.peers.forEach(function (peer) { targets.push(peer); });
    } else {
      var peer = this.peers.get(seat);
      if (!peer && this.roomRole === 'guest' && this.peers.size === 1) {
        peer = this.peers.values().next().value;
      }
      if (peer) targets.push(peer);
    }
    targets.forEach(function (p) {
      var ch = kind === 'ctrl' ? p.ctrl : p.game;
      if (ch && ch.readyState === 'open') {
        /* 快照是不可靠通道：TURN 拥塞时 SCTP 发送队列会堆积，
           旧快照排队到达只会放大抖动、让客机缓冲忽空忽满。
           队列超过 4KB 直接丢弃本次快照（下一帧 33ms 后就有新数据），
           ctrl 是可靠控制消息，绝不能丢。 */
        if (kind === 'game' && ch.bufferedAmount > 4096) return;
        try { ch.send(payload); } catch (e) {}
      }
    });
  };

  /* 保持 sendCtrl(obj) / sendGame(str) 单参可用：不传 seat 即广播 */
  Session.prototype.sendCtrl = function (obj, seat) {
    this._sendTo('ctrl', JSON.stringify(obj), seat);
  };
  Session.prototype.broadcastCtrl = function (obj) { this.sendCtrl(obj); };
  Session.prototype.sendGame = function (str, seat) {
    this._sendTo('game', str, seat);
  };
  Session.prototype.broadcastGame = function (str) { this.sendGame(str); };

  Session.prototype.close = function () {
    this.broadcastCtrl({ k: 'bye' });
    this._roomClose();
    var self = this;
    setTimeout(function () {
      self.closed = true;
      self.peers.forEach(function (peer) {
        try { if (peer.ctrl) peer.ctrl.close(); } catch (e) {}
        try { if (peer.game) peer.game.close(); } catch (e) {}
        try { if (peer.pc) peer.pc.close(); } catch (e) {}
      });
    }, 120);
  };

  /* 房主：把某个客机座位的应答码应用到对应 PC（核心，供静态 hostFinish 复用） */
  Session.prototype._applyAnswer = async function (seat, answerCode) {
    var peer = this.peers.get(seat);
    if (!peer || !peer.pc) throw new Error('会话已失效，请点「重新生成」重新创建房间');
    var pc = peer.pc;
    // 信令状态校验：stable = 应答码已应用过（双击 / 旧码重复粘贴），再设会直接抛
    var st = pc.signalingState;
    if (st !== 'have-local-offer') {
      if (this.ready) throw new Error('已经连接成功了，不需要再应用应答码');
      if (st === 'stable') throw new Error('这份应答码之前已经应用过了。若仍未连上，请点「重新生成」换新邀请码，让好友重新走一遍流程');
      throw new Error('当前连接状态不匹配（' + st + '），请点「重新生成」重试');
    }
    var ans = await unpack(answerCode);
    if (ans.t !== 'answer') throw new Error('这不是应答码，请确认复制的是好友回传的那段');
    this._remoteSdp = ans.sdp;
    await pc.setRemoteDescription({ type: 'answer', sdp: ans.sdp });
    this._finishedSeats.add(seat);
    this._state('应答码已应用（座位 ' + seat + '），等待连接建立…');
    this._armWatchdog(false);
    return this;
  };

  /* 实例形式：hostFinish(seat, answer)，供 createHostRoom 逐个座位调用 */
  Session.prototype.hostFinish = function (seat, answer) {
    return this._applyAnswer(seat, answer);
  };

  /* ---------- 手动信令（1V1 单 PC，保留旧 API 语义） ---------- */

  Session.createHost = async function (opts) {
    var s = new Session(opts);
    s.roomRole = 'host';
    s.mode = '1v1'; s.seats = 2; s.mySeat = 0;
    s._state('正在获取中继凭证…');
    await fetchTurn();
    s._state('正在收集网络候选地址，请稍候…');
    var peer = s._makeHostPeer(1);
    try {
      var offer = await peer.pc.createOffer();
      await peer.pc.setLocalDescription(offer);
      // 配了 TURN 就放宽收集窗口：中继分配在慢网络下可能超过 3.5s
      await waitIce(peer.pc, effectiveTurn() ? 10000 : 3500);
      var code = await pack({ t: 'offer', sdp: peer.pc.localDescription.sdp, ty: peer.pc.localDescription.type });
      s._state(s.roomMode ? '正在创建房间…' : '邀请码已生成 · 中继候选 ' + s.stats.relay + ' 个');
      return { session: s, code: code };
    } catch (e) {
      s._teardown('创建失败：' + e.message);
      throw e;
    }
  };

  /* 静态形式（兼容旧 net-test.html）：应用到第一个尚未完成的房主座位 */
  Session.hostFinish = async function (session, answerCode) {
    var expected = session._expectedSeats();
    var seat = -1;
    for (var i = 0; i < expected.length; i++) {
      if (!session._finishedSeats.has(expected[i])) { seat = expected[i]; break; }
    }
    if (seat < 0) seat = expected[0];
    return session._applyAnswer(seat, answerCode);
  };

  Session.createGuest = async function (offerCode, opts) {
    var off = await unpack(offerCode);
    if (off.t !== 'offer') throw new Error('这不是邀请码，请确认复制的是房主发来的那段');
    var s = new Session(opts);
    s.roomRole = 'guest';
    s.mode = '1v1'; s.seats = 2; s.mySeat = 1;
    s._state('正在获取中继凭证…');
    await fetchTurn();
    s._state('正在生成应答码…');
    var pc = s._newPc();
    var peer = { pc: pc, ctrl: null, game: null };
    s.peers.set(0, peer);            // 客机唯一 peer = 房主 seat0
    s.pc = pc;
    pc.ondatachannel = function (e) {
      s._bind(e.channel, e.channel.label === 'ctrl' ? 'ctrl' : 'game', 0);
    };
    await pc.setRemoteDescription({ type: 'offer', sdp: off.sdp });
    var answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitIce(pc, effectiveTurn() ? 10000 : 3500);
    var code = await pack({ t: 'answer', sdp: pc.localDescription.sdp, ty: pc.localDescription.type });
    s._remoteSdp = off.sdp;
    s._armWatchdog(true);
    s._state(s.roomMode ? '已加入房间，正在建立直连…' : '应答码已生成，请复制发给房主');
    return { session: s, code: code };
  };

  /* ---------- 8 位房间码：服务端只中转一次建连信令 ---------- */

  function normalizeRoomCode(v) {
    return String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  }

  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* 客户端预生成期望房间码（与服务端同字母表），用于 create 的 preferredCode，
     让服务端有机会直接采用、省去一次随机碰撞重试。 */
  function clientCodeAlphabet() { return 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; }
  function genClientCode() {
    var a = clientCodeAlphabet(), s = '', buf = new Uint8Array(8);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(buf);
    else for (var i = 0; i < 8; i++) buf[i] = Math.floor(Math.random() * 256);
    for (var i = 0; i < 8; i++) s += a[buf[i] % a.length];
    return s;
  }

  /* 同域优先，失败回落线上服务；房间查询一律 no-store */
  async function roomCall(act, o) {
    o = o || {};
    var lastErr = null;
    for (var i = 0; i < ROOM_API_LIST.length; i++) {
      try {
        var init = { method: o.method || 'GET', cache: 'no-store' };
        if (o.body) {
          init.headers = { 'Content-Type': 'application/json' };
          init.body = JSON.stringify(o.body);
        }
        var r = await fetch(ROOM_API_LIST[i] + '/' + act + (o.query || ''), init);
        var j = await r.json();
        j._status = r.status;
        return j;
      } catch (e) { lastErr = e; }
    }
    throw new Error('房间服务连接失败：' + ((lastErr && lastErr.message) || '网络异常'));
  }

  /* 房主：先建房间、立刻拿到 8 位码（不等 ICE 收集，码秒显），再后台逐座位收集
     offer 并补传到服务端。兼容两种调用：
       createHostRoom(opts)              → 默认 1v1（旧 game.js 单参不回归）
       createHostRoom(mode, opts)       → '1v1' | '2v2' */
  Session.createHostRoom = async function (a, b) {
    var mode, opts;
    if (typeof a === 'string') { mode = a; opts = b || {}; }
    else { opts = a || {}; mode = opts.mode || '1v1'; }
    mode = normalizeMode(mode);
    var seats = seatsFromMode(mode);

    var s = new Session(opts);
    s.mode = mode; s.seats = seats; s.mySeat = 0;
    s.roomRole = 'host'; s.roomMode = true;
    s._state('正在获取中继凭证…');
    await fetchTurn();

    /* 1) 先建房间、立刻拿到 8 位码（不阻塞在 ICE 收集中），让房间码秒显 */
    var preferred = genClientCode();
    var res = await roomCall('create', {
      method: 'POST',
      body: { mode: mode, offers: null, nick: opts.nick || '', public: !!opts.public, preferredCode: preferred },
    });
    if (!res || res.error || !res.code) throw new Error((res && res.error) || '创建房间失败');
    var roomCode = res.code;
    s.roomCode = roomCode;

    /* 2) 后台异步收集每个座位的 offer，逐个补传；不再阻塞码显示 */
    (async function () {
      try {
        for (var seat = 1; seat < seats; seat++) {
          if (s.closed) return;
          var peer = s._makeHostPeer(seat);
          var offer = await peer.pc.createOffer();
          await peer.pc.setLocalDescription(offer);
          s._state('正在收集网络候选地址（座位 ' + seat + '）…');
          await waitIce(peer.pc, effectiveTurn() ? 10000 : 3500);
          var code = await pack({ t: 'offer', sdp: peer.pc.localDescription.sdp, ty: peer.pc.localDescription.type });
          await roomCall('offer', { method: 'POST', body: { code: roomCode, seat: seat, offer: code } });
        }
      } catch (e) {
        // 收集失败不致命：已显示的码仍然有效，只是对应座位暂时连不上
        console.warn('[p2p] offer 收集失败', e);
      }
    })();

    /* 3) 后台轮询：全部座位的应答收齐后逐个应用；同时把成员状态回调出去 */
    (async function () {
      var notified = {};
      try {
        for (var i = 0; i < 500; i++) {
          if (s.closed || s.ready) return;
          var st = await roomCall('poll', { query: '?code=' + encodeURIComponent(roomCode) });
          // 轮询返回时可能刚好已建连、房间已被销毁，此时不能把 404 当故障报出去
          if (s.closed || s.ready) return;
          if (st.error) { s._fail('房间已失效：' + st.error); return; }
          if (typeof opts.onSeats === 'function' && Array.isArray(st.members)) opts.onSeats(st.members);
          // joined 事件：兼容旧 onRoom({k:'joined', nick})
          if (Array.isArray(st.members)) {
            for (var m = 0; m < st.members.length; m++) {
              var mem = st.members[m];
              if (mem && mem.seat >= 1 && mem.joined && !notified[mem.seat]) {
                notified[mem.seat] = true;
                if (typeof opts.onRoom === 'function') opts.onRoom({ k: 'joined', nick: mem.nick, seat: mem.seat });
              }
            }
          }
          var answers = Array.isArray(st.answers) ? st.answers : null;
          // 兼容尚未升级的旧房间服务（单 answer 字段）
          if (!answers && st.answer) { answers = []; answers[1] = st.answer; }
          var allDone = true;
          for (var st2 = 1; st2 < seats; st2++) {
            if (s._finishedSeats.has(st2)) continue;
            var ans = answers ? answers[st2] : null;
            if (ans) {
              await s.hostFinish(st2, ans);
            } else {
              allDone = false;
            }
          }
          if (allDone) return;       // 全部应答已应用，交给 _checkReady
          await delay(1200);
        }
        s._fail('等待好友加入超时（10 分钟），请重新创建房间');
      } catch (e) {
        if (!s.closed && !s.ready) s._fail('房间服务异常：' + e.message);
      }
    })();

    return { session: s, code: roomCode };
  };

  /* 客机：输入 8 位码 → lookup 拿 seat+offer → 建到房主的 PC → answer。
     全程无需复制任何码；额外轮询 poll 把成员状态通过 onSeats 回调出去。 */
  Session.joinRoom = async function (rawCode, opts) {
    opts = opts || {};
    var code = normalizeRoomCode(rawCode);
    if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) throw new Error('请输入 8 位房间邀请码（字母和数字）');
    var look = await roomCall('lookup', { query: '?code=' + encodeURIComponent(code) });
    if (look.error) throw new Error(look.error);
    var mode = normalizeMode(look.mode);
    var seats = typeof look.seats === 'number' ? look.seats : seatsFromMode(mode);
    var mySeat = (typeof look.seat === 'number' && look.seat >= 1) ? look.seat : 1;
    // 房主 offer 可能还在后台收集中：轮询 poll 直到本座位 offer 就绪（最多 15s）
    var offer = look.offer;
    if (!offer) {
      var waited = 0;
      while (waited < 15000) {
        await delay(400);
        waited += 400;
        var st = await roomCall('poll', { query: '?code=' + encodeURIComponent(code) });
        if (st.error) throw new Error(st.error);
        var offersArr = Array.isArray(st.offers) ? st.offers : null;
        if (offersArr && offersArr[mySeat]) { offer = offersArr[mySeat]; break; }
      }
      if (!offer) throw new Error('房间房主网络尚未就绪，请稍候重试');
    }
    var made = await Session.createGuest(offer, Object.assign({}, opts, { roomMode: true }));
    var s = made.session;
    s.roomCode = code;
    s.roomRole = 'guest';
    s.mode = mode; s.seats = seats; s.mySeat = mySeat;
    var ans = await roomCall('answer', {
      method: 'POST',
      body: { code: code, seat: mySeat, answer: made.code, nick: opts.nick || '' },
    });
    if (ans.error) {
      s.close();
      throw new Error(ans.error);
    }
    // 客机轮询成员状态：房间被房主销毁或过期后静默停止，不当故障
    (async function () {
      try {
        for (var i = 0; i < 500; i++) {
          if (s.closed) return;
          var st = await roomCall('poll', { query: '?code=' + encodeURIComponent(code) });
          if (s.closed) return;
          if (st.error) return;
          if (typeof opts.onSeats === 'function' && Array.isArray(st.members)) opts.onSeats(st.members);
          await delay(1200);
        }
      } catch (e) { /* 网络抖动静默 */ }
    })();
    return made;
  };

  /* 联机大厅：列公开房间（命中 ROOM_API_LIST，本地优先、回落线上）。
     返回 { rooms:[{code,mode,seats,host,joined,ready,ts}], error? } */
  async function listRooms() {
    var res = await roomCall('list', { method: 'GET' });
    if (!res || res.error) return { rooms: [], error: (res && res.error) || '大厅服务无响应' };
    return { rooms: Array.isArray(res.rooms) ? res.rooms : [] };
  }

  var API = {
    Session: Session,
    pack: pack,
    unpack: unpack,
    normalizeRoomCode: normalizeRoomCode,
    listRooms: listRooms,
    // 顶层便捷引用：契约列出的导出名
    createHostRoom: Session.createHostRoom,
    joinRoom: Session.joinRoom,
    createHost: Session.createHost,
    createGuest: Session.createGuest
  };
  window.WowPinballNet = API;
  // 契约里提到的 window.NET 别名，指向同一对象
  window.NET = API;
})();
