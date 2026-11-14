Archived floor-plan experiments
==============================

Production code lives under packages/processing. Benchmark data and private reports are preserved.
These historical scripts refer to their original paths and experimental adapter registry.
Reproduce the original environment from Git commit 47a491173c9af0e4ef9c871bc4a8fdc70d3708f5 in a separate checkout; use its packages/processing/experiments instructions. Do not deploy this archived Compose stack over production.
The chosen cleanup implementation now lives in packages/processing/cubicasa/utils/geometry_cleanup.py.

The archived `sources.lock.json` is intentionally omitted from this branch. Historical asset fetching and report generation require that file; run them from the original checkout above, which retains the pinned revisions, download URLs, and checksums. Production does not read this experiment lockfile.
