# FormulaBridge architecture

## Overview

FormulaBridge separates formula semantics from Word integration so the same document representation can serve legacy and current Word clients.

```text
LaTeX source
    |
    v
Dependency-free parser ---> diagnostics
    |
    v
Formula AST
    |---------------------> HTML preview
    |
    v
OMML writer
    |
    v
Word content control + document-local metadata
```

## Components

- `src/core/latex-parser.js`: safe parser that never invokes a TeX executable.
- `src/core/omml-writer.js`: converts the supported AST subset to native Office Math.
- `src/core/html-writer.js`: dependency-free task-pane preview renderer.
- `src/core/index.js`: stable core API.
- `src/word/formula-store.js`: persists formula source and settings in Office document settings.
- `src/word/taskpane.js`: inserts and updates formulas through the WordApi 1.1 surface.
- `manifest/word-addin.xml`: add-in-only manifest with a WordApi 1.1 activation baseline.

## Word 2016 strategy

The web add-in deliberately uses ES5 syntax and the WordApi 1.1 surface. A future Windows adapter may use VSTO to provide richer selection events, keyboard integration, and legacy OLE migration. Both adapters must call the same parser and produce the same FormulaBridge metadata schema.

## Portable document representation

Each formula receives a stable identifier. The visible content is native OMML wrapped in a tagged Word content control. The corresponding source record is stored in the document's Office settings:

```json
{
  "schema": 1,
  "formulas": {
    "fb-...": {
      "source": "\\frac{a}{b}",
      "mode": "inline",
      "createdAt": "ISO-8601 timestamp",
      "updatedAt": "ISO-8601 timestamp"
    }
  }
}
```

This makes the document self-contained. A later milestone will additionally embed portable per-object metadata for reliable cross-document copy/paste.

## Compatibility rules

- Baseline APIs must be available in WordApi 1.1.
- Newer APIs require `Office.context.requirements.isSetSupported` checks.
- Unsupported formula constructs must never silently produce incorrect mathematics.
- Until the vector fallback renderer is implemented, unsupported constructs are rejected with a diagnostic and the document is left unchanged.

