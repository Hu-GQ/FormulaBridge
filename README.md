# FormulaBridge

FormulaBridge is an independently developed LaTeX equation editor for Microsoft Word. It is not affiliated with, endorsed by, or derived from Elevator Lady Inc. or its Aurora product.

The first development milestone targets:

- Windows 10/11;
- Word 2016 (WordApi 1.1 baseline), Microsoft 365, and Word 2024;
- editable native Word equations (OMML) for supported LaTeX;
- embedded, self-contained document output that remains readable without FormulaBridge;
- inline, display, and numbered equations;
- document-local LaTeX source metadata for re-editing.

## Current status

This repository contains the first runnable MVP:

- a dependency-free LaTeX parser;
- OMML generation for common formula structures;
- a lightweight HTML preview renderer;
- an Office.js task pane and Word add-in manifest;
- document-local formula metadata storage;
- automated parser and writer tests.

Legacy Aurora object migration and the optional VSTO adapter are designed but not yet implemented.

## Development

Run the tests:

```powershell
npm test
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

See [docs/requirements.md](docs/requirements.md) and [docs/architecture.md](docs/architecture.md) for the product baseline and technical design.
