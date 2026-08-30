---
status: accepted
---

# Map document requirements to local render profiles

A document stores engine, package, capability, and optional version-fingerprint requirements rather than machine-specific executable paths. On another machine the user explicitly maps those requirements to a compatible local render profile; FormulaBridge warns that compatible mapping may not reproduce pixel-identical output and never switches engines silently.
