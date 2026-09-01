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
    "word-automation.log"
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
        reason: index === 0 ? reason : "The Word preflight prevented this assertion"
      };
    })
  }, null, 2) + "\n");
  fs.writeFileSync(logPath, "Source-portable copy smoke blocked: " + reason + "\n");

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
      maxBuffer: 10 * 1024 * 1024
    }
  );

  if (result.error) {
    throw result.error;
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
