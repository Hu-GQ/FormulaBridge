---
status: accepted
---

# Embed and verify SVG with PNG fallback

Every FormulaBridge 1.0 formula rendered by local TeX embeds a sanitized SVG together with a PNG fallback in the Word package. Correct preservation across Word save, reopen, ordinary copy, print, and PDF export is a release gate; neither an external image link nor a single-format TeX representation satisfies the portability contract.
