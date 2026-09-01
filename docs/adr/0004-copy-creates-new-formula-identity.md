---
status: accepted
---

# Copy creates a new formula identity

Ordinary Word copy and paste must carry a FormulaBridge formula's source and required metadata, while the pasted instance receives a new UUID and has its formula label cleared by default. Moving a formula retains its UUID, and existing references continue to target the original instance rather than a copy. Reliable source-preserving ordinary copy within the supported Word matrix is a FormulaBridge 1.0 release gate, not an optional enhancement or a specialized copy command.

The Phase 0 spike fixes the portable side of the carrier contract as a nested, hidden plain-text content control tagged `FormulaBridge.CopyCarrier:v1`. It contains versioned UTF-8 JSON encoded as Base64 with the formula UUID, label, LaTeX source, and a SHA-256 integrity value. The outer managed content control carries only the visible representation and identity tag. After ordinary paste, FormulaBridge validates the redundant payload, creates a new UUID, clears the label and any copied reference bookmark, and writes the recovered record into the target document's authoritative Custom XML store. A cut-and-paste move keeps the existing payload and bookmark. This combination passed same-document copy, cross-document copy, move, save/reopen, and offline DOCX inspection in real Word automation; the supported Word release matrix remains a release-validation obligation.

Custom XML is only a candidate carrier at the object-copy boundary; the accepted combination does not depend on a document-level Custom XML part moving with one copied object.
