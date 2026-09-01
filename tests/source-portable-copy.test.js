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

var crcTable = Array.from({ length: 256 }, function (_, index) {
  var value = index;
  for (var bit = 0; bit < 8; bit += 1) {
    value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return value >>> 0;
});

function crc32(buffer) {
  var value = 0xffffffff;
  for (var index = 0; index < buffer.length; index += 1) {
    value = (value >>> 8) ^ crcTable[(value ^ buffer[index]) & 0xff];
  }
  return (value ^ 0xffffffff) >>> 0;
}

function writeStoredZip(entries, outputPath) {
  var localParts = [];
  var centralParts = [];
  var offset = 0;

  Array.from(entries.entries()).forEach(function (entry) {
    var name = Buffer.from(entry[0], "utf8");
    var content = Buffer.from(entry[1]);
    var crc = crc32(content);
    var local = Buffer.alloc(30);
    var central = Buffer.alloc(46);

    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);

    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);

    localParts.push(local, name, content);
    centralParts.push(central, name);
    offset += local.length + name.length + content.length;
  });

  var centralDirectory = Buffer.concat(centralParts);
  var end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.size, 8);
  end.writeUInt16LE(entries.size, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  fs.writeFileSync(outputPath, Buffer.concat(localParts.concat(centralDirectory, end)));
}

function mutatedPackage(t, transform) {
  var workspace = fs.mkdtempSync(path.join(os.tmpdir(), "formulabridge-copy-package-"));
  var sourcePath = path.join(projectRoot, "corpus", "phase0", "word", "minimal-document.docx");
  var outputPath = path.join(workspace, "mutated.docx");
  var entries = packageInspector.readZipEntries(sourcePath);

  t.after(function () {
    fs.rmSync(workspace, { recursive: true, force: true });
  });
  transform(entries);
  writeStoredZip(entries, outputPath);
  return outputPath;
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
  assert.equal(result.privacy, "synthetic-no-personal-metadata");
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

test("the DOCX package seam rejects visible and partially hidden carriers", function (t) {
  var visiblePath = mutatedPackage(t, function (entries) {
    var xml = entries.get("word/document.xml").toString("utf8");
    entries.set("word/document.xml", Buffer.from(xml.replace("<w:vanish/>", ""), "utf8"));
  });
  var partialPath = mutatedPackage(t, function (entries) {
    var xml = entries.get("word/document.xml").toString("utf8");
    var carrierRun = /(<w:rPr>[\s\S]*?<w:vanish\/>[\s\S]*?<\/w:rPr>\s*)<w:t>([A-Za-z0-9+/=]+)<\/w:t>/;
    var match = xml.match(carrierRun);
    assert.ok(match, "fixture carrier run");
    var midpoint = Math.floor(match[2].length / 2);
    entries.set("word/document.xml", Buffer.from(xml.replace(carrierRun, function (_, properties, encoded) {
      return properties + "<w:t>" + encoded.slice(0, midpoint) + "</w:t></w:r>" +
        "<w:r><w:t>" + encoded.slice(midpoint) + "</w:t>";
    }), "utf8"));
  });

  assert.throws(function () { packageInspector.inspect(visiblePath); }, /hidden carrier formatting/);
  assert.throws(function () { packageInspector.inspect(partialPath); }, /hidden carrier formatting/);
});

test("the DOCX package seam rejects personal metadata in synthetic evidence", function (t) {
  var documentPath = mutatedPackage(t, function (entries) {
    entries.set("docProps/core.xml", Buffer.from(
      '<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Local User</dc:creator></cp:coreProperties>',
      "utf8"
    ));
  });

  assert.throws(function () { packageInspector.inspect(documentPath); }, /personal document metadata fields/);
});

test("the Word store update validates authority before replacing it", function () {
  var smoke = read("tools/test-source-portable-copy.ps1");
  var functionStart = smoke.indexOf("function Update-FormulaStore");
  var functionEnd = smoke.indexOf("function Add-ManagedFormula", functionStart);
  var implementation = smoke.slice(functionStart, functionEnd);

  assert.ok(implementation.indexOf("Read-FormulaPayload") < implementation.indexOf("CustomXMLParts.Add"));
  assert.ok(implementation.indexOf("CustomXMLParts.Add") < implementation.indexOf("oldPart.Delete"));
  assert.match(implementation, /duplicate authoritative formula stores/);
  assert.match(implementation, /authoritative formula store and portable copy carrier disagree/);
  assert.match(implementation, /unexpected orphan identity/);
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

test("the Phase 0 provider fails with structured evidence when Word times out", {
  skip: process.platform !== "win32"
}, function (t) {
  var checkSet = require(path.join(projectRoot, "phase0", "checks.json"));
  var definition = checkSet.checks.find(function (check) {
    return check.id === "source-portable-copy";
  });
  var provider = require(path.join(projectRoot, definition.provider));
  var workspace = fs.mkdtempSync(path.join(os.tmpdir(), "formulabridge-copy-timeout-"));
  var originalSpawnSync = childProcess.spawnSync;

  t.after(function () {
    childProcess.spawnSync = originalSpawnSync;
    fs.rmSync(workspace, { recursive: true, force: true });
  });
  childProcess.spawnSync = function (_, __, options) {
    var error = new Error("timed out");
    error.code = "ETIMEDOUT";
    assert.equal(options.timeout, 180000);
    assert.equal(options.killSignal, "SIGKILL");
    return { error: error };
  };

  var result = provider.run({
    definition: definition,
    environment: { word: { availability: "available" } },
    commit: "0000000000000000000000000000000000000000",
    workspace: workspace,
    projectRoot: projectRoot
  });

  assert.equal(result.status, "failed");
  assert.match(result.reason, /180-second timeout/);
  assert.deepEqual(result.evidence.map(function (item) { return item.kind; }), ["result", "log"]);
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
  var timestamp = new RegExp(require("../schemas/phase0-run.schema.json").$defs.timestamp.pattern);
  assert.match(fragment.startedAt, timestamp);
  assert.match(fragment.finishedAt, timestamp);
  assert.deepEqual(
    fragment.evidence.map(function (item) { return item.kind; }),
    ["result", "log", "docx-package", "word-automation"]
  );
  fragment.evidence.forEach(function (item) {
    assert.equal(fs.statSync(path.join(workspace, item.path)).size > 0, true, item.path);
  });
});

test("a mid-run Word failure preserves a nonempty synthetic reproduction package", {
  skip: process.platform !== "win32" || process.env.FORMULABRIDGE_RUN_WORD_AUTOMATION !== "1",
  timeout: 180000
}, function (t) {
  var workspace = fs.mkdtempSync(path.join(os.tmpdir(), "formulabridge-word-copy-failure-"));
  var fragmentPath = path.join(workspace, "source-portable-copy-check-fragment.json");

  t.after(function () {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  var result = childProcess.spawnSync(
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
      fragmentPath,
      "-InduceFailureAfterAssertion",
      "same-document-copy"
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
  assert.equal(result.status, 1, result.stdout);
  var fragment = JSON.parse(fs.readFileSync(fragmentPath, "utf8"));
  assert.equal(fragment.status, "failed");
  assert.deepEqual(
    fragment.evidence.map(function (item) { return item.kind; }),
    ["result", "log", "docx-package"]
  );

  var packageEvidence = fragment.evidence.find(function (item) {
    return item.kind === "docx-package";
  });
  var entries = packageInspector.readZipEntries(path.join(workspace, packageEvidence.path));
  ["source.docx", "target.docx", "failure-context.json", "word-automation.log"].forEach(function (name) {
    assert.equal(entries.has(name), true, name);
    assert.ok(entries.get(name).length > 0, name);
  });
});
