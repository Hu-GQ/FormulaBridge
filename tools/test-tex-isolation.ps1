[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$EnginePath,

    [Parameter(Mandatory = $true)]
    [string]$TexRoot,

    [Parameter(Mandatory = $true)]
    [ValidatePattern("^[0-9A-Fa-f]{64}$")]
    [string]$ExpectedEngineSha256,

    [Parameter(Mandatory = $true)]
    [string]$EvidenceDirectory,

    [Parameter(Mandatory = $true)]
    [ValidatePattern("^[0-9a-f]{40}$")]
    [string]$ExpectedCommit
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$sandboxProject = Join-Path $projectRoot "src\desktop\FormulaBridge.TexSandbox\FormulaBridge.TexSandbox.csproj"
$sandboxExecutable = Join-Path $projectRoot "src\desktop\FormulaBridge.TexSandbox\bin\Release\net10.0-windows\FormulaBridge.TexSandbox.exe"
$corpusRoot = Join-Path $projectRoot "corpus\phase0"
$resolvedEvidenceDirectory = [IO.Path]::GetFullPath($EvidenceDirectory)
$evidenceRoot = Join-Path $resolvedEvidenceDirectory "evidence\tex-isolation"
$resultRelativePath = "evidence/tex-isolation/result/result.json"
$logRelativePath = "evidence/tex-isolation/log/smoke.log"
$securityTraceRelativePath = "evidence/tex-isolation/security-trace/security-trace.json"
$resourceReportRelativePath = "evidence/tex-isolation/resource-report/resource-report.json"
$resultPath = Join-Path $resolvedEvidenceDirectory $resultRelativePath
$logPath = Join-Path $resolvedEvidenceDirectory $logRelativePath
$securityTracePath = Join-Path $resolvedEvidenceDirectory $securityTraceRelativePath
$resourceReportPath = Join-Path $resolvedEvidenceDirectory $resourceReportRelativePath
$fragmentPath = Join-Path $resolvedEvidenceDirectory "check-fragment.json"
$startedAt = [DateTime]::UtcNow.ToString("o")
$workspace = Join-Path ([IO.Path]::GetTempPath()) ("formulabridge-tex-smoke-" + [Guid]::NewGuid().ToString("N"))
$outsideRoot = Join-Path ([IO.Path]::GetTempPath()) ("formulabridge-tex-outside-" + [Guid]::NewGuid().ToString("N"))
$canaryPath = Join-Path $outsideRoot "outside-canary.txt"
$jobDirectories = [Collections.Generic.List[string]]::new()
$reparseLinks = [Collections.Generic.List[string]]::new()
$securityCases = [Collections.Generic.List[object]]::new()
$resourceCases = [Collections.Generic.List[object]]::new()
$cleanupSucceeded = $false
$preflightSucceeded = $false
$mechanismReady = $false
$originalOutsideCanary = $env:FORMULABRIDGE_OUTSIDE_CANARY
$originalTexInputs = $env:TEXINPUTS
$assertionOrder = @(
    "approved-read-write-roots",
    "filesystem-escape-resistance",
    "lualatex-file-and-network-resistance",
    "network-blocking",
    "immutable-executable-and-policy",
    "job-cleanup-and-evidence-privacy",
    "resource-and-process-limits"
)
$assertions = [ordered]@{}

foreach ($assertionId in $assertionOrder) {
    $assertions[$assertionId] = [ordered]@{
        id = $assertionId
        status = "not-run"
        reason = "The TeX isolation smoke has not evaluated this assertion"
    }
}

function Set-Assertion {
    param(
        [string]$Id,
        [ValidateSet("passed", "failed", "blocked", "not-run")]
        [string]$Status,
        [string]$Reason
    )

    $value = [ordered]@{ id = $Id; status = $Status }
    if ($Status -ne "passed") {
        $value.reason = $Reason
    }
    $script:assertions[$Id] = $value
}

function Write-EvidenceJson {
    param([string]$Path, [object]$Value)

    $parent = Split-Path -Parent $Path
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    $Value | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $Path -Encoding utf8NoBOM
}

function Write-SmokeLog {
    param([string]$Message)

    $safeMessage = [Text.RegularExpressions.Regex]::Replace(
        $Message,
        "(?i)[A-Z]:\\[^\r\n]+",
        "<redacted-path>")
    $safeMessage = $safeMessage.Replace([Environment]::UserName, "<redacted-user>")
    Add-Content -LiteralPath $logPath -Value (([DateTime]::UtcNow.ToString("o")) + " " + $safeMessage) -Encoding utf8
}

function Test-PathInside {
    param([string]$Root, [string]$Candidate)

    $resolvedRoot = [IO.Path]::TrimEndingDirectorySeparator([IO.Path]::GetFullPath($Root))
    $resolvedCandidate = [IO.Path]::GetFullPath($Candidate)
    $relative = [IO.Path]::GetRelativePath($resolvedRoot, $resolvedCandidate)
    return $relative -ne ".." -and
        -not $relative.StartsWith(".." + [IO.Path]::DirectorySeparatorChar, [StringComparison]::Ordinal) -and
        -not [IO.Path]::IsPathRooted($relative)
}

function Get-OverallStatus {
    $statuses = @($script:assertionOrder | ForEach-Object { $script:assertions[$_].status })
    if ($statuses -contains "failed") { return "failed" }
    if ($statuses -contains "blocked") { return "blocked" }
    if ($statuses -contains "not-run") { return "not-run" }
    return "passed"
}

function Get-CaseSource {
    param([string]$RelativePath)

    $sourcePath = Join-Path $corpusRoot $RelativePath
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
        throw "Versioned corpus source is unavailable"
    }
    return Get-Content -LiteralPath $sourcePath -Raw
}

function Invoke-TexCase {
    param(
        [string]$Id,
        [string]$CorpusPath,
        [int]$WallClockSeconds = 30,
        [switch]$CreateTraversalCanary,
        [switch]$CreateOutsideLink,
        [switch]$InjectAbsoluteCanary,
        [switch]$InjectNetworkListener,
        [switch]$ResourceCase
    )

    $caseRoot = Join-Path $workspace ("case-" + $Id)
    $jobRoot = Join-Path $caseRoot "job"
    $outputDirectory = Join-Path $jobRoot "output"
    $inputPath = Join-Path $jobRoot "input.tex"
    $requestPath = Join-Path $caseRoot "request.json"
    $listener = $null
    $acceptResult = $null
    $listenerConnected = $false

    New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
    $jobDirectories.Add($caseRoot)
    $source = Get-CaseSource $CorpusPath

    if ($CreateTraversalCanary) {
        Set-Content -LiteralPath (Join-Path $caseRoot "outside-canary.txt") -Value "FORMULABRIDGE-CANARY" -Encoding utf8NoBOM
    }
    if ($CreateOutsideLink) {
        $linksRoot = Join-Path $jobRoot "links"
        $outsideLink = Join-Path $linksRoot "outside"
        New-Item -ItemType Directory -Path $linksRoot -Force | Out-Null
        New-Item -ItemType Junction -Path $outsideLink -Target $outsideRoot | Out-Null
        $reparseLinks.Add($outsideLink)
    }
    if ($InjectAbsoluteCanary) {
        if ($canaryPath.Contains("]]", [StringComparison]::Ordinal)) {
            throw "Generated canary path cannot be embedded safely"
        }
        $source = $source.Replace("@@ABSOLUTE_CANARY@@", $canaryPath)
    }
    if ($InjectNetworkListener) {
        $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
        $listener.Start()
        $listenerPort = ([Net.IPEndPoint]$listener.LocalEndpoint).Port
        $acceptResult = $listener.BeginAcceptTcpClient($null, $null)
        $source = $source.Replace("@@LISTENER_PORT@@", $listenerPort.ToString([Globalization.CultureInfo]::InvariantCulture))
    }

    Set-Content -LiteralPath $inputPath -Value $source -Encoding utf8NoBOM
    $request = [ordered]@{
        schemaVersion = 1
        enginePath = [IO.Path]::GetFullPath($EnginePath)
        texRoot = [IO.Path]::GetFullPath($TexRoot)
        engineSha256 = $ExpectedEngineSha256.ToLowerInvariant()
        jobRoot = $jobRoot
        inputPath = $inputPath
        outputDirectory = $outputDirectory
        mode = "interactive"
        testWallClockSeconds = $WallClockSeconds
    }
    Write-EvidenceJson -Path $requestPath -Value $request

    $nativeOutput = @(& $sandboxExecutable run --request $requestPath 2>$null) -join [Environment]::NewLine
    $nativeExitCode = $LASTEXITCODE
    try {
        $runner = $nativeOutput | ConvertFrom-Json -Depth 20
    }
    catch {
        $runner = [pscustomobject]@{
            status = "failed"
            code = "invalid-sandbox-result"
            exitCode = $null
            timedOut = $false
            outputLimitExceeded = $false
            appContainerApplied = $false
            networkCapabilityCount = -1
            assignedToJobBeforeResume = $false
            engineIdentityVerified = $false
            engineIdentityStable = $false
            profileDeleted = $false
            aclRestored = $false
            texAclExplicitlyGranted = $false
            limits = $null
        }
    }

    if ($acceptResult) {
        $listenerConnected = $acceptResult.AsyncWaitHandle.WaitOne(0)
        if ($listenerConnected) {
            $client = $listener.EndAcceptTcpClient($acceptResult)
            $client.Dispose()
        }
        $acceptResult.AsyncWaitHandle.Dispose()
        $listener.Stop()
    }

    $markerPath = Join-Path $outputDirectory "attack-result.txt"
    $marker = if (Test-Path -LiteralPath $markerPath -PathType Leaf) {
        (Get-Content -LiteralPath $markerPath -Raw).Trim()
    } else {
        "missing"
    }
    $producedPdf = @(Get-ChildItem -LiteralPath $outputDirectory -Filter "*.pdf" -File -ErrorAction SilentlyContinue).Count -gt 0
    $shellArtifact = (Test-Path -LiteralPath (Join-Path $outputDirectory "shell-escape.txt")) -or
        (Test-Path -LiteralPath (Join-Path $outputDirectory "process-escape.txt"))

    $caseEvidence = [ordered]@{
        id = $Id
        runnerStatus = $runner.status
        runnerCode = $runner.code
        nativeExitCode = $nativeExitCode
        texExitCode = $runner.exitCode
        marker = $marker
        producedPdf = $producedPdf
        listenerConnected = $listenerConnected
        shellOrProcessArtifact = $shellArtifact
        appContainerApplied = $runner.appContainerApplied
        networkCapabilityCount = $runner.networkCapabilityCount
        assignedToJobBeforeResume = $runner.assignedToJobBeforeResume
        engineIdentityVerified = $runner.engineIdentityVerified
        engineIdentityStable = $runner.engineIdentityStable
        profileDeleted = $runner.profileDeleted
        aclRestored = $runner.aclRestored
        texAclExplicitlyGranted = $runner.texAclExplicitlyGranted
    }
    if ($ResourceCase) {
        $caseEvidence.timedOut = $runner.timedOut
        $caseEvidence.outputLimitExceeded = $runner.outputLimitExceeded
        $caseEvidence.limits = $runner.limits
        $resourceCases.Add([pscustomobject]$caseEvidence)
    } else {
        $securityCases.Add([pscustomobject]$caseEvidence)
    }

    Write-SmokeLog ("Completed probe " + $Id + " with " + $runner.status + "/" + $runner.code)
    return [pscustomobject]$caseEvidence
}

New-Item -ItemType Directory -Path (Split-Path -Parent $logPath) -Force | Out-Null
Set-Content -LiteralPath $logPath -Value "" -Encoding utf8NoBOM
Write-SmokeLog "Starting TeX isolation smoke"

try {
    if (-not $IsWindows) {
        throw "The TeX isolation smoke requires Windows"
    }
    if ([Environment]::OSVersion.Version.Build -lt 22000 -or
        [Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne [Runtime.InteropServices.Architecture]::X64) {
        throw "The TeX isolation smoke requires the supported Windows 11 x64 platform"
    }
    if ([IO.Path]::GetFileName($EnginePath) -ine "lualatex.exe") {
        throw "The Phase 0 isolation spike requires an explicitly approved lualatex.exe"
    }
    if (-not (Test-Path -LiteralPath $EnginePath -PathType Leaf) -or
        -not (Test-Path -LiteralPath $TexRoot -PathType Container)) {
        throw "The approved TeX installation is unavailable"
    }
    if (-not (Test-PathInside -Root $TexRoot -Candidate $EnginePath)) {
        throw "The approved engine must stay inside the approved TeX installation"
    }
    $actualEngineSha256 = (Get-FileHash -LiteralPath $EnginePath -Algorithm SHA256).Hash
    if ($actualEngineSha256 -ine $ExpectedEngineSha256) {
        throw "The approved engine identity does not match"
    }
    if ((git -C $projectRoot rev-parse HEAD 2>$null) -ne $ExpectedCommit) {
        throw "The checked out commit does not match the execution manifest"
    }

    New-Item -ItemType Directory -Path $workspace, $outsideRoot -Force | Out-Null
    Set-Content -LiteralPath $canaryPath -Value "FORMULABRIDGE-CANARY" -Encoding utf8NoBOM
    $env:FORMULABRIDGE_OUTSIDE_CANARY = $canaryPath
    $env:TEXINPUTS = $outsideRoot + [IO.Path]::PathSeparator

    & dotnet build $sandboxProject --configuration Release --nologo *> $null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $sandboxExecutable -PathType Leaf)) {
        throw "The TeX sandbox helper did not build"
    }
    $preflightSucceeded = $true
    Write-SmokeLog "Preflight and sandbox helper build succeeded"

    $benign = Invoke-TexCase -Id "benign" -CorpusPath "formula\benign-lualatex.tex"
    $mechanismReady = $benign.runnerStatus -eq "completed" -and
        $benign.texExitCode -eq 0 -and
        $benign.producedPdf -and
        $benign.appContainerApplied -and
        $benign.networkCapabilityCount -eq 0 -and
        $benign.assignedToJobBeforeResume -and
        $benign.engineIdentityVerified -and
        $benign.engineIdentityStable -and
        $benign.profileDeleted -and
        $benign.aclRestored

    if ($mechanismReady) {
        Set-Assertion "approved-read-write-roots" "passed" ""
        $pathTraversal = Invoke-TexCase -Id "path-traversal" -CorpusPath "malicious-tex\path-traversal.tex" -CreateTraversalCanary
        $absolutePath = Invoke-TexCase -Id "absolute-path" -CorpusPath "malicious-tex\absolute-path.tex" -InjectAbsoluteCanary
        $environmentVariable = Invoke-TexCase -Id "environment-variable" -CorpusPath "malicious-tex\environment-variable.tex"
        $searchPath = Invoke-TexCase -Id "search-path" -CorpusPath "malicious-tex\search-path.tex"
        $linkReparse = Invoke-TexCase -Id "link-reparse" -CorpusPath "malicious-tex\link-and-reparse-point.tex" -CreateOutsideLink
        $luaFileNetwork = Invoke-TexCase -Id "lualatex-file-network" -CorpusPath "malicious-tex\lualatex-file-and-network.tex" -InjectAbsoluteCanary -InjectNetworkListener
        $shellProcess = Invoke-TexCase -Id "shell-process" -CorpusPath "malicious-tex\shell-and-process.tex"
        $resourceTimeout = Invoke-TexCase -Id "resource-timeout" -CorpusPath "malicious-tex\resource-exhaustion.tex" -WallClockSeconds 2 -ResourceCase
        $resourceOutput = Invoke-TexCase -Id "resource-output" -CorpusPath "malicious-tex\resource-output.tex" -ResourceCase

        $filesystemCases = @($pathTraversal, $absolutePath, $environmentVariable, $searchPath, $linkReparse)
        if (@($filesystemCases | Where-Object { $_.runnerStatus -ne "completed" -or $_.marker -ne "blocked" }).Count -eq 0) {
            Set-Assertion "filesystem-escape-resistance" "passed" ""
        } else {
            Set-Assertion "filesystem-escape-resistance" "failed" "At least one filesystem escape probe was not blocked"
        }
        if ($luaFileNetwork.runnerStatus -eq "completed" -and $luaFileNetwork.marker -eq "blocked" -and -not $luaFileNetwork.listenerConnected) {
            Set-Assertion "lualatex-file-and-network-resistance" "passed" ""
        } else {
            Set-Assertion "lualatex-file-and-network-resistance" "failed" "The LuaLaTeX file/network probe did not demonstrate both blocks"
        }
        if ($luaFileNetwork.networkCapabilityCount -eq 0 -and -not $luaFileNetwork.listenerConnected) {
            Set-Assertion "network-blocking" "passed" ""
        } else {
            Set-Assertion "network-blocking" "failed" "The sandbox exposed a network capability or reached the controlled listener"
        }
        $immutableCases = @($securityCases)
        if (@($immutableCases | Where-Object {
            -not $_.engineIdentityVerified -or -not $_.engineIdentityStable -or
            -not $_.assignedToJobBeforeResume -or $_.networkCapabilityCount -ne 0
        }).Count -eq 0 -and $shellProcess.marker -eq "blocked" -and -not $shellProcess.shellOrProcessArtifact) {
            Set-Assertion "immutable-executable-and-policy" "passed" ""
        } else {
            Set-Assertion "immutable-executable-and-policy" "failed" "An executable identity, fixed policy, shell, or child-process probe failed"
        }
        if ($resourceTimeout.runnerStatus -eq "terminated" -and $resourceTimeout.timedOut -and
            $resourceOutput.runnerStatus -eq "terminated" -and $resourceOutput.outputLimitExceeded -and
            -not $shellProcess.shellOrProcessArtifact) {
            Set-Assertion "resource-and-process-limits" "passed" ""
        } else {
            Set-Assertion "resource-and-process-limits" "failed" "Wall-clock, output, or single-process enforcement was not observed"
        }
    } else {
        Set-Assertion "approved-read-write-roots" "failed" "A benign LuaLaTeX formula could not run under the required AppContainer/Job/ACL policy"
        Set-Assertion "filesystem-escape-resistance" "not-run" "The isolation mechanism failed before adversarial filesystem probes"
        Set-Assertion "lualatex-file-and-network-resistance" "not-run" "The isolation mechanism failed before the LuaLaTeX combined probe"
        Set-Assertion "network-blocking" "not-run" "The isolation mechanism failed before the network probe"
        Set-Assertion "immutable-executable-and-policy" "failed" "The required immutable sandbox policy could not launch the approved engine"
        Set-Assertion "resource-and-process-limits" "not-run" "The isolation mechanism failed before resource probes"
    }
}
catch {
    Write-SmokeLog ("Preflight failed: " + $_.Exception.Message)
    if (-not $preflightSucceeded) {
        Set-Assertion "approved-read-write-roots" "blocked" "The TeX isolation preflight could not establish a runnable approved engine"
        foreach ($assertionId in $assertionOrder | Select-Object -Skip 1) {
            if ($assertionId -ne "job-cleanup-and-evidence-privacy") {
                Set-Assertion $assertionId "not-run" "The blocked preflight prevented this assertion"
            }
        }
    } else {
        Set-Assertion "approved-read-write-roots" "failed" "The TeX isolation smoke failed after preflight"
    }
}
finally {
    $env:FORMULABRIDGE_OUTSIDE_CANARY = $originalOutsideCanary
    $env:TEXINPUTS = $originalTexInputs
    foreach ($link in @($reparseLinks)) {
        if (Test-Path -LiteralPath $link) {
            Remove-Item -LiteralPath $link -Force -ErrorAction SilentlyContinue
        }
    }
    foreach ($directory in @($jobDirectories)) {
        if (Test-Path -LiteralPath $directory) {
            Remove-Item -LiteralPath $directory -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
    if (Test-Path -LiteralPath $workspace) {
        Remove-Item -LiteralPath $workspace -Recurse -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $outsideRoot) {
        Remove-Item -LiteralPath $outsideRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
    $cleanupSucceeded = -not (Test-Path -LiteralPath $workspace) -and -not (Test-Path -LiteralPath $outsideRoot)
}

$securityTrace = [ordered]@{
    schemaVersion = 1
    commit = $ExpectedCommit
    mechanism = "AppContainer + Job Object + filesystem ACL + TeX policy"
    networkCapabilities = @()
    cases = @($securityCases)
}
$resourceReport = [ordered]@{
    schemaVersion = 1
    ceilings = [ordered]@{
        inputBytes = 262144
        interactiveSeconds = 30
        batchItemSeconds = 120
        memoryBytes = 1073741824
        outputFiles = 64
        outputBytes = 67108864
        activeProcesses = 1
    }
    cases = @($resourceCases)
}
Write-EvidenceJson -Path $securityTracePath -Value $securityTrace
Write-EvidenceJson -Path $resourceReportPath -Value $resourceReport

$privacyText = @(
    Get-Content -LiteralPath $logPath -Raw
    ($securityTrace | ConvertTo-Json -Depth 20)
    ($resourceReport | ConvertTo-Json -Depth 20)
) -join "`n"
$containsSensitivePath = [Text.RegularExpressions.Regex]::IsMatch($privacyText, "(?i)[A-Z]:\\") -or
    $privacyText.Contains([Environment]::UserName, [StringComparison]::OrdinalIgnoreCase) -or
    $privacyText.Contains($env:USERPROFILE, [StringComparison]::OrdinalIgnoreCase)
if ($cleanupSucceeded -and -not $containsSensitivePath) {
    Set-Assertion "job-cleanup-and-evidence-privacy" "passed" ""
} else {
    Set-Assertion "job-cleanup-and-evidence-privacy" "failed" "Temporary job cleanup or evidence privacy validation failed"
}

$overallStatus = Get-OverallStatus
$result = [ordered]@{
    schemaVersion = 1
    checkId = "tex-isolation"
    status = $overallStatus
    assertions = @($assertionOrder | ForEach-Object { [pscustomobject]$assertions[$_] })
}
Write-EvidenceJson -Path $resultPath -Value $result
Write-SmokeLog ("Finished TeX isolation smoke with status " + $overallStatus)

$evidence = @(
    [ordered]@{ path = $resultRelativePath; kind = "result" }
    [ordered]@{ path = $logRelativePath; kind = "log" }
    [ordered]@{ path = $securityTraceRelativePath; kind = "security-trace" }
    [ordered]@{ path = $resourceReportRelativePath; kind = "resource-report" }
)
$fragment = [ordered]@{
    id = "tex-isolation"
    name = "TeX isolation and resource limits"
    status = $overallStatus
    startedAt = $startedAt
    finishedAt = [DateTime]::UtcNow.ToString("o")
    evidence = $evidence
}
if ($overallStatus -ne "passed") {
    $fragment.reason = "The TeX isolation smoke did not satisfy every required assertion"
}
Write-EvidenceJson -Path $fragmentPath -Value $fragment

if ($overallStatus -eq "passed") { exit 0 }
exit 1
