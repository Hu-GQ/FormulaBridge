"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var childProcess = require("node:child_process");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");

var projectRoot = path.resolve(__dirname, "..");
var packageInspector = require(path.join(
  projectRoot,
  "tools",
  "source-portable-copy",
  "inspect-docx.js"
));

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("the Word smoke runner covers every source-portable copy assertion", function () {
  var smoke = read("tools/test-source-portable-copy.ps1");
  var checkSet = JSON.parse(read("phase0/checks.json"));
  var definition = checkSet.checks.find(function (check) {
    return check.id === "source-portable-copy";
  });

  definition.requiredAssertions.forEach(function (assertionId) {
    assert.ok(smoke.includes('"' + assertionId + '"'), assertionId);
  });
  assert.match(smoke, /Selection\.Copy\(\)/);
  assert.match(smoke, /Selection\.Paste\(\)/);
  assert.match(smoke, /Selection\.Cut\(\)/);
  assert.match(smoke, /Documents\.Open/);
  assert.match(smoke, /CustomXMLParts/);
  assert.match(smoke, /CopyCarrier:v1/);
  assert.match(smoke, /package-evidence\.zip/);
});

test("the source-portable copy spike has a repeatable documented entry point", function () {
  var packageJson = JSON.parse(read("package.json"));
  var readme = read("README.md");
  var documentation = read("docs/source-portable-copy-spike.md");
  var copyIdentityAdr = read("docs/adr/0004-copy-creates-new-formula-identity.md");
  var metadataAdr = read("docs/adr/0007-store-latex-source-as-plain-document-metadata.md");

  assert.equal(
    packageJson.scripts["copy:smoke"],
    "pwsh -NoProfile -File tools/test-source-portable-copy.ps1"
  );
  assert.match(packageJson.scripts.check, /tests\/source-portable-copy\.test\.js/);
  assert.match(readme, /阶段 0 源码可移植复制样机/);
  assert.match(documentation, /Selection\.Copy\/Paste/);
  assert.match(documentation, /Custom XML/);
  assert.match(documentation, /隐藏的纯文本内容控件/);
  assert.match(documentation, /同文档.*跨文档.*移动.*保存.*重开/s);
  assert.match(documentation, /evidence\/source-portable-copy/);
  assert.match(copyIdentityAdr, /FormulaBridge\.CopyCarrier:v1/);
  assert.match(metadataAdr, /redundant object-level copy carrier/);
});

test("the DOCX package seam verifies the managed formula and portable carrier", function () {
  var result = packageInspector.inspect(path.join(
    projectRoot,
    "corpus",
    "phase0",
    "word",
    "minimal-document.docx"
  ));

  assert.equal(result.schemaVersion, 1);
  assert.deepEqual(result.formulas, [
    {
      formulaId: "11111111-1111-4111-8111-111111111111",
      label: "eq:quadratic",
      latex: "x^2 + y^2 = z^2",
      visibleText: "x² + y² = z²",
      carrierVersion: 1,
      carrierHidden: true,
      authoritativeStore: "customXml"
    }
  ]);
});

test("the DOCX package seam is available to the Word automation runner", function () {
  var inspectorPath = path.join(
    projectRoot,
    "tools",
    "source-portable-copy",
    "inspect-docx.js"
  );
  var documentPath = path.join(
    projectRoot,
    "corpus",
    "phase0",
    "word",
    "minimal-document.docx"
  );
  var result = childProcess.spawnSync(process.execPath, [inspectorPath, documentPath], {
    cwd: projectRoot,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), packageInspector.inspect(documentPath));
});

test("the Phase 0 provider blocks rather than simulating Word clipboard evidence", function (t) {
  var checkSet = require(path.join(projectRoot, "phase0", "checks.json"));
  var definition = checkSet.checks.find(function (check) {
    return check.id === "source-portable-copy";
  });
  var workspace = fs.mkdtempSync(path.join(os.tmpdir(), "formulabridge-copy-provider-"));

  t.after(function () {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  assert.equal(
    definition.provider,
    "tools/phase0-providers/source-portable-copy.js"
  );

  var provider = require(path.join(projectRoot, definition.provider));
  var result = provider.run({
    definition: definition,
    environment: {
      word: { availability: "unavailable", reason: "Word is not installed" }
    },
    workspace: workspace,
    projectRoot: projectRoot
  });

  assert.equal(result.status, "blocked");
  assert.match(result.reason, /Word is not installed/);
  assert.deepEqual(
    result.evidence.map(function (item) { return item.kind; }),
    ["result", "log"]
  );

  var resultEvidence = JSON.parse(fs.readFileSync(
    path.join(workspace, result.evidence[0].path),
    "utf8"
  ));

  assert.equal(resultEvidence.status, "blocked");
  assert.deepEqual(
    resultEvidence.assertions.map(function (assertion) { return assertion.id; }),
    definition.requiredAssertions
  );
});

test("real Word ordinary clipboard automation preserves source and reconciles identities", {
  skip: process.platform !== "win32" || process.env.FORMULABRIDGE_RUN_WORD_AUTOMATION !== "1",
  timeout: 180000
}, function (t) {
  var workspace = fs.mkdtempSync(path.join(os.tmpdir(), "formulabridge-word-copy-"));
  var fragmentPath = path.join(workspace, "source-portable-copy-check-fragment.json");
  var result;

  t.after(function () {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  result = childProcess.spawnSync(
    process.env.FORMULABRIDGE_PWSH || "pwsh",
    [
      "-NoProfile",
      "-File",
      path.join(projectRoot, "tools", "test-source-portable-copy.ps1"),
      "-EvidenceDirectory",
      workspace,
      "-ExpectedCommit",
      "0000000000000000000000000000000000000000",
      "-FragmentPath",
      fragmentPath
    ],
    {
      cwd: projectRoot,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 150000
    }
  );

  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  var fragment = JSON.parse(fs.readFileSync(fragmentPath, "utf8"));

  assert.equal(fragment.status, "passed");
  assert.deepEqual(
    fragment.evidence.map(function (item) { return item.kind; }),
    ["result", "log", "docx-package", "word-automation"]
  );
  fragment.evidence.forEach(function (item) {
    assert.equal(fs.statSync(path.join(workspace, item.path)).size > 0, true, item.path);
  });
});
