// BTC 심리차트 — 바이낸스 현물 BTCUSDT 캔들 + 그리기 도구 (빌드 없음)
(() => {
'use strict';

const LWC = window.LightweightCharts;

// ───────────────────────── 와이드 (화면 90° 회전)
// iPhone 사파리는 화면 방향 고정 API가 없어서 CSS로 돌린다. 돌린 화면에선 터치 좌표가 어긋나므로
// 와이드일 때만 clientX/Y·pageX/Y·getBoundingClientRect를 '돌린 화면 기준'으로 바꿔 돌려준다.
// 화면 (sx, sy) ↔ 돌린 화면 (ux, uy):  ux = sy,  uy = W − sx   (W = 실제 화면 폭)
const wide = (() => {
  const html = document.documentElement;
  const root = document.getElementById('root');
  let on = false;
  const W = () => window.innerWidth;
  const active = () => on;

  for (const proto of [window.MouseEvent && MouseEvent.prototype, window.Touch && Touch.prototype]) {
    if (!proto) continue;
    const d = name => {
      for (let o = proto; o; o = Object.getPrototypeOf(o)) {
        const desc = Object.getOwnPropertyDescriptor(o, name);
        if (desc && desc.get) return desc.get;
      }
      return null;
    };
    const g = { cx: d('clientX'), cy: d('clientY'), px: d('pageX'), py: d('pageY') };
    if (!g.cx || !g.cy || !g.px || !g.py) continue;
    Object.defineProperties(proto, {
      clientX: { configurable: true, get() { return active() ? g.cy.call(this) : g.cx.call(this); } },
      clientY: { configurable: true, get() { return active() ? W() - g.cx.call(this) : g.cy.call(this); } },
      pageX: { configurable: true, get() { return active() ? g.py.call(this) : g.px.call(this); } },
      pageY: { configurable: true, get() { return active() ? W() - g.px.call(this) : g.py.call(this); } },
    });
  }
  const origRect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    const r = origRect.call(this);
    if (!active() || !root || !root.contains(this)) return r;
    return new DOMRect(r.top, W() - r.right, r.height, r.width);
  };
  // 사파리는 캔버스 해상도를 getClientRects로 정한다 → 돌린 화면에선 폭·높이가 뒤바뀌어 축 글씨가 뭉개짐
  const origRects = Element.prototype.getClientRects;
  Element.prototype.getClientRects = function () {
    const list = origRects.call(this);
    if (!active() || !root || !root.contains(this)) return list;
    return Array.from(list, r => new DOMRect(r.top, W() - r.right, r.height, r.width));
  };

  function apply(want) {
    // 폰을 실제로 가로로 돌렸으면 이중 회전이 되므로 끈다 (옛 index.html이면 #root가 없어 못 켬)
    on = !!want && !!root && window.innerWidth < window.innerHeight && window.innerWidth <= 720;
    html.style.setProperty('--vw', window.innerWidth + 'px');
    html.style.setProperty('--vh', window.innerHeight + 'px');
    html.classList.toggle('wide', on);
    const b = document.getElementById('wideBtn');
    if (b) b.classList.toggle('on', !!want);
  }
  return { apply, isOn: () => on };
})();
const SYMBOL = 'BTCUSDT';
const KST = 9 * 3600;            // 차트 시각은 KST로 밀어서 넣는다 (눈금이 KST 자정에 맞도록)
const PAGE = 1000;               // 바이낸스 klines 최대 개수
const EDGE = 150;                // 가장자리에서 이 정도 봉 남으면 더 받는다
const STORE_KEY = 'psychChart.drawings.v1';
const PREF_KEY = 'psychChart.prefs.v1';

const IVS = { '5m': 300, '15m': 900, '1h': 3600 };

const REST_BASES = [
  'https://data-api.binance.vision',
  'https://api.binance.com',
  'https://api1.binance.com',
];
const WS_BASES = [
  'wss://data-stream.binance.vision/ws/',
  'wss://stream.binance.com:9443/ws/',
];

const C = {
  bg: '#0a0e14', grid: 'rgba(36,52,71,0.45)', border: '#243447', text: '#8a9ab0',
  up: '#26e0a5', down: '#ff5572', btc: '#f7931a',
  hline: '#f7931a', ray: '#33d4ff', dot: '#ffcc33',
  box: '#7a93ad', boxFill: 'rgba(122,147,173,0.14)',
  erase: '#ff5572', jump: 'rgba(247,147,26,0.7)',
};

const $ = id => document.getElementById(id);

// ───────────────────────── 저장소 (localStorage는 실패할 수 있음)
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  },
  set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch { return false; }
  },
};

// ───────────────────────── 시각 표시 (차트 시각은 이미 +9h 되어 있어 UTC 게터로 읽는다)
const pad = n => String(n).padStart(2, '0');
const WD = ['일', '월', '화', '수', '목', '금', '토'];
function fmtChartTime(t, withWeekday = true) {
  const d = new Date(t * 1000);
  const s = `${String(d.getUTCFullYear()).slice(2)}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())}`;
  return `${s}${withWeekday ? `(${WD[d.getUTCDay()]})` : ''} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
function tickFmt(t, type) {
  const d = new Date(t * 1000);
  switch (type) {
    case 0: return String(d.getUTCFullYear());
    case 1: return `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}`;
    case 2: return `${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())}`;
    default: return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  }
}
const fmtPrice = p => p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const msToChart = ms => Math.floor(ms / 1000) + KST;
const chartToMs = t => (t - KST) * 1000;

// ───────────────────────── 시세 REST
let restIdx = 0; // 마지막으로 성공한 경로를 먼저 쓴다

async function fetchJson(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? `timeout(${timeoutMs / 1000}s)` : e.message);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchKlines(interval, { startTime, endTime, limit = PAGE } = {}) {
  const q = new URLSearchParams({ symbol: SYMBOL, interval, limit: String(limit) });
  if (startTime != null) q.set('startTime', String(Math.max(0, Math.floor(startTime))));
  if (endTime != null) q.set('endTime', String(Math.floor(endTime)));
  const path = `/api/v3/klines?${q}`;

  const routes = REST_BASES.map((b, i) => ({ i, name: new URL(b).host, url: b + path }));
  routes.push({ i: REST_BASES.length, name: 'corsproxy', url: `https://corsproxy.io/?url=${encodeURIComponent(REST_BASES[0] + path)}` });
  const ordered = [...routes.slice(restIdx), ...routes.slice(0, restIdx)];

  const errors = [];
  for (const r of ordered) {
    try {
      const json = await fetchJson(r.url);
      if (!Array.isArray(json)) throw new Error(`unexpected: ${JSON.stringify(json).slice(0, 80)}`);
      restIdx = r.i;
      return json.map(k => ({
        time: msToChart(k[0]),
        open: +k[1], high: +k[2], low: +k[3], close: +k[4],
      }));
    } catch (e) {
      errors.push(`${r.name}: ${e.message}`);
    }
  }
  throw new Error(errors.join(' | '));
}

// ───────────────────────── 화면 요소
const ui = {
  legend: $('legend'), hint: $('hint'), hintText: $('hintText'), toast: $('toast'),
  livePrice: $('livePrice'), connDot: $('connDot'),
};

let toastTimer = 0;
function toast(msg, { error = false, detail = '', retry = null, ms = 3500 } = {}) {
  clearTimeout(toastTimer);
  const el = ui.toast;
  el.className = 'toast show' + (error ? ' err' : '');
  el.innerHTML = '';
  const m = document.createElement('div'); m.textContent = msg; el.appendChild(m);
  if (detail) { const d = document.createElement('div'); d.className = 'detail'; d.textContent = detail; el.appendChild(d); }
  if (retry) {
    const b = document.createElement('button'); b.className = 'btn'; b.textContent = '다시 시도';
    b.onclick = () => { el.className = 'toast'; retry(); };
    el.appendChild(b);
  }
  if (!retry) toastTimer = setTimeout(() => { el.className = 'toast'; }, ms);
}

// ───────────────────────── 차트
const chart = LWC.createChart($('chart'), {
  autoSize: true,
  layout: {
    background: { type: 'solid', color: C.bg }, textColor: C.text,
    fontFamily: "'IBM Plex Mono', Menlo, Consolas, monospace", fontSize: 11,
    attributionLogo: false,
  },
  grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
  rightPriceScale: { borderColor: C.border, scaleMargins: { top: 0.08, bottom: 0.08 } },
  timeScale: {
    borderColor: C.border, timeVisible: true, secondsVisible: false,
    rightOffset: 8, barSpacing: window.innerWidth < 720 ? 4.5 : 7, tickMarkFormatter: tickFmt,
  },
  localization: { locale: 'ko-KR', timeFormatter: t => fmtChartTime(t), priceFormatter: fmtPrice },
  crosshair: {
    mode: LWC.CrosshairMode.Normal,
    vertLine: { color: 'rgba(138,154,176,0.5)', labelBackgroundColor: '#243447' },
    horzLine: { color: 'rgba(138,154,176,0.5)', labelBackgroundColor: '#243447' },
  },
});

const series = chart.addSeries(LWC.CandlestickSeries, {
  upColor: C.up, downColor: C.down, borderUpColor: C.up, borderDownColor: C.down,
  wickUpColor: C.up, wickDownColor: C.down,
  priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
  priceLineColor: 'rgba(247,147,26,0.8)',
});
const ts = chart.timeScale();

// ───────────────────────── 봉 데이터 상태 (봉 간격별로 메모리에 둔다)
// bars: 연속된 구간 하나. atLatest: 오른쪽 끝이 지금 봉인가 (실시간 반영 여부)
const cache = {};
const S = {
  iv: '5m', bars: [], atLatest: false, noMoreLeft: false,
  loadingLeft: false, loadingRight: false, gen: 0, jumpT: null,
};
const sec = () => IVS[S.iv];

function mergeBars(a, b) {
  const m = new Map();
  for (const x of a) m.set(x.time, x);
  for (const x of b) m.set(x.time, x);
  return [...m.values()].sort((x, y) => x.time - y.time);
}

// 데이터를 바꾸되 보던 자리를 유지한다 (shift = 왼쪽에 새로 붙은 봉 수)
function applyBars(newBars, shift = 0) {
  const r = ts.getVisibleLogicalRange();
  S.bars = newBars;
  series.setData(newBars);
  if (r && S.bars.length) ts.setVisibleLogicalRange({ from: r.from + shift, to: r.to + shift });
  saveCache();
  drawings.refresh();
  updateLegend();
}

function saveCache() {
  cache[S.iv] = { bars: S.bars, atLatest: S.atLatest, noMoreLeft: S.noMoreLeft };
}

function setBusy(on) {
  S.busy = on;
  updateLegend();
}

async function loadLatest() {
  const gen = ++S.gen;
  setBusy(true);
  try {
    const bars = await fetchKlines(S.iv);
    if (gen !== S.gen) return;
    S.atLatest = true; S.noMoreLeft = false;
    S.bars = bars;
    series.setData(bars);
    ts.scrollToRealTime();
    saveCache();
    drawings.refresh();
    updateLegend();
    setTimeout(checkEdges, 0);
  } catch (e) {
    if (gen !== S.gen) return;
    toast('시세를 받지 못했습니다', { error: true, detail: e.message, retry: loadLatest });
  } finally {
    if (gen === S.gen) setBusy(false);
  }
}

async function loadLeft() {
  if (S.loadingLeft || S.noMoreLeft || !S.bars.length) return;
  S.loadingLeft = true; setBusy(true);
  const gen = S.gen, iv = S.iv;
  try {
    const first = S.bars[0].time;
    const got = await fetchKlines(iv, { endTime: chartToMs(first) - 1 });
    if (gen !== S.gen || iv !== S.iv) return;
    if (!got.length) { S.noMoreLeft = true; saveCache(); return; }
    if (got.length < PAGE) S.noMoreLeft = true;
    const merged = mergeBars(got, S.bars);
    const shift = merged.findIndex(b => b.time === first);
    applyBars(merged, Math.max(0, shift));
  } catch (e) {
    toast('과거 봉을 받지 못했습니다', { error: true, detail: e.message, ms: 5000 });
  } finally {
    S.loadingLeft = false; setBusy(S.loadingRight);
    setTimeout(checkEdges, 300);
  }
}

async function loadRight() {
  if (S.loadingRight || S.atLatest || !S.bars.length) return;
  S.loadingRight = true; setBusy(true);
  const gen = S.gen, iv = S.iv;
  try {
    const last = S.bars[S.bars.length - 1].time;
    const got = await fetchKlines(iv, { startTime: chartToMs(last) + 1 });
    if (gen !== S.gen || iv !== S.iv) return;
    if (got.length < PAGE) S.atLatest = true;
    applyBars(mergeBars(S.bars, got), 0);
  } catch (e) {
    toast('다음 봉을 받지 못했습니다', { error: true, detail: e.message, ms: 5000 });
  } finally {
    S.loadingRight = false; setBusy(S.loadingLeft);
    setTimeout(checkEdges, 300);
  }
}

function checkEdges() {
  const r = ts.getVisibleLogicalRange();
  if (!r || !S.bars.length) return;
  if (r.from < EDGE) loadLeft();
  if (!S.atLatest && r.to > S.bars.length - 1 - EDGE) loadRight();
}
ts.subscribeVisibleLogicalRangeChange(() => {
  checkEdges();
  drawings.refresh();
});

// 특정 시각(실제 ms)으로 이동
async function jumpTo(ms, { mark = true } = {}) {
  const s = sec();
  const t = Math.floor(msToChart(ms) / s) * s; // 봉 시작 시각으로 내림 (KST로 민 값 기준이라 1h도 정각)
  if (mark) S.jumpT = t;
  const width = (() => { const r = ts.getVisibleLogicalRange(); return r ? Math.max(40, r.to - r.from) : 160; })();

  const inRange = S.bars.length && t >= S.bars[0].time && t <= S.bars[S.bars.length - 1].time;
  if (!inRange) {
    const gen = ++S.gen;
    S.loadingLeft = S.loadingRight = false;
    setBusy(true);
    try {
      const nowMs = Date.now();
      const startMs = chartToMs(t) - (PAGE / 2) * s * 1000;
      let bars;
      if (chartToMs(t) + (PAGE / 2) * s * 1000 >= nowMs) {
        // 지금과 가까우면 최신 구간을 받는다
        bars = await fetchKlines(S.iv);
        S.atLatest = true;
        if (bars.length && t < bars[0].time) {
          const more = await fetchKlines(S.iv, { endTime: chartToMs(bars[0].time) - 1 });
          bars = mergeBars(more, bars);
        }
      } else {
        bars = await fetchKlines(S.iv, { startTime: startMs });
        S.atLatest = bars.length < PAGE;
      }
      if (gen !== S.gen) return;
      if (!bars.length) { toast('그 시각의 봉이 없습니다', { error: true }); return; }
      S.noMoreLeft = false;
      S.bars = bars;
      series.setData(bars);
      saveCache();
    } catch (e) {
      if (gen !== S.gen) return;
      toast('그 시각의 시세를 받지 못했습니다', { error: true, detail: e.message, retry: () => jumpTo(ms, { mark }) });
      return;
    } finally {
      if (gen === S.gen) setBusy(false);
    }
  }
  const idx = indexAtOrBefore(t);
  ts.setVisibleLogicalRange({ from: idx - width / 2, to: idx + width / 2 });
  drawings.refresh();
  updateLegend();
  setTimeout(checkEdges, 0);
}

// 이분 탐색: time <= t 인 마지막 봉 번호 (없으면 -1)
function indexAtOrBefore(t) {
  const b = S.bars;
  let lo = 0, hi = b.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (b[mid].time <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

// 차트 시각(초, KST로 민 값) → 논리 봉 번호 (소수 가능, 받은 구간 밖은 봉 간격으로 연장)
function timeToLogical(t) {
  const b = S.bars, s = sec();
  if (!b.length) return null;
  if (t < b[0].time) return (t - b[0].time) / s;
  const i = indexAtOrBefore(t);
  if (i === b.length - 1) return i + (t - b[i].time) / s;
  const span = b[i + 1].time - b[i].time;
  return i + Math.min(1, (t - b[i].time) / span);
}
function logicalToTime(l) {
  const b = S.bars, s = sec();
  const i = Math.round(l);
  if (i < 0) return b[0].time + i * s;
  if (i >= b.length) return b[b.length - 1].time + (i - b.length + 1) * s;
  return b[i].time;
}
// logicalToCoordinate는 정수 번호만 제대로 받는다 → 이웃 두 봉 사이를 직접 보간
function timeToX(t) {
  const l = timeToLogical(t);
  if (l == null) return null;
  const f = Math.floor(l);
  const a = ts.logicalToCoordinate(f);
  if (a == null || l === f) return a;
  const b = ts.logicalToCoordinate(f + 1);
  return b == null ? a : a + (l - f) * (b - a);
}

// 간격을 바꿔도 같은 시각을 보도록
function switchInterval(iv) {
  if (iv === S.iv || !IVS[iv]) return;
  const r = ts.getVisibleLogicalRange();
  const wasLatest = S.atLatest && r && r.to >= S.bars.length - 3;
  const centerT = r && S.bars.length ? logicalToTime((r.from + r.to) / 2) : null;

  saveCache();
  S.gen++;
  S.loadingLeft = S.loadingRight = false;
  S.iv = iv;
  store.set(PREF_KEY, { ...store.get(PREF_KEY, {}), iv });
  document.querySelectorAll('#ivSeg button').forEach(b => b.classList.toggle('on', b.dataset.iv === iv));
  connectWs();

  const c = cache[iv];
  S.bars = c ? c.bars : [];
  S.atLatest = c ? c.atLatest : false;
  S.noMoreLeft = c ? c.noMoreLeft : false;
  series.setData(S.bars);

  if (wasLatest || centerT == null) {
    if (c && c.atLatest) { ts.scrollToRealTime(); drawings.refresh(); updateLegend(); backfill(); }
    else loadLatest();
  } else {
    jumpTo(chartToMs(centerT), { mark: false });
  }
}

// ───────────────────────── 실시간 (웹소켓)
const WSs = { ws: null, idx: 0, retry: 0, timer: 0, gotMsg: false };

function setConn(state) {
  ui.connDot.className = 'dot ' + ({ ok: 'ok', wait: 'wait', bad: 'bad' }[state] || '');
  ui.connDot.title = { ok: '실시간 연결됨', wait: '연결 중…', bad: '실시간 끊김 — 재연결 시도 중' }[state] || '';
}

function connectWs() {
  clearTimeout(WSs.timer);
  if (WSs.ws) { WSs.ws.onclose = null; WSs.ws.onerror = null; try { WSs.ws.close(); } catch {} }
  const iv = S.iv;
  const url = `${WS_BASES[WSs.idx % WS_BASES.length]}${SYMBOL.toLowerCase()}@kline_${iv}`;
  setConn('wait');
  let ws;
  try { ws = new WebSocket(url); } catch { scheduleReconnect(); return; }
  WSs.ws = ws; WSs.gotMsg = false;
  ws.onopen = () => { WSs.retry = 0; setConn('ok'); backfill(); };
  ws.onmessage = ev => {
    WSs.gotMsg = true;
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    const k = m.k; if (!k || k.i !== S.iv) return;
    onLiveBar({ time: msToChart(k.t), open: +k.o, high: +k.h, low: +k.l, close: +k.c });
  };
  ws.onerror = () => {};
  ws.onclose = () => {
    if (WSs.ws !== ws) return;
    if (!WSs.gotMsg) WSs.idx++; // 메시지 한 번도 못 받았으면 다른 주소로
    setConn('bad');
    scheduleReconnect();
  };
}
function scheduleReconnect() {
  clearTimeout(WSs.timer);
  const delay = Math.min(30000, 1000 * 2 ** WSs.retry++);
  WSs.timer = setTimeout(connectWs, delay);
}

function onLiveBar(bar) {
  ui.livePrice.textContent = fmtPrice(bar.close);
  document.title = `${fmtPrice(bar.close)} · BTC 심리차트`;
  if (!S.atLatest || !S.bars.length) return;
  const last = S.bars[S.bars.length - 1];
  if (bar.time < last.time) return;
  if (bar.time === last.time) S.bars[S.bars.length - 1] = bar;
  else if (bar.time === last.time + sec()) S.bars.push(bar);
  else { backfill(); return; } // 빈 구간 생김 → REST로 메움
  series.update(bar);
  updateLegend();
}

// 끊겼다 이어졌을 때 빠진 봉을 채운다
let backfilling = false;
async function backfill() {
  if (backfilling || !S.atLatest || !S.bars.length) return;
  backfilling = true;
  const gen = S.gen, iv = S.iv;
  try {
    for (let round = 0; round < 3; round++) {
      const last = S.bars[S.bars.length - 1].time;
      const got = await fetchKlines(iv, { startTime: chartToMs(last) });
      if (gen !== S.gen || iv !== S.iv) return;
      applyBars(mergeBars(S.bars, got), 0);
      if (got.length < PAGE) return;
    }
    loadLatest(); // 너무 오래 끊겼으면 최신 구간을 새로 받는다
  } catch { /* 다음 연결 때 다시 */ }
  finally { backfilling = false; }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (!WSs.ws || WSs.ws.readyState > 1) { WSs.retry = 0; connectWs(); }
  else backfill();
});

// ───────────────────────── 범례 (마우스·탭 위치의 봉 OHLC)
let hoverT = null;
function updateLegend() {
  const b = S.bars;
  let bar = null;
  if (hoverT != null) { const i = indexAtOrBefore(hoverT); if (i >= 0 && b[i].time === hoverT) bar = b[i]; }
  if (!bar) bar = b[b.length - 1];
  if (!bar) { ui.legend.innerHTML = S.busy ? '<span class="busy">불러오는 중…</span>' : ''; return; }
  const chg = (bar.close - bar.open) / bar.open * 100;
  const cls = bar.close >= bar.open ? 'u' : 'd';
  ui.legend.innerHTML =
    `<span class="t">${fmtChartTime(bar.time)}</span>` +
    `<span>O <b class="${cls}">${fmtPrice(bar.open)}</b></span>` +
    `<span>H <b class="${cls}">${fmtPrice(bar.high)}</b></span>` +
    `<span>L <b class="${cls}">${fmtPrice(bar.low)}</b></span>` +
    `<span>C <b class="${cls}">${fmtPrice(bar.close)}</b></span>` +
    `<span class="${cls}">${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%</span>` +
    (S.busy ? '<span class="busy">불러오는 중…</span>' : '');
}

// ───────────────────────── 색 (트레이딩뷰 기본 10색에서 남보라를 빼고 흰색을 넣음)
const PALETTE = ['#ffffff', '#f23645', '#ff9800', '#ffeb3b', '#4caf50', '#089981', '#00bcd4', '#2962ff', '#9c27b0', '#e91e63'];
const DEFAULT_COLOR = { hline: C.hline, ray: C.ray, dot: C.dot, box: C.box };
const isHex = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const colorOf = d => (isHex(d.c) ? d.c : DEFAULT_COLOR[d.type]);
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}
// 밝은 바탕(흰·노랑 등)엔 어두운 글씨
function labelTextColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? C.bg : '#ffffff';
}
// 도구별 마지막에 쓴 색
const toolColors = { ...DEFAULT_COLOR };
for (const [k, v] of Object.entries(store.get(PREF_KEY, {}).colors || {})) if (k in toolColors && isHex(v)) toolColors[k] = v;
function saveToolColors() { store.set(PREF_KEY, { ...store.get(PREF_KEY, {}), colors: toolColors }); }

// ───────────────────────── 그림 (시각·가격으로 저장 → 확대·스크롤·간격 변경에도 따라온다)
// 저장 형식: { id, type: 'hline'|'ray'|'dot'|'box', p, t?, p2?, t2?, c? }  (t = 실제 UTC ms, c = 색 #rrggbb)
const drawings = (() => {
  let list = (store.get(STORE_KEY, { drawings: [] }).drawings || []).filter(valid);
  let pending = null;   // 박스 첫 꼭짓점 {t, p}
  let preview = null;   // 박스 미리보기 둘째 꼭짓점 {t, p}
  let hot = null;       // 지우기 후보 id
  let sel = null;       // 수정 중인 그림 id
  let requestUpdate = () => {};
  let axisViews = [];

  function valid(d) {
    if (!d || typeof d !== 'object' || typeof d.id !== 'string') return false;
    const num = v => typeof v === 'number' && isFinite(v);
    switch (d.type) {
      case 'hline': return num(d.p);
      case 'ray': case 'dot': return num(d.p) && num(d.t);
      case 'box': return num(d.p) && num(d.t) && num(d.p2) && num(d.t2);
      default: return false;
    }
  }
  function persist() {
    if (!store.set(STORE_KEY, { version: 1, drawings: list })) {
      toast('이 브라우저에 저장하지 못했습니다 (개인정보 보호 모드?) — 내보내기로 백업하세요', { error: true, ms: 6000 });
    }
    rebuildAxis();
    requestUpdate();
    $('drawCount').textContent = list.length;
  }

  // 가격축 라벨: 수평선·레이
  function rebuildAxis() {
    axisViews = list.filter(d => d.type === 'hline' || d.type === 'ray').map(d => {
      return {
        coordinate: () => series.priceToCoordinate(d.p) ?? -100,
        text: () => fmtPrice(d.p),
        textColor: () => (hot === d.id ? '#ffffff' : labelTextColor(colorOf(d))),
        backColor: () => (hot === d.id ? C.erase : colorOf(d)),
      };
    });
  }

  const cx = d => timeToX(msToChart(d.t));
  const cy = p => series.priceToCoordinate(p);

  function draw(ctx, w, h) {
    // 날짜 이동 표시
    if (S.jumpT != null) {
      const x = timeToX(S.jumpT);
      if (x != null && x >= 0 && x <= w) {
        ctx.save(); ctx.strokeStyle = C.jump; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, h); ctx.stroke();
        ctx.restore();
      }
    }
    for (const d of list) drawOne(ctx, d, w, h, hot === d.id);
    const sd = sel && list.find(d => d.id === sel);
    if (sd) drawHandles(ctx, sd, w);
    if (pending) {
      const c = toolColors.box;
      const a = { type: 'dot', t: pending.t, p: pending.p, c };
      if (preview) drawOne(ctx, { type: 'box', t: pending.t, p: pending.p, t2: preview.t, p2: preview.p, c }, w, h, false, true);
      drawOne(ctx, a, w, h, false);
    }
  }

  function drawOne(ctx, d, w, h, isHot, ghost = false) {
    const y = cy(d.p);
    if (y == null) return;
    ctx.save();
    ctx.lineWidth = isHot ? 2.5 : 1.5;
    const color = colorOf(d);
    switch (d.type) {
      case 'hline': {
        ctx.strokeStyle = isHot ? C.erase : color;
        ctx.beginPath(); ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(w, Math.round(y) + 0.5); ctx.stroke();
        break;
      }
      case 'ray': {
        const x = cx(d); if (x == null) break;
        const col = isHot ? C.erase : color;
        ctx.strokeStyle = col; ctx.fillStyle = col;
        const yy = Math.round(y) + 0.5;
        ctx.beginPath(); ctx.moveTo(Math.max(x, -10), yy); ctx.lineTo(w, yy); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'dot': {
        const x = cx(d); if (x == null) break;
        ctx.fillStyle = isHot ? C.erase : color;
        ctx.strokeStyle = C.bg; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, isHot ? 6 : 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        break;
      }
      case 'box': {
        const x1 = cx(d), x2 = timeToX(msToChart(d.t2)), y2 = cy(d.p2);
        if (x1 == null || x2 == null || y2 == null) break;
        const l = Math.min(x1, x2), r = Math.max(x1, x2), t = Math.min(y, y2), b = Math.max(y, y2);
        ctx.fillStyle = isHot ? 'rgba(255,85,114,0.15)' : hexA(color, 0.14);
        ctx.fillRect(l, t, r - l, b - t);
        ctx.strokeStyle = isHot ? C.erase : color;
        if (ghost) ctx.setLineDash([4, 3]);
        ctx.strokeRect(Math.round(l) + 0.5, Math.round(t) + 0.5, Math.round(r - l), Math.round(b - t));
        break;
      }
    }
    ctx.restore();
  }

  // 수정 손잡이: 박스는 네 꼭짓점, 레이·점은 시작점, 수평선은 화면 가운데 한 점
  function handlesOf(d, w) {
    const y = cy(d.p); if (y == null) return [];
    if (d.type === 'hline') return [{ x: w / 2, y, tk: null, pk: 'p' }];
    const x = cx(d); if (x == null) return [];
    if (d.type !== 'box') return [{ x, y, tk: 't', pk: 'p' }];
    const x2 = timeToX(msToChart(d.t2)), y2 = cy(d.p2);
    if (x2 == null || y2 == null) return [];
    return [
      { x, y, tk: 't', pk: 'p' }, { x: x2, y, tk: 't2', pk: 'p' },
      { x, y: y2, tk: 't', pk: 'p2' }, { x: x2, y: y2, tk: 't2', pk: 'p2' },
    ];
  }
  function drawHandles(ctx, d, w) {
    ctx.save();
    ctx.fillStyle = C.bg; ctx.strokeStyle = C.btc; ctx.lineWidth = 2;
    for (const hd of handlesOf(d, w)) {
      ctx.beginPath(); ctx.arc(hd.x, hd.y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  // 지우기용: 탭 위치에서 가장 가까운 그림 (px 거리)
  function hitTest(px, py, tol = 16, only = null) {
    let best = null, bestD = tol;
    for (const d of only ? list.filter(x => x.id === only) : list) {
      const y = cy(d.p); if (y == null) continue;
      let dist = Infinity;
      if (d.type === 'hline') dist = Math.abs(py - y);
      else if (d.type === 'dot') { const x = cx(d); if (x != null) dist = Math.hypot(px - x, py - y); }
      else if (d.type === 'ray') {
        const x = cx(d); if (x == null) continue;
        dist = px >= x ? Math.abs(py - y) : Math.hypot(px - x, py - y);
      } else if (d.type === 'box') {
        const x1 = cx(d), x2 = timeToX(msToChart(d.t2)), y2 = cy(d.p2);
        if (x1 == null || x2 == null || y2 == null) continue;
        const l = Math.min(x1, x2), r = Math.max(x1, x2), t = Math.min(y, y2), b = Math.max(y, y2);
        const inside = px >= l && px <= r && py >= t && py <= b;
        const edge = Math.min(
          px >= l - tol && px <= r + tol ? Math.min(Math.abs(py - t), Math.abs(py - b)) : Infinity,
          py >= t - tol && py <= b + tol ? Math.min(Math.abs(px - l), Math.abs(px - r)) : Infinity,
        );
        dist = inside ? Math.min(edge, tol - 1) : edge; // 안쪽 탭도 지울 수 있게, 선은 우선
      }
      if (dist < bestD) { bestD = dist; best = d; }
    }
    return best;
  }

  const paneView = {
    zOrder: () => 'top',
    renderer: () => ({
      draw: target => target.useMediaCoordinateSpace(({ context, mediaSize }) => draw(context, mediaSize.width, mediaSize.height)),
    }),
  };
  const paneViews = [paneView];
  const primitive = {
    attached: p => { requestUpdate = p.requestUpdate; },
    detached: () => { requestUpdate = () => {}; },
    updateAllViews: () => {},
    paneViews: () => paneViews,
    priceAxisViews: () => axisViews,
  };
  series.attachPrimitive(primitive);
  rebuildAxis();
  $('drawCount').textContent = list.length;

  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  return {
    refresh: () => requestUpdate(),
    all: () => list.slice(),
    count: () => list.length,
    add(d) { list.push({ id: newId(), ...d }); persist(); },
    remove(id) { list = list.filter(d => d.id !== id); hot = null; if (sel === id) sel = null; persist(); },
    get: id => list.find(d => d.id === id) || null,
    // 끄는 동안은 그리기만 다시 하고, 손을 뗄 때 save()로 저장
    patch(id, fields) { const d = list.find(x => x.id === id); if (d) { Object.assign(d, fields); requestUpdate(); } },
    save: () => persist(),
    setSel(id) { sel = id; requestUpdate(); },
    getSel: () => sel,
    handleAt(px, py, w, tol) {
      const d = sel && list.find(x => x.id === sel); if (!d) return null;
      let best = null, bestD = tol;
      for (const hd of handlesOf(d, w)) { const dist = Math.hypot(px - hd.x, py - hd.y); if (dist < bestD) { bestD = dist; best = hd; } }
      return best;
    },
    clear() { list = []; sel = null; persist(); },
    importMany(arr) {
      const have = new Set(list.map(d => d.id));
      let added = 0, bad = 0;
      for (const d of arr) {
        if (!valid(d)) { bad++; continue; }
        if (have.has(d.id)) continue;
        const clean = { id: d.id, type: d.type, p: d.p };
        if (d.t != null) clean.t = d.t;
        if (d.type === 'box') { clean.p2 = d.p2; clean.t2 = d.t2; }
        if (isHex(d.c)) clean.c = d.c;
        list.push(clean); have.add(d.id); added++;
      }
      persist();
      return { added, bad };
    },
    hitTest,
    setPending(p) { pending = p; preview = null; requestUpdate(); },
    getPending: () => pending,
    setPreview(p) { preview = p; requestUpdate(); },
    setHot(id) { if (hot !== id) { hot = id; rebuildAxis(); requestUpdate(); } },
  };
})();

// ───────────────────────── 도구 (버튼 → 탭 1번 / 박스는 2번 → 다시 커서로)
let tool = null;
const HINTS = {
  hline: '수평선 — 가격 위치를 탭하세요',
  dot: '점 — 찍을 위치를 탭하세요',
  ray: '레이 — 시작점을 탭하세요 (오른쪽으로 뻗음)',
  box: '박스 — 첫 꼭짓점을 탭하세요',
  box2: '박스 — 반대쪽 꼭짓점을 탭하세요',
  erase: '지우기 — 지울 그림을 탭하세요',
  edit: '끌어서 이동 · ○로 크기 조절',
};

function setTool(t) {
  if (t) select(null);
  tool = t;
  drawings.setPending(null);
  drawings.setHot(null);
  document.querySelectorAll('#tools .tool').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  showHint(t ? HINTS[t] : null);
}
function showHint(text) {
  ui.hint.classList.toggle('show', !!text);
  ui.hint.classList.toggle('erase', tool === 'erase');
  ui.hintText.textContent = text || '';
  $('hintDelete').hidden = !drawings.getSel();
  $('hintCancel').textContent = drawings.getSel() ? '완료' : '취소';
  renderSwatches();
}

// 색 고르기: 도구를 고른 상태면 새로 그릴 색, 그림을 선택한 상태면 그 그림의 색
function renderSwatches() {
  const box = $('swatches');
  const sd = drawings.getSel() && drawings.get(drawings.getSel());
  const type = sd ? sd.type : (tool && tool !== 'erase' ? tool : null);
  box.hidden = !type;
  if (!type) return;
  const cur = sd ? colorOf(sd) : toolColors[type];
  box.innerHTML = '';
  for (const c of PALETTE) {
    const b = document.createElement('button');
    b.className = 'sw' + (c.toLowerCase() === cur.toLowerCase() ? ' on' : '');
    b.style.background = c;
    b.title = c;
    b.addEventListener('click', () => {
      toolColors[type] = c; saveToolColors();
      const id = drawings.getSel();
      if (id) { drawings.patch(id, { c }); drawings.save(); }
      drawings.refresh();
      renderSwatches();
    });
    box.appendChild(b);
  }
}

// 그림 선택(수정 모드): 선택 중엔 차트 끌기·확대를 잠가서 손가락이 그림만 움직이게 한다
function select(id) {
  if (id === drawings.getSel()) return;
  drawings.setSel(id);
  chart.applyOptions({ handleScroll: !id, handleScale: !id });
  if (id) { tool = null; document.querySelectorAll('#tools .tool').forEach(b => b.classList.remove('on')); }
  showHint(id ? HINTS.edit : null);
}

document.querySelectorAll('#tools .tool').forEach(b => {
  b.addEventListener('click', () => setTool(tool === b.dataset.tool ? null : b.dataset.tool));
});
$('hintCancel').addEventListener('click', () => { select(null); setTool(null); });
$('hintDelete').addEventListener('click', () => { const id = drawings.getSel(); select(null); if (id) drawings.remove(id); });

function pointAt(x, y) {
  if (!S.bars.length) return null;
  const p = series.coordinateToPrice(y);
  const l = ts.coordinateToLogical(x);
  if (p == null || l == null) return null;
  return { t: chartToMs(logicalToTime(l)), p: Math.round(p * 100) / 100 };
}

// 탭 처리는 직접 한다: 차트 자체 click은 0.5초 안의 두 번째 클릭을 더블클릭 대기로 삼켜서
// 박스 두 꼭짓점을 빨리 찍으면 빠진다.
const chartEl = $('chart');
const taps = new Map(); // pointerId → {x, y, t}
let multiTouch = false;
let drag = null; // {id, pointerId, handle|null, start:{l,p}, orig}
function localXY(e) {
  const r = chartEl.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width - chart.priceScale('right').width() };
}
chartEl.addEventListener('pointerdown', e => {
  taps.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
  if (taps.size > 1) { multiTouch = true; drag = null; return; }
  const sid = drawings.getSel();
  if (!sid || tool) return;
  const { x, y, w } = localXY(e);
  const tol = e.pointerType === 'mouse' ? 10 : 22;
  const handle = drawings.handleAt(x, y, w, tol);
  if (!handle && !drawings.hitTest(x, y, tol, sid)) return;
  const l = ts.coordinateToLogical(x), p = series.coordinateToPrice(y);
  if (l == null || p == null) return;
  drag = { id: sid, pointerId: e.pointerId, handle, start: { l, p }, orig: { ...drawings.get(sid) }, moved: false };
  try { chartEl.setPointerCapture(e.pointerId); } catch {}
}, true);
chartEl.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const { x, y } = localXY(e);
  const l = ts.coordinateToLogical(x), p = series.coordinateToPrice(y);
  if (l == null || p == null) return;
  drag.moved = true;
  const o = drag.orig, round = v => Math.round(v * 100) / 100;
  if (drag.handle) {
    // 손잡이: 그 꼭짓점만 손가락 위치로
    const f = { [drag.handle.pk]: round(p) };
    if (drag.handle.tk) f[drag.handle.tk] = chartToMs(logicalToTime(l));
    drawings.patch(drag.id, f);
  } else {
    // 몸통: 가격·봉 개수만큼 통째로 이동
    const dp = p - drag.start.p, dl = Math.round(l - drag.start.l);
    const shiftT = t => chartToMs(logicalToTime(timeToLogical(msToChart(t)) + dl));
    const f = { p: round(o.p + dp) };
    if (o.t != null) f.t = shiftT(o.t);
    if (o.type === 'box') { f.p2 = round(o.p2 + dp); f.t2 = shiftT(o.t2); }
    drawings.patch(drag.id, f);
  }
}, true);
const endTap = e => {
  if (drag && e.pointerId === drag.pointerId) {
    const moved = drag.moved;
    drag = null;
    if (moved) { drawings.save(); taps.delete(e.pointerId); return; }
  }
  const d = taps.get(e.pointerId);
  taps.delete(e.pointerId);
  if (!d) return;
  const wasMulti = multiTouch;
  if (!taps.size) multiTouch = false;
  if (e.type !== 'pointerup' || wasMulti || (e.pointerType === 'mouse' && e.button !== 0)) return;
  if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8 || performance.now() - d.t > 600) return; // 끌기·길게 누르기는 탭 아님
  const r = chartEl.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  const paneW = r.width - chart.priceScale('right').width(), paneH = r.height - ts.height();
  if (x < 0 || y < 0 || x > paneW || y > paneH) return; // 축 위 탭은 무시
  onTap(x, y);
};
chartEl.addEventListener('pointerup', endTap, true);
chartEl.addEventListener('pointercancel', endTap, true);

function onTap(x, y) {
  if (!tool) {
    // 도구 없이 탭: 그림을 고르면 수정 모드, 빈 곳이면 해제
    const sid = drawings.getSel();
    if (sid && drawings.hitTest(x, y, 22, sid)) return;
    const hit = drawings.hitTest(x, y, 18);
    select(hit ? hit.id : null);
    return;
  }
  if (tool === 'erase') {
    const hit = drawings.hitTest(x, y);
    if (hit) { drawings.remove(hit.id); setTool(null); }
    else toast('여기엔 지울 그림이 없습니다', { ms: 1500 });
    return;
  }
  const pt = pointAt(x, y);
  if (!pt) return;
  const c = toolColors[tool];
  if (tool === 'hline') drawings.add({ type: 'hline', p: pt.p, c });
  else if (tool === 'dot') drawings.add({ type: 'dot', t: pt.t, p: pt.p, c });
  else if (tool === 'ray') drawings.add({ type: 'ray', t: pt.t, p: pt.p, c });
  else if (tool === 'box') {
    const first = drawings.getPending();
    if (!first) { drawings.setPending(pt); showHint(HINTS.box2); return; }
    if (first.t === pt.t && first.p === pt.p) return;
    drawings.add({ type: 'box', t: first.t, p: first.p, t2: pt.t, p2: pt.p, c });
  }
  setTool(null);
}

chart.subscribeCrosshairMove(param => {
  hoverT = param.time ?? null;
  updateLegend();
  if (!tool || !param.point) { if (tool === 'erase') drawings.setHot(null); return; }
  if (tool === 'erase') {
    const hit = drawings.hitTest(param.point.x, param.point.y);
    drawings.setHot(hit ? hit.id : null);
  } else if (tool === 'box' && drawings.getPending()) {
    const pt = pointAt(param.point.x, param.point.y);
    if (pt) drawings.setPreview(pt);
  }
});

// ───────────────────────── 팝업
function openModal(id) { $(id).classList.add('show'); }
function closeModal(el) { el.classList.remove('show'); }
document.querySelectorAll('.backdrop').forEach(bd => {
  bd.addEventListener('click', e => { if (e.target === bd || e.target.hasAttribute('data-close')) closeModal(bd); });
});

// 날짜 이동 (입력은 KST)
function kstInputValue(ms) {
  const d = new Date(ms + KST * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
function parseKstInput(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v || '');
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - KST * 1000;
}
$('gotoBtn').addEventListener('click', () => {
  const inp = $('gotoInput');
  inp.max = kstInputValue(Date.now());
  if (!inp.value) {
    const r = ts.getVisibleLogicalRange();
    inp.value = kstInputValue(r && S.bars.length ? chartToMs(logicalToTime((r.from + r.to) / 2)) : Date.now());
  }
  openModal('gotoModal');
});
function doGoto(ms) {
  if (ms == null || isNaN(ms)) { toast('날짜·시각을 입력하세요', { error: true }); return; }
  if (ms > Date.now()) ms = Date.now();
  closeModal($('gotoModal'));
  jumpTo(ms);
}
$('gotoGo').addEventListener('click', () => doGoto(parseKstInput($('gotoInput').value)));
$('gotoInput').addEventListener('keydown', e => { if (e.key === 'Enter') doGoto(parseKstInput(e.target.value)); });
document.querySelectorAll('#gotoModal [data-ago]').forEach(b => b.addEventListener('click', () => {
  const ms = Date.now() - (+b.dataset.ago) * 86400000;
  $('gotoInput').value = kstInputValue(ms);
  doGoto(ms);
}));
document.querySelectorAll('#gotoModal [data-date]').forEach(b => b.addEventListener('click', () => {
  $('gotoInput').value = b.dataset.date;
  doGoto(parseKstInput(b.dataset.date));
}));

$('latestBtn').addEventListener('click', () => {
  S.jumpT = null;
  if (S.atLatest) { ts.scrollToRealTime(); drawings.refresh(); }
  else loadLatest();
});

// 내보내기 / 가져오기
function exportPayload() {
  return JSON.stringify({
    app: 'btc-psych-chart', version: 1, symbol: SYMBOL,
    exportedAt: new Date().toISOString(), drawings: drawings.all(),
  }, null, 1);
}
$('dataBtn').addEventListener('click', () => { $('drawCount').textContent = drawings.count(); openModal('dataModal'); });
$('exportFile').addEventListener('click', () => {
  const blob = new Blob([exportPayload()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `btc-psych-drawings-${kstInputValue(Date.now()).replace(/[-:]/g, '').replace('T', '-')}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
$('exportCopy').addEventListener('click', async () => {
  const text = exportPayload();
  try { await navigator.clipboard.writeText(text); toast(`그림 ${drawings.count()}개를 복사했습니다`); }
  catch { $('importText').value = text; $('importText').select(); toast('자동 복사가 막혀 있어요 — 아래 칸의 텍스트를 직접 복사하세요', { ms: 5000 }); }
});
function importText(text) {
  let data;
  try { data = JSON.parse(text); } catch { toast('JSON 형식이 아닙니다', { error: true }); return; }
  const arr = Array.isArray(data) ? data : data && data.drawings;
  if (!Array.isArray(arr)) { toast('그림 목록을 찾지 못했습니다', { error: true }); return; }
  const { added, bad } = drawings.importMany(arr);
  $('drawCount').textContent = drawings.count();
  toast(`${added}개 가져왔습니다${bad ? ` (잘못된 항목 ${bad}개 건너뜀)` : ''}`);
}
$('importFileBtn').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  importText(await f.text());
  e.target.value = '';
});
$('importPaste').addEventListener('click', () => {
  const v = $('importText').value.trim();
  if (!v) { toast('붙여넣은 내용이 없습니다', { error: true }); return; }
  importText(v);
  $('importText').value = '';
});
$('clearAll').addEventListener('click', () => {
  if (!drawings.count()) return;
  if (!confirm(`그림 ${drawings.count()}개를 모두 지울까요? (먼저 내보내기로 백업 권장)`)) return;
  drawings.clear();
  $('drawCount').textContent = 0;
});

// 봉 간격 버튼
document.querySelectorAll('#ivSeg button').forEach(b => b.addEventListener('click', () => switchInterval(b.dataset.iv)));

// 단축키 (PC)
document.addEventListener('keydown', e => {
  if (e.target.matches('input, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Escape') {
    const open = document.querySelector('.backdrop.show');
    if (open) closeModal(open); else { select(null); setTool(null); }
    return;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && drawings.getSel()) { $('hintDelete').click(); return; }
  if (document.querySelector('.backdrop.show')) return;
  const map = { h: 'hline', b: 'box', d: 'dot', r: 'ray', e: 'erase' };
  const k = e.key.toLowerCase();
  if (map[k]) setTool(tool === map[k] ? null : map[k]);
  else if (k === 'g') $('gotoBtn').click();
  else if (k === 'l') $('latestBtn').click();
  else if (k === '1') switchInterval('5m');
  else if (k === '2') switchInterval('15m');
  else if (k === '3') switchInterval('1h');
});

// 와이드 버튼
let wantWide = false;
$('wideBtn')?.addEventListener('click', () => {
  wantWide = !wantWide;
  store.set(PREF_KEY, { ...store.get(PREF_KEY, {}), wide: wantWide });
  wide.apply(wantWide);
});
window.addEventListener('resize', () => wide.apply(wantWide));

// ───────────────────────── 시작
const prefs = store.get(PREF_KEY, {});
wantWide = !!prefs.wide;
wide.apply(wantWide);
S.iv = IVS[prefs.iv] ? prefs.iv : '5m';
document.querySelectorAll('#ivSeg button').forEach(b => b.classList.toggle('on', b.dataset.iv === S.iv));
updateLegend();
loadLatest();
connectWs();

// 디버그·테스트용
window.__psych = { S, chart, series, drawings, jumpTo, switchInterval, wide };
})();
