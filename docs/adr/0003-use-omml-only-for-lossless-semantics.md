---
status: accepted
---

# Use OMML only for lossless semantics

Automatic rendering selects OMML only when a versioned Core capability rule proves that Word can represent the formula without semantic loss; otherwise it selects local TeX. Minor visual differences are acceptable, users may force local TeX, and an unsupported request to force OMML is rejected instead of silently degraded.
