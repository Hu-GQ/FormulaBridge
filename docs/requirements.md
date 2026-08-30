# FormulaBridge product requirements

Status: development baseline 0.1

## Product and legal boundary

- FormulaBridge is an independent product with a new name, identity, codebase, UI, and documentation.
- The product must not contain or redistribute Aurora binaries, code, icons, documentation, activation mechanisms, or bundled third-party files taken from the legacy installer.
- Any legacy document import capability must be independently implemented from lawfully obtained sample documents and receive jurisdiction-appropriate legal review before release.
- No product text may imply endorsement by or succession from Elevator Lady Inc.

## Supported environments

### Full modern support

- Windows 11 x64.
- Microsoft 365 Word on supported update channels.
- Word/Office 2024 x64.

### Legacy compatibility support

- Windows 10 22H2 x64.
- Word 2016, 32-bit and 64-bit, MSI and Click-to-Run final patched builds.
- WordApi 1.1 is the JavaScript API baseline.
- Features that require later Word APIs must be capability-detected and disabled or implemented through a legacy adapter.

Windows 10 and Office 2016 are outside Microsoft support. FormulaBridge compatibility support does not reinstate Microsoft servicing or security support.

## Document portability

- A generated document must open and display all formulas on a clean machine without FormulaBridge installed.
- Supported mathematics must be stored as native OMML.
- Unsupported LaTeX must use embedded vector artwork with an embedded raster fallback; no linked images or remote resources are permitted.
- Formula source and settings must be stored inside the document and ignored safely by Word when the add-in is absent.
- Native equations remain editable with Word's built-in equation tools when FormulaBridge is absent.
- Fallback artwork remains readable, printable, and exportable but requires FormulaBridge to recover its LaTeX editing experience.
- Opening, saving, printing, PDF export, protected view, and offline use must not produce missing-object placeholders.

## Functional baseline

- LaTeX source editing with syntax diagnostics and live preview.
- Desktop-editor interaction model with conventional menus, a common-structure toolbar, source/preview/log panes, a properties dialog, and documented keyboard shortcuts; all visual assets and implementation remain independently created.
- Inline, display, and numbered equations.
- Insert and update selected FormulaBridge equations.
- Fractions, roots, subscripts, superscripts, common Greek letters, common operators, text, font styles, and matrices.
- Document-local stable formula identifiers.
- Equation numbering and cross-reference infrastructure.
- Undo-safe and failure-safe document mutations.
- Chinese and English content.
- Offline-first processing.

## Security baseline

- The parser does not execute TeX or operating-system commands.
- Shell escape, file reads, file writes, process execution, and network access are not available to formula input.
- Remote rendering, telemetry, and cloud storage are opt-in features only.
- Production hosting must use HTTPS and least-privilege manifest permissions.
- Release binaries and installers must be signed and accompanied by a dependency/license inventory.

## MVP acceptance criteria

- All automated core tests pass.
- A supported formula inserted into Word is represented by OMML, not a linked object.
- The visible formula survives removal of the add-in.
- Source metadata survives document save and reopen.
- Invalid LaTeX produces a diagnostic without mutating the document.
- Word 2016 paths use no API later than WordApi 1.1 unless protected by runtime capability detection.
