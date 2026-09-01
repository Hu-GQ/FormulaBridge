"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var childProcess = require("node:child_process");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");

var projectRoot = path.resolve(__dirname, "..");
var smokeScript = path.join(projectRoot, "tools", "test-dual-format-roundtrip.ps1");
var checkSetPath = path.join(projectRoot, "phase0", "checks.json");
var phase0Evidence = require("../tools/phase0-evidence");
var dualFormatPackage = require("../tools/dual-format-package");

test("the dual-format smoke fixture embeds self-contained SVG with a PNG fallback", function (t) {
  var workspace = fs.mkdtempSync(path.join(os.tmpdir(), "formulabridge-dual-format-"));
  var inspectionPath = path.join(workspace, "package-inspection.json");

  t.after(function () {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  var result = childProcess.spawnSync(
    process.env.FORMULABRIDGE_PWSH || "pwsh",
    [
      "-NoProfile",
      "-File",
      smokeScript,
      "-EvidenceDirectory",
      workspace,
      "-PackageOnly"
    ],
    {
      cwd: projectRoot,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024
    }
  );

  var diagnostic = result.stderr || result.stdout || "";
  var smokeLogPath = path.join(
    workspace,
    "evidence",
    "dual-format-roundtrip",
    "log",
    "smoke.log"
  );
  if (fs.existsSync(smokeLogPath)) {
    diagnostic += "\n" + fs.readFileSync(smokeLogPath, "utf8");
  }

  assert.equal(result.status, 0, diagnostic);
  assert.equal(fs.existsSync(inspectionPath), true);

  var inspection = JSON.parse(fs.readFileSync(inspectionPath, "utf8"));

  assert.equal(inspection.schemaVersion, 1);
  assert.equal(inspection.svgMediaParts, 1);
  assert.equal(inspection.pngMediaParts, 1);
  assert.equal(inspection.svgBlipReferences, 1);
  assert.equal(inspection.pngFallbackReferences, 1);
  assert.equal(inspection.externalImageRelationships, 0);
  assert.equal(inspection.externalFontRelationships, 0);
  assert.equal(inspection.danglingImageReferences, 0);
  assert.equal(inspection.mismatchedPngFallbacks, 0);
  assert.equal(inspection.externalSvgReferences, 0);
  assert.equal(inspection.externalFontReferences, 0);
  assert.equal(inspection.executableSvgElements, 0);
  assert.match(
    fs.readFileSync(path.join(workspace, "fixture", "assets", "formula.tex"), "utf8"),
    /\\documentclass[\s\S]*x\^2 \+ y\^2 = z\^2/
  );
  var provenance = JSON.parse(fs.readFileSync(path.join(workspace, "fixture", "assets", "manifest.json"), "utf8"));
  assert.equal(provenance.provenance.kind, "local-tex-render");
  assert.match(provenance.provenance.engine, /TeX/);
  assert.equal(provenance.entries.length, 3);
  assert.equal(fs.readFileSync(path.join(workspace, "fixture", "assets", "formula.svg"), "utf8").includes("\r"), false);
});

test("the package inspection detects a damaged PNG even while the SVG remains intact", function (t) {
  var workspace = fs.mkdtempSync(path.join(os.tmpdir(), "formulabridge-damaged-fallback-"));
  var documentPath = path.join(workspace, "damaged.docx");
  t.after(function () { fs.rmSync(workspace, { recursive: true, force: true }); });
  dualFormatPackage.createDocument(documentPath);
  var mutation = childProcess.spawnSync(process.env.FORMULABRIDGE_PWSH || "pwsh", [
    "-NoProfile", "-File", path.join(__dirname, "fixtures", "corrupt-png-fallback.ps1"),
    "-DocumentPath", documentPath
  ], { encoding: "utf8", windowsHide: true });
  assert.equal(mutation.status, 0, mutation.stderr);
  var inspection = dualFormatPackage.inspectDocument(documentPath);
  assert.equal(inspection.svgBlipReferences, 1);
  assert.equal(inspection.danglingImageReferences, 0);
  assert.equal(inspection.mismatchedPngFallbacks, 1);
});

test("the Phase 0 provider blocks with structured evidence when Word is unavailable", function (t) {
  var workspace = fs.mkdtempSync(path.join(os.tmpdir(), "formulabridge-dual-format-provider-"));
  var definition = JSON.parse(fs.readFileSync(checkSetPath, "utf8")).checks.find(function (check) {
    return check.id === "dual-format-roundtrip";
  });

  t.after(function () {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  assert.equal(definition.provider, "tools/phase0-providers/dual-format-roundtrip.js");
  assert.deepEqual(definition.passedEvidenceKinds, [
    "docx-package",
    "pdf",
    "print-output",
    "visual-diff"
  ]);

  var checks = phase0Evidence.executeCheckProviders({
    runId: "dual-format-word-unavailable",
    commit: "0123456789abcdef0123456789abcdef01234567",
    environment: {
      word: { availability: "unavailable", reason: "Word is not installed" }
    },
    corpus: { version: "1.0.0", manifest: "corpus/phase0/manifest.json" }
  }, workspace, { checks: [definition] });

  assert.equal(checks.length, 1);
  assert.equal(checks[0].status, "blocked");
  assert.match(checks[0].reason, /Word is unavailable/i);

  var resultEvidence = checks[0].evidence.find(function (item) { return item.kind === "result"; });
  var logEvidence = checks[0].evidence.find(function (item) { return item.kind === "log"; });

  assert.ok(resultEvidence);
  assert.ok(logEvidence);

  var result = JSON.parse(fs.readFileSync(path.join(workspace, resultEvidence.path), "utf8"));
  assert.equal(result.checkId, "dual-format-roundtrip");
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.assertions.map(function (assertion) { return assertion.id; }), definition.requiredAssertions);
});

test("the Phase 0 provider preserves the dual-format formula with existing sibling evidence", {
  skip: process.env.FORMULABRIDGE_RUN_WORD_SMOKE !== "1",
  timeout: 180000
}, function (t) {
  var workspace = fs.mkdtempSync(path.join(os.tmpdir(), "formulabridge-dual-format-word-"));
  var definition = JSON.parse(fs.readFileSync(checkSetPath, "utf8")).checks.find(function (check) {
    return check.id === "dual-format-roundtrip";
  });
  var completed = false;
  t.after(function () {
    if (completed) {
      fs.rmSync(workspace, { recursive: true, force: true });
    } else {
      t.diagnostic("Failed Word evidence retained at " + workspace);
    }
  });
  fs.writeFileSync(path.join(workspace, "previous-provider.txt"), "Existing sibling provider evidence\n");

  var checks = phase0Evidence.executeCheckProviders({
    runId: "dual-format-real-word",
    commit: "0123456789abcdef0123456789abcdef01234567",
    environment: { word: { availability: "available" } },
    corpus: { version: "1.0.0", manifest: "corpus/phase0/manifest.json" }
  }, workspace, { checks: [definition] });
  var fragment = checks[0];
  var logEvidence = fragment.evidence.find(function (item) { return item.kind === "log"; });
  var diagnostic = logEvidence ? fs.readFileSync(path.join(workspace, logEvidence.path), "utf8") : "No log evidence";

  assert.equal(fragment.status, "passed", diagnostic);

  var evidenceKinds = fragment.evidence.map(function (item) { return item.kind; });
  ["result", "log", "docx-package", "pdf", "print-output", "visual-diff"].forEach(function (kind) {
    assert.ok(evidenceKinds.includes(kind), "missing " + kind + " evidence");
  });
  fragment.evidence.forEach(function (item) {
    assert.equal(fs.existsSync(path.join(workspace, item.path)), true, item.path);
  });

  var resultEvidence = fragment.evidence.find(function (item) { return item.kind === "result"; });
  var checkResult = JSON.parse(fs.readFileSync(path.join(workspace, resultEvidence.path), "utf8"));
  assert.deepEqual(checkResult.assertions.map(function (assertion) { return assertion.id; }), definition.requiredAssertions);
  checkResult.assertions.forEach(function (assertion) {
    assert.equal(assertion.status, "passed", assertion.id);
  });
  completed = true;
});

test("a visual failure retains the DOCX, both PDFs, and diagnostic metrics", {
  skip: process.env.FORMULABRIDGE_RUN_WORD_SMOKE !== "1",
  timeout: 180000
}, function (t) {
  var workspace = fs.mkdtempSync(path.join(os.tmpdir(), "formulabridge-failed-visual-"));
  t.after(function () { fs.rmSync(workspace, { recursive: true, force: true }); });
  var argumentsList = [
    "-NoProfile", "-File", smokeScript, "-EvidenceDirectory", workspace,
    "-PdfToPpmPath", path.join(__dirname, "fixtures", "blank-pdf-renderer.ps1")
  ];
  if (process.env.FORMULABRIDGE_PROVISION_PRINT_CAPTURE === "1") {
    argumentsList.push("-ProvisionPrintCapture");
  }
  var result = childProcess.spawnSync(process.env.FORMULABRIDGE_PWSH || "pwsh", argumentsList, {
    encoding: "utf8", windowsHide: true, timeout: 180000
  });
  assert.equal(result.status, 1, result.stderr);
  var fragment = JSON.parse(fs.readFileSync(path.join(workspace, "check-fragment.json"), "utf8"));
  assert.equal(fragment.status, "failed");
  ["docx-package", "pdf", "print-output", "visual-diff"].forEach(function (kind) {
    var evidence = fragment.evidence.find(function (item) { return item.kind === kind; });
    assert.ok(evidence, "failure lost " + kind);
    assert.ok(fs.statSync(path.join(workspace, evidence.path)).size > 0);
  });
  var visualEvidence = fragment.evidence.find(function (item) { return item.kind === "visual-diff"; });
  var visual = JSON.parse(fs.readFileSync(path.join(workspace, visualEvidence.path), "utf8"));
  assert.equal(visual.export.passed, false);
  assert.match(visual.export.reason, /visible.*ink/i);
});
