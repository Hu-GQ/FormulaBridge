---
status: accepted
---

# Use LaTeX as the authoritative formula source

A FormulaBridge formula treats its saved LaTeX source as the authoritative semantic state; OMML, SVG, and PNG are derived Word representations. Arbitrary Word OMML cannot be guaranteed to convert back to equivalent LaTeX, so FormulaBridge detects divergence instead of attempting an automatic bidirectional merge. The user may restore the LaTeX projection, detach the object as an ordinary Word formula, or explicitly preview an OMML-to-LaTeX import only when Core proves a lossless conversion. Unsupported OMML and SVG or PNG representations are never guessed, reverse-engineered, or sent through OCR in FormulaBridge 1.0.
