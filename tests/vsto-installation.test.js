"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");

var projectRoot = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("the VSTO installer is x64, per-user, and registers Word auto-load without document access", function () {
  var installer = read("installer/FormulaBridge.Installer/Package.wxs");

  assert.match(installer, /<Package[^>]+Scope="perUser"/);
  assert.match(installer, /Bitness="always64"/);
  assert.match(installer, /Root="HKCU"/);
  assert.match(installer, /Software\\Microsoft\\Office\\Word\\Addins\\FormulaBridge\.WordAddIn/);
  assert.match(installer, /Name="LoadBehavior"[^>]+Type="integer"[^>]+Value="3"/);
  assert.match(installer, /Name="Manifest"[^>]+file:\/\/\/.+FormulaBridge\.WordAddIn\.vsto\|vstolocal/);
  assert.doesNotMatch(installer, /Root="HKLM"|ALLUSERS|ProgramFilesFolder|CommonFilesFolder/i);
  assert.doesNotMatch(installer, /PersonalFolder|MyDocuments|DocumentsFolder/i);
  assert.match(installer, /RemoveFolder[^>]+Directory="FormulaBridgeProgramsFolder"[^>]+On="uninstall"/);
  assert.match(installer, /RemoveFile[^>]+Name="word-load-state\.json\.\*\.tmp"[^>]+On="uninstall"/);
});

test("the Word add-in publishes a signed VSTO Ribbon and an external load-state signal", function () {
  var project = read("src/desktop/FormulaBridge.WordAddIn/FormulaBridge.WordAddIn.csproj");
  var addIn = read("src/desktop/FormulaBridge.WordAddIn/ThisAddIn.cs");
  var ribbonCode = read("src/desktop/FormulaBridge.WordAddIn/FormulaBridgeRibbon.cs");
  var ribbonXml = read("src/desktop/FormulaBridge.WordAddIn/FormulaBridgeRibbon.xml");
  var loadState = read("src/desktop/FormulaBridge.WordAddIn/WordLoadState.cs");

  assert.match(project, /<TargetFrameworkVersion>v4\.8<\/TargetFrameworkVersion>/);
  assert.match(project, /<PlatformTarget>x64<\/PlatformTarget>/);
  assert.match(project, /<SignManifests>true<\/SignManifests>/);
  assert.match(project, /Microsoft\.VisualStudio\.Tools\.Office\.targets/);
  assert.match(addIn, /CreateRibbonExtensibilityObject/);
  assert.match(addIn, /WordLoadState\.RecordStopped/);
  assert.doesNotMatch([addIn, ribbonCode, loadState].join("\n"), /ActiveDocument|Documents\.|Documents\[/);
  assert.match(ribbonXml, /<tab id="FormulaBridge\.Tab" label="FormulaBridge">/);
  assert.match(ribbonXml, /onLoad="Ribbon_Load"/);
  assert.match(ribbonCode, /Ribbon_Load/);
  assert.match(ribbonCode, /WordLoadState\.RecordRibbonLoaded/);
  assert.match(loadState, /LocalApplicationData/);
  assert.match(loadState, /word-load-state\.json/);
});

test("external diagnostics report registration, prerequisites, policy, and Ribbon load without documents", function () {
  var project = read("src/desktop/FormulaBridge.Diagnostics/FormulaBridge.Diagnostics.csproj");
  var program = read("src/desktop/FormulaBridge.Diagnostics/Program.cs");
  var diagnostics = read("src/desktop/FormulaBridge.Diagnostics/VstoDiagnostics.cs") + read("src/desktop/FormulaBridge.Diagnostics/WindowsDiagnosticProbe.cs");

  assert.match(project, /<TargetFrameworkVersion>v4\.8<\/TargetFrameworkVersion>/);
  assert.match(project, /<OutputType>Exe<\/OutputType>/);
  assert.ok(diagnostics.includes("Software\\\\Microsoft\\\\Office\\\\Word\\\\Addins\\\\FormulaBridge.WordAddIn"));
  assert.match(diagnostics, /VSTO Runtime Setup/);
  assert.match(diagnostics, /Resiliency/);
  assert.match(diagnostics, /DisabledItems/);
  assert.match(diagnostics, /Encoding\.Unicode/);
  assert.match(diagnostics, /DisabledItemCount\s*>\s*0/);
  assert.match(diagnostics, /opaque DisabledItems entr/);
  assert.match(diagnostics, /word-load-state\.json/);
  assert.match(diagnostics, /ribbonLoadedAt/);
  assert.match(program, /--output/);
  assert.match(program, /Console\.Out\.Write/);
  assert.doesNotMatch([program, diagnostics].join("\n"), /ActiveDocument|Documents\.|Documents\[|MyDocuments|PersonalFolder/);
});

test("the build pipeline signs and verifies every FormulaBridge deployment artifact with explicit trust level", function () {
  var build = read("tools/build-vsto-installation.ps1");

  assert.match(build, /ValidateSet\("test", "production"\)/);
  assert.match(build, /CertificateThumbprint/);
  assert.match(build, /ManifestCertificateThumbprint/);
  assert.match(build, /MSBuild\.exe/);
  assert.match(build, /"\/p:PublishDir=\$publishDirectory\\"/);
  assert.doesNotMatch(build, /"\/p:PublishUrl=\$publishDirectory\\"/);
  assert.match(build, /Microsoft\.VisualStudio\.Tools\.Office\.targets/);
  assert.match(build, /mage(?:\.exe)?[\s\S]+-Update/);
  assert.match(build, /mage(?:\.exe)?[\s\S]+-Verify/);
  assert.match(build, /\$payloadApplicationManifest\s*=\s*Join-Path\s+\$payloadDirectory/);
  assert.match(build, /\$payloadDeploymentManifest\s*=\s*Join-Path\s+\$payloadDirectory/);
  assert.match(build, /\$manifestFilesDirectory\s*=\s*Join-Path\s+\$resolvedOutputDirectory/);
  assert.match(build, /"-FromDirectory",\s*\$manifestFilesDirectory/);
  assert.doesNotMatch(build, /"-FromDirectory",\s*\$addInPublishDirectory/);
  assert.match(build, /signtool(?:\.exe)?[\s\S]+sign/);
  assert.match(build, /signtool(?:\.exe)?[\s\S]+verify/);
  assert.match(build, /wix(?:\.exe)?[\s\S]+build/);
  assert.match(build, /build-metadata\.json/);
  assert.match(build, /production[\s\S]+TimestampUrl/);
  assert.doesNotMatch(build, /New-SelfSignedCertificate|Import-Certificate|RunAs|Verb\s+runas|Start-Process[^\n]+-Verb/i);
});

test("the smoke runner covers the installation lifecycle and emits the pinned VSTO evidence contract", function () {
  var smoke = read("tools/test-vsto-installation.ps1") + read("tools/vsto-diagnostics-smoke.ps1");
  var checkSet = JSON.parse(read("phase0/checks.json"));
  var definition = checkSet.checks.find(function (check) {
    return check.id === "vsto-installation";
  });

  assert.ok(definition);
  definition.requiredAssertions.forEach(function (assertionId) {
    assert.ok(smoke.includes('"' + assertionId + '"'), assertionId);
  });
  assert.match(smoke, /msiexec\.exe/);
  assert.match(smoke, /Get-MsiProductState/);
  assert.match(smoke, /Get-MsiRelatedProducts/);
  assert.match(smoke, /"UpgradeCode"/);
  assert.match(smoke, /Clean-install preflight/);
  assert.match(smoke, /WindowsPrincipal/);
  assert.match(smoke, /WindowsBuiltInRole\]::Administrator/);
  assert.match(smoke, /clean-install/);
  assert.match(smoke, /repeated-install/);
  assert.match(smoke, /repair/);
  assert.match(smoke, /uninstall/);
  assert.match(smoke, /Word\.Application/);
  assert.match(smoke, /COMAddIns/);
  assert.match(smoke, /UIAutomationClient/);
  assert.match(smoke, /ControlType\]::TabItem/);
  assert.match(smoke, /Get-FileHash/);
  assert.match(smoke, /RegistryHive\]::CurrentUser/);
  assert.match(smoke, /RegistryHive\]::LocalMachine/);
  assert.match(smoke, /signature-report/);
  assert.match(smoke, /Build metadata signer does not match/);
  assert.match(smoke, /Build metadata commit does not match/);
  assert.match(smoke, /certificate\.thumbprint/);
  assert.match(smoke, /word-load-state/);
  assert.match(smoke, /diagnostics-report/);
  assert.match(smoke, /evidence\/vsto-installation\/result\/result\.json/);
  assert.match(smoke, /programFilesAfterUninstall/);
  assert.match(smoke, /Uninstall left program files/);
  assert.match(smoke, /Assert-MsiDocumentPrivacyContract/);
  assert.match(smoke, /CustomAction/);
  assert.match(smoke, /Archive-RawMsiLogs/);
  assert.match(smoke, /returnValue3Count/);
  assert.match(smoke, /MachineName/);
  assert.match(smoke, /UserDomainName/);
  assert.match(smoke, /Windows absolute path/);
  assert.doesNotMatch(smoke, /Add-Content[^\n]+Get-Content[^\n]+rawMsiLog/);
  assert.match(smoke, /finally\s*\{[\s\S]+Archive-RawMsiLogs[\s\S]+Remove-Item/s);
  assert.doesNotMatch(smoke, /Verb\s+RunAs/i);
});

test("the VSTO spike documents repeatable build, smoke, trust, and evidence entry points", function () {
  var packageJson = JSON.parse(read("package.json"));
  var readme = read("README.md");
  var documentation = read("docs/vsto-installation-spike.md");

  assert.equal(packageJson.scripts["vsto:build"], "pwsh -NoProfile -File tools/build-vsto-installation.ps1");
  assert.equal(packageJson.scripts["vsto:smoke"], "pwsh -NoProfile -File tools/test-vsto-installation.ps1");
  assert.match(packageJson.scripts.check, /tests\/vsto-installation\.test\.js/);
  assert.match(readme, /阶段 0 VSTO 安装样机/);
  assert.match(documentation, /Visual Studio 2022/);
  assert.match(documentation, /WiX Toolset 4/);
  assert.match(documentation, /test.*production/s);
  assert.match(documentation, /clean install.*repeated install.*repair.*uninstall/is);
  assert.match(documentation, /evidence\/vsto-installation\/result\/result\.json/);
  assert.match(documentation, /FORMULABRIDGE_VSTO_INSTALLER/);
  assert.match(documentation, /phase0 -- execute --input/);
  assert.match(documentation, /不能.*passed/);
  assert.match(documentation, /不扫描或修改用户文档/);
});

test("the Phase 0 execute entry point registers VSTO smoke and reports missing real artifacts as blocked", function (t) {
  var checkSet = JSON.parse(read("phase0/checks.json"));
  var providerSource = read("tools/phase0-providers/vsto-installation.js");
  var definition = checkSet.checks.find(function (check) {
    return check.id === "vsto-installation";
  });
  var workspace = fs.mkdtempSync(path.join(os.tmpdir(), "formulabridge-vsto-provider-"));
  var environmentKeys = [
    "FORMULABRIDGE_VSTO_INSTALLER",
    "FORMULABRIDGE_VSTO_BUILD_METADATA",
    "FORMULABRIDGE_VSTO_TRUST_LEVEL"
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

  assert.equal(definition.provider, "tools/phase0-providers/vsto-installation.js");
  assert.match(providerSource, /"-ExpectedCommit",\s*context\.commit/);

  var provider = require(path.join(projectRoot, definition.provider));
  var result = provider.run({
    definition: definition,
    environment: { signing: { availability: "unavailable", reason: "No signed spike artifact" } },
    workspace: workspace,
    projectRoot: projectRoot
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.id, "vsto-installation");
  assert.deepEqual(result.evidence.map(function (item) { return item.kind; }), ["result", "log"]);
  result.evidence.forEach(function (item) {
    assert.equal(fs.existsSync(path.join(workspace, item.path)), true);
  });

  var evidenceResult = JSON.parse(fs.readFileSync(path.join(workspace, result.evidence[0].path), "utf8"));
  assert.equal(evidenceResult.status, "blocked");
  assert.deepEqual(evidenceResult.assertions.map(function (assertion) { return assertion.id; }), definition.requiredAssertions);
});
