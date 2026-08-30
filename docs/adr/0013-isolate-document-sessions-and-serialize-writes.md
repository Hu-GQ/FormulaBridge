---
status: accepted
---

# Isolate document sessions and serialize writes

Each Word document window owns an independent FormulaBridge editor session and document configuration. Document writes are serialized per document, while RenderHost serves a bounded cross-document render queue. An unsaved new document can contain managed formulas because metadata is written to the in-memory package and protected drafts cover uncommitted editor text until the first `.docx` or `.docm` save.
