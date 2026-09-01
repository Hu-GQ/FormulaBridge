"use strict";

var childProcess = require("node:child_process");
var fs = require("node:fs");
var path = require("node:path");

function portable(relativePath) {
  return relativePath.split(path.sep).join("/");
}

var automationTimeoutMs = 180000;

function terminal(context, status, reason) {
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
    "word-automation.log"
  ));
  var resultPath = path.join(context.workspace, resultRelativePath);
  var logPath = path.join(context.workspace, logRelativePath);

  fs.mkdirSync(path.dirname(resultPath), { recursive: true });
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(resultPath, JSON.stringify({
    schemaVersion: 1,
    checkId: context.definition.id,
    status: status,
    assertions: context.definition.requiredAssertions.map(function (id, index) {
      return {
        id: id,
        status: index === 0 ? status : "not-run",
        reason: index === 0 ? reason : "A terminal Word automation condition prevented this assertion"
      };
    })
  }, null, 2) + "\n");
  fs.writeFileSync(logPath, "Source-portable copy smoke " + status + ": " + reason + "\n");

  return {
    id: context.definition.id,
    name: context.definition.name,
    status: status,
    reason: reason,
    startedAt: startedAt,
    finishedAt: new Date().toISOString(),
    evidence: [
      { path: resultRelativePath, kind: "result" },
      { path: logRelativePath, kind: "log" }
    ]
  };
}

function blocked(context, reason) {
  return terminal(context, "blocked", reason);
}

function failed(context, reason) {
  return terminal(context, "failed", reason);
}

function run(context) {
  var word = context.environment.word;
  var scriptPath;
  var fragmentPath;
  var result;

  if (process.platform !== "win32") {
    return blocked(context, "The Word clipboard automation requires Windows");
  }
  if (!word || word.availability !== "available") {
    return blocked(context, word && word.reason ? word.reason : "Microsoft Word is unavailable");
  }

  scriptPath = path.join(context.projectRoot, "tools", "test-source-portable-copy.ps1");
  fragmentPath = path.join(context.workspace, "source-portable-copy-check-fragment.json");
  result = childProcess.spawnSync(
    process.env.FORMULABRIDGE_PWSH || "pwsh",
    [
      "-NoProfile",
      "-File",
      scriptPath,
      "-EvidenceDirectory",
      context.workspace,
      "-ExpectedCommit",
      context.commit,
      "-FragmentPath",
      fragmentPath
    ],
    {
      cwd: context.projectRoot,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
      timeout: automationTimeoutMs,
      killSignal: "SIGKILL"
    }
  );

  if (result.error) {
    if (result.error.code === "ETIMEDOUT") {
      return failed(context, "Word clipboard automation exceeded the 180-second timeout");
    }
    return failed(context, "Word clipboard automation could not start (" + (result.error.code || "unknown error") + ")");
  }
  if (result.status !== 0 && result.status !== 1) {
    throw new Error("Word clipboard automation exited without a valid result");
  }
  if (!fs.existsSync(fragmentPath)) {
    throw new Error("Word clipboard automation did not produce its check fragment");
  }

  return JSON.parse(fs.readFileSync(fragmentPath, "utf8"));
}

module.exports = { run: run };
