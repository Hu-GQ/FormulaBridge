"use strict";
var fs = require("node:fs");
var ids = ["initial-benign", "cancel", "after-cancel", "timeout", "after-timeout", "memory", "after-memory",
  "output-files", "after-output-files", "output-bytes", "after-output-bytes", "child-process", "after-child-process"];
function evaluate(report, policy) {
  var invalid = { cancellation: false, recovery: false, resources: false, word: false };
  if (!report || report.hostFailure || report.schemaVersion !== 1 || !Array.isArray(report.cases) || !policy || !policy.ceilings ||
      report.cases.length !== ids.length || report.cases.some(function (c, i) { return !c || c.id !== ids[i] || !c.result; })) return invalid;
  var cases = Object.fromEntries(report.cases.map(function (c) { return [c.id, c]; }));
  var limits = policy.ceilings;
  var drained = report.cases.every(function (c) {
    var r = c.result;
    return r.processTreeExited === true && r.activeProcessesAfterCleanup === 0 && Number.isInteger(r.totalProcesses) && r.totalProcesses >= 1 &&
      r.profileDeleted === true && r.aclRestored === true && r.appContainerApplied === true && r.networkCapabilityCount === 0 &&
      r.assignedToJobBeforeResume === true && r.engineIdentityVerified === true && r.engineIdentityStable === true &&
      r.texAclExplicitlyGranted === true && c.jobDirectoryRemoved === true && Number.isFinite(r.elapsedMilliseconds) && r.elapsedMilliseconds >= 0 &&
      r.limits && r.limits.memoryBytes === limits.memoryBytes && r.limits.outputFiles === limits.outputFiles &&
      r.limits.outputBytes === limits.outputBytes && r.limits.activeProcesses === limits.activeProcesses &&
      r.limits.wallClockSeconds > 0 && r.limits.wallClockSeconds <= limits.interactiveSeconds;
  });
  var cancel = cases.cancel;
  var timeout = cases.timeout;
  var cancelled = drained && cancel.cancelObserved === true && cancel.exitCode === 1 && cancel.result.status === "terminated" &&
    cancel.result.code === "cancelled" && cancel.result.cancelled === true && cancel.result.timedOut === false;
  var timedOut = timeout.exitCode === 1 && timeout.result.status === "terminated" && timeout.result.timedOut === true &&
    timeout.result.code === "wall-clock-ceiling-exceeded" && timeout.result.elapsedMilliseconds >= timeout.result.limits.wallClockSeconds * 1000;
  var resources = drained && ["output-files", "output-bytes"].every(function (id) {
    var c = cases[id];
    return c.exitCode === 1 && c.result.status === "terminated" && c.result.outputLimitExceeded === true && c.result.code === "output-ceiling-exceeded";
  }) && cases["output-files"].result.observedOutputFiles > limits.outputFiles &&
    cases["output-bytes"].result.observedOutputBytes > limits.outputBytes &&
    cases.memory.result.status === "completed" && cases.memory.result.exitCode > 0 && cases.memory.result.timedOut === false &&
    cases.memory.result.peakJobMemoryBytes >= limits.memoryBytes / 2 && cases.memory.result.peakJobMemoryBytes <= limits.memoryBytes &&
    cases["child-process"].result.status === "completed" && cases["child-process"].result.exitCode === 0 &&
    cases["child-process"].attackMarker === "blocked" && cases["child-process"].childArtifact === false;
  var sameHost = report.cases.every(function (c) { return Number.isInteger(c.hostProcessId) && c.hostProcessId > 0 && c.hostProcessId === report.cases[0].hostProcessId; });
  var recovered = report.cases.filter(function (c) { return c.id === "initial-benign" || c.id.startsWith("after-"); }).every(function (c) {
    return c.exitCode === 0 && c.result.status === "completed" && c.result.exitCode === 0 && c.producedPdf === true;
  });
  return { cancellation: cancelled && timedOut, resources: resources && timedOut,
    recovery: sameHost && recovered && cancelled && timedOut && resources,
    word: report.wordResponsive === true && Number.isInteger(report.wordProbeCount) && report.wordProbeCount > 0 };
}
module.exports = { evaluate: evaluate, caseIds: ids };
if (require.main === module) {
  try { process.stdout.write(JSON.stringify(evaluate(JSON.parse(fs.readFileSync(process.argv[2], "utf8")), JSON.parse(fs.readFileSync(process.argv[3], "utf8")))) + "\n"); }
  catch (_) { process.stderr.write("Lifecycle evidence could not be evaluated.\n"); process.exitCode = 2; }
}
