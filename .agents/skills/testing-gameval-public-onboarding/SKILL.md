# Gameval Public-Onboarding Testing

Use this skill when testing public-readiness, quick-start, sample-data fallback, or dashboard/arena smoke flows in `dicefuji/gameval`.

## Devin Secrets Needed

- None for public onboarding, dashboard sample-data fallback, or arena sandbox smoke testing.
- `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY` are only needed when intentionally running live `npm run eval` model evaluations.

## Setup

1. From the repo root, install dependencies if needed:
   ```bash
   npm install
   ```
2. Run the low-cost validation command:
   ```bash
   npm run check
   ```
   Expected public-onboarding signal includes JS syntax checks, `sample-eval-results.json` metadata validation, and provider smoke tests without real API calls.
3. Start the static app:
   ```bash
   npm run serve
   ```
   This serves the app at `http://127.0.0.1:3000/`.

## Dashboard Sample-Data Smoke Test

1. Open `http://127.0.0.1:3000/results.html`.
2. Verify the dashboard renders, rather than the empty-state message.
3. Confirm the version badge and visible model stats match the currently tracked `sample-eval-results.json` artifact. Read the sample file first instead of assuming the version/model names, because the website repo may use newer generated artifacts than `gameval`.
4. In browser state, verify:
   ```js
   ArenaRegistry.getSource() === 'sample-eval-results.json'
   ArenaRegistry.getModelEntries().length
   ```
   Match the count to `registry.js` behavior: it includes iterations where `typeof iter.rawCode === 'string'`, including empty-string raw code from failed iterations.

## Arena Registry Smoke Test

1. Navigate from the dashboard using the visible `arena sandbox` link, or open `http://127.0.0.1:3000/arena.html`.
2. Verify the `seat 0 algorithm` picker shows baselines and model optgroups from the sample registry.
3. Load a known-good iteration with non-empty `rawCode` and a finite mean score. For the current sample at the time this was written, `claude-opus-4-7@4` is a good choice and should show `46% territory`.
4. After clicking `Load & Reset`, verify the status says `loaded <model>@<iter>` and the `territory` / `players` panels remain populated.

## Notes

- Do not use live provider API keys for this public-onboarding path; the goal is to prove a fresh clone works without credentials.
- If testing a PR that updates `sample-eval-results.json`, derive all expected model/version/count assertions from the PR branch's sample file before recording.
- `wmctrl` may be unavailable in the VM. If browser maximization cannot be automated, continue with the browser tool and note the caveat in the report.