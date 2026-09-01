"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var cp = require("node:child_process");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var crypto = require("node:crypto");
var root = path.resolve(__dirname, "..");
var workspace;
var harness;
var executable;
test.before(function () {
  if (process.platform !== "win32") return;
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "formulabridge-diagnostics-"));
  [false, true].forEach(function (includeHarness) {
    var args = ["-NoProfile", "-File", path.join(root, "tools/build-diagnostics.ps1"), "-OutputDirectory", workspace];
    if (includeHarness) args.push("-TestHarness");
    var result = cp.spawnSync(process.env.FORMULABRIDGE_PWSH || "pwsh", args, { encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
  harness = path.join(workspace, "FormulaBridge.Diagnostics.Tests.exe");
  executable = path.join(workspace, "FormulaBridge.Diagnostics.exe");
});
test.after(function () { if (workspace) fs.rmSync(workspace, { recursive: true, force: true }); });
function run(args) {
  var result = cp.spawnSync(harness, args, { encoding: "utf8", windowsHide: true, timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
var windows = { skip: process.platform !== "win32" };
test("diagnostics report a fully observed healthy session and either WebView2 install scope", windows, function () {
  ["healthy", "user-webview", "machine-webview"].forEach(function (scenario) {
    var result = JSON.parse(run([scenario]));
    assert.equal(result.status, "passed");
    assert.equal(result.checks.length, 10);
    assert.ok(result.checks.every(function (check) { return check.status === "passed"; }));
  });
});
var scenarios = {
  "missing-registration": ["current-user-registration", "failed"], "wrong-bitness": ["word-x64", "failed"],
  "missing-word": ["word-x64", "failed"], "missing-vsto": ["vsto-runtime", "failed"],
  "missing-webview": ["webview2-runtime", "failed"], "zero-webview": ["webview2-runtime", "failed"],
  "invalid-webview": ["webview2-runtime", "failed"], "missing-manifest": ["local-signed-manifest", "failed"],
  "invalid-signature": ["deployment-signatures", "failed"], "unknown-trust": ["deployment-signatures", "blocked"],
  "manual-disabled": ["load-behavior", "failed"], "word-disabled": ["resiliency-and-policy", "failed"],
  "word-crash": ["resiliency-and-policy", "failed"], "opaque-disabled": ["resiliency-and-policy", "blocked"],
  "policy-disabled": ["resiliency-and-policy", "failed"], "access-denied": ["resiliency-and-policy", "blocked"],
  "missing-state": ["add-in-load-state", "failed"], "closed-word": ["add-in-load-state", "failed"],
  "reused-pid": ["add-in-load-state", "failed"], "future-state": ["add-in-load-state", "failed"],
  "future-ribbon": ["ribbon-load-state", "failed"], "ribbon-before-startup": ["ribbon-load-state", "failed"],
  "malformed-time": ["add-in-load-state", "failed"], "unsupported-state": ["add-in-load-state", "failed"],
  "wrong-addin": ["add-in-load-state", "failed"]
};
Object.keys(scenarios).forEach(function (scenario) {
  test("diagnostics explain " + scenario + " without claiming healthy", windows, function () {
    var result = JSON.parse(run([scenario]));
    var expected = scenarios[scenario];
    var check = result.checks.find(function (item) { return item.id === expected[0]; });
    assert.equal(check.status, expected[1]);
    assert.equal(result.status, expected[1]);
    assert.ok(check.reason && check.remediation);
    assert.doesNotMatch(JSON.stringify(result), /C:\\|private invalid|Users\\private/);
  });
});
test("native signature verification rejects an unsigned executable and missing or unsigned manifests", windows, function () {
  assert.equal(run(["binary", harness]), "failed");
  assert.equal(run(["manifest", path.join(workspace, "missing.vsto")]), "failed");
  var manifest = path.join(workspace, "unsigned.vsto");
  fs.writeFileSync(manifest, '<assembly xmlns="urn:schemas-microsoft-com:asm.v1"><assemblyIdentity name="Example" version="1.0.0.0"/></assembly>');
  assert.equal(run(["manifest", manifest]), "failed");
  fs.writeFileSync(manifest, '<!DOCTYPE assembly [<!ENTITY external SYSTEM "file:///C:/private.txt">]><assembly>&external;</assembly>');
  assert.equal(run(["manifest", manifest]), "failed");
});
test("payload verification catches tampering, missing hashes and external or traversing references", windows, function () {
  var manifest = path.join(workspace, "payload.xml");
  var payload = path.join(workspace, "payload.dll");
  fs.writeFileSync(payload, "payload");
  var digest = crypto.createHash("sha256").update("payload").digest("base64");
  function xml(name, hash) { return '<assembly xmlns="urn:schemas-microsoft-com:asm.v1"><file name="' + name + '">' +
    (hash ? '<hash><DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><DigestValue>' + digest + '</DigestValue></hash>' : '') + '</file></assembly>'; }
  fs.writeFileSync(manifest, xml("payload.dll", true));
  assert.equal(run(["payload", manifest, workspace]), "passed");
  fs.writeFileSync(payload, "modified");
  assert.equal(run(["payload", manifest, workspace]), "failed");
  ["../payload.dll", "https://invalid.example/payload.dll", "C:/payload.dll", "payload.dll:alternate", "%2e%2e/payload.dll"].forEach(function (name) {
    fs.writeFileSync(manifest, xml(name, true));
    assert.equal(run(["payload", manifest, workspace]), "failed");
  });
  fs.writeFileSync(manifest, xml("payload.dll", false));
  assert.equal(run(["payload", manifest, workspace]), "failed");
});
test("external diagnostics do not accept remote manifest registration or expose paths on CLI failures", windows, function () {
  ["https://example.test/a.vsto|vstolocal", "file://server/share/a.vsto|vstolocal", "file:///C:/a.vsto:stream|vstolocal", "file:///C:/a.vsto"].forEach(function (value) {
    assert.equal(run(["local-path", value]), "rejected");
  });
  var result = cp.spawnSync(executable, ["--output", "C:\\private\\*"], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 2);
  assert.doesNotMatch(result.stderr, /private|C:\\|HuGuoQing/);
});
