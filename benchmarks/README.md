# Benchmarks

Run on demand while iterating on performance (not part of any suite):

    npx playwright test --config playwright.smoke.config.ts \
      tests/smoke/perf-switch-benchmark.spec.ts --retries=0

Results land in `switch-latency.json`; `history.md` keeps dated comparisons.
Browser dev-harness numbers — dev-build React inflates absolutes, so compare
runs against each other, never against native feel.
