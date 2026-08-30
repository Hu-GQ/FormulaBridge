---
status: accepted
---

# Map document requirements to local render profiles

A document stores engine, package, capability, font, and optional version-fingerprint requirements rather than machine-specific executable paths. On another machine the user explicitly maps those requirements to a compatible local render profile; FormulaBridge warns that compatible mapping may not reproduce pixel-identical output and never switches engines silently. Without local TeX, OMML operations remain available while embedded TeX representations and source remain viewable, but recompilation and replacement are blocked. When an approved installation, package, font, or profile identity changes, affected formulas retain their embedded representation and become stale until the user explicitly renders them again.
