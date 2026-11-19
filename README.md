# FX Domain

A personal forex dashboard comparing one-day performance relative to USD. The dashboard HTML, styles, chart and icons are adapted from the [FX Domain prototype](https://forex-gap-monitor-lg.louieje-codex.chatgpt.site/). The browser application lives in app/. The Node server supplies same-origin data and serves the installable app.

## Windows setup

Install Node.js 24 with npm, Git, and Google Chrome (for browser tests). Run these commands in PowerShell:

    git clone https://github.com/louieje-g/fx-domain.git
    cd fx-domain
    npm ci

## Live mode

    npm start

Open http://127.0.0.1:4173/ in your browser. Stop the server with Ctrl+C before switching launch commands. Override the port with $env:PORT = '4180' if needed.

## Fixture mode

    npm run fixture

Open http://127.0.0.1:4173/?mode=fixture as printed by the launcher. The query selects a labeled development fixture with its own endpoint and snapshot storage key. Opening the root URL selects live data. Changing modes does not overwrite the other mode’s readings.

## Test and build

    npm test
    npm run build
    npm run production

The test command builds the browser assets, then runs Node tests and Playwright against an isolated production server. Chrome must be installed locally. To use Microsoft Edge instead, set $env:BROWSER_CHANNEL = 'msedge' before npm test. Production serves dist/ on http://127.0.0.1:4173/ and uses the same Node feed adapter. Keep server.js, feed.js and app/model.js alongside dist/. Static hosting alone cannot serve the live endpoint.

## Data and behavior

GET /feed reads https://finviz.com/api/forex_perf with a 7-second timeout. The observed response was a flat JSON object with numeric percent values, including an extra BTC field. The adapter selects EUR, GBP, AUD, NZD, USD, CAD, CHF and JPY in that order and preserves the original numeric scale (0.50 means +0.50%). Any missing or nonfinite required reading invalidates the entire response. The endpoint sends Cache-Control: no-store on success and failure.

The browser checks immediately and every 10 seconds by default. Its 8.5-second timeout and in-flight guard bound each refresh. The provider’s own update frequency is unverified. Pausing stops future checks. A failed check retains the previous successful timestamp and values. After one successful visit and service worker installation, the shell can reopen offline on localhost or HTTPS. Clearing browser site data removes the cached readings.

The scanner produces 28 fixed-orientation pairs, rounds base minus quote to two decimal places in percentage points, and uses the sign for BUY, SELL or NEUTRAL. These labels describe relative performance. The fixture produces EUR +0.50%, JPY -0.40%, and EUR/JPY +0.90 pp.

## Time frames

The chart, highlights, scanner inputs and bias follow the selected Finviz period. GET /feed?v=N proxies https://finviz.com/api/forex_perf?v=N. Finviz uses 1 for daily, 2 weekly, 3 monthly, 4 quarterly, 5 half-year, 6 yearly, 7 year to date and 8 month to date. Switching periods fetches once even when periodic refresh is paused. The selection and each period's last success are stored locally.


## GitHub Pages

The Pages workflow publishes on pushes to main and requests fresh Finviz snapshots every five minutes through GitHub Actions. Scheduled runs and CDN updates may be delayed. The fetch timestamp records the upstream read. Local Node mode continues checking Finviz directly on the selected interval. A failed snapshot build leaves the previous deployment available.

Reset to defaults clears the saved dashboard preferences and restores an empty search, Daily, Widest gap, the system theme, and a 10-second refresh.
