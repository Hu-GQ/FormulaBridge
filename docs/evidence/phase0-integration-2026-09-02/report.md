# FormulaBridge Phase 0 Evidence Report

- Run: `phase0-integration-local`
- Commit: `113a9000e744dd8a6c2923279e0612cd67a1af23`
- Result: `blocked`
- Time: `2026-09-01T16:42:37.496Z` – `2026-09-01T16:44:50.106Z`
- Windows: `Windows 10 Home China 22H2 19045.7663` (x64, zh-CN)
- Word: `16.0.19127.20302` (HomeStudent2019Retail (outside supported release matrix), x64, zh-CN)
- Runtimes: `Node.js 24.18.0`, `.NET Framework 4.8.09037 (Release 533325)`, `.NET 10.0.11`, `VSTO Runtime 10.0.60917`, `WebView2 Runtime 151.0.4129.107`
- TeX: `TeX Live 2024`
- Signing: `unavailable` — No signed FormulaBridge MSI or build-metadata.json is available; no current-user code-signing certificate was found.

## Checks

### VSTO user-level installation and diagnostics

- Result: `blocked`
- Reason: FORMULABRIDGE_VSTO_INSTALLER is not configured with a signed MSI
- Time: `2026-09-01T16:42:43.880Z` – `2026-09-01T16:42:43.910Z`
- Environment: Word `16.0.19127.20302` (HomeStudent2019Retail (outside supported release matrix), x64, zh-CN)
- Evidence:
  - `evidence/vsto-installation/result/result.json` — `sha256:ca43d95d15712f21a0d59a096fabf0311c9cb6a500beedec66e65691fe6d9246`
  - `evidence/vsto-installation/log/smoke.log` — `sha256:7ca42a4a22353c3a48bbbaa9f1ca7f4d3be30576605c4e526c042c9683d8eea2`

### Source-portable ordinary copy

- Result: `passed`
- Time: `2026-09-01T16:42:51.913Z` – `2026-09-01T16:43:17.602Z`
- Environment: Word `16.0.19127.20302` (HomeStudent2019Retail (outside supported release matrix), x64, zh-CN)
- Evidence:
  - `evidence/source-portable-copy/result/result.json` — `sha256:1a1123554b08e924c0bdb9a16d609643e70119eca651463cc9c3bcf32d8fb5a6`
  - `evidence/source-portable-copy/log/word-automation.log` — `sha256:f731c34db423c8b9ccd009c04db3d22d995a2801a2440804b8d937ab80c76846`
  - `evidence/source-portable-copy/docx-package/package-evidence.zip` — `sha256:653c56866d0c5894dd1602154baa0730588a462eaafba6bf42bc6fb47f090902`
  - `evidence/source-portable-copy/word-automation/word-automation.json` — `sha256:221ff484b415faadabedcb4c537f33ae26d6ff57ada64f021b99993a241db9d9`

### SVG and PNG Word round trip

- Result: `passed`
- Time: `2026-09-01T16:43:27.379Z` – `2026-09-01T16:44:27.509Z`
- Environment: Word `16.0.19127.20302` (HomeStudent2019Retail (outside supported release matrix), x64, zh-CN)
- Evidence:
  - `evidence/dual-format-roundtrip/result/result.json` — `sha256:c23cc239c425c614ac510f8111d9a1135a7fa661e2823ec552bd53950d1d8033`
  - `evidence/dual-format-roundtrip/log/smoke.log` — `sha256:284d3547ef474faae70bd5e3beccb6ec3224a3518022e89622e0933fd8d66915`
  - `evidence/dual-format-roundtrip/docx-package/roundtrip-documents.zip` — `sha256:a6ff6f22a9b540c14ddb088ba6a59858d6335f041166e0583af44ce8557a8326`
  - `evidence/dual-format-roundtrip/pdf/word-export.pdf` — `sha256:508a95ab01a552cb785f6c1faf3145ce878906834908df266be031179d971a76`
  - `evidence/dual-format-roundtrip/print-output/word-print.pdf` — `sha256:7938d93f3bb9254bb0eb7ff217e3cada9718b6978a88bbe4ba085b9ce4bb2bc4`
  - `evidence/dual-format-roundtrip/visual-diff/visual-diff.json` — `sha256:7b8c562151d411b61719b4f4375ed17cd216ecd76719a148c560f46910bfdcb3`

### TeX isolation and resource limits

- Result: `blocked`
- Reason: The TeX isolation smoke did not satisfy every required assertion
- Time: `2026-09-01T16:44:34.262Z` – `2026-09-01T16:44:50.015Z`
- Environment: Word `16.0.19127.20302` (HomeStudent2019Retail (outside supported release matrix), x64, zh-CN)
- Evidence:
  - `evidence/tex-isolation/result/result.json` — `sha256:f1e26bdb719abafc9b3326b0881c7787ce8d889661d90a2cf7c7dd7e3b254db5`
  - `evidence/tex-isolation/log/smoke.log` — `sha256:d7e1afb6717af03db981dd0d08f1e34ae2f63bdb5bcb807df5c8fa40d6bc1612`
  - `evidence/tex-isolation/security-trace/security-trace.json` — `sha256:8eea956fbc254eb10aaf20cf1b3c31523623068289f41ca0ffd634e0f0a04bbe`
  - `evidence/tex-isolation/resource-report/resource-report.json` — `sha256:00f0b951638179d4e15c6c40162d9004256471515dc298bba0b2159fd6009961`
  - `evidence/tex-isolation/lifecycle-report/lifecycle-report.json` — `sha256:5bec4168fc936ea63990b85ddf3e89dcc8e16361214050bb9be658a22a8cd6df`

