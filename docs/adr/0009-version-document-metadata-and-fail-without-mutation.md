---
status: accepted
---

# Version document metadata and fail without mutation

FormulaBridge document metadata has an explicit schema version and migration path. An older FormulaBridge version encountering a newer schema preserves the visible formula, permits read-only source inspection when safely possible, and refuses to downgrade or overwrite the metadata. A newer version first validates older metadata read-only and migrates only on the user's first confirmed write, retaining the previous representation until a successful save and reopen validation; major migrations recommend saving a copy. Missing, duplicate, or corrupt metadata leaves the visible content intact and marks the formula as detached so the user can recover, re-enter, or reattach source explicitly.
