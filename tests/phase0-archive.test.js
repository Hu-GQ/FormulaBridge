"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var cp = require("node:child_process");

test("the committed integration archive verifies independently and preserves its blocked verdict", function () {
  var root = path.resolve(__dirname, "..");
  var relative = "docs/evidence/phase0-integration-2026-09-02/report.json";
  var report = JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
  assert.equal(report.commit, "113a9000e744dd8a6c2923279e0612cd67a1af23");
  assert.equal(report.overallStatus, "blocked");
  assert.deepEqual(report.checks.map(function (c) { return [c.id, c.status]; }), [
    ["vsto-installation", "blocked"], ["source-portable-copy", "passed"],
    ["dual-format-roundtrip", "passed"], ["tex-isolation", "blocked"]
  ]);
  var result = cp.spawnSync(process.execPath, [path.join(root, "tools/phase0-evidence.js"), "validate-report", "--report", relative],
    { cwd: root, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  // Hash-pinned snapshots must keep their bytes when checked out on another OS.
  var attributes = cp.spawnSync("git", ["check-attr", "text", "--", relative], { cwd: root, encoding: "utf8", windowsHide: true });
  assert.equal(attributes.status, 0, attributes.stderr);
  assert.match(attributes.stdout, /: text: unset/);
});
