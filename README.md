# NSE Scanner

A phone-friendly web app that scans the Nifty 500 for trading opportunities.
It's hosted free on GitHub Pages and refreshed by a scheduled GitHub Actions workflow.

```
Actions schedule ──► scan job (Python) ──► web/data/*.json ──► deploy job ──► https://<you>.github.io/<repo>/
                     yfinance prices + fundamentals              web/ (PWA)
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

## Hosting on GitHub (one-time setup)

The repo is public, because free GitHub Pages requires that, and so is the site. Only public market data is published; your watchlist stays in your phone's browser.

```powershell
gh auth login --web                                        # sign in once
gh repo create nse-scanner --public --source . --push
gh api -X POST repos/{owner}/nse-scanner/pages -f build_type=workflow
gh workflow run "Scan and deploy"                          # or push any commit
```

- **Schedule:** the workflow runs weekdays at 16:45 IST (after the close) and 08:00 IST. GitHub's cron can start 5–30 minutes late. Change the times in [.github/workflows/scan-and-deploy.yml](.github/workflows/scan-and-deploy.yml).
- **Manual run:** Actions tab → *Scan and deploy* → **Run workflow**, or run `gh workflow run "Scan and deploy"`.
- **60-day rule:** GitHub pauses schedules in public repos after 60 days without commits. It emails you first, and one click re-enables them.
- **On your phone:** open `https://<username>.github.io/nse-scanner/` and choose **Add to Home Screen**. It then opens like an app.

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
- niftyindices.com sometimes blocks cloud runners. The scanner then falls back to a bundled 40-stock list, and the header shows "Nifty 50 (fallback)". If that happens a lot, commit a copy of the Nifty 500 CSV into `scanner/`.

## Roadmap

- **Phase 2: real-time with Zerodha Kite Connect.** A small always-on backend (FastAPI on an Oracle Cloud free VM in Mumbai, or Render/Railway) holds the KiteTicker websocket. It computes intraday signals (VWAP, opening-range breakout, live volume surges) and pushes them to this app. Kite's access token expires daily, so the backend will show a login link each morning.
- **Phase 3: options.** Option chain from Kite: OI build-up/unwinding, IV rank, PCR, max pain.
- **Phase 4: news & events.** NSE corporate announcements, earnings calendar, RSS headlines tagged per stock.
- **Alerts:** Telegram bot for new high-score signals.

Signals are mechanical screens, not investment advice.
