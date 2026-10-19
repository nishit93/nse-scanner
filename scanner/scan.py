"""Daily NSE opportunity scanner.

Downloads end-of-day prices for the Nifty 500, computes technical signals,
attaches basic fundamentals for the most interesting names, and writes JSON
that the web app reads:

    <out>/scan.json              summary + one row per stock
    <out>/history/<SYMBOL>.json  recent OHLCV bars for the chart

Usage: python scanner/scan.py [output_dir]   (default: web/data)
"""
import io
import json
import math
import sys
import time
from datetime import datetime, time as dtime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import requests
import yfinance as yf

ROOT = Path(__file__).resolve().parent
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parent / "web" / "data"
IST = timezone(timedelta(hours=5, minutes=30))

UNIVERSE_URL = "https://www.niftyindices.com/IndexConstituent/ind_nifty500list.csv"
FUND_CACHE = ROOT / ".cache" / "fundamentals.json"
FUND_MAX = 150          # fundamentals are fetched for the top-N scored stocks
FUND_TTL_DAYS = 7       # fundamentals change slowly; refresh weekly
HISTORY_BARS = 180      # bars written per stock for the chart
CHUNK = 100             # tickers per yfinance batch download
SESSION_FINAL = dtime(16, 0)  # IST; NSE closes 15:30, allow time for final prices


# ---------------------------------------------------------------- helpers

def num(x, nd=2):
    """Round to nd places, mapping NaN/inf/None/non-numbers to None (JSON-safe)."""
    try:
        f = float(x)
    except (TypeError, ValueError):
        return None
    return round(f, nd) if math.isfinite(f) else None


def scaled(x, k, nd=1):
    v = num(x, 6)
    return num(v * k, nd) if v is not None else None


def rsi(close: pd.Series, n: int = 14) -> pd.Series:
    d = close.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    return 100 - 100 / (1 + up / dn.replace(0, np.nan))


def recent_cross(a: pd.Series, b: pd.Series, bars: int = 5) -> int:
    """+1 if a crossed above b within the last `bars`, -1 if below, else 0."""
    valid = a.notna() & b.notna()
    above = (a > b) & valid
    prev = above.shift(1, fill_value=False)
    window = slice(-bars, None)
    if (above & ~prev & valid.shift(1, fill_value=False)).iloc[window].any() and above.iloc[-1]:
        return 1
    if (~above & prev & valid).iloc[window].any() and not above.iloc[-1]:
        return -1
    return 0


# ---------------------------------------------------------------- data

def load_universe() -> tuple[pd.DataFrame, str]:
    try:
        r = requests.get(UNIVERSE_URL, headers={"User-Agent": "Mozilla/5.0"}, timeout=20)
        r.raise_for_status()
        df = pd.read_csv(io.StringIO(r.text))
        if "Symbol" not in df.columns:
            raise ValueError("unexpected CSV format")
        name = "Nifty 500"
    except Exception as e:  # NSE sites often block cloud IPs; degrade gracefully
        print(f"universe download failed ({e}); using bundled fallback list")
        df = pd.read_csv(ROOT / "universe_fallback.csv")
        name = "Nifty 50 (fallback)"
    df = df.rename(columns={"Company Name": "name", "Industry": "sector", "Symbol": "symbol"})
    df["symbol"] = df["symbol"].str.strip()
    print(f"universe: {name}, {len(df)} symbols")
    return df[["symbol", "name", "sector"]], name


def download_prices(symbols: list[str]) -> dict[str, pd.DataFrame]:
    # During market hours Yahoo returns today's unfinished candle; scan completed sessions only.
    now = datetime.now(IST)
    partial_day = now.date() if now.time() < SESSION_FINAL else None
    frames = {}
    for i in range(0, len(symbols), CHUNK):
        chunk = symbols[i:i + CHUNK]
        tickers = [f"{s}.NS" for s in chunk]
        data = yf.download(tickers, period="2y", interval="1d", group_by="ticker",
                           auto_adjust=True, threads=True, progress=False)
        if not isinstance(data.columns, pd.MultiIndex):
            data = pd.concat({tickers[0]: data}, axis=1)
        for sym, t in zip(chunk, tickers):
            if t not in data.columns.get_level_values(0):
                continue
            df = data[t].dropna(subset=["Close"])
            if partial_day and len(df) and df.index[-1].date() == partial_day:
                df = df.iloc[:-1]
            if len(df) >= 60:
                frames[sym] = df
        print(f"prices: {min(i + CHUNK, len(symbols))}/{len(symbols)} requested, {len(frames)} usable")
    return frames


def fetch_fundamentals(symbols: list[str]) -> dict:
    cache = {}
    if FUND_CACHE.exists():
        try:
            cache = json.loads(FUND_CACHE.read_text())
        except json.JSONDecodeError:
            pass
    now = time.time()
    fetched = failures = 0
    for sym in symbols:
        entry = cache.get(sym)
        if entry and now - entry.get("_ts", 0) < FUND_TTL_DAYS * 86400:
            continue
        try:
            info = yf.Ticker(f"{sym}.NS").info or {}
            failures = 0
        except Exception as e:
            print(f"fundamentals {sym}: {e}")
            failures += 1
            if failures >= 5:
                print("fundamentals: too many consecutive failures (rate limited?); stopping")
                break
            continue
        cache[sym] = {
            "_ts": now,
            "pe": num(info.get("trailingPE"), 1),
            "pb": num(info.get("priceToBook"), 1),
            "roe": scaled(info.get("returnOnEquity"), 100),
            "de": scaled(info.get("debtToEquity"), 0.01, 2),  # yfinance reports D/E in %
            "revGrowth": scaled(info.get("revenueGrowth"), 100),
            "epsGrowth": scaled(info.get("earningsGrowth"), 100),
            "mcapCr": scaled(info.get("marketCap"), 1e-7, 0),
        }
        fetched += 1
        time.sleep(0.25)
    FUND_CACHE.parent.mkdir(parents=True, exist_ok=True)
    FUND_CACHE.write_text(json.dumps(cache))
    print(f"fundamentals: {fetched} fetched, {len(symbols) - fetched} from cache")
    return cache


def quality(f: dict) -> int | None:
    """Simple 0-5 quality score: one point per passed check."""
    if not f:
        return None
    checks = [
        f.get("roe") is not None and f["roe"] >= 15,
        f.get("de") is not None and f["de"] < 1,
        f.get("epsGrowth") is not None and f["epsGrowth"] > 0,
        f.get("revGrowth") is not None and f["revGrowth"] >= 10,
        f.get("pe") is not None and 0 < f["pe"] <= 40,
    ]
    return sum(checks)


# ---------------------------------------------------------------- signals

def analyze(df: pd.DataFrame) -> dict:
    o, h, l, c, v = (df[k] for k in ("Open", "High", "Low", "Close", "Volume"))
    sma20, sma50, sma200 = (c.rolling(n).mean() for n in (20, 50, 200))
    r = rsi(c)
    vol20 = v.rolling(20).mean().shift(1)
    hi252 = h.rolling(252, min_periods=120).max().shift(1)
    lo252 = l.rolling(252, min_periods=120).min().shift(1)
    bw = 4 * c.rolling(20).std() / sma20
    bw_min = bw.rolling(126, min_periods=60).min()

    close, prev = c.iloc[-1], c.iloc[-2]
    chg = (close / prev - 1) * 100
    vol_ratio = v.iloc[-1] / vol20.iloc[-1] if vol20.iloc[-1] else np.nan
    sigs = []

    def add(sid, label, bias, weight, detail=""):
        sigs.append({"id": sid, "label": label, "bias": bias, "w": weight, "detail": detail})

    if pd.notna(hi252.iloc[-1]):
        if close > hi252.iloc[-1]:
            add("breakout_52w", "52-week high breakout", "bull", 3, f"closed above {hi252.iloc[-1]:.2f}")
        elif close >= 0.97 * hi252.iloc[-1]:
            add("near_52w_high", "Near 52-week high", "bull", 1,
                f"{(1 - close / hi252.iloc[-1]) * 100:.1f}% below high")
    if pd.notna(lo252.iloc[-1]) and close < lo252.iloc[-1]:
        add("breakdown_52w", "52-week low breakdown", "bear", 3, f"closed below {lo252.iloc[-1]:.2f}")

    if pd.notna(vol_ratio) and vol_ratio >= 2:
        add("volume_spike", "Volume spike", "bull" if chg >= 0 else "bear", 2,
            f"{vol_ratio:.1f}x 20-day avg volume")

    cross = recent_cross(sma50, sma200)
    if cross == 1:
        add("golden_cross", "Golden cross (50/200)", "bull", 3, "50-DMA crossed above 200-DMA")
    elif cross == -1:
        add("death_cross", "Death cross (50/200)", "bear", 3, "50-DMA crossed below 200-DMA")

    if pd.notna(r.iloc[-1]):
        if r.iloc[-2] < 30 <= r.iloc[-1]:
            add("rsi_bounce", "RSI oversold bounce", "bull", 2, f"RSI {r.iloc[-2]:.0f} -> {r.iloc[-1]:.0f}")
        elif r.iloc[-1] < 30:
            add("rsi_oversold", "RSI oversold", "bull", 1, f"RSI {r.iloc[-1]:.0f}")
        elif r.iloc[-1] > 75:
            add("rsi_overbought", "RSI overbought", "bear", 1, f"RSI {r.iloc[-1]:.0f}")

    if pd.notna(sma200.iloc[-1]) and close > sma20.iloc[-1] > sma50.iloc[-1] > sma200.iloc[-1]:
        add("uptrend", "Strong uptrend", "bull", 1, "price > 20 > 50 > 200 DMA")
    elif pd.notna(sma200.iloc[-1]) and close < sma20.iloc[-1] < sma50.iloc[-1] < sma200.iloc[-1]:
        add("downtrend", "Strong downtrend", "bear", 1, "price < 20 < 50 < 200 DMA")

    if pd.notna(bw_min.iloc[-1]) and bw.iloc[-1] <= bw_min.iloc[-1] * 1.05:
        add("squeeze", "Volatility squeeze", "neutral", 1, "Bollinger width at 6-month low")

    if o.iloc[-1] > h.iloc[-2] * 1.02:
        add("gap_up", "Gap up", "bull", 1, f"opened {(o.iloc[-1] / h.iloc[-2] - 1) * 100:.1f}% above prior high")
    elif o.iloc[-1] < l.iloc[-2] * 0.98:
        add("gap_down", "Gap down", "bear", 1, f"opened {(1 - o.iloc[-1] / l.iloc[-2]) * 100:.1f}% below prior low")

    bull = sum(s["w"] for s in sigs if s["bias"] == "bull")
    bear = sum(s["w"] for s in sigs if s["bias"] == "bear")

    def perf(n):
        return num((close / c.iloc[-n - 1] - 1) * 100, 1) if len(c) > n else None

    return {
        "date": c.index[-1].strftime("%Y-%m-%d"),
        "close": num(close),
        "chg": num(chg),
        "rsi": num(r.iloc[-1], 1),
        "volRatio": num(vol_ratio, 1),
        "fromHigh": num((close / hi252.iloc[-1] - 1) * 100, 1),
        "perf1m": perf(21),
        "perf3m": perf(63),
        "above200": bool(pd.notna(sma200.iloc[-1]) and close > sma200.iloc[-1]),
        "newHigh": any(s["id"] == "breakout_52w" for s in sigs),
        "newLow": any(s["id"] == "breakdown_52w" for s in sigs),
        "signals": [{k: s[k] for k in ("id", "label", "bias", "detail")} for s in sigs],
        "score": bull - bear,
        "strength": bull + bear,
    }


def history(df: pd.DataFrame) -> list:
    tail = df.tail(HISTORY_BARS)
    return [[d.strftime("%Y-%m-%d"), num(r.Open), num(r.High), num(r.Low), num(r.Close), int(num(r.Volume, 0) or 0)]
            for d, r in zip(tail.index, tail.itertuples())]


# ---------------------------------------------------------------- main

def main():
    universe, universe_name = load_universe()
    frames = download_prices(universe["symbol"].tolist())
    if not frames:
        sys.exit("no price data downloaded; aborting so the previous scan stays published")

    (OUT / "history").mkdir(parents=True, exist_ok=True)
    rows = []
    for rec in universe.itertuples():
        df = frames.get(rec.symbol)
        if df is None:
            continue
        try:
            a = analyze(df)
        except Exception as e:
            print(f"analyze {rec.symbol}: {e}")
            continue
        rows.append({"symbol": rec.symbol, "name": rec.name, "sector": rec.sector, **a})
        (OUT / "history" / f"{rec.symbol}.json").write_text(json.dumps(history(df), separators=(",", ":")))

    # Fundamentals for the names with the strongest signals (either direction).
    ranked = sorted(rows, key=lambda x: x["strength"], reverse=True)
    fund = fetch_fundamentals([x["symbol"] for x in ranked[:FUND_MAX] if x["strength"] > 0])
    for row in rows:
        f = {k: v for k, v in fund.get(row["symbol"], {}).items() if not k.startswith("_")}
        row["fund"] = f or None
        row["quality"] = quality(f)
        if row["quality"] is not None and row["quality"] >= 4 and row["score"] > 0:
            row["signals"].append({"id": "quality", "label": "Quality fundamentals", "bias": "bull",
                                   "detail": f"passes {row['quality']}/5 checks"})
            row["score"] += 1

    n = len(rows)
    breadth = {
        "advancers": sum(r["chg"] is not None and r["chg"] > 0 for r in rows),
        "decliners": sum(r["chg"] is not None and r["chg"] < 0 for r in rows),
        "pctAbove200": num(100 * sum(r["above200"] for r in rows) / n, 1),
        "newHighs": sum(r["newHigh"] for r in rows),
        "newLows": sum(r["newLow"] for r in rows),
    }
    now = datetime.now(IST)
    out = {
        "generatedAt": now.isoformat(timespec="seconds"),
        "marketDate": max(r["date"] for r in rows),
        "universe": universe_name,
        "count": n,
        "breadth": breadth,
        "stocks": sorted(rows, key=lambda x: (x["score"], x["strength"]), reverse=True),
    }
    (OUT / "scan.json").write_text(json.dumps(out, separators=(",", ":")))
    with_signals = sum(1 for r in rows if r["signals"])
    print(f"wrote {OUT / 'scan.json'}: {n} stocks, {with_signals} with signals")


if __name__ == "__main__":
    main()
