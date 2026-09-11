// Auto-loaded by `playwright test` (cwd = tests/). Captures one screenshot per test
// into $PW_ARTIFACTS so each verifier run's visual state is viewable in the job's
// artifacts/ (e.g. via `harbor view`). Falls back to ./test-results locally.
//
// fullyParallel + workers: behavioural tests are independent (each boots its own
// page), so we run them concurrently instead of serially — the dominant cost of a
// run (measured 31.5s -> 10.7s on a 6-test spec). trace is retain-on-failure to avoid
// per-test recording overhead on the all-pass path; screenshots are always kept.
const path = require('path');
const out = process.env.PW_ARTIFACTS || path.join(process.cwd(), 'test-results');
module.exports = {
  outputDir: out,
  fullyParallel: true,
  workers: process.env.PW_WORKERS ? Number(process.env.PW_WORKERS) : 4,
  // 60s test timeout (default 30s) so transient slow boots under concurrent load
  // don't flake a genuinely-correct verifier into a false failure.
  timeout: 60000,
  // 15s expect timeout (default 5s) so a slow app init under load doesn't fail an
  // assertion (toHaveCount/toBeVisible) that would pass given a moment longer.
  expect: { timeout: 15000 },
  use: { screenshot: 'on', trace: 'retain-on-failure' },
};
