# Sourdough Starter Tracker

Offline-capable single-page PWA (vanilla JS + self-hosted Bootstrap CSS, no build step).

- Log feedings: time, container (with empty weight), room temperature
- Proposes discard / flour / water for your ratio, with target scale readings; record what you actually did
- **Plan** tab works backward from when you want to mix dough to when to feed, and suggests a ratio that avoids sleeping hours
- Log actual peak times in **History** and estimates self-calibrate
- Data stays in your browser (localStorage); use Settings → Export for backups

## Run

    python3 -m http.server 8000   # then open http://localhost:8000

Service worker / install need HTTPS or localhost; deploy the folder to any static host (e.g. GitHub Pages).
When changing app files, bump `CACHE` in `sw.js`.

## Test

    node --test tests/*.test.mjs
