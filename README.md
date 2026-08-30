# FormulaBridge

FormulaBridge is an independently developed LaTeX equation editor for Microsoft Word. It is not affiliated with, endorsed by, or derived from Elevator Lady Inc. or its Aurora product.

The approved product direction targets:

- Windows 11 with Microsoft 365 Word and Word/Office 2024 as the primary supported environment;
- editable native Word equations (OMML) for supported LaTeX;
- a signed local rendering host for TeX Live, MiKTeX, and multiple selectable TeX environments;
- embedded SVG with a PNG fallback for complex LaTeX that cannot be represented faithfully in OMML;
- embedded, self-contained document output that remains readable without FormulaBridge;
- inline, display, and numbered equations;
- document-local LaTeX source metadata for re-editing.

The approved product experience, functional scope, architecture, security model, acceptance criteria, and release roadmap are defined in [docs/product-design.md](docs/product-design.md).

## Current status

This repository contains the first runnable MVP:

- a dependency-free LaTeX parser;
- OMML generation for common formula structures;
- a lightweight HTML preview renderer;
- a desktop-style Office.js editor with menus, structure toolbar, source/preview panes, diagnostics, properties, and keyboard shortcuts;
- a Word add-in manifest;
- document-local formula metadata storage;
- automated parser/writer tests and a real-browser UI smoke test.

Legacy Aurora object migration and the optional VSTO adapter are designed but not yet implemented.

## Development

Run the tests:

```powershell
npm test
```

With the local server running, execute the interactive UI smoke test (Chrome required):

```powershell
npm run test:ui
```

Start the local development server:

```powershell
npm run serve
```

The server uses HTTPS when `certs/localhost.crt` and `certs/localhost.key` exist. Otherwise it starts an HTTP preview server. Word sideloading requires a trusted HTTPS development certificate.

On a Windows machine with Word installed, run the clean-machine document smoke test:

```powershell
powershell -ExecutionPolicy Bypass -File tools/word-smoke-test.ps1
```

The test builds a minimal DOCX containing FormulaBridge-generated OMML, opens it in Word without loading the add-in, and verifies that Word detects both the native equation and its content control.

See [docs/product-design.md](docs/product-design.md) for the approved product direction, and [docs/requirements.md](docs/requirements.md) plus [docs/architecture.md](docs/architecture.md) for the current MVP engineering baseline.
