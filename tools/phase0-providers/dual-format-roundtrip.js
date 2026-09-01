"use strict";

var childProcess = require("node:child_process");
var fs = require("node:fs");
var path = require("node:path");

function portable(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function blocked(context, reason) {
  var startedAt = new Date().toISOString();
  var resultRelativePath = portable(path.join(
    "evidence",
    context.definition.id,
    "result",
    "result.json"
  ));
  var logRelativePath = portable(path.join(
    "evidence",
    context.definition.id,
    "log",
    "smoke.log"
  ));
  var resultPath = path.join(context.workspace, resultRelativePath);
  var logPath = path.join(context.workspace, logRelativePath);

  fs.mkdirSync(path.dirname(resultPath), { recursive: true });
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(resultPath, JSON.stringify({
    schemaVersion: 1,
    checkId: context.definition.id,
    status: "blocked",
    assertions: context.definition.requiredAssertions.map(function (id, index) {
      return {
        id: id,
        status: index === 0 ? "blocked" : "not-run",
        reason: index === 0 ? reason : "The blocked preflight prevented this assertion"
      };
    })
  }, null, 2) + "\n");
  fs.writeFileSync(logPath, "Dual-format Word round-trip smoke blocked: " + reason + "\n");

  return {
    id: context.definition.id,
    name: context.definition.name,
    status: "blocked",
    reason: reason,
    startedAt: startedAt,
    finishedAt: new Date().toISOString(),
    evidence: [
      { path: resultRelativePath, kind: "result" },
      { path: logRelativePath, kind: "log" }
    ]
  };
}

function run(context) {
  var scriptPath;
  var argumentsList;
  var result;
  var fragmentPath;

  if (process.platform !== "win32") {
    return blocked(context, "The dual-format Word round-trip smoke requires Windows");
  }
  if (!context.environment.word || context.environment.word.availability !== "available") {
    return blocked(context, "Word is unavailable in the declared Phase 0 environment");
  }

  scriptPath = path.join(context.projectRoot, "tools", "test-dual-format-roundtrip.ps1");
  argumentsList = [
    "-NoProfile",
    "-File",
    scriptPath,
    "-EvidenceDirectory",
    context.workspace,
    "-ExpectedCommit",
    context.commit
  ];

  if (process.env.FORMULABRIDGE_PDFTOPPM) {
    argumentsList.push("-PdfToPpmPath", process.env.FORMULABRIDGE_PDFTOPPM);
  }
  if (process.env.FORMULABRIDGE_PRINT_TO_PDF_PRINTER) {
    argumentsList.push("-PrintToPdfPrinter", process.env.FORMULABRIDGE_PRINT_TO_PDF_PRINTER);
  }
  if (process.env.FORMULABRIDGE_PROVISION_PRINT_CAPTURE === "1") {
    argumentsList.push("-ProvisionPrintCapture");
  }

  result = childProcess.spawnSync(
    process.env.FORMULABRIDGE_PWSH || "pwsh",
    argumentsList,
    {
      cwd: context.projectRoot,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024
    }
  );

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0 && result.status !== 1) {
    throw new Error("Dual-format Word round-trip smoke exited without a valid result");
  }

  fragmentPath = path.join(context.workspace, "check-fragment.json");
  if (!fs.existsSync(fragmentPath)) {
    throw new Error("Dual-format Word round-trip smoke did not produce check-fragment.json");
  }

  return JSON.parse(fs.readFileSync(fragmentPath, "utf8"));
}

module.exports = { run: run };
