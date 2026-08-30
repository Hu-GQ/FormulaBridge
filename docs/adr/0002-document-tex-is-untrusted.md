---
status: accepted
---

# Treat document TeX as untrusted input

LaTeX source loaded from a Word document is never compiled automatically and requires an explicit user action before the restricted RenderHost processes it. FormulaBridge 1.0 does not expose shell escape because documents can arrive from untrusted authors and disabling shell escape alone is not a complete file-access sandbox.
