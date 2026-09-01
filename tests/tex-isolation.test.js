"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var childProcess = require("node:child_process");
var crypto = require("node:crypto");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");

var projectRoot = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function texIsolationDefinition() {
  var checkSet = JSON.parse(read("phase0/checks.json"));

  return checkSet.checks.find(function (check) {
    return check.id === "tex-isolation";
  });
}

function runSandboxRequest(t, overrides) {
  var workspace = fs.mkdtempSync(path.join(os.tmpdir(), "formulabridge-tex-request-"));
  var texRoot = path.join(workspace, "tex");
  var jobRoot = path.join(workspace, "job");
  var outputDirectory = path.join(jobRoot, "output");
  var enginePath = path.join(texRoot, "lualatex.exe");
  var inputPath = path.join(jobRoot, "input.tex");
  var requestPath = path.join(workspace, "request.json");

  fs.mkdirSync(texRoot, { recursive: true });
  fs.mkdirSync(outputDirectory, { recursive: true });
  var requestOverrides = Object.assign({}, overrides || {});
  if (requestOverrides.engineSource) {
    fs.copyFileSync(requestOverrides.engineSource, enginePath);
    delete requestOverrides.engineSource;
  } else {
    fs.writeFileSync(enginePath, "synthetic engine");
  }
  fs.writeFileSync(inputPath, "synthetic input");

  var request = Object.assign({
    schemaVersion: 1,
    enginePath: enginePath,
    texRoot: texRoot,
    engineSha256: crypto.createHash("sha256").update(fs.readFileSync(enginePath)).digest("hex"),
    jobRoot: jobRoot,
    inputPath: inputPath,
    outputDirectory: outputDirectory,
    mode: "interactive",
    testWallClockSeconds: 1
  }, requestOverrides);

  fs.writeFileSync(requestPath, JSON.stringify(request));
  t.after(function () {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  return childProcess.spawnSync(
    "dotnet",
    [
      "run",
      "--project",
      path.join(projectRoot, "src", "desktop", "FormulaBridge.TexSandbox"),
      "--",
      "run",
      "--request",
      requestPath
    ],
    { cwd: projectRoot, encoding: "utf8", windowsHide: true }
  );
}

function runApprovedSandboxRequest(t, sourceRelativePath, wallClockSeconds) {
  var workspace = fs.mkdtempSync(path.join(os.tmpdir(), "formulabridge-tex-live-"));
  var jobRoot = path.join(workspace, "job");
  var outputDirectory = path.join(jobRoot, "output");
  var inputPath = path.join(jobRoot, "input.tex");
  var requestPath = path.join(workspace, "request.json");

  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.copyFileSync(path.join(projectRoot, sourceRelativePath), inputPath);
  fs.writeFileSync(path.join(workspace, "outside-canary.txt"), "FORMULABRIDGE-CANARY");
  fs.writeFileSync(requestPath, JSON.stringify({
    schemaVersion: 1,
    enginePath: process.env.FORMULABRIDGE_TEX_ENGINE,
    texRoot: process.env.FORMULABRIDGE_TEX_ROOT,
    engineSha256: process.env.FORMULABRIDGE_TEX_ENGINE_SHA256,
    jobRoot: jobRoot,
    inputPath: inputPath,
    outputDirectory: outputDirectory,
    mode: "interactive",
    testWallClockSeconds: wallClockSeconds
  }));

  t.after(function () {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  var result = childProcess.spawnSync(
    "dotnet",
    [
      "run",
      "--project",
      path.join(projectRoot, "src", "desktop", "FormulaBridge.TexSandbox"),
      "--",
      "run",
      "--request",
      requestPath
    ],
    { cwd: projectRoot, encoding: "utf8", windowsHide: true, timeout: 120000 }
  );

  return { process: result, outputDirectory: outputDirectory };
}

test("the TeX sandbox CLI publishes the immutable security policy", { timeout: 120000 }, function () {
  var result = childProcess.spawnSync(
    "dotnet",
    [
      "run",
      "--project",
      path.join(projectRoot, "src", "desktop", "FormulaBridge.TexSandbox"),
      "--",
      "describe-policy"
    ],
    { cwd: projectRoot, encoding: "utf8", windowsHide: true }
  );

  assert.equal(result.status, 0, result.stderr);

  var policy = JSON.parse(result.stdout);

  assert.equal(policy.schemaVersion, 1);
  assert.equal(policy.supportedPlatform, "Windows 11 x64");
  assert.equal(policy.isolationIdentity, "AppContainer");
  assert.deepEqual(policy.networkCapabilities, []);
  assert.equal(policy.executableSource, "approved-local-profile");
  assert.equal(policy.useShellExecute, false);
  assert.equal(policy.shellEscape, false);
  assert.deepEqual(policy.readRoots, ["approved-tex-installation", "random-job"]);
  assert.deepEqual(policy.writeRoots, ["controlled-output"]);
  assert.equal(policy.rejectReparseRoots, true);
  assert.deepEqual(policy.jobLimits, [
    "active-process",
    "job-memory",
    "process-memory",
    "kill-on-close",
    "wall-clock"
  ]);
  assert.deepEqual(policy.ceilings, {
    inputBytes: 262144,
    interactiveSeconds: 30,
    batchItemSeconds: 120,
    memoryBytes: 1073741824,
    outputFiles: 64,
    outputBytes: 67108864,
    activeProcesses: 1
  });
});

test("the TeX sandbox rejects an executable outside the approved TeX installation", { timeout: 120000 }, function (t) {
  var outsideEngine = path.join(os.tmpdir(), "document-selected-lualatex.exe");
  var result = runSandboxRequest(t, { enginePath: outsideEngine });

  assert.equal(result.status, 2, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    schemaVersion: 1,
    status: "rejected",
    code: "engine-outside-approved-root"
  });
});

test("the TeX sandbox rejects a request that raises the product wall-clock ceiling", { timeout: 120000 }, function (t) {
  var result = runSandboxRequest(t, { testWallClockSeconds: 31 });

  assert.equal(result.status, 2, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    schemaVersion: 1,
    status: "rejected",
    code: "wall-clock-ceiling-exceeded"
  });
});

test("the Windows sandbox launches a suspended AppContainer and assigns its immutable Job Object before resume", {
  timeout: 120000,
  skip: process.platform !== "win32" || process.env.FORMULABRIDGE_RUN_APPCONTAINER_TESTS !== "1"
}, function (t) {
  var result = runSandboxRequest(t, { engineSource: process.env.ComSpec });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  var evidence = JSON.parse(result.stdout);
  assert.equal(evidence.status, "completed");
  assert.equal(evidence.appContainerApplied, true);
  assert.equal(evidence.networkCapabilityCount, 0);
  assert.equal(evidence.assignedToJobBeforeResume, true);
  assert.equal(evidence.engineIdentityVerified, true);
  assert.equal(evidence.engineIdentityStable, true);
  assert.equal(evidence.profileDeleted, true);
  assert.equal(evidence.aclRestored, true);
  assert.deepEqual(evidence.limits, {
    wallClockSeconds: 1,
    memoryBytes: 1073741824,
    outputFiles: 64,
    outputBytes: 67108864,
    activeProcesses: 1
  });
});

test("an approved LuaLaTeX process cannot read a canary outside the random job root", {
  timeout: 120000,
  skip: !process.env.FORMULABRIDGE_TEX_ENGINE ||
    !process.env.FORMULABRIDGE_TEX_ROOT ||
    !process.env.FORMULABRIDGE_TEX_ENGINE_SHA256
}, function (t) {
  var execution = runApprovedSandboxRequest(
    t,
    "corpus/phase0/malicious-tex/path-traversal.tex",
    30
  );

  assert.equal(execution.process.status, 0, execution.process.stderr || execution.process.stdout);

  var result = JSON.parse(execution.process.stdout);
  assert.equal(result.status, "completed");
  assert.equal(result.appContainerApplied, true);
  assert.equal(result.networkCapabilityCount, 0);
  assert.equal(result.assignedToJobBeforeResume, true);
  assert.equal(result.engineIdentityVerified, true);
  assert.equal(result.engineIdentityStable, true);
  assert.equal(result.profileDeleted, true);
  assert.equal(result.aclRestored, true);
  assert.equal(
    fs.readFileSync(path.join(execution.outputDirectory, "attack-result.txt"), "utf8"),
    "blocked"
  );
});

test("the Phase 0 provider blocks instead of weakening TeX isolation when configuration is absent", function (t) {
  var definition = texIsolationDefinition();
  var workspace = fs.mkdtempSync(path.join(os.tmpdir(), "formulabridge-tex-provider-"));
  var environmentKeys = [
    "FORMULABRIDGE_TEX_ENGINE",
    "FORMULABRIDGE_TEX_ROOT",
    "FORMULABRIDGE_TEX_ENGINE_SHA256"
  ];
  var previousEnvironment = {};

  t.after(function () {
    fs.rmSync(workspace, { recursive: true, force: true });
    environmentKeys.forEach(function (key) {
      if (previousEnvironment[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousEnvironment[key];
      }
    });
  });

  environmentKeys.forEach(function (key) {
    previousEnvironment[key] = process.env[key];
    delete process.env[key];
  });

  assert.equal(definition.provider, "tools/phase0-providers/tex-isolation.js");

  var provider = require(path.join(projectRoot, definition.provider));
  var result = provider.run({
    definition: definition,
    environment: { tex: { availability: "unavailable", reason: "No approved TeX installation" } },
    workspace: workspace,
    projectRoot: projectRoot,
    commit: "0".repeat(40)
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.id, "tex-isolation");
  assert.deepEqual(result.evidence.map(function (item) { return item.kind; }), ["result", "log"]);

  var evidenceResult = JSON.parse(fs.readFileSync(path.join(workspace, result.evidence[0].path), "utf8"));
  assert.equal(evidenceResult.status, "blocked");
  assert.deepEqual(
    evidenceResult.assertions.map(function (assertion) { return assertion.id; }),
    definition.requiredAssertions
  );
});

test("the versioned malicious TeX corpus covers every filesystem and LuaLaTeX network attack class", function () {
  var manifest = JSON.parse(read("corpus/phase0/manifest.json"));
  var maliciousEntries = manifest.entries.filter(function (entry) {
    return entry.category === "malicious-tex";
  });
  var attackIds = maliciousEntries.map(function (entry) { return entry.id; });

  assert.deepEqual(attackIds, [
    "malicious-tex.path-traversal",
    "malicious-tex.absolute-path",
    "malicious-tex.write-outside",
    "malicious-tex.environment-variable",
    "malicious-tex.search-path",
    "malicious-tex.link-and-reparse-point",
    "malicious-tex.lualatex-file-and-network",
    "malicious-tex.shell-and-process",
    "malicious-tex.resource-exhaustion",
    "malicious-tex.resource-output",
    "malicious-tex.resource-output-bytes",
    "malicious-tex.resource-memory"
  ]);

  maliciousEntries.forEach(function (entry) {
    var source = read(path.join("corpus", "phase0", entry.path));

    assert.equal(entry.mediaType, "application/x-tex");
    assert.match(source, /FORMULABRIDGE_ATTACK_RESULT/);
  });

  assert.match(read("corpus/phase0/malicious-tex/lualatex-file-and-network.tex"), /require,\s*["']socket["']/);
  assert.match(read("corpus/phase0/malicious-tex/resource-output.tex"), /os\.clock/);
  assert.match(read("corpus/phase0/malicious-tex/resource-output-bytes.tex"), /64 \* 1024 \* 1024/);
  assert.match(read("corpus/phase0/malicious-tex/resource-memory.tex"), /string\.rep/);
  assert.doesNotMatch(read("corpus/phase0/malicious-tex/shell-and-process.tex"), /second\s*==\s*["']exit["']/);
});

test("the smoke runner fails closed on ACL, profile cleanup, all resource ceilings, and UNC evidence", function () {
  var runner = read("tools/test-tex-isolation.ps1");

  assert.match(runner, /\$benign\.texAclExplicitlyGranted/);
  assert.match(runner, /\$caseCleanupSucceeded.*profileDeleted.*aclRestored/s);
  assert.match(runner, /resource-output-bytes/);
  assert.match(runner, /resource-memory/);
  assert.match(runner, /peakJobMemoryBytes/);
  assert.match(runner, /uncPathPattern/);
  assert.match(runner, /SymbolicLink/);
});

test("the TeX isolation spike documents repeatable build, smoke, evidence, and fail-closed boundaries", function () {
  var packageJson = JSON.parse(read("package.json"));
  var readme = read("README.md");
  var documentation = read("docs/tex-isolation-spike.md");
  var decision = read("docs/adr/0006-require-tex-filesystem-isolation.md");

  assert.equal(
    packageJson.scripts["tex:build"],
    "dotnet build src/desktop/FormulaBridge.TexSandbox/FormulaBridge.TexSandbox.csproj --configuration Release"
  );
  assert.equal(packageJson.scripts["tex:smoke"], "pwsh -NoProfile -File tools/test-tex-isolation.ps1");
  assert.match(packageJson.scripts.check, /FormulaBridge\.TexSandbox/);
  assert.match(packageJson.scripts.check, /tests\/tex-isolation\.test\.js/);
  assert.match(readme, /阶段 0 TeX 隔离样机/);
  assert.match(documentation, /Windows 11 x64/);
  assert.match(documentation, /AppContainer.*Job Object.*ACL/s);
  assert.match(documentation, /FORMULABRIDGE_TEX_ENGINE_SHA256/);
  assert.match(documentation, /evidence\/tex-isolation\/security-trace\/security-trace\.json/);
  assert.match(documentation, /不能.*passed/);
  assert.match(documentation, /Windows 运行库/);
  assert.match(documentation, /profile.*删除/is);
  assert.match(decision, /AppContainer/);
  assert.match(decision, /零网络 capability/);
  assert.match(decision, /挂起.*Job Object.*恢复线程/s);
  assert.match(decision, /Windows 运行库/);
  assert.match(decision, /profile.*删除/is);
  assert.match(decision, /本地 TeX 路径.*不得发布/);
});
