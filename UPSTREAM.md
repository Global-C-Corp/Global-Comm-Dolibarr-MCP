# Upstream attribution

This project is derived from [`digitalfactorysn/mcp-dolibarr`](https://github.com/digitalfactorysn/mcp-dolibarr), maintained by Digital Factory Senegal. The Phase 1 baseline starts from upstream commit `360cb7c66e470a1c844f22320573c2ced2f01c4d` (2026-06-05).

The upstream `README.md` and `package.json` identify the original project as MIT-licensed and credit Digital Factory Senegal. The audited commit did not contain a standalone `LICENSE` file. The present repository includes the MIT text in `LICENSE`, retains that attribution, and records Global Communication Corporate's subsequent modifications separately.

This hosted repository was created separately, so its Git commit graph does not contain the upstream commit. The imported Phase 1 tree exactly matched the locally reviewed source tree; a separate Git bundle retains the shallow upstream snapshot and the local baseline commit. To track upstream in a fresh clone, run `git remote add upstream https://github.com/digitalfactorysn/mcp-dolibarr.git`. Review upstream changes before incorporating them, especially operations that write to Dolibarr.
