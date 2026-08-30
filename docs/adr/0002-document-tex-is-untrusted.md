---
status: accepted
---

# Treat document TeX as untrusted input

LaTeX source loaded from a Word document is never compiled merely because the document opens or the formula is selected. Editing the current formula and confirming a disclosed batch-update scope count as explicit compilation actions, after which the restricted RenderHost may process only that scope. FormulaBridge 1.0 does not expose shell escape because documents can arrive from untrusted authors and disabling shell escape alone is not a complete file-access sandbox.
