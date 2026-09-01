---
status: accepted
---

# Store LaTeX source as plain document metadata

FormulaBridge stores authoritative LaTeX source as plain Custom XML inside the Word document package so formulas remain portable and recoverable without a FormulaBridge-specific key. Confidentiality comes from Word document encryption and access controls rather than custom source encryption, and the product documentation must disclose that the source is inspectable by anyone who can open the package.

Document-level Custom XML is not assumed to travel with one copied Word object. Ordinary object copy therefore also carries a redundant object-level copy carrier containing the minimum source and identity data needed to create a target-document record. The duplicate is transport data, not a second authority: FormulaBridge verifies its version and checksum against the visible object's identity, then writes a validated record to the target document's plain Custom XML store. Missing, duplicated, or inconsistent data fails without silently choosing either representation.
