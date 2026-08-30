---
status: accepted
---

# Use native Word fields for basic numbering

FormulaBridge 1.0 implements continuous equation numbering and managed references with native Word `SEQ` and `REF` fields plus bookmarks, not static text or a custom layout engine. Insert, move, and delete operations update the affected local range inside the same undo record; full-document field and numbering updates remain an explicit user action. Chapter-aware numbering is deferred to 1.1.
