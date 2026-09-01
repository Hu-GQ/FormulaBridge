"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var crypto = require("node:crypto");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var childProcess = require("node:child_process");

var projectRoot = path.resolve(__dirname, "..");
var cliPath = path.join(projectRoot, "tools", "phase0-evidence.js");
var phase0Evidence = require(cliPath);
var checkSetPath = path.join(projectRoot, "phase0", "checks.json");
var requiredChecks = JSON.parse(fs.readFileSync(checkSetPath, "utf8")).checks;

function createCheckResult(definition, status) {
  return {
    schemaVersion: 1,
    checkId: definition.id,
    status: status,
    assertions: definition.requiredAssertions.map(function (assertionId, index) {
      var assertionStatus = status;

      if (status === "failed" && index > 0) {
        assertionStatus = "passed";
      }

      var assertion = {
        id: assertionId,
        status: assertionStatus
      };

      if (assertionStatus !== "passed") {
        assertion.reason = "Synthetic " + assertionStatus + " result";
      }

      return assertion;
    })
  };
}

function createChecks(workspace, status) {
  return requiredChecks.map(function (definition) {
    var kinds = [];

    if (status === "passed" || status === "failed") {
      kinds = definition.requiredEvidenceKinds.slice();
    }
    if (status === "passed") {
      kinds = kinds.concat(definition.passedEvidenceKinds);
    }

    var check = {
      id: definition.id,
      name: definition.name,
      status: status,
      startedAt: "2026-08-30T08:01:00.000Z",
      finishedAt: "2026-08-30T08:02:00.000Z",
      evidence: kinds.map(function (kind) {
        var relativePath = path.join("evidence", definition.id, kind + ".txt");
        var evidencePath = path.join(workspace, relativePath);

        fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
        if (kind === "result") {
          fs.writeFileSync(evidencePath, JSON.stringify(createCheckResult(definition, status), null, 2));
        } else {
          fs.writeFileSync(evidencePath, definition.id + " " + kind + " synthetic evidence\n");
        }
        return { path: relativePath.split(path.sep).join("/"), kind: kind };
      })
    };

    if (status === "blocked" || status === "not-run") {
      check.reason = status === "blocked" ? "Required environment is unavailable" : "Check was not scheduled";
    }

    return check;
  });
}

function createAvailableEnvironment() {
  return {
    windows: {
      version: "11",
      build: "26100",
      architecture: "x64",
      language: "zh-CN"
    },
    word: {
      availability: "available",
      version: "16.0.19029.20244",
      channel: "Current Channel",
      bitness: "x64",
      language: "zh-CN"
    },
    runtimes: [
      { name: "Node.js", availability: "available", version: "24.18.0" },
      { name: ".NET Framework", availability: "available", version: "4.8" },
      { name: ".NET", availability: "available", version: "10.0.0" },
      { name: "VSTO Runtime", availability: "available", version: "10.0.60910" },
      { name: "WebView2 Runtime", availability: "available", version: "140.0.0" }
    ],
    tex: {
      availability: "available",
      installations: [
        { distribution: "TeX Live", version: "2026" }
      ]
    },
    signing: {
      availability: "available",
      trustLevel: "test",
      tools: [
        { name: "signtool", version: "10.0.26100.0" }
      ]
    }
  };
}

function invokeCli(argumentsList) {
  return childProcess.spawnSync(process.execPath, [cliPath].concat(argumentsList), {
    cwd: projectRoot,
    encoding: "utf8"
  });
}

test("complete phase 0 evidence generates machine and human readable reports", function (t) {
  var workspace = fs.mkdtempSync(path.join(os.tmpdir(), "formulabridge-phase0-"));
  var outputDirectory = path.join(workspace, "report");
  var inputPath = path.join(workspace, "run.json");

  t.after(function () {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  fs.writeFileSync(inputPath, JSON.stringify({
    schemaVersion: 1,
    runId: "phase0-test-run",
    commit: "0123456789abcdef0123456789abcdef01234567",
    startedAt: "2026-08-30T08:00:00.000Z",
    finishedAt: "2026-08-30T08:05:00.000Z",
    environment: createAvailableEnvironment(),
    corpus: {
      version: "1.1.0",
      manifest: "corpus/phase0/manifest.json"
    },
    checks: createChecks(workspace, "passed")
  }, null, 2));

  var result = invokeCli([
    "run",
    "--input",
    inputPath,
    "--output",
    outputDirectory
  ]);

  assert.equal(result.status, 0, result.stderr);

  var report = JSON.parse(fs.readFileSync(path.join(outputDirectory, "report.json"), "utf8"));
  var markdown = fs.readFileSync(path.join(outputDirectory, "report.md"), "utf8");

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.runId, "phase0-test-run");
  assert.equal(report.commit, "0123456789abcdef0123456789abcdef01234567");
  assert.equal(report.overallStatus, "passed");
  assert.equal(report.environment.windows.build, "26100");
  assert.equal(report.environment.runtimes[0].name, "Node.js");
  assert.equal(report.environment.tex.installations[0].distribution, "TeX Live");
  assert.equal(report.environment.signing.trustLevel, "test");
  assert.equal(report.corpus.version, "1.1.0");
  assert.equal(report.corpus.sha256, crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(projectRoot, "corpus", "phase0", "manifest.json")))
    .digest("hex"));
  assert.equal(report.checks[0].name, "VSTO user-level installation and diagnostics");
  assert.equal(report.checks[0].environment.word.channel, "Current Channel");
  assert.equal(report.checks[0].evidence[0].location, "evidence/vsto-installation/result/result.txt");
  assert.equal(report.checks[0].evidence[0].sha256, crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(workspace, "evidence", "vsto-installation", "result.txt")))
    .digest("hex"));
  assert.match(markdown, /^# FormulaBridge Phase 0 Evidence Report$/m);
  assert.match(markdown, /VSTO user-level installation and diagnostics/);
  assert.match(markdown, /Current Channel/);
  assert.match(markdown, /evidence\/vsto-installation\/result\/result\.txt/);
  assert.equal(JSON.stringify(report).includes(workspace), false);
});

test("a passed check cannot omit required environment evidence", function (t) {
  var workspace = fs.mkdtempSync(path.join(os.tmpdir(), "formulabridge-phase0-"));
  var evidenceDirectory = path.join(workspace, "evidence");
  var outputDirectory = path.join(workspace, "report");
  var inputPath = path.join(workspace, "run.json");
  var input = {
    schemaVersion: 1,
    runId: "missing-word-version",
    commit: "0123456789abcdef0123456789abcdef01234567",
    startedAt: "2026-08-30T08:00:00.000Z",
    finishedAt: "2026-08-30T08:05:00.000Z",
    environment: createAvailableEnvironment(),
    corpus: {
      version: "1.1.0",
      manifest: "corpus/phase0/manifest.json"
    },
    checks: [
      {
        id: "baseline.sample",
        name: "Baseline sample",
        status: "passed",
        startedAt: "2026-08-30T08:01:00.000Z",
        finishedAt: "2026-08-30T08:02:00.000Z",
        evidence: [
          { path: "evidence/sample.txt", kind: "log" }
        ]
      }
    ]
  };

  delete input.environment.word.version;

  t.after(function () {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  fs.mkdirSync(evidenceDirectory);
  fs.writeFileSync(path.join(evidenceDirectory, "sample.txt"), "synthetic evidence\n");
  fs.writeFileSync(inputPath, JSON.stringify(input, null, 2));

  var result = invokeCli([
    "run",
    "--input",
    inputPath,
    "--output",
    outputDirectory
  ]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /schema validation failed/i);
  assert.match(result.stderr, /environment\/word.*version/i);
  assert.equal(fs.existsSync(path.join(outputDirectory, "report.json")), false);
});

test("failed, blocked, and not-run stay distinct and fail the phase 0 gate", function (t) {
  var workspace = fs.mkdtempSync(path.join(os.tmpdir(), "formulabridge-phase0-"));
  var statuses = ["failed", "blocked", "not-run"];

  t.after(function () {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  statuses.forEach(function (status) {
    var statusDirectory = path.join(workspace, status);
    var outputDirectory = path.join(statusDirectory, "report");
    var inputPath = path.join(statusDirectory, "run.json");
    fs.mkdirSync(statusDirectory, { recursive: true });
    fs.writeFileSync(inputPath, JSON.stringify({
      schemaVersion: 1,
      runId: "phase0-" + status,
      commit: "0123456789abcdef0123456789abcdef01234567",
      startedAt: "2026-08-30T08:00:00.000Z",
      finishedAt: "2026-08-30T08:05:00.000Z",
      environment: createAvailableEnvironment(),
      corpus: {
        version: "1.1.0",
        manifest: "corpus/phase0/manifest.json"
      },
      checks: createChecks(statusDirectory, status)
    }, null, 2));

    var result = invokeCli([
      "run",
      "--input",
      inputPath,
      "--output",
      outputDirectory
    ]);

    assert.equal(result.status, 1, status + ": " + result.stderr);

    var report = JSON.parse(fs.readFileSync(path.join(outputDirectory, "report.json"), "utf8"));
    assert.equal(report.overallStatus, status);
    assert.equal(report.checks[0].status, status);
  });
});

test("the versioned phase 0 corpus is privacy-free, complete, and hash-pinned", function () {
  var manifestPath = path.join(projectRoot, "corpus", "phase0", "manifest.json");
  var result = invokeCli([
    "validate-corpus",
    "--manifest",
    "corpus/phase0/manifest.json"
  ]);

  assert.equal(result.status, 0, result.stderr);

  var manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  var categories = new Set(manifest.entries.map(function (entry) {
    return entry.category;
  }));

  assert.equal(manifest.schemaVersion, 1);
  assert.match(manifest.corpusVersion, /^[0-9]+\.[0-9]+\.[0-9]+$/);
  assert.equal(manifest.privacy.containsPersonalData, false);
  assert.equal(manifest.privacy.provenance, "synthetic");
  assert.deepEqual(categories, new Set(["word", "formula", "malicious-tex"]));

  manifest.entries.forEach(function (entry) {
    var artifactPath = path.resolve(path.dirname(manifestPath), entry.path);
    var actualHash = crypto.createHash("sha256")
      .update(fs.readFileSync(artifactPath))
      .digest("hex");

    assert.equal(fs.statSync(artifactPath).isFile(), true, entry.path);
    assert.equal(entry.sha256, actualHash, entry.path);
  });
});

test("report schema validation rejects incomplete artifact evidence", function (t) {
  var workspace = fs.mkdtempSync(path.join(os.tmpdir(), "formulabridge-phase0-"));
  var reportPath = path.join(workspace, "report.json");
  var environment = createAvailableEnvironment();

  t.after(function () {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  fs.writeFileSync(reportPath, JSON.stringify({
    schemaVersion: 1,
    runId: "incomplete-report",
    commit: "0123456789abcdef0123456789abcdef01234567",
    startedAt: "2026-08-30T08:00:00.000Z",
    finishedAt: "2026-08-30T08:05:00.000Z",
    overallStatus: "passed",
    environment: environment,
    corpus: {
      version: "1.1.0",
      manifest: "corpus/phase0/manifest.json",
      sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    },
    checkSet: {
      version: "1.0.0",
      manifest: "phase0/checks.json",
      sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    },
    checks: [
      {
        id: "baseline.sample",
        name: "Baseline sample",
        status: "passed",
        startedAt: "2026-08-30T08:01:00.000Z",
        finishedAt: "2026-08-30T08:02:00.000Z",
        environment: environment,
        evidence: [
          {
            kind: "log",
            location: "evidence/sample.txt",
            sizeBytes: 19
          }
        ]
      }
    ]
  }, null, 2));

  var result = invokeCli([
    "validate-report",
    "--report",
    reportPath
  ]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /report schema validation failed/i);
  assert.match(result.stderr, /checks\/0\/evidence\/0\/sha256/i);
});

test("unavailable environment is reported as blocked without undefined values", function (t) {
  var workspace = fs.mkdtempSync(path.join(os.tmpdir(), "formulabridge-phase0-"));
  var outputDirectory = path.join(workspace, "report");
  var inputPath = path.join(workspace, "run.json");
  var environment = createAvailableEnvironment();

  environment.word = {
    availability: "unavailable",
    reason: "Word is not installed on this runner"
  };
  environment.tex = {
    availability: "unavailable",
    reason: "No approved TeX installation"
  };
  environment.signing = {
    availability: "unavailable",
    reason: "Signing tools are not installed"
  };

  t.after(function () {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  fs.writeFileSync(inputPath, JSON.stringify({
    schemaVersion: 1,
    runId: "phase0-environment-unavailable",
    commit: "0123456789abcdef0123456789abcdef01234567",
    startedAt: "2026-08-30T08:00:00.000Z",
    finishedAt: "2026-08-30T08:05:00.000Z",
    environment: environment,
    corpus: {
      version: "1.1.0",
      manifest: "corpus/phase0/manifest.json"
    },
    checks: createChecks(workspace, "not-run")
  }, null, 2));

  var result = invokeCli([
    "run",
    "--input",
    inputPath,
    "--output",
    outputDirectory
  ]);

  assert.equal(result.status, 1, result.stderr);

  var report = JSON.parse(fs.readFileSync(path.join(outputDirectory, "report.json"), "utf8"));
  var markdown = fs.readFileSync(path.join(outputDirectory, "report.md"), "utf8");

  assert.equal(report.overallStatus, "blocked");
  assert.equal(report.environment.word.availability, "unavailable");
  assert.match(markdown, /Word: `unavailable` — Word is not installed on this runner/);
  assert.doesNotMatch(markdown, /undefined/);
});

test("the npm entry point and status contract are documented", function () {
  var packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
  var readme = fs.readFileSync(path.join(projectRoot, "README.md"), "utf8");
  var documentationPath = path.join(projectRoot, "docs", "phase0-evidence.md");

  assert.equal(packageJson.scripts.phase0, "node tools/phase0-evidence.js");
  assert.equal(packageJson.packageManager, "npm@12.0.2");
  assert.equal(fs.existsSync(documentationPath), true);

  var documentation = fs.readFileSync(documentationPath, "utf8");

  assert.match(readme, /\[阶段 0 证据基线\]\(docs\/phase0-evidence\.md\)/);
  assert.match(documentation, /`passed`.*全部必需检查已执行且证据完整/);
  assert.match(documentation, /`failed`.*检查已经执行但验收条件失败/);
  assert.match(documentation, /`blocked`.*缺少必需环境或前置条件/);
  assert.match(documentation, /`not-run`.*检查未执行/);
  assert.match(documentation, /退出码 `0`.*全部通过/);
  assert.match(documentation, /退出码 `1`.*有效报告/);
  assert.match(documentation, /退出码 `2`.*schema 或证据不完整/);
  assert.match(documentation, /npm run phase0 -- run --input/);
  assert.match(documentation, /npm run phase0 -- execute --input/);
  assert.match(documentation, /phase0-check-result\.schema\.json/);
  assert.match(documentation, /validate-corpus/);
  assert.match(documentation, /validate-checks/);
  assert.match(documentation, /validate-report/);
});

test("missing corpus metadata is reported by input schema validation", function (t) {
  var workspace = fs.mkdtempSync(path.join(os.tmpdir(), "formulabridge-phase0-"));
  var inputPath = path.join(workspace, "run.json");

  t.after(function () {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  fs.writeFileSync(inputPath, JSON.stringify({ schemaVersion: 1 }));

  var result = invokeCli([
    "run",
    "--input",
    inputPath,
    "--output",
    path.join(workspace, "report")
  ]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /input schema validation failed/i);
  assert.match(result.stderr, /\/corpus/);
});

test("the versioned check set fixes all four Phase 0 spikes and their evidence contract", function () {
  var result = invokeCli([
    "validate-checks",
    "--manifest",
    "phase0/checks.json"
  ]);

  assert.equal(result.status, 0, result.stderr);

  var checkSet = JSON.parse(fs.readFileSync(checkSetPath, "utf8"));

  assert.equal(checkSet.schemaVersion, 1);
  assert.equal(checkSet.checkSetVersion, "1.3.0");
  assert.deepEqual(checkSet.checks.map(function (check) {
    return check.id;
  }), [
    "vsto-installation",
    "source-portable-copy",
    "dual-format-roundtrip",
    "tex-isolation"
  ]);
  assert.deepEqual(checkSet.requiredRuntimes, [
    "Node.js",
    ".NET Framework",
    ".NET",
    "VSTO Runtime",
    "WebView2 Runtime"
  ]);
  checkSet.checks.forEach(function (check) {
    assert.ok(check.requiredEvidenceKinds.includes("result"), check.id);
    assert.ok(check.requiredEvidenceKinds.includes("log"), check.id);
    assert.ok(check.passedEvidenceKinds.length > 0, check.id);
    assert.ok(check.requiredAssertions.length > 0, check.id);
  });
});

test("the check set schema validates structure without duplicating the current inventory", function (t) {
  var workspace = fs.mkdtempSync(path.join(os.tmpdir(), "formulabridge-phase0-"));
  var manifestPath = path.join(workspace, "checks.json");
  var currentCheckSet = JSON.parse(fs.readFileSync(checkSetPath, "utf8"));

  t.after(function () {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  fs.writeFileSync(manifestPath, JSON.stringify({
    schemaVersion: currentCheckSet.schemaVersion,
    checkSetVersion: "2.0.0",
    requiredRuntimes: [currentCheckSet.requiredRuntimes[0]],
    checks: [currentCheckSet.checks[0]]
  }, null, 2));

  var result = invokeCli([
    "validate-checks",
    "--manifest",
    manifestPath
  ]);

  assert.equal(result.status, 0, result.stderr);
});

test("a run cannot omit a required Phase 0 check", function (t) {
  var workspace = fs.mkdtempSync(path.join(os.tmpdir(), "formulabridge-phase0-"));
  var inputPath = path.join(workspace, "run.json");
  var checks = createChecks(workspace, "passed");

  t.after(function () {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  checks.pop();
  fs.writeFileSync(inputPath, JSON.stringify({
    schemaVersion: 1,
    runId: "phase0-missing-check",
    commit: "0123456789abcdef0123456789abcdef01234567",
    startedAt: "2026-08-30T08:00:00.000Z",
    finishedAt: "2026-08-30T08:05:00.000Z",
    environment: createAvailableEnvironment(),
    corpus: {
      version: "1.1.0",
      manifest: "corpus/phase0/manifest.json"
    },
    checks: checks
  }, null, 2));

  var result = invokeCli([
    "run",
    "--input",
    inputPath,
    "--output",
    path.join(workspace, "report")
  ]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /required check tex-isolation is missing/i);
});

test("a run cannot hide missing required runtimes behind the Node.js version", function (t) {
  var workspace = fs.mkdtempSync(path.join(os.tmpdir(), "formulabridge-phase0-"));
  var inputPath = path.join(workspace, "run.json");
  var environment = createAvailableEnvironment();

  environment.runtimes = [environment.runtimes[0]];

  t.after(function () {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  fs.writeFileSync(inputPath, JSON.stringify({
    schemaVersion: 1,
    runId: "phase0-missing-runtimes",
    commit: "0123456789abcdef0123456789abcdef01234567",
    startedAt: "2026-08-30T08:00:00.000Z",
    finishedAt: "2026-08-30T08:05:00.000Z",
    environment: environment,
    corpus: {
      version: "1.1.0",
      manifest: "corpus/phase0/manifest.json"
    },
    checks: createChecks(workspace, "passed")
  }, null, 2));

  var result = invokeCli([
    "run",
    "--input",
    inputPath,
    "--output",
    path.join(workspace, "report")
  ]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /required runtime \.NET Framework is missing/i);
});

test("validate-report recomputes archived evidence hashes", function (t) {
  var workspace = fs.mkdtempSync(path.join(os.tmpdir(), "formulabridge-phase0-"));
  var inputPath = path.join(workspace, "run.json");
  var outputDirectory = path.join(workspace, "report");
  var reportPath = path.join(outputDirectory, "report.json");
  var archivedEvidencePath = path.join(
    outputDirectory,
    "evidence",
    "vsto-installation",
    "result",
    "result.txt"
  );

  t.after(function () {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  fs.writeFileSync(inputPath, JSON.stringify({
    schemaVersion: 1,
    runId: "phase0-archived-evidence",
    commit: "0123456789abcdef0123456789abcdef01234567",
    startedAt: "2026-08-30T08:00:00.000Z",
    finishedAt: "2026-08-30T08:05:00.000Z",
    environment: createAvailableEnvironment(),
    corpus: {
      version: "1.1.0",
      manifest: "corpus/phase0/manifest.json"
    },
    checks: createChecks(workspace, "passed")
  }, null, 2));

  var runResult = invokeCli([
    "run",
    "--input",
    inputPath,
    "--output",
    outputDirectory
  ]);

  assert.equal(runResult.status, 0, runResult.stderr);
  assert.equal(fs.existsSync(archivedEvidencePath), true);

  var validResult = invokeCli([
    "validate-report",
    "--report",
    reportPath
  ]);

  assert.equal(validResult.status, 0, validResult.stderr);

  fs.appendFileSync(archivedEvidencePath, "tampered\n");

  var tamperedResult = invokeCli([
    "validate-report",
    "--report",
    reportPath
  ]);

  assert.equal(tamperedResult.status, 2);
  assert.match(tamperedResult.stderr, /hash mismatch.*vsto-installation.*result\.txt/i);
});

test("report filenames used as source evidence cannot overwrite archived evidence", function (t) {
  var workspace = fs.mkdtempSync(path.join(os.tmpdir(), "formulabridge-phase0-"));
  var inputPath = path.join(workspace, "run.json");
  var outputDirectory = path.join(workspace, "output");
  var reportPath = path.join(outputDirectory, "report.json");
  var checks = createChecks(workspace, "passed");

  t.after(function () {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  checks[0].evidence[0].path = "report.json";
  fs.writeFileSync(
    path.join(workspace, "report.json"),
    JSON.stringify(createCheckResult(requiredChecks[0], "passed"), null, 2)
  );
  fs.writeFileSync(inputPath, JSON.stringify({
    schemaVersion: 1,
    runId: "phase0-reserved-evidence-name",
    commit: "0123456789abcdef0123456789abcdef01234567",
    startedAt: "2026-08-30T08:00:00.000Z",
    finishedAt: "2026-08-30T08:05:00.000Z",
    environment: createAvailableEnvironment(),
    corpus: {
      version: "1.1.0",
      manifest: "corpus/phase0/manifest.json"
    },
    checks: checks
  }, null, 2));

  var runResult = invokeCli([
    "run",
    "--input",
    inputPath,
    "--output",
    outputDirectory
  ]);

  assert.equal(runResult.status, 0, runResult.stderr);

  var report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert.match(report.checks[0].evidence[0].location, /^evidence\/vsto-installation\/result\//);

  var validationResult = invokeCli([
    "validate-report",
    "--report",
    reportPath
  ]);

  assert.equal(validationResult.status, 0, validationResult.stderr);
});

test("empty evidence files cannot satisfy the Phase 0 contract", function (t) {
  var workspace = fs.mkdtempSync(path.join(os.tmpdir(), "formulabridge-phase0-"));
  var inputPath = path.join(workspace, "run.json");
  var checks = createChecks(workspace, "passed");

  t.after(function () {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  fs.writeFileSync(path.join(workspace, checks[0].evidence[1].path), "");
  fs.writeFileSync(inputPath, JSON.stringify({
    schemaVersion: 1,
    runId: "phase0-empty-evidence",
    commit: "0123456789abcdef0123456789abcdef01234567",
    startedAt: "2026-08-30T08:00:00.000Z",
    finishedAt: "2026-08-30T08:05:00.000Z",
    environment: createAvailableEnvironment(),
    corpus: {
      version: "1.1.0",
      manifest: "corpus/phase0/manifest.json"
    },
    checks: checks
  }, null, 2));

  var result = invokeCli(["run", "--input", inputPath, "--output", path.join(workspace, "report")]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /evidence file.*empty/i);
});

test("result evidence must be structured and match its check", function (t) {
  var workspace = fs.mkdtempSync(path.join(os.tmpdir(), "formulabridge-phase0-"));
  var inputPath = path.join(workspace, "run.json");
  var checks = createChecks(workspace, "passed");

  t.after(function () {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  fs.writeFileSync(path.join(workspace, checks[0].evidence[0].path), "not JSON\n");
  fs.writeFileSync(inputPath, JSON.stringify({
    schemaVersion: 1,
    runId: "phase0-malformed-result",
    commit: "0123456789abcdef0123456789abcdef01234567",
    startedAt: "2026-08-30T08:00:00.000Z",
    finishedAt: "2026-08-30T08:05:00.000Z",
    environment: createAvailableEnvironment(),
    corpus: {
      version: "1.1.0",
      manifest: "corpus/phase0/manifest.json"
    },
    checks: checks
  }, null, 2));

  var result = invokeCli(["run", "--input", inputPath, "--output", path.join(workspace, "report")]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /result evidence.*JSON/i);
});

test("report archives the pinned corpus and check set for standalone validation", function (t) {
  var workspace = fs.mkdtempSync(path.join(os.tmpdir(), "formulabridge-phase0-"));
  var inputPath = path.join(workspace, "run.json");
  var outputDirectory = path.join(workspace, "report");

  t.after(function () {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  fs.writeFileSync(inputPath, JSON.stringify({
    schemaVersion: 1,
    runId: "phase0-self-contained-report",
    commit: "0123456789abcdef0123456789abcdef01234567",
    startedAt: "2026-08-30T08:00:00.000Z",
    finishedAt: "2026-08-30T08:05:00.000Z",
    environment: createAvailableEnvironment(),
    corpus: {
      version: "1.1.0",
      manifest: "corpus/phase0/manifest.json"
    },
    checks: createChecks(workspace, "passed")
  }, null, 2));

  var runResult = invokeCli(["run", "--input", inputPath, "--output", outputDirectory]);

  assert.equal(runResult.status, 0, runResult.stderr);

  var report = JSON.parse(fs.readFileSync(path.join(outputDirectory, "report.json"), "utf8"));

  assert.equal(report.corpus.manifest, "inputs/corpus/manifest.json");
  assert.equal(report.checkSet.manifest, "inputs/check-set/checks.json");
  assert.equal(fs.existsSync(path.join(outputDirectory, report.corpus.manifest)), true);
  assert.equal(fs.existsSync(path.join(outputDirectory, report.checkSet.manifest)), true);
  assert.equal(fs.existsSync(path.join(outputDirectory, "inputs/corpus/word/minimal-document.docx")), true);

  var validationResult = invokeCli(["validate-report", "--report", path.join(outputDirectory, "report.json")]);
  assert.equal(validationResult.status, 0, validationResult.stderr);
});

test("evidence paths cannot escape through directory links", function (t) {
  var workspace = fs.mkdtempSync(path.join(os.tmpdir(), "formulabridge-phase0-"));
  var outsideDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "formulabridge-phase0-outside-"));
  var linkedDirectory = path.join(workspace, "linked-evidence");
  var inputPath = path.join(workspace, "run.json");
  var checks = createChecks(workspace, "passed");

  t.after(function () {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(outsideDirectory, { recursive: true, force: true });
  });

  fs.writeFileSync(
    path.join(outsideDirectory, "result.json"),
    JSON.stringify(createCheckResult(requiredChecks[0], "passed"), null, 2)
  );

  try {
    fs.symlinkSync(outsideDirectory, linkedDirectory, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (error.code === "EPERM" || error.code === "EACCES") {
      t.skip("creating directory links is not permitted in this environment");
      return;
    }
    throw error;
  }

  checks[0].evidence[0].path = "linked-evidence/result.json";
  fs.writeFileSync(inputPath, JSON.stringify({
    schemaVersion: 1,
    runId: "phase0-linked-evidence",
    commit: "0123456789abcdef0123456789abcdef01234567",
    startedAt: "2026-08-30T08:00:00.000Z",
    finishedAt: "2026-08-30T08:05:00.000Z",
    environment: createAvailableEnvironment(),
    corpus: {
      version: "1.1.0",
      manifest: "corpus/phase0/manifest.json"
    },
    checks: checks
  }, null, 2));

  var result = invokeCli(["run", "--input", inputPath, "--output", path.join(workspace, "report")]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /evidence file.*real path.*inside/i);
});

test("execute runs a registered check provider", function (t) {
  var workspace = fs.mkdtempSync(path.join(os.tmpdir(), "formulabridge-phase0-provider-"));
  var definition = Object.assign({}, requiredChecks[0], {
    provider: "tests/fixtures/phase0-provider.js"
  });

  t.after(function () {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  var checks = phase0Evidence.executeCheckProviders({
    runId: "phase0-provider-test",
    commit: "0123456789abcdef0123456789abcdef01234567",
    environment: createAvailableEnvironment(),
    corpus: {
      version: "1.1.0",
      manifest: "corpus/phase0/manifest.json"
    }
  }, workspace, { checks: [definition] });

  assert.equal(checks.length, 1);
  assert.equal(checks[0].status, "passed");
  assert.ok(checks[0].evidence.some(function (item) { return item.kind === "result"; }));
  checks[0].evidence.forEach(function (item) {
    assert.equal(fs.existsSync(path.join(workspace, item.path)), true);
  });
});

test("execute blocks unavailable registered providers and leaves unregistered providers not-run", function (t) {
  var workspace = fs.mkdtempSync(path.join(os.tmpdir(), "formulabridge-phase0-execute-"));
  var inputPath = path.join(workspace, "execution.json");
  var outputDirectory = path.join(workspace, "report");
  var environment = createAvailableEnvironment();

  environment.word = { availability: "unavailable", reason: "Synthetic Word absence" };
  environment.tex = { availability: "unavailable", reason: "Synthetic TeX absence" };

  t.after(function () {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  fs.writeFileSync(inputPath, JSON.stringify({
    schemaVersion: 1,
    runId: "phase0-no-providers",
    commit: "0123456789abcdef0123456789abcdef01234567",
    startedAt: "2026-08-30T08:00:00.000Z",
    environment: environment,
    corpus: {
      version: "1.1.0",
      manifest: "corpus/phase0/manifest.json"
    }
  }, null, 2));

  var previousInstaller = process.env.FORMULABRIDGE_VSTO_INSTALLER;
  delete process.env.FORMULABRIDGE_VSTO_INSTALLER;
  t.after(function () {
    if (previousInstaller === undefined) {
      delete process.env.FORMULABRIDGE_VSTO_INSTALLER;
    } else {
      process.env.FORMULABRIDGE_VSTO_INSTALLER = previousInstaller;
    }
  });

  var result = invokeCli(["execute", "--input", inputPath, "--output", outputDirectory]);

  assert.equal(result.status, 1, result.stderr);

  var report = JSON.parse(fs.readFileSync(path.join(outputDirectory, "report.json"), "utf8"));
  assert.equal(report.overallStatus, "blocked");
  assert.equal(report.checks.length, requiredChecks.length);
  assert.equal(report.checks[0].status, "blocked");
  assert.match(report.checks[0].reason, /FORMULABRIDGE_VSTO_INSTALLER/);
  report.checks.slice(1).forEach(function (check, index) {
    var definition = requiredChecks[index + 1];

    assert.equal(check.status, definition.provider ? "blocked" : "not-run");
    if (!definition.provider) {
      assert.match(check.reason, /No check provider is registered/);
    }
  });
});

test("result evidence cannot omit a required acceptance assertion", function (t) {
  var workspace = fs.mkdtempSync(path.join(os.tmpdir(), "formulabridge-phase0-"));
  var inputPath = path.join(workspace, "run.json");
  var checks = createChecks(workspace, "passed");
  var resultPath = path.join(workspace, checks[0].evidence[0].path);
  var resultEvidence = JSON.parse(fs.readFileSync(resultPath, "utf8"));

  t.after(function () {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  resultEvidence.assertions.pop();
  fs.writeFileSync(resultPath, JSON.stringify(resultEvidence, null, 2));
  fs.writeFileSync(inputPath, JSON.stringify({
    schemaVersion: 1,
    runId: "phase0-missing-assertion",
    commit: "0123456789abcdef0123456789abcdef01234567",
    startedAt: "2026-08-30T08:00:00.000Z",
    finishedAt: "2026-08-30T08:05:00.000Z",
    environment: createAvailableEnvironment(),
    corpus: {
      version: "1.1.0",
      manifest: "corpus/phase0/manifest.json"
    },
    checks: checks
  }, null, 2));

  var result = invokeCli(["run", "--input", inputPath, "--output", path.join(workspace, "report")]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /required assertions do not match/i);
});

test("report output cannot escape through a pre-existing directory link", function (t) {
  var workspace = fs.mkdtempSync(path.join(os.tmpdir(), "formulabridge-phase0-"));
  var outsideDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "formulabridge-phase0-output-"));
  var inputPath = path.join(workspace, "run.json");
  var outputDirectory = path.join(workspace, "report");

  t.after(function () {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(outsideDirectory, { recursive: true, force: true });
  });

  fs.mkdirSync(outputDirectory);
  try {
    fs.symlinkSync(
      outsideDirectory,
      path.join(outputDirectory, "evidence"),
      process.platform === "win32" ? "junction" : "dir"
    );
  } catch (error) {
    if (error.code === "EPERM" || error.code === "EACCES") {
      t.skip("creating directory links is not permitted in this environment");
      return;
    }
    throw error;
  }

  fs.writeFileSync(inputPath, JSON.stringify({
    schemaVersion: 1,
    runId: "phase0-linked-output",
    commit: "0123456789abcdef0123456789abcdef01234567",
    startedAt: "2026-08-30T08:00:00.000Z",
    finishedAt: "2026-08-30T08:05:00.000Z",
    environment: createAvailableEnvironment(),
    corpus: {
      version: "1.1.0",
      manifest: "corpus/phase0/manifest.json"
    },
    checks: createChecks(workspace, "passed")
  }, null, 2));

  var result = invokeCli(["run", "--input", inputPath, "--output", outputDirectory]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /archived evidence path parent.*(?:real path|symbolic link)/i);
  assert.equal(fs.existsSync(path.join(outsideDirectory, "vsto-installation")), false);
});
