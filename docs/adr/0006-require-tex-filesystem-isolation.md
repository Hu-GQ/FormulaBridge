---
status: accepted
---

# Require TeX filesystem isolation for release

FormulaBridge 1.0 does not ship until security tests demonstrate that a TeX job cannot read outside its explicitly allowed TeX-installation and per-job roots. Formula source cannot directly reference arbitrary document or user paths; a future resource-import feature may copy an explicitly selected file into a controlled root. Missing packages produce distribution-specific installation guidance, but FormulaBridge 1.0 never invokes a package manager to modify the user's TeX installation. Engine and converter executables require explicit local-user approval of absolute paths plus version and minimal-render health checks; identity changes revoke approval, and document data can never select an executable. Disabling shell escape is necessary but insufficient, so each job must combine a restricted child-process identity, Job Object limits, filesystem ACLs, TeX input/output policy, network blocking, and adversarial tests. Initial product-controlled ceilings are 256 KiB input, 30 seconds interactive or 120 seconds per batch item, 1 GiB memory, and 64 output files totaling at most 64 MiB; a document cannot relax them.
