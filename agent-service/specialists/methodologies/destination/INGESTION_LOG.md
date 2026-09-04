# Destination Methodology Ingestion Log

Immutable record of every verbatim ingestion of the DVA-1/DVA-2/DAP Claude
Project instructions. Each entry is append-only — a re-ingestion (a new
Project-instructions revision from Jerry) gets a NEW version number and a
NEW row here; existing rows are never edited.

| Methodology | Version | Source File | Content SHA-256 | Ingested At (UTC) | Provided By |
|---|---|---|---|---|---|
| destination/dva1 | v2 | `_imports/dva1_project_instructions.md` | `59f193e1d7b119558530cc0b842465cd8d8849d3a711f19df7eb4938f5698bf2` | 2026-09-04T19:02:32.382Z | Jerry (existing live Claude Project — DVA-1) |
| destination/dva2 | v2 | `_imports/dva2_project_instructions.md` | `c59a2d0e3179c6f0d75d0472e98cd922bbd3b2c052745ad598ab58dc5745ce3b` | 2026-09-04T19:02:39.760Z | Jerry (existing live Claude Project — DVA-2) |
| destination/dap  | v2 | `_imports/dap_project_instructions.md`  | `1efda4620073fbb52132663dfa674937c93b53b4408128d1f4ade0392fce3cfe` | 2026-09-04T19:02:40.158Z | Jerry (existing live Claude Project — DAP v2.0) |

Each target file (`destination/<id>/v2.md`) was verified byte-identical to
its source file in `_imports/` at ingestion time (`diff` clean, zero
output). The `_imports/` copies are the untouched originals and are kept
alongside the canonical copies — neither is deleted.

`v1.md` in each of the three methodology directories remains on disk,
unchanged, marked `complete: false` in `methodologyRegistry.ts` — those
were Phase 2D's gate-semantics-only reconstruction (from an Open Brain
paraphrase, not the actual Project instructions) and are now superseded
by v2 for real execution. They are kept for historical comparison, not
deleted, per the "original Projects remain intact as backup/reference"
instruction extended to their in-repo reconstruction too.

See each methodology's own `v2.legacy-operator-instructions.md` for the
passages classified as describing the old manual multi-Project workflow
rather than the evaluation methodology itself, and `v2.orchestration.md`
for the Chief-facing wrapper spec built on top of (never replacing) this
verbatim text.
