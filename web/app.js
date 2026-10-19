"use strict";

const $ = (s) => document.querySelector(s);
const state = {
  data: null,
  sample: false,
  tab: "opps",
  bias: "all",
  signal: "",
  sector: "",
  sort: "score",
  q: "",
  watch: new Set(load("watchlist", [])),
  chart: null,
};

// ---------------------------------------------------------------- storage (per-device convenience only)
function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* private mode etc. */ }
}

// ---------------------------------------------------------------- formatting
const fmt = (n, d = 2) => (n == null ? "–" : n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }));
const pct = (n, d = 2) => (n == null ? "–" : `${n > 0 ? "+" : ""}${fmt(n, d)}%`);
const cls = (n) => (n == null ? "" : n > 0 ? "up" : n < 0 ? "down" : "");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------------------------------------------------------------- data
async function fetchJSON(url) {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

async function loadData() {
  $("#refresh").classList.add("spin");
  try {
    try {
      state.data = await fetchJSON("data/scan.json");
      state.sample = false;
    } catch {
      state.data = await fetchJSON("data/sample-scan.json");
      state.sample = true;
    }
    buildFilters();
    render();
  } catch (e) {
    $("#meta").textContent = "Could not load data";
    $("#list").innerHTML = `<p class="empty">Failed to load scan data.<br>${esc(e.message)}</p>`;
  } finally {
    $("#refresh").classList.remove("spin");
  }
}

function buildFilters() {
  const stocks = state.data.stocks;
  const sigCounts = new Map();
  for (const s of stocks) for (const g of s.signals) {
    const c = sigCounts.get(g.id) || { label: g.label, n: 0 };
    c.n++; sigCounts.set(g.id, c);
  }
  $("#signal").innerHTML = `<option value="">Any signal</option>` +
    [...sigCounts].sort((a, b) => b[1].n - a[1].n)
      .map(([id, c]) => `<option value="${esc(id)}">${esc(c.label)} (${c.n})</option>`).join("");
  $("#signal").value = sigCounts.has(state.signal) ? state.signal : (state.signal = "");

  const sectors = [...new Set(stocks.map((s) => s.sector).filter(Boolean))].sort();
  $("#sector").innerHTML = `<option value="">All sectors</option>` +
    sectors.map((s) => `<option>${esc(s)}</option>`).join("");
  $("#sector").value = sectors.includes(state.sector) ? state.sector : (state.sector = "");
}

// ---------------------------------------------------------------- list view
function filtered() {
  const q = state.q.trim().toLowerCase();
  let rows = state.data.stocks.filter((s) => {
    if (state.tab === "opps" && !s.signals.length) return false;
    if (state.tab === "watch" && !state.watch.has(s.symbol)) return false;
    if (state.bias === "bull" && !(s.score > 0)) return false;
    if (state.bias === "bear" && !(s.score < 0)) return false;
    if (state.signal && !s.signals.some((g) => g.id === state.signal)) return false;
    if (state.sector && s.sector !== state.sector) return false;
    if (q && !s.symbol.toLowerCase().includes(q) && !(s.name || "").toLowerCase().includes(q)) return false;
    return true;
  });
  const key = state.sort;
  const val = (s) => (key === "score" ? (state.bias === "bear" ? -s.score : Math.abs(s.score) * 100 + s.score) : s[key]);
  rows.sort((a, b) => (val(b) ?? -Infinity) - (val(a) ?? -Infinity));
  return rows;
}

function render() {
  const d = state.data;
  const when = new Date(d.generatedAt);
  $("#meta").textContent = `${d.universe} · ${d.marketDate} · updated ${when.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`;

  const banner = $("#banner");
  banner.hidden = !state.sample;
  banner.textContent = state.sample ? "Showing SAMPLE data (made-up numbers). Real scans appear once the scan workflow runs." : "";

  const b = d.breadth, adv = b.advancers + b.decliners ? (100 * b.advancers) / (b.advancers + b.decliners) : 50;
  $("#breadth").innerHTML = `
    <div class="stat"><span>Adv / Dec</span><b><span class="up">${b.advancers}</span> / <span class="down">${b.decliners}</span></b>
      <div class="adbar"><i style="width:${adv.toFixed(0)}%"></i></div></div>
    <div class="stat"><span>Above 200-DMA</span><b>${fmt(b.pctAbove200, 0)}%</b></div>
    <div class="stat"><span>52w highs</span><b class="up">${b.newHighs}</b></div>
    <div class="stat"><span>52w lows</span><b class="down">${b.newLows}</b></div>`;

  const rows = filtered();
  const list = $("#list");
  if (!rows.length) {
    list.innerHTML = `<p class="empty">${state.tab === "watch" && !state.watch.size
      ? "Your watchlist is empty. Tap ☆ on any stock to add it."
      : "No stocks match these filters."}</p>`;
    return;
  }
  const shown = rows.slice(0, 200);
  list.innerHTML = `<div class="count">${rows.length} stock${rows.length === 1 ? "" : "s"}${rows.length > shown.length ? ` · showing top ${shown.length}` : ""}</div>` +
    shown.map(card).join("");
}

function card(s) {
  const sc = s.score > 0 ? "pos" : s.score < 0 ? "neg" : "";
  return `<article class="card" data-sym="${esc(s.symbol)}" tabindex="0">
    <div class="card-top">
      <div style="min-width:0">
        <div class="sym">${esc(s.symbol)} ${s.score ? `<span class="score ${sc}">${s.score > 0 ? "+" : ""}${s.score}</span>` : ""}${state.watch.has(s.symbol) ? " ★" : ""}</div>
        <div class="name">${esc(s.name)} · ${esc(s.sector)}</div>
      </div>
      <div class="px"><b>₹${fmt(s.close)}</b><span class="${cls(s.chg)}">${pct(s.chg)}</span></div>
    </div>
    ${s.signals.length ? `<div class="chips">${s.signals.map((g) => `<span class="chip ${g.bias}">${esc(g.label)}</span>`).join("")}</div>` : ""}
    <div class="mini">
      <span>RSI <b>${fmt(s.rsi, 0)}</b></span>
      <span>Vol <b>${s.volRatio == null ? "–" : fmt(s.volRatio, 1) + "×"}</b></span>
      <span>1M <b class="${cls(s.perf1m)}">${pct(s.perf1m, 1)}</b></span>
      <span>From high <b>${pct(s.fromHigh, 1)}</b></span>
      ${s.quality != null ? `<span>Quality <b>${s.quality}/5</b></span>` : ""}
    </div>
  </article>`;
}

// ---------------------------------------------------------------- detail view
async function openDetail(sym) {
  const s = state.data?.stocks.find((x) => x.symbol === sym);
  if (!s) return;
  $("#d-title").textContent = s.symbol;
  $("#d-sub").textContent = `${s.name} · ${s.sector}`;
  updateStar(sym);
  const f = s.fund || {};
  const enc = encodeURIComponent(s.symbol);
  $("#d-body").innerHTML = `
    <div class="d-price"><b>₹${fmt(s.close)}</b><span class="${cls(s.chg)}">${pct(s.chg)}</span><span class="muted">${s.date}</span></div>
    <div class="ranges" id="ranges">
      <button data-n="22">1M</button><button data-n="66" class="on">3M</button><button data-n="0">6M</button>
    </div>
    <div id="chart" class="chart"></div>
    <div class="section"><h3>Signals</h3>
      <div class="sig-list">${s.signals.length ? s.signals.map((g) =>
        `<div class="sig"><span class="chip ${g.bias}">${esc(g.label)}</span><small>${esc(g.detail)}</small></div>`).join("")
        : `<p class="muted">No active signals.</p>`}</div>
    </div>
    <div class="section"><h3>Technicals</h3><div class="grid">
      ${stat("RSI (14)", fmt(s.rsi, 0))}
      ${stat("Volume vs 20d", s.volRatio == null ? "–" : fmt(s.volRatio, 1) + "×")}
      ${stat("From 52w high", pct(s.fromHigh, 1))}
      ${stat("1 month", pct(s.perf1m, 1), cls(s.perf1m))}
      ${stat("3 months", pct(s.perf3m, 1), cls(s.perf3m))}
      ${stat("Above 200-DMA", s.above200 ? "Yes" : "No", s.above200 ? "up" : "down")}
    </div></div>
    <div class="section"><h3>Fundamentals${s.quality != null ? ` · quality ${s.quality}/5` : ""}</h3>
      ${s.fund ? `<div class="grid">
        ${stat("P/E", fmt(f.pe, 1))}
        ${stat("P/B", fmt(f.pb, 1))}
        ${stat("ROE", f.roe == null ? "–" : fmt(f.roe, 1) + "%")}
        ${stat("Debt / Equity", fmt(f.de, 2))}
        ${stat("Revenue growth", pct(f.revGrowth, 1), cls(f.revGrowth))}
        ${stat("EPS growth", pct(f.epsGrowth, 1), cls(f.epsGrowth))}
        ${stat("Market cap", f.mcapCr == null ? "–" : "₹" + fmt(f.mcapCr, 0) + " Cr")}
      </div>` : `<p class="muted">Fundamentals are fetched only for stocks with active signals.</p>`}
    </div>
    <div class="section"><h3>Research</h3><div class="links">
      <a href="https://www.tradingview.com/chart/?symbol=NSE:${enc}" target="_blank" rel="noopener">TradingView</a>
      <a href="https://www.screener.in/company/${enc}/" target="_blank" rel="noopener">Screener.in</a>
      <a href="https://www.nseindia.com/get-quotes/equity?symbol=${enc}" target="_blank" rel="noopener">NSE</a>
    </div></div>
    <p class="disclaimer">Signals are mechanical screens on end-of-day data, not recommendations. Do your own research.</p>`;
  $("#sheet").hidden = false;
  document.body.style.overflow = "hidden";
  $("#sheet").scrollTop = 0;

  let bars;
  try {
    bars = state.sample ? sampleHistory(s) : await fetchJSON(`data/history/${enc}.json`);
  } catch {
    $("#chart").innerHTML = `<p class="empty">Chart data unavailable.</p>`;
    return;
  }
  if (location.hash !== `#/s/${enc}`) return; // user navigated away while loading
  drawChart(bars, 66);
  $("#ranges").addEventListener("click", (e) => {
    const n = e.target.dataset?.n;
    if (n == null) return;
    $("#ranges").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === e.target));
    drawChart(bars, +n);
  });
}

function stat(label, value, c = "") {
  return `<div class="stat"><span>${label}</span><b class="${c}">${value}</b></div>`;
}

function sma(bars, n) {
  const out = [];
  let sum = 0;
  bars.forEach((b, i) => {
    sum += b[4];
    if (i >= n) sum -= bars[i - n][4];
    if (i >= n - 1) out.push({ time: b[0], value: +(sum / n).toFixed(2) });
  });
  return out;
}

function drawChart(bars, n) {
  const el = $("#chart");
  disposeChart();
  if (!window.LightweightCharts) { el.innerHTML = `<p class="empty">Chart library failed to load.</p>`; return; }
  const css = getComputedStyle(document.documentElement);
  const v = (k) => css.getPropertyValue(k).trim();
  const chart = LightweightCharts.createChart(el, {
    width: el.clientWidth,
    height: el.clientHeight,
    layout: { background: { color: "transparent" }, textColor: v("--muted"), fontSize: 11 },
    grid: { vertLines: { visible: false }, horzLines: { color: v("--border") } },
    rightPriceScale: { borderVisible: false },
    timeScale: { borderVisible: false },
    crosshair: { mode: 0 },
    handleScroll: { vertTouchDrag: false },
  });
  const candles = chart.addCandlestickSeries({
    upColor: v("--bull"), downColor: v("--bear"), wickUpColor: v("--bull"), wickDownColor: v("--bear"), borderVisible: false,
  });
  candles.setData(bars.map((b) => ({ time: b[0], open: b[1], high: b[2], low: b[3], close: b[4] })));
  const vol = chart.addHistogramSeries({ priceScaleId: "", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
  vol.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
  vol.setData(bars.map((b) => ({ time: b[0], value: b[5], color: b[4] >= b[1] ? v("--bull-bg") : v("--bear-bg") })));
  const line = (data, color) => {
    const s = chart.addLineSeries({ color, lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
    s.setData(data);
  };
  line(sma(bars, 20), v("--accent"));
  line(sma(bars, 50), v("--neutral"));
  if (n && bars.length > n) chart.timeScale().setVisibleLogicalRange({ from: bars.length - n, to: bars.length - 1 });
  else chart.timeScale().fitContent();
  state.chart = chart;
  state.chartResize = new ResizeObserver(() => chart.resize(el.clientWidth, el.clientHeight));
  state.chartResize.observe(el);
}

function closeDetail() {
  $("#sheet").hidden = true;
  document.body.style.overflow = "";
  disposeChart();
}

function disposeChart() {
  state.chartResize?.disconnect();
  state.chart?.remove();
  state.chart = state.chartResize = null;
}

function updateStar(sym) {
  const on = state.watch.has(sym);
  const btn = $("#d-star");
  btn.classList.toggle("on", on);
  btn.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="${on ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/></svg>`;
  btn.dataset.sym = sym;
}

// Deterministic made-up bars so the sample preview has a chart.
function sampleHistory(s) {
  let seed = [...s.symbol].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const n = 180, closes = [s.close];
  for (let i = 1; i < n; i++) closes.unshift(closes[0] / (1 + (rnd() - 0.5 + (s.score || 0) * 0.01) * 0.04));
  const day = new Date(s.date || Date.now());
  const dates = [];
  while (dates.length < n) {
    if (day.getDay() % 6) dates.unshift(day.toISOString().slice(0, 10));
    day.setDate(day.getDate() - 1);
  }
  return closes.map((c, i) => {
    const o = i ? closes[i - 1] : c, hi = Math.max(o, c) * (1 + rnd() * 0.012), lo = Math.min(o, c) * (1 - rnd() * 0.012);
    return [dates[i], +o.toFixed(2), +hi.toFixed(2), +lo.toFixed(2), +c.toFixed(2), Math.round(1e6 * (0.5 + rnd()))];
  });
}

// ---------------------------------------------------------------- routing + events
function route() {
  const m = location.hash.match(/^#\/s\/(.+)$/);
  if (m) openDetail(decodeURIComponent(m[1]));
  else closeDetail();
}

$("#list").addEventListener("click", (e) => {
  const c = e.target.closest(".card");
  if (!c) return;
  state.fromList = true;
  location.hash = `#/s/${encodeURIComponent(c.dataset.sym)}`;
});
$("#list").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.classList.contains("card")) e.target.click();
});
$("#close").addEventListener("click", () => {
  // Go back if we pushed the detail entry ourselves; otherwise (deep link) just clear the hash.
  if (state.fromList) { state.fromList = false; history.back(); } else location.hash = "";
});
$("#d-star").addEventListener("click", (e) => {
  const sym = e.currentTarget.dataset.sym;
  state.watch.has(sym) ? state.watch.delete(sym) : state.watch.add(sym);
  save("watchlist", [...state.watch]);
  updateStar(sym);
  render();
});
document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => {
  state.tab = b.dataset.tab;
  document.querySelectorAll(".tabs button").forEach((x) => x.setAttribute("aria-selected", x === b));
  render();
}));
$("#bias").addEventListener("click", (e) => {
  const v = e.target.dataset?.bias;
  if (!v) return;
  state.bias = v;
  $("#bias").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === e.target));
  render();
});
for (const id of ["signal", "sector", "sort"]) {
  $(`#${id}`).addEventListener("change", (e) => { state[id] = e.target.value; render(); });
}
$("#search").addEventListener("input", (e) => { state.q = e.target.value; render(); });
$("#refresh").addEventListener("click", loadData);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#sheet").hidden) $("#close").click(); });
window.addEventListener("hashchange", route);

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

loadData().then(route);
