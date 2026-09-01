"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var cp = require("node:child_process");
var evidence = require("../tools/tex-lifecycle-evidence");
var root = path.resolve(__dirname, "..");
var policy = { ceilings: { memoryBytes: 1073741824, outputFiles: 64, outputBytes: 67108864, activeProcesses: 1, interactiveSeconds: 30 } };
function sample() {
  var report = { schemaVersion: 1, wordResponsive: true, wordProbeCount: 9, cases: evidence.caseIds.map(function (id) {
    return { id: id, hostProcessId: 42, exitCode: 0, producedPdf: true, jobDirectoryRemoved: true,
      attackMarker: "blocked", childArtifact: false, result: {
        status: "completed", code: "process-exited", exitCode: 0, timedOut: false, cancelled: false,
        processTreeExited: true, activeProcessesAfterCleanup: 0, totalProcesses: 1, elapsedMilliseconds: 3000,
        profileDeleted: true, aclRestored: true, appContainerApplied: true, networkCapabilityCount: 0,
        assignedToJobBeforeResume: true, engineIdentityVerified: true, engineIdentityStable: true, texAclExplicitlyGranted: true,
        limits: { memoryBytes: 1073741824, outputFiles: 64, outputBytes: 67108864, activeProcesses: 1, wallClockSeconds: 2 }
      } };
  }) };
  var cases = Object.fromEntries(report.cases.map(function (c) { return [c.id, c]; }));
  cases.cancel.exitCode = 1; cases.cancel.cancelObserved = true;
  Object.assign(cases.cancel.result, { status: "terminated", code: "cancelled", cancelled: true });
  cases.timeout.exitCode = 1;
  Object.assign(cases.timeout.result, { status: "terminated", code: "wall-clock-ceiling-exceeded", timedOut: true });
  cases.memory.result.exitCode = 1; cases.memory.result.peakJobMemoryBytes = 900000000;
  ["output-files", "output-bytes"].forEach(function (id) {
    cases[id].exitCode = 1;
    Object.assign(cases[id].result, { status: "terminated", code: "output-ceiling-exceeded", outputLimitExceeded: true,
      observedOutputFiles: 65, observedOutputBytes: 67108865 });
  });
  return report;
}
test("lifecycle evidence accepts a complete synthetic host sequence with measured cleanup and resource limits", function () {
  assert.deepEqual(evidence.evaluate(sample(), policy), { cancellation: true, recovery: true, resources: true, word: true });
});
var corruptions = [
  ["incomplete host run", function (r) { r.hostFailure = "lifecycle-host-incomplete"; }, "recovery"],
  ["cancel before the engine started", function (r) { r.cases[1].result.code = "cancelled-before-resume"; }, "cancellation"],
  ["no observed cancellation request", function (r) { r.cases[1].cancelObserved = false; }, "cancellation"],
  ["live descendant after termination", function (r) { r.cases[1].result.activeProcessesAfterCleanup = 1; }, "cancellation"],
  ["missing job accounting", function (r) { delete r.cases[1].result.totalProcesses; }, "cancellation"],
  ["ACL residue", function (r) { r.cases[2].result.aclRestored = false; }, "recovery"],
  ["directory residue", function (r) { r.cases[2].jobDirectoryRemoved = false; }, "recovery"],
  ["different recovery host", function (r) { r.cases[2].hostProcessId = 43; }, "recovery"],
  ["missing recovered PDF", function (r) { r.cases[2].producedPdf = false; }, "recovery"],
  ["timeout below its observed bound", function (r) { r.cases[3].result.elapsedMilliseconds = 1; }, "cancellation"],
  ["memory failure without substantial allocation", function (r) { r.cases[5].result.peakJobMemoryBytes = 1; }, "resources"],
  ["output count did not cross the ceiling", function (r) { r.cases[7].result.observedOutputFiles = 64; }, "resources"],
  ["output bytes did not cross the ceiling", function (r) { r.cases[9].result.observedOutputBytes = 67108864; }, "resources"],
  ["child process escaped", function (r) { r.cases[11].childArtifact = true; }, "resources"],
  ["relaxed resource policy", function (r) { r.cases[1].result.limits.memoryBytes *= 2; }, "cancellation"],
  ["no Word heartbeat", function (r) { r.wordProbeCount = 0; }, "word"],
  ["unresponsive Word", function (r) { r.wordResponsive = false; }, "word"]
];
corruptions.forEach(function (entry) {
  test("lifecycle evidence refuses " + entry[0], function () {
    var report = sample(); entry[1](report);
    assert.equal(evidence.evaluate(report, policy)[entry[2]], false);
  });
});
test("lifecycle evidence refuses omitted or duplicate tasks", function () {
  var report = sample(); report.cases.pop();
  assert.equal(evidence.evaluate(report, policy).recovery, false);
  report = sample(); report.cases[2] = report.cases[0];
  assert.equal(evidence.evaluate(report, policy).recovery, false);
});
test("the same host rejects policy injection and then handles the next request", { skip: process.platform !== "win32", timeout: 120000 }, function (t) {
  var workspace = fs.mkdtempSync(path.join(os.tmpdir(), "formulabridge-host-sequence-"));
  t.after(function () { fs.rmSync(workspace, { recursive: true, force: true }); });
  var sequence = [];
  ["memoryBytes", "outputBytes", "outputFiles", "activeProcesses", "preamble", "document", "formula"].forEach(function (field, i) {
    var job = path.join(workspace, String(i), "job");
    fs.mkdirSync(path.join(job, "output"), { recursive: true });
    var request = { schemaVersion: 1, jobRoot: job, outputDirectory: path.join(job, "output"), mode: "interactive", testWallClockSeconds: 1 };
    request[field] = { memoryBytes: 999999999999 };
    var file = path.join(workspace, String(i), "request.json");
    fs.writeFileSync(file, JSON.stringify(request));
    sequence.push({ id: field, request: file });
  });
  var job = path.join(workspace, "next", "job"); fs.mkdirSync(path.join(job, "output"), { recursive: true });
  var next = path.join(workspace, "next", "request.json");
  fs.writeFileSync(next, JSON.stringify({ schemaVersion: 1, jobRoot: job, outputDirectory: path.join(job, "output"), mode: "interactive", testWallClockSeconds: 31 }));
  sequence.push({ id: "next-request", request: next });
  var input = path.join(workspace, "sequence.json"); fs.writeFileSync(input, JSON.stringify(sequence));
  var build = cp.spawnSync("dotnet", ["build", path.join(root, "tests/fixtures/TexLifecycleHarness"), "--configuration", "Release", "--nologo"], { encoding: "utf8", windowsHide: true });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  var result = cp.spawnSync(path.join(root, "tests/fixtures/TexLifecycleHarness/bin/Release/net10.0-windows/TexLifecycleHarness.exe"), [input], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  var report = JSON.parse(result.stdout);
  assert.equal(new Set(report.cases.map(function (c) { return c.hostProcessId; })).size, 1);
  report.cases.slice(0, -1).forEach(function (c) { assert.equal(c.result.code, "invalid-request-json"); assert.equal(c.jobDirectoryRemoved, true); });
  assert.equal(report.cases.at(-1).result.code, "wall-clock-ceiling-exceeded");
  // A later corrupt request must not erase evidence from the completed request.
  var validJob = path.join(workspace, "partial", "job"); fs.mkdirSync(path.join(validJob, "output"), { recursive: true });
  var validPath = path.join(workspace, "partial", "request.json");
  fs.writeFileSync(validPath, JSON.stringify({ schemaVersion: 1, jobRoot: validJob, outputDirectory: path.join(validJob, "output"), mode: "interactive", testWallClockSeconds: 31 }));
  fs.writeFileSync(input, JSON.stringify([{ id: "complete", request: validPath }, { id: "broken", request: path.join(workspace, "missing.json") }]));
  result = cp.spawnSync(path.join(root, "tests/fixtures/TexLifecycleHarness/bin/Release/net10.0-windows/TexLifecycleHarness.exe"), [input], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 1);
  report = JSON.parse(result.stdout);
  assert.equal(report.hostFailure, "lifecycle-host-incomplete");
  assert.equal(report.cases.length, 1);
  assert.equal(report.cases[0].id, "complete");
  assert.equal(result.stdout.includes(workspace), false);
});
test("the new smoke scripts parse without errors", { skip: process.platform !== "win32" }, function () {
  var script = "$bad=@(); foreach($p in $args) { $t=$null; $e=$null; [void][System.Management.Automation.Language.Parser]::ParseFile($p,[ref]$t,[ref]$e); $bad+= $e }; if($bad.Count) { $bad | Out-String | Write-Error; exit 1 }";
  // A script file keeps paths as arguments, independent of shell interpolation.
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "formulabridge-parse-"));
  try {
    var file = path.join(dir, "parse.ps1"); fs.writeFileSync(file, script);
    var result = cp.spawnSync(process.env.FORMULABRIDGE_PWSH || "pwsh", ["-NoProfile", "-File", file].concat(
      ["tools/test-tex-isolation.ps1", "tools/tex-lifecycle-smoke.ps1", "tools/vsto-diagnostics-smoke.ps1", "tools/test-vsto-installation.ps1"].map(function (p) { return path.join(root, p); })), { encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
