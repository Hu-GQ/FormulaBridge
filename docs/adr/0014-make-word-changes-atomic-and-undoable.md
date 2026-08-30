---
status: accepted
---

# Make Word changes atomic and undoable

FormulaBridge groups each insertion, update, mode conversion, numbering action, or disclosed batch group into an intelligible Word undo record and commits visible content with its metadata atomically. Failure or cancellation preserves the previous state. Batch work renders and validates before any document write; after failures, the user either cancels everything or explicitly applies successful items in auditable undo groups. Label conflicts are rejected before commit. Duplicate UUIDs and orphan metadata are only changed by explicit, undoable repair or confirmed save-time cleanup, with one canonical identity retained and copied identities relabeled safely.
