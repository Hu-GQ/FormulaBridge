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
  fs.writeFileSync(logPath, "TeX isolation smoke blocked: " + reason + "\n");

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
  var enginePath = process.env.FORMULABRIDGE_TEX_ENGINE;
  var texRoot = process.env.FORMULABRIDGE_TEX_ROOT;
  var engineSha256 = process.env.FORMULABRIDGE_TEX_ENGINE_SHA256;
  var scriptPath;
  var argumentsList;
  var result;
  var fragmentPath;

  if (process.platform !== "win32") {
    return blocked(context, "The TeX isolation smoke requires Windows");
  }
  if (!context.environment.tex || context.environment.tex.availability !== "available") {
    return blocked(context, "The execution environment has no approved TeX installation");
  }
  if (!enginePath || !texRoot || !engineSha256) {
    return blocked(
      context,
      "FORMULABRIDGE_TEX_ENGINE, FORMULABRIDGE_TEX_ROOT, and FORMULABRIDGE_TEX_ENGINE_SHA256 are required"
    );
  }

  scriptPath = path.join(context.projectRoot, "tools", "test-tex-isolation.ps1");
  argumentsList = [
    "-NoProfile",
    "-File",
    scriptPath,
    "-EnginePath",
    enginePath,
    "-TexRoot",
    texRoot,
    "-ExpectedEngineSha256",
    engineSha256,
    "-EvidenceDirectory",
    context.workspace,
    "-ExpectedCommit",
    context.commit
  ];

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
    throw new Error("TeX isolation smoke exited without a valid result");
  }

  fragmentPath = path.join(context.workspace, "check-fragment.json");
  if (!fs.existsSync(fragmentPath)) {
    throw new Error("TeX isolation smoke did not produce check-fragment.json");
  }

  return JSON.parse(fs.readFileSync(fragmentPath, "utf8"));
}

module.exports = { run: run };
