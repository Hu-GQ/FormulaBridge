# Development status

Last updated: 2026-08-30

## Completed in milestone 0.1

- Independent FormulaBridge product identity and legal boundary documentation.
- Dependency-free, non-executing LaTeX parser.
- Common-symbol, fraction, radical, script, styled-text, and matrix AST support.
- Native OMML generation for inline, display, and numbered equations.
- WordApi 1.1 task-pane baseline using ES5-compatible runtime syntax.
- Aurora-inspired clean-room desktop workflow: menu bar, formula toolbar, line-numbered source editor, preview/error/output tabs, properties dialog, and status bar.
- Formula structure insertion, live/manual refresh, keyboard shortcuts, responsive 380 px task-pane layout, and saved editor preferences.
- Insert, load selected source, and update selected formula workflows.
- Document-local source metadata using Office document settings.
- Static CSS fallbacks for legacy Word webviews.
- Word add-in manifest, local server, icons, and automated tests.
- Clean-machine DOCX smoke-test tooling.

## Verification evidence

- `npm run check`: all runtime and tooling JavaScript passes syntax checks.
- `npm test`: 13 parser, OMML, HTML-safety, and metadata-store tests pass.
- `npm run test:ui`: real Chrome interaction tests pass for menus, snippets, diagnostics, properties, and preview; 380 px and 1080 px layouts have no page overflow.
- Manifest XML parses successfully and declares WordApi 1.1.
- Local HTTP task pane and core resources return HTTP 200.
- Chrome DevTools rendering verifies stacked narrow and side-by-side wide layouts with live preview.
- A generated DOCX opens read-only in an unextended Word session and exposes native `OMaths`, FormulaBridge content controls, and a Word numbering field.

## Known limitations

- HTTPS developer certificate and direct Word add-in sideloading are not configured yet.
- The available COM registration reports Word 12.0, so direct task-pane behavior must still be verified on a clean Word 2016 target machine.
- Selected-formula loading currently expects the entire tagged formula control to be selected.
- Changing an existing equation between inline, display, and numbered modes requires reinsertion.
- Unsupported LaTeX is rejected; embedded vector/raster fallback rendering is not implemented yet.
- Source metadata is document-local but does not yet travel reliably when one formula is copied into another document.
- Legacy Aurora OLE inventory and migration are not implemented.
- VSTO enhancement adapter requires Visual Studio/.NET Framework build tools, which are not installed in the current environment.

## Next milestone

Configure trusted HTTPS sideloading and run an end-to-end Word 2016 test matrix before adding portable per-object metadata, cross-document copy/paste, and legacy object migration.
