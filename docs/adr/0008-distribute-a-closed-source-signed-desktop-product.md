---
status: accepted
---

# Distribute a closed-source signed desktop product

FormulaBridge 1.0 is a closed-source Windows desktop product distributed through an official channel as a signed per-user installer. This creates a single support, update, migration-review, and compatibility boundary; enterprise machine-wide deployment and opening selected components can be reconsidered after the core product is established. The architecture may reserve an authorization boundary, but accounts, online activation, and a commercial licensing system are not FormulaBridge 1.0 release gates. Updates are installed only after Word and RenderHost exit, as one compatible component set with complete rollback. An embedded trust root verifies signed manifests and packages, hashes, versions, and anti-downgrade rules, with key rotation and revocation; any verification failure blocks installation.
