---
status: accepted
---

# Require TeX filesystem isolation for release

FormulaBridge 1.0 does not ship until security tests demonstrate that a TeX job cannot read outside its explicitly allowed TeX-installation and per-job roots. Formula source cannot directly reference arbitrary document or user paths; a future resource-import feature may copy an explicitly selected file into a controlled root. Missing packages produce distribution-specific installation guidance, but FormulaBridge 1.0 never invokes a package manager to modify the user's TeX installation. Disabling shell escape is necessary but insufficient, so the RenderHost must combine restricted process identity, filesystem permissions, TeX input/output policy, and adversarial tests rather than relying on a warning.
