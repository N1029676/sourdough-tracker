# Sourdough tracker — working notes

- **Before every commit, refresh the version number:** run `scripts/bump-version.sh`
  (writes `js/version.js` as UTC `yymmddhhmm`, e.g. `2611142145`) and include it in the commit.
  The service-worker cache name and the Settings → "Check for updates" both key off this value,
  so a commit without a bump will not reach installed copies.
- Run tests with `node --test tests/*.test.mjs`.
