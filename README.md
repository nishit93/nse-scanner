# NSE Scanner

A phone-friendly web app that scans the Nifty 500 for trading opportunities.
It's hosted free on GitLab Pages and refreshed by a scheduled GitLab pipeline.

```
GitLab schedule ──► scan job (Python) ──► public/data/*.json ──► pages job ──► https://<you>.gitlab.io/<project>
                    yfinance prices + fundamentals                 web/ (PWA)
```

## What it finds (Phase 1, end-of-day)

| Signal | Bias | Weight |
|---|---|---|
| 52-week high breakout / low breakdown | bull / bear | 3 |
| Golden / death cross (50 vs 200 DMA, last 5 days) | bull / bear | 3 |
| Volume spike (≥ 2× 20-day average) | direction of the day's move | 2 |
| RSI oversold bounce (crosses back above 30) | bull | 2 |
| Near 52-week high (within 3%) | bull | 1 |
| RSI oversold (< 30) / overbought (> 75) | bull / bear | 1 |
| Strong up / downtrend (price, 20, 50, 200 DMA stacked) | bull / bear | 1 |
| Gap up / down (> 2% beyond prior high / low) | bull / bear | 1 |
| Volatility squeeze (Bollinger width at 6-month low) | neutral | 1 |
| Quality fundamentals (≥ 4 of 5: ROE ≥ 15%, D/E < 1, EPS growth > 0, revenue growth ≥ 10%, 0 < P/E ≤ 40) | bull | +1 |

Score = bullish weights − bearish weights. Fundamentals are fetched only for the 150 stocks with the strongest signals, and cached for a week.

## Setup on GitLab (one-time, ~10 minutes)

1. **Create a project.** On gitlab.com go to New project → Create blank project. Name it e.g. `nse-scanner` and set visibility to **Private**.
2. **Push this folder:**
   ```bash
   git init -b main
   git add .
   git commit -m "NSE scanner: phase 1"
   git remote add origin https://gitlab.com/<your-username>/nse-scanner.git
   git push -u origin main
   ```
   The push starts the first pipeline (Build → Pipelines). The scan takes about 5–15 minutes.
3. **Keep the site private.** Go to Settings → General → Visibility → Pages and choose **Only project members**. You'll sign in to GitLab once on your phone.
4. **Schedule the scan.** Go to Build → Pipeline schedules → New schedule:
   - Interval: `45 16 * * 1-5` with timezone **Asia/Kolkata** (weekdays at 4:45 PM IST, after the close)
   - Optional second schedule: `0 8 * * 1-5` (8:00 AM, before the open, picks up any late data fixes)
5. **Open it.** The URL is under Deploy → Pages. On your phone, open it and choose **Add to Home Screen**. It then opens like an app.

## Run locally

Requires Python 3.12 and Git. Node.js LTS is installed for the later phases. From the project folder (PowerShell):

```powershell
python -m venv .venv                                   # once
.venv\Scripts\python.exe -m pip install -r scanner\requirements.txt
.venv\Scripts\python.exe scanner\scan.py               # ~3 min first run; writes web\data\scan.json + history\
.venv\Scripts\python.exe -m http.server 8765 -d web    # open http://localhost:8765
```

Without a `scan.json`, the app shows clearly labelled sample data. During market hours the scanner ignores today's unfinished candle, so its results always reflect the last completed session.

## Known limits

- yfinance is an unofficial Yahoo endpoint. It can rate-limit cloud IPs or change without notice. Prices for 500 stocks come in a few batch calls and are reliable. Fundamentals are the fragile part: the scan stops fetching them after 5 straight failures and still publishes.
- niftyindices.com sometimes blocks CI runners. The scanner then falls back to a bundled 40-stock list, and the header shows "Nifty 50 (fallback)". If that happens a lot, commit a copy of the Nifty 500 CSV into `scanner/`.

## Roadmap

- **Phase 2: real-time with Zerodha Kite Connect.** A small always-on backend (FastAPI on an Oracle Cloud free VM in Mumbai, or Render/Railway) holds the KiteTicker websocket. It computes intraday signals (VWAP, opening-range breakout, live volume surges) and pushes them to this app. Kite's access token expires daily, so the backend will show a login link each morning.
- **Phase 3: options.** Option chain from Kite: OI build-up/unwinding, IV rank, PCR, max pain.
- **Phase 4: news & events.** NSE corporate announcements, earnings calendar, RSS headlines tagged per stock.
- **Alerts:** Telegram bot for new high-score signals.

Signals are mechanical screens, not investment advice.
