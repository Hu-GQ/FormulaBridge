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
$lifecycleReportRelativePath = "evidence/tex-isolation/lifecycle-report/lifecycle-report.json"
$lifecycleReportPath = Join-Path $resolvedEvidenceDirectory $lifecycleReportRelativePath
$resourceReportPath = Join-Path $resolvedEvidenceDirectory $resourceReportRelativePath
$fragmentPath = Join-Path $resolvedEvidenceDirectory "check-fragment.json"
$startedAt = [DateTime]::UtcNow.ToString("o")
$workspace = Join-Path ([IO.Path]::GetTempPath()) ("formulabridge-tex-smoke-" + [Guid]::NewGuid().ToString("N"))
$outsideRoot = Join-Path ([IO.Path]::GetTempPath()) ("formulabridge-tex-outside-" + [Guid]::NewGuid().ToString("N"))
$canaryPath = Join-Path $outsideRoot "outside-canary.txt"
$outsideWritePath = Join-Path $outsideRoot "escaped-write.txt"
$uncPathPattern = '(?i)\\\\[^\\\r\n\s]+\\[^\r\n]+'
$jobDirectories = [Collections.Generic.List[string]]::new()
$reparseLinks = [Collections.Generic.List[string]]::new()
$securityCases = [Collections.Generic.List[object]]::new()
$resourceCases = [Collections.Generic.List[object]]::new()
$policyCases = [Collections.Generic.List[object]]::new()
$cleanupSucceeded = $false
$preflightSucceeded = $false
$mechanismReady = $false
$policy = [pscustomobject]@{ ceilings = $null }
$originalOutsideCanary = $env:FORMULABRIDGE_OUTSIDE_CANARY
$originalTexInputs = $env:TEXINPUTS
$assertionOrder = @(
    "approved-read-write-roots",
    "filesystem-escape-resistance",
    "lualatex-file-and-network-resistance",
    "network-blocking",
    "immutable-executable-and-policy",
    "job-cleanup-and-evidence-privacy",
    "resource-and-process-limits",
    "cancellation-and-process-tree",
    "same-host-recovery",
    "word-survives-resource-failures"
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
    $safeMessage = [Text.RegularExpressions.Regex]::Replace(
        $safeMessage,
        $uncPathPattern,
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

function Write-TexInput {
    param(
        [string]$Path,
        [string]$Source,
        [int]$ExactInputBytes = 0
    )

    $encoding = [Text.UTF8Encoding]::new($false)
    if ($ExactInputBytes -le 0) {
        [IO.File]::WriteAllText($Path, $Source, $encoding)
        return
    }

    $sourceBytes = $encoding.GetByteCount($Source)
    $commentPrefix = "`n%"
    $paddingBytes = $ExactInputBytes - $sourceBytes - $encoding.GetByteCount($commentPrefix)
    if ($paddingBytes -lt 0) {
        throw "The benign TeX source cannot fit the requested exact input size"
    }

    [IO.File]::WriteAllText($Path, $Source + $commentPrefix + ("x" * $paddingBytes), $encoding)
    if ((Get-Item -LiteralPath $Path).Length -ne $ExactInputBytes) {
        throw "The TeX input did not match the requested exact byte size"
    }
}

function Invoke-TexCase {
    param(
        [string]$Id,
        [string]$CorpusPath,
        [int]$WallClockSeconds = 0,
        [ValidateSet("interactive", "batch-item")]
        [string]$Mode = "interactive",
        [int]$ExactInputBytes = 0,
        [int]$OutputFileCount = 0,
        [long]$OutputBytes = 0,
        [switch]$CreateTraversalCanary,
        [switch]$CreateOutsideLinks,
        [switch]$InjectAbsoluteCanary,
        [switch]$InjectAbsoluteWrite,
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
    if ($WallClockSeconds -le 0) {
        $WallClockSeconds = [int]$policy.ceilings.interactiveSeconds
    }

    if ($CreateTraversalCanary) {
        Set-Content -LiteralPath (Join-Path $caseRoot "outside-canary.txt") -Value "FORMULABRIDGE-CANARY" -Encoding utf8NoBOM
    }
    if ($CreateOutsideLinks) {
        $linksRoot = Join-Path $jobRoot "links"
        $outsideJunction = Join-Path $linksRoot "outside"
        $outsideSymbolicLink = Join-Path $linksRoot "outside-canary-symbolic.txt"
        New-Item -ItemType Directory -Path $linksRoot -Force | Out-Null
        New-Item -ItemType Junction -Path $outsideJunction -Target $outsideRoot | Out-Null
        $reparseLinks.Add($outsideJunction)
        New-Item -ItemType SymbolicLink -Path $outsideSymbolicLink -Target $canaryPath | Out-Null
        $reparseLinks.Add($outsideSymbolicLink)
    }
    if ($InjectAbsoluteCanary) {
        if ($canaryPath.Contains("]]", [StringComparison]::Ordinal)) {
            throw "Generated canary path cannot be embedded safely"
        }
        $source = $source.Replace("@@ABSOLUTE_CANARY@@", $canaryPath)
    }
    if ($InjectAbsoluteWrite) {
        if ($outsideWritePath.Contains("]]", [StringComparison]::Ordinal)) {
            throw "Generated outside write path cannot be embedded safely"
        }
        $source = $source.Replace("@@ABSOLUTE_WRITE@@", $outsideWritePath)
    }
    if ($InjectNetworkListener) {
        $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
        $listener.Start()
        $listenerPort = ([Net.IPEndPoint]$listener.LocalEndpoint).Port
        $acceptResult = $listener.BeginAcceptTcpClient($null, $null)
        $source = $source.Replace("@@LISTENER_PORT@@", $listenerPort.ToString([Globalization.CultureInfo]::InvariantCulture))
    }
    if ($OutputFileCount -gt 0) {
        $source = $source.Replace(
            "@@OUTPUT_FILE_COUNT@@",
            $OutputFileCount.ToString([Globalization.CultureInfo]::InvariantCulture))
    }
    if ($OutputBytes -gt 0) {
        $source = $source.Replace(
            "@@OUTPUT_BYTES@@",
            $OutputBytes.ToString([Globalization.CultureInfo]::InvariantCulture))
    }
    if ($source.Contains("@@OUTPUT_FILE_COUNT@@", [StringComparison]::Ordinal) -or
        $source.Contains("@@OUTPUT_BYTES@@", [StringComparison]::Ordinal)) {
        throw "A resource probe is missing its policy-driven output ceiling"
    }

    Write-TexInput -Path $inputPath -Source $source -ExactInputBytes $ExactInputBytes
    $request = [ordered]@{
        schemaVersion = 1
        enginePath = [IO.Path]::GetFullPath($EnginePath)
        texRoot = [IO.Path]::GetFullPath($TexRoot)
        engineSha256 = $ExpectedEngineSha256.ToLowerInvariant()
        jobRoot = $jobRoot
        inputPath = $inputPath
        outputDirectory = $outputDirectory
        mode = $Mode
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
            peakJobMemoryBytes = $null
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
    $outsideWriteArtifact = (Test-Path -LiteralPath (Join-Path $jobRoot "outside-write.txt")) -or
        (Test-Path -LiteralPath $outsideWritePath)

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
        peakJobMemoryBytes = $runner.peakJobMemoryBytes
        inputBytes = (Get-Item -LiteralPath $inputPath).Length
        outsideWriteArtifact = $outsideWriteArtifact
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

function Invoke-PolicyRejection {
    param(
        [string]$Id,
        [ValidateSet("interactive", "batch-item")]
        [string]$Mode,
        [int]$WallClockSeconds,
        [switch]$OversizedInput
    )

    $caseRoot = Join-Path $workspace ("case-" + $Id)
    $jobRoot = Join-Path $caseRoot "job"
    $outputDirectory = Join-Path $jobRoot "output"
    $inputPath = Join-Path $jobRoot "input.tex"
    $requestPath = Join-Path $caseRoot "request.json"
    New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
    $jobDirectories.Add($caseRoot)

    $source = Get-CaseSource "formula\benign-lualatex.tex"
    $exactInputBytes = if ($OversizedInput) { [int]$policy.ceilings.inputBytes + 1 } else { 0 }
    Write-TexInput -Path $inputPath -Source $source -ExactInputBytes $exactInputBytes
    Write-EvidenceJson -Path $requestPath -Value ([ordered]@{
        schemaVersion = 1
        enginePath = [IO.Path]::GetFullPath($EnginePath)
        texRoot = [IO.Path]::GetFullPath($TexRoot)
        engineSha256 = $ExpectedEngineSha256.ToLowerInvariant()
        jobRoot = $jobRoot
        inputPath = $inputPath
        outputDirectory = $outputDirectory
        mode = $Mode
        testWallClockSeconds = $WallClockSeconds
    })

    $nativeOutput = @(& $sandboxExecutable run --request $requestPath 2>$null) -join [Environment]::NewLine
    $nativeExitCode = $LASTEXITCODE
    try {
        $runner = $nativeOutput | ConvertFrom-Json -Depth 5
        $policyEvidence = [pscustomobject][ordered]@{
            id = $Id
            runnerStatus = $runner.status
            runnerCode = $runner.code
            nativeExitCode = $nativeExitCode
        }
    }
    catch {
        $policyEvidence = [pscustomobject][ordered]@{
            id = $Id
            runnerStatus = "failed"
            runnerCode = "invalid-sandbox-result"
            nativeExitCode = $nativeExitCode
        }
    }

    $policyCases.Add($policyEvidence)
    Write-SmokeLog ("Completed policy probe " + $Id + " with " +
        $policyEvidence.runnerStatus + "/" + $policyEvidence.runnerCode)
    return $policyEvidence
}

. (Join-Path $PSScriptRoot "tex-lifecycle-smoke.ps1")
Write-EvidenceJson $lifecycleReportPath ([ordered]@{ schemaVersion = 1; status = "not-run"; reason = "The supported-platform and benign-isolation gates have not passed." })

New-Item -ItemType Directory -Path (Split-Path -Parent $logPath) -Force | Out-Null
Set-Content -LiteralPath $logPath -Value "" -Encoding utf8NoBOM
Write-SmokeLog "Starting TeX isolation smoke"

try {
    & dotnet build $sandboxProject --configuration Release --nologo *> $null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $sandboxExecutable -PathType Leaf)) {
        throw "The TeX sandbox helper did not build"
    }
    try {
        $policy = (@(& $sandboxExecutable describe-policy 2>$null) -join [Environment]::NewLine) |
            ConvertFrom-Json -Depth 10
    }
    catch {
        throw "The TeX sandbox helper did not publish a valid policy"
    }
    if ($policy.schemaVersion -ne 1 -or $null -eq $policy.ceilings -or
        @($policy.ceilings.inputBytes, $policy.ceilings.interactiveSeconds,
            $policy.ceilings.batchItemSeconds, $policy.ceilings.memoryBytes,
            $policy.ceilings.outputFiles, $policy.ceilings.outputBytes,
            $policy.ceilings.activeProcesses | Where-Object { [long]$_ -le 0 }).Count -gt 0) {
        throw "The TeX sandbox helper published an incomplete policy"
    }

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
        $benign.aclRestored -and
        $benign.texAclExplicitlyGranted

    if ($mechanismReady) {
        Set-Assertion "approved-read-write-roots" "passed" ""
        $pathTraversal = Invoke-TexCase -Id "path-traversal" -CorpusPath "malicious-tex\path-traversal.tex" -CreateTraversalCanary
        $absolutePath = Invoke-TexCase -Id "absolute-path" -CorpusPath "malicious-tex\absolute-path.tex" -InjectAbsoluteCanary
        $writeOutside = Invoke-TexCase -Id "write-outside" -CorpusPath "malicious-tex\write-outside.tex" -InjectAbsoluteWrite
        $environmentVariable = Invoke-TexCase -Id "environment-variable" -CorpusPath "malicious-tex\environment-variable.tex"
        $searchPath = Invoke-TexCase -Id "search-path" -CorpusPath "malicious-tex\search-path.tex"
        $linkReparse = Invoke-TexCase -Id "link-reparse" -CorpusPath "malicious-tex\link-and-reparse-point.tex" -CreateOutsideLinks
        $luaFileNetwork = Invoke-TexCase -Id "lualatex-file-network" -CorpusPath "malicious-tex\lualatex-file-and-network.tex" -InjectAbsoluteCanary -InjectNetworkListener
        $shellProcess = Invoke-TexCase -Id "shell-process" -CorpusPath "malicious-tex\shell-and-process.tex"
        $resourceTimeout = Invoke-TexCase -Id "resource-timeout" -CorpusPath "malicious-tex\resource-exhaustion.tex" -WallClockSeconds 2 -ResourceCase
        $resourceOutputFiles = Invoke-TexCase -Id "resource-output-files" -CorpusPath "malicious-tex\resource-output.tex" -OutputFileCount ([int]$policy.ceilings.outputFiles + 1) -ResourceCase
        $resourceOutputBytes = Invoke-TexCase -Id "resource-output-bytes" -CorpusPath "malicious-tex\resource-output-bytes.tex" -OutputBytes ([long]$policy.ceilings.outputBytes + 1) -ResourceCase
        $resourceMemory = Invoke-TexCase -Id "resource-memory" -CorpusPath "malicious-tex\resource-memory.tex" -ResourceCase
        $inputCeilingBenign = Invoke-TexCase -Id "input-ceiling-benign" -CorpusPath "formula\benign-lualatex.tex" -ExactInputBytes ([int]$policy.ceilings.inputBytes) -ResourceCase
        $batchBenign = Invoke-TexCase -Id "batch-benign" -CorpusPath "formula\benign-lualatex.tex" -Mode "batch-item" -WallClockSeconds ([int]$policy.ceilings.batchItemSeconds) -ResourceCase
        $inputCeilingProbe = Invoke-PolicyRejection -Id "input-ceiling-probe" -Mode "interactive" -WallClockSeconds ([int]$policy.ceilings.interactiveSeconds) -OversizedInput
        $batchCeilingProbe = Invoke-PolicyRejection -Id "batch-ceiling-probe" -Mode "batch-item" -WallClockSeconds ([int]$policy.ceilings.batchItemSeconds + 1)

        $filesystemCases = @($pathTraversal, $absolutePath, $writeOutside, $environmentVariable, $searchPath, $linkReparse)
        if (@($filesystemCases | Where-Object {
            $_.runnerStatus -ne "completed" -or $_.marker -ne "blocked" -or $_.outsideWriteArtifact
        }).Count -eq 0) {
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
        $immutableCases = @($securityCases) + @($resourceCases)
        if (@($immutableCases | Where-Object {
            -not $_.engineIdentityVerified -or -not $_.engineIdentityStable -or
            -not $_.assignedToJobBeforeResume -or $_.networkCapabilityCount -ne 0 -or
            -not $_.texAclExplicitlyGranted
        }).Count -eq 0 -and $shellProcess.marker -eq "blocked" -and -not $shellProcess.shellOrProcessArtifact) {
            Set-Assertion "immutable-executable-and-policy" "passed" ""
        } else {
            Set-Assertion "immutable-executable-and-policy" "failed" "An executable identity, fixed policy, shell, or child-process probe failed"
        }
        $memoryLimit = [long]$resourceMemory.limits.memoryBytes
        $memoryCeilingObserved = $resourceMemory.runnerStatus -eq "completed" -and
            $resourceMemory.texExitCode -ne 0 -and -not $resourceMemory.timedOut -and
            $resourceMemory.peakJobMemoryBytes -ge [long]($memoryLimit / 2) -and
            $resourceMemory.peakJobMemoryBytes -le $memoryLimit
        $requestCeilingsObserved = $inputCeilingBenign.runnerStatus -eq "completed" -and
            $inputCeilingBenign.texExitCode -eq 0 -and $inputCeilingBenign.producedPdf -and
            $inputCeilingBenign.inputBytes -eq [long]$policy.ceilings.inputBytes -and
            $batchBenign.runnerStatus -eq "completed" -and
            $batchBenign.texExitCode -eq 0 -and $batchBenign.producedPdf -and
            $inputCeilingProbe.runnerStatus -eq "rejected" -and
            $inputCeilingProbe.runnerCode -eq "input-ceiling-exceeded" -and
            $batchCeilingProbe.runnerStatus -eq "rejected" -and
            $batchCeilingProbe.runnerCode -eq "wall-clock-ceiling-exceeded"
        if ($resourceTimeout.runnerStatus -eq "terminated" -and $resourceTimeout.timedOut -and
            $resourceOutputFiles.runnerStatus -eq "terminated" -and $resourceOutputFiles.outputLimitExceeded -and
            $resourceOutputBytes.runnerStatus -eq "terminated" -and $resourceOutputBytes.outputLimitExceeded -and
            $memoryCeilingObserved -and $requestCeilingsObserved -and
            -not $shellProcess.shellOrProcessArtifact) {
            Set-Assertion "resource-and-process-limits" "passed" ""
        } else {
            Set-Assertion "resource-and-process-limits" "failed" "Input, batch, wall-clock, memory, output, or single-process enforcement was not observed"
        }
        Invoke-TexLifecycleSmoke
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
    foreach ($directory in @($jobDirectories)) {
        if (-not (Test-PathInside -Root $workspace -Candidate $directory)) { throw "Cleanup target escaped the generated job workspace" }
    }
    foreach ($root in @($workspace, $outsideRoot)) {
        if (-not (Test-PathInside -Root ([IO.Path]::GetTempPath()) -Candidate $root) -or [IO.Path]::GetFullPath($root) -eq [IO.Path]::GetFullPath([IO.Path]::GetTempPath())) { throw "Cleanup target escaped the temporary root" }
    }
    foreach ($link in @($reparseLinks)) {
        if (-not (Test-PathInside -Root $workspace -Candidate $link)) { throw "Cleanup link escaped the generated job workspace" }
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
    ceilings = $policy.ceilings
    cases = @($resourceCases)
    policyCases = @($policyCases)
}
Write-EvidenceJson -Path $securityTracePath -Value $securityTrace
Write-EvidenceJson -Path $resourceReportPath -Value $resourceReport

$privacyText = @(
    Get-Content -LiteralPath $logPath -Raw
    ($securityTrace | ConvertTo-Json -Depth 20)
    ($resourceReport | ConvertTo-Json -Depth 20)
    (Get-Content -LiteralPath $lifecycleReportPath -Raw)
) -join "`n"
$containsSensitivePath = [Text.RegularExpressions.Regex]::IsMatch($privacyText, "(?i)[A-Z]:\\") -or
    [Text.RegularExpressions.Regex]::IsMatch($privacyText, $uncPathPattern) -or
    $privacyText.Contains([Environment]::UserName, [StringComparison]::OrdinalIgnoreCase) -or
    (-not [string]::IsNullOrEmpty($env:USERPROFILE) -and
        $privacyText.Contains($env:USERPROFILE, [StringComparison]::OrdinalIgnoreCase))
$allCases = @($securityCases) + @($resourceCases)
$caseCleanupSucceeded = @($allCases | Where-Object {
    -not $_.profileDeleted -or -not $_.aclRestored
}).Count -eq 0
if ($cleanupSucceeded -and $caseCleanupSucceeded -and -not $containsSensitivePath) {
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
    [ordered]@{ path = $lifecycleReportRelativePath; kind = "lifecycle-report" }
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
