[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$InstallerPath,

    [Parameter(Mandatory = $true)]
    [string]$EvidenceDirectory,

    [Parameter(Mandatory = $true)]
    [ValidateSet("test", "production")]
    [string]$TrustLevel,

    [string]$BuildMetadataPath,
    [string]$ExpectedCommit,
    [string]$SignToolPath,
    [string]$MagePath,

    [ValidateRange(5, 120)]
    [int]$WordLoadTimeoutSeconds = 30
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$addInId = "FormulaBridge.WordAddIn"
$addInRegistryPath = "Software\Microsoft\Office\Word\Addins\FormulaBridge.WordAddIn"
$statePath = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)) "FormulaBridge\Phase0\word-load-state.json"
$installDirectory = Split-Path -Parent $statePath
$resultRelativePath = "evidence/vsto-installation/result/result.json"
$logRelativePath = "evidence/vsto-installation/log/smoke.log"
$installerRelativePath = "evidence/vsto-installation/installer/FormulaBridge.Phase0.x64.msi"
$signatureRelativePath = "evidence/vsto-installation/signature-report/signature-report.json"
$wordLoadRelativePath = "evidence/vsto-installation/word-load-state/word-load-state.json"
$diagnosticsRelativePath = "evidence/vsto-installation/diagnostics-report/diagnostics-report.json"
$startedAt = [DateTime]::UtcNow

$requiredAssertionIds = @(
    "current-user-installation",
    "signature-verification",
    "automatic-ribbon-load",
    "non-destructive-uninstall",
    "installation-lifecycle-smoke",
    "diagnostics-failure-detection",
    "diagnostics-load-state-consistency",
    "diagnostics-respects-policy",
    "diagnostics-fault-smoke",
    "diagnostics-privacy"
)
$script:assertionById = [ordered]@{}
$script:currentAssertionId = "installation-lifecycle-smoke"
foreach ($assertionId in $requiredAssertionIds) {
    $script:assertionById[$assertionId] = [ordered]@{
        id = $assertionId
        status = "not-run"
        reason = "The assertion was not reached."
    }
}

function Resolve-CommandPath {
    param(
        [string]$ExplicitPath,
        [string]$CommandName,
        [string]$Description
    )

    if ($ExplicitPath) {
        $resolved = Resolve-Path -LiteralPath $ExplicitPath -ErrorAction SilentlyContinue
        if (-not $resolved) {
            throw "$Description is missing."
        }
        return $resolved.Path
    }

    $command = Get-Command $CommandName -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    throw "$Description is unavailable."
}

function Set-Assertion {
    param(
        [string]$Id,
        [ValidateSet("passed", "failed", "blocked", "not-run")]
        [string]$Status,
        [string]$Reason
    )

    $entry = $script:assertionById[$Id]
    $entry.status = $Status
    if ($Status -eq "passed") {
        [void]$entry.Remove("reason")
    }
    else {
        $entry.reason = $Reason
    }
}

function Get-OverallStatus {
    $precedence = @{ "passed" = 0; "not-run" = 1; "blocked" = 2; "failed" = 3 }
    $highest = 0

    foreach ($entry in $script:assertionById.Values) {
        $highest = [Math]::Max($highest, $precedence[$entry.status])
    }

    return (@("passed", "not-run", "blocked", "failed") | Where-Object { $precedence[$_] -eq $highest } | Select-Object -First 1)
}

function ConvertTo-PortablePath {
    param([string]$RelativePath)
    return $RelativePath.Replace("/", [IO.Path]::DirectorySeparatorChar)
}

$resolvedEvidenceDirectory = [IO.Path]::GetFullPath($EvidenceDirectory)
if (Test-Path -LiteralPath $resolvedEvidenceDirectory) {
    if (Get-ChildItem -LiteralPath $resolvedEvidenceDirectory -Force | Select-Object -First 1) {
        throw "EvidenceDirectory must be empty."
    }
}
else {
    New-Item -ItemType Directory -Path $resolvedEvidenceDirectory | Out-Null
}

function Resolve-EvidencePath {
    param([string]$RelativePath)

    $candidate = [IO.Path]::GetFullPath((Join-Path $resolvedEvidenceDirectory (ConvertTo-PortablePath $RelativePath)))
    $prefix = $resolvedEvidenceDirectory.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $candidate.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Evidence path escaped EvidenceDirectory."
    }
    return $candidate
}

$resultPath = Resolve-EvidencePath $resultRelativePath
$logPath = Resolve-EvidencePath $logRelativePath
$installerEvidencePath = Resolve-EvidencePath $installerRelativePath
$signatureEvidencePath = Resolve-EvidencePath $signatureRelativePath
$wordLoadEvidencePath = Resolve-EvidencePath $wordLoadRelativePath
$diagnosticsEvidencePath = Resolve-EvidencePath $diagnosticsRelativePath
foreach ($path in @($resultPath, $logPath, $installerEvidencePath, $signatureEvidencePath, $wordLoadEvidencePath, $diagnosticsEvidencePath)) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $path) -Force | Out-Null
}

function Protect-EvidenceText {
    param([string]$Text)

    $protected = $Text
    $redactions = @(
        @{ Value = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile); Replacement = "%USERPROFILE%" },
        @{ Value = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData); Replacement = "%LOCALAPPDATA%" },
        @{ Value = [Environment]::UserName; Replacement = "<user>" },
        @{ Value = [Environment]::MachineName; Replacement = "<machine>" },
        @{ Value = [Environment]::UserDomainName; Replacement = "<domain>" }
    )
    foreach ($redaction in $redactions) {
        if ($redaction.Value) {
            $protected = [Text.RegularExpressions.Regex]::Replace(
                $protected,
                [Text.RegularExpressions.Regex]::Escape($redaction.Value),
                $redaction.Replacement,
                [Text.RegularExpressions.RegexOptions]::IgnoreCase)
        }
    }
    $protected = [Text.RegularExpressions.Regex]::Replace(
        $protected,
        "(?i)(?:[A-Z]:\\|\\\\[^\\\s]+\\)[^\r\n;]*",
        "<Windows absolute path>")
    return $protected
}

function Write-SmokeLog {
    param([string]$Message)

    $line = "{0} {1}" -f [DateTime]::UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'"), (Protect-EvidenceText $Message)
    Add-Content -LiteralPath $logPath -Value $line -Encoding utf8
}

function Get-SafeErrorType {
    param([object]$ErrorRecord)

    $name = $ErrorRecord.Exception.GetType().Name
    if ($name -match "^[A-Za-z][A-Za-z0-9]*$") {
        return $name
    }
    return "Error"
}

function Invoke-Native {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$Description,
        [int[]]$AllowedExitCodes = @(0)
    )

    & $FilePath @Arguments
    $exitCode = $LASTEXITCODE
    if ($AllowedExitCodes -notcontains $exitCode) {
        throw "$Description failed with exit code $exitCode."
    }
    return $exitCode
}

function Invoke-Msi {
    param(
        [string]$Step,
        [string[]]$Arguments,
        [string]$RawLogPath
    )

    Write-SmokeLog ("Starting MSI lifecycle step: " + $Step)
    $msiexec = Join-Path $env:WINDIR "System32\msiexec.exe"
    [void](Invoke-Native $msiexec ($Arguments + @("/qn", "/norestart", "/L*V", $RawLogPath)) ("MSI " + $Step))
    Write-SmokeLog ("Completed MSI lifecycle step: " + $Step)
}

function Test-RegistryKey {
    param(
        [Microsoft.Win32.RegistryHive]$Hive,
        [Microsoft.Win32.RegistryView]$View,
        [string]$SubKey
    )

    $baseKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey($Hive, $View)
    try {
        $key = $baseKey.OpenSubKey($SubKey, $false)
        if ($key) {
            $key.Dispose()
            return $true
        }
        return $false
    }
    finally {
        $baseKey.Dispose()
    }
}

function Read-CurrentUserRegistration {
    $baseKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey(
        [Microsoft.Win32.RegistryHive]::CurrentUser,
        [Microsoft.Win32.RegistryView]::Registry64)
    try {
        $key = $baseKey.OpenSubKey($addInRegistryPath, $false)
        if (-not $key) {
            return $null
        }
        try {
            return [pscustomobject]@{
                Manifest = [string]$key.GetValue("Manifest")
                LoadBehavior = [int]$key.GetValue("LoadBehavior", 0)
            }
        }
        finally {
            $key.Dispose()
        }
    }
    finally {
        $baseKey.Dispose()
    }
}

function Get-MsiProperty {
    param(
        [string]$Path,
        [string]$Property
    )

    $windowsInstaller = New-Object -ComObject WindowsInstaller.Installer
    try {
        $database = $windowsInstaller.GetType().InvokeMember(
            "OpenDatabase",
            "InvokeMethod",
            $null,
            $windowsInstaller,
            @($Path, 0))
        $query = "SELECT `Value` FROM `Property` WHERE `Property`='" + $Property.Replace("'", "''") + "'"
        $view = $database.GetType().InvokeMember("OpenView", "InvokeMethod", $null, $database, @($query))
        [void]$view.GetType().InvokeMember("Execute", "InvokeMethod", $null, $view, $null)
        $record = $view.GetType().InvokeMember("Fetch", "InvokeMethod", $null, $view, $null)
        if (-not $record) {
            return $null
        }
        return [string]$record.GetType().InvokeMember("StringData", "GetProperty", $null, $record, @(1))
    }
    finally {
        if ($windowsInstaller) {
            [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($windowsInstaller)
        }
    }
}

function Get-MsiProductState {
    param(
        [string]$Path
    )

    $productCode = Get-MsiProperty $Path "ProductCode"
    if (-not $productCode) {
        throw "The MSI does not contain a ProductCode."
    }

    $windowsInstaller = New-Object -ComObject WindowsInstaller.Installer
    try {
        return [int]$windowsInstaller.GetType().InvokeMember(
            "ProductState",
            "GetProperty",
            $null,
            $windowsInstaller,
            @($productCode))
    }
    finally {
        if ($windowsInstaller) {
            [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($windowsInstaller)
        }
    }
}

function Get-MsiRelatedProducts {
    param([string]$Path)

    $upgradeCode = Get-MsiProperty $Path "UpgradeCode"
    if (-not $upgradeCode) {
        throw "The MSI does not contain an UpgradeCode."
    }

    $windowsInstaller = New-Object -ComObject WindowsInstaller.Installer
    $relatedProducts = $null
    try {
        $relatedProducts = $windowsInstaller.GetType().InvokeMember(
            "RelatedProducts",
            "GetProperty",
            $null,
            $windowsInstaller,
            @($upgradeCode))
        $productCodes = @()
        foreach ($productCode in $relatedProducts) {
            $productCodes += [string]$productCode
        }
        return $productCodes
    }
    finally {
        if ($relatedProducts -and [Runtime.InteropServices.Marshal]::IsComObject($relatedProducts)) {
            [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($relatedProducts)
        }
        if ($windowsInstaller) {
            [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($windowsInstaller)
        }
    }
}

function Get-MsiColumnValues {
    param(
        [string]$Path,
        [ValidatePattern("^[A-Za-z_][A-Za-z0-9_]*$")]
        [string]$Table,
        [ValidatePattern("^[A-Za-z_][A-Za-z0-9_]*$")]
        [string]$Column
    )

    $windowsInstaller = New-Object -ComObject WindowsInstaller.Installer
    $view = $null
    $database = $null
    try {
        $database = $windowsInstaller.GetType().InvokeMember(
            "OpenDatabase",
            "InvokeMethod",
            $null,
            $windowsInstaller,
            @($Path, 0))
        $query = "SELECT ``$Column`` FROM ``$Table``"
        $view = $database.GetType().InvokeMember("OpenView", "InvokeMethod", $null, $database, @($query))
        [void]$view.GetType().InvokeMember("Execute", "InvokeMethod", $null, $view, $null)
        $values = @()
        while ($true) {
            $record = $view.GetType().InvokeMember("Fetch", "InvokeMethod", $null, $view, $null)
            if (-not $record) {
                break
            }
            try {
                $values += [string]$record.GetType().InvokeMember("StringData", "GetProperty", $null, $record, @(1))
            }
            finally {
                [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($record)
            }
        }
        return $values
    }
    finally {
        if ($view) {
            [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($view)
        }
        if ($database) {
            [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($database)
        }
        if ($windowsInstaller) {
            [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($windowsInstaller)
        }
    }
}

function Assert-MsiDocumentPrivacyContract {
    param([string]$Path)

    $tableNames = @(Get-MsiColumnValues $Path "_Tables" "Name")
    $customActions = @()
    if ($tableNames -contains "CustomAction") {
        $customActions = @(Get-MsiColumnValues $Path "CustomAction" "Action")
    }
    $directoryIds = @(Get-MsiColumnValues $Path "Directory" "Directory")
    $documentDirectoryIds = @($directoryIds | Where-Object { $_ -match "Personal|MyDocuments|DocumentsFolder" })

    if ($customActions.Count -gt 0 -or $documentDirectoryIds.Count -gt 0) {
        throw "The MSI contains a custom action or user-document directory reference."
    }

    Write-SmokeLog "MSI privacy contract passed: no custom actions and no user-document directory references."
}

function Archive-RawMsiLogs {
    foreach ($rawMsiLog in $rawMsiLogs) {
        if (-not (Test-Path -LiteralPath $rawMsiLog)) {
            continue
        }

        $content = Get-Content -LiteralPath $rawMsiLog -Raw
        $returnCodes = @(
            [Text.RegularExpressions.Regex]::Matches($content, "MainEngineThread is returning (?<code>[0-9]+)") |
                ForEach-Object { $_.Groups["code"].Value } |
                Sort-Object -Unique
        )
        $returnValue3Count = [Text.RegularExpressions.Regex]::Matches($content, "Return value 3").Count
        $safeStep = [Text.RegularExpressions.Regex]::Replace(
            [IO.Path]::GetFileNameWithoutExtension($rawMsiLog),
            "[^A-Za-z0-9.-]",
            "_")
        Write-SmokeLog (
            "MSI log summary: step={0}; sizeBytes={1}; sha256={2}; returnCodes={3}; returnValue3Count={4}" -f
                $safeStep,
                (Get-Item -LiteralPath $rawMsiLog).Length,
                (Get-FileHash -LiteralPath $rawMsiLog -Algorithm SHA256).Hash.ToLowerInvariant(),
                ($returnCodes -join ","),
                $returnValue3Count)
    }
}

function Get-RegistryPolicyFingerprint {
    $locations = @(
        @{ Hive = [Microsoft.Win32.RegistryHive]::CurrentUser; View = [Microsoft.Win32.RegistryView]::Registry64; Path = "Software\Policies\Microsoft\Office\16.0\Word\Resiliency\AddinList" },
        @{ Hive = [Microsoft.Win32.RegistryHive]::LocalMachine; View = [Microsoft.Win32.RegistryView]::Registry64; Path = "SOFTWARE\Policies\Microsoft\Office\16.0\Word\Resiliency\AddinList" },
        @{ Hive = [Microsoft.Win32.RegistryHive]::CurrentUser; View = [Microsoft.Win32.RegistryView]::Registry64; Path = "Software\Microsoft\Office\16.0\Word\Resiliency\CrashingAddinList" },
        @{ Hive = [Microsoft.Win32.RegistryHive]::CurrentUser; View = [Microsoft.Win32.RegistryView]::Registry64; Path = "Software\Microsoft\Office\16.0\Word\Resiliency\DisabledItems" }
    )
    $snapshot = @()

    foreach ($location in $locations) {
        $baseKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey($location.Hive, $location.View)
        try {
            $key = $baseKey.OpenSubKey($location.Path, $false)
            if ($key) {
                try {
                    foreach ($name in ($key.GetValueNames() | Sort-Object)) {
                        $registryValue = $key.GetValue($name)
                        $fingerprintValue = if ($registryValue -is [byte[]]) {
                            ([BitConverter]::ToString($registryValue)).Replace("-", "")
                        }
                        else {
                            [string]$registryValue
                        }
                        $snapshot += [ordered]@{
                            hive = [string]$location.Hive
                            path = $location.Path
                            name = $name
                            value = $fingerprintValue
                        }
                    }
                }
                finally {
                    $key.Dispose()
                }
            }
        }
        finally {
            $baseKey.Dispose()
        }
    }

    $temporary = [IO.Path]::GetTempFileName()
    try {
        $snapshot | ConvertTo-Json -Depth 4 -Compress | Set-Content -LiteralPath $temporary -Encoding utf8
        return (Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    finally {
        Remove-Item -LiteralPath $temporary -Force
    }
}

function Invoke-WordLoadProbe {
    param([string]$Step)

    if (Test-Path -LiteralPath $statePath) {
        Remove-Item -LiteralPath $statePath -Force
    }

    $word = $null
    $document = $null
    try {
        Write-SmokeLog ("Starting Word automatic-load probe after " + $Step)
        $word = New-Object -ComObject Word.Application
        $word.Visible = $true
        $document = $word.Documents.Add()
        $deadline = [DateTime]::UtcNow.AddSeconds($WordLoadTimeoutSeconds)
        $state = $null
        do {
            Start-Sleep -Milliseconds 250
            if (Test-Path -LiteralPath $statePath) {
                try {
                    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
                }
                catch {
                    $state = $null
                }
            }
        } while ((-not $state -or -not $state.ribbonLoadedAt) -and [DateTime]::UtcNow -lt $deadline)

        $comAddIn = $word.COMAddIns.Item($addInId)
        if (-not $comAddIn.Connect) {
            throw "Word reports that FormulaBridge.WordAddIn is not connected."
        }
        if (-not $state -or $state.addInId -ne $addInId -or -not $state.addInStartedAt -or -not $state.ribbonLoadedAt) {
            throw "The fresh FormulaBridge Ribbon onLoad state was not observed."
        }

        Add-Type -AssemblyName UIAutomationClient
        $wordElement = [Windows.Automation.AutomationElement]::FromHandle([IntPtr]$word.Hwnd)
        $nameCondition = New-Object Windows.Automation.PropertyCondition -ArgumentList @(
            [Windows.Automation.AutomationElement]::NameProperty,
            "FormulaBridge")
        $namedElements = $wordElement.FindAll([Windows.Automation.TreeScope]::Descendants, $nameCondition)
        $ribbonTabVisible = $false
        for ($index = 0; $index -lt $namedElements.Count; $index += 1) {
            $element = $namedElements.Item($index)
            if ($element.Current.ControlType -eq [Windows.Automation.ControlType]::TabItem -and
                -not $element.Current.IsOffscreen) {
                $ribbonTabVisible = $true
                break
            }
        }
        if (-not $ribbonTabVisible) {
            throw "UI Automation did not find a visible FormulaBridge Ribbon tab."
        }
        $state | Add-Member -NotePropertyName "ribbonUiVisible" -NotePropertyValue $true -Force

        Write-SmokeLog ("Word automatic-load probe passed after " + $Step)
        return $state
    }
    finally {
        if ($document) {
            $document.Close(0)
            [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($document)
        }
        if ($word) {
            $word.Quit(0)
            [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($word)
        }
        [GC]::Collect()
        [GC]::WaitForPendingFinalizers()
    }
}

function Invoke-Diagnostics {
    param(
        [string]$Executable,
        [string]$OutputPath,
        [int[]]$AllowedExitCodes
    )

    & $Executable --output $OutputPath | Out-Null
    $exitCode = $LASTEXITCODE
    if ($AllowedExitCodes -notcontains $exitCode) {
        throw "FormulaBridge diagnostics returned unexpected exit code $exitCode."
    }
    return $exitCode
}

function Invoke-SignatureVerification {
    param(
        [string]$SignTool,
        [string]$Mage,
        [string]$InstalledDirectory,
        [string]$MetadataPath
    )

    $metadata = Get-Content -LiteralPath $MetadataPath -Raw | ConvertFrom-Json
    if ($metadata.trustLevel -ne $TrustLevel) {
        throw "Build metadata trustLevel does not match the smoke run."
    }
    if ($ExpectedCommit -and $metadata.commit -ne $ExpectedCommit) {
        throw "Build metadata commit does not match the Phase 0 execution commit."
    }
    if ($TrustLevel -eq "production" -and (-not $metadata.certificate.chainTrusted -or -not $metadata.certificate.timestamped)) {
        throw "Production evidence requires a trusted and timestamped signing certificate."
    }
    $expectedSignerThumbprint = ([string]$metadata.certificate.thumbprint).Replace(" ", "").ToLowerInvariant()
    if ($expectedSignerThumbprint -notmatch "^[0-9a-f]{40}$") {
        throw "Build metadata does not contain a valid signing certificate thumbprint."
    }

    $artifacts = @(
        @{ name = "installer"; path = $resolvedInstallerPath; kind = "authenticode"; expectedSigner = $true },
        @{ name = "word-addin"; path = (Join-Path $InstalledDirectory "FormulaBridge.WordAddIn.dll"); kind = "authenticode"; expectedSigner = $true },
        @{ name = "diagnostics"; path = (Join-Path $InstalledDirectory "FormulaBridge.Diagnostics.exe"); kind = "authenticode"; expectedSigner = $true },
        @{ name = "office-tools-utilities"; path = (Join-Path $InstalledDirectory "Microsoft.Office.Tools.Common.v4.0.Utilities.dll"); kind = "authenticode"; expectedSigner = $false },
        @{ name = "application-manifest"; path = (Join-Path $InstalledDirectory "FormulaBridge.WordAddIn.dll.manifest"); kind = "manifest" },
        @{ name = "deployment-manifest"; path = (Join-Path $InstalledDirectory "FormulaBridge.WordAddIn.vsto"); kind = "manifest" }
    )
    $results = @()

    foreach ($artifact in $artifacts) {
        if (-not (Test-Path -LiteralPath $artifact.path)) {
            throw ("Signed artifact is missing: " + $artifact.name)
        }
        if ($artifact.kind -eq "authenticode") {
            [void](Invoke-Native $SignTool @("verify", "/pa", "/all", "/v", $artifact.path) ("signtool verify " + $artifact.name))
            $signature = Get-AuthenticodeSignature -LiteralPath $artifact.path
            if ($signature.Status -ne [Management.Automation.SignatureStatus]::Valid) {
                throw ("Windows signature verification failed for " + $artifact.name)
            }
            $signerThumbprint = $signature.SignerCertificate.Thumbprint.ToLowerInvariant()
            if ($artifact.expectedSigner -and $signerThumbprint -ne $expectedSignerThumbprint) {
                throw ("Build metadata signer does not match " + $artifact.name + ".")
            }
            if ($TrustLevel -eq "production" -and $artifact.expectedSigner -and -not $signature.TimeStamperCertificate) {
                throw ("Production signature is not timestamped for " + $artifact.name + ".")
            }
            $results += [ordered]@{
                artifact = $artifact.name
                verification = "windows-authenticode"
                status = "passed"
                sha256 = (Get-FileHash -LiteralPath $artifact.path -Algorithm SHA256).Hash.ToLowerInvariant()
                signerThumbprint = $signerThumbprint
            }
        }
        else {
            [void](Invoke-Native $Mage @("-Verify", $artifact.path) ("mage -Verify " + $artifact.name))
            $results += [ordered]@{
                artifact = $artifact.name
                verification = "clickonce-manifest"
                status = "passed"
                sha256 = (Get-FileHash -LiteralPath $artifact.path -Algorithm SHA256).Hash.ToLowerInvariant()
            }
        }
    }

    [ordered]@{
        schemaVersion = 1
        trustLevel = $TrustLevel
        metadataSha256 = (Get-FileHash -LiteralPath $MetadataPath -Algorithm SHA256).Hash.ToLowerInvariant()
        artifacts = $results
    } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $signatureEvidencePath -Encoding utf8
}

function Test-EvidencePrivacy {
    param([string[]]$TextPaths)

    $sensitiveValues = @(
        [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile),
        [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData),
        [Environment]::UserName,
        [Environment]::MachineName,
        [Environment]::UserDomainName
    ) | Where-Object { $_ }

    foreach ($textPath in $TextPaths) {
        $content = Get-Content -LiteralPath $textPath -Raw
        foreach ($sensitiveValue in $sensitiveValues) {
            if ($content.IndexOf($sensitiveValue, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
                return $false
            }
        }
        if ([Text.RegularExpressions.Regex]::IsMatch(
            $content,
            "(?i)(?:[A-Z]:\\|\\\\[^\\\s]+\\)[^\r\n;]*")) {
            return $false
        }
    }
    return $true
}

function Write-ResultEvidence {
    $status = Get-OverallStatus
    $assertions = @()
    foreach ($assertionId in $requiredAssertionIds) {
        $assertions += [pscustomobject]$script:assertionById[$assertionId]
    }

    [ordered]@{
        schemaVersion = 1
        checkId = "vsto-installation"
        status = $status
        assertions = $assertions
    } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $resultPath -Encoding utf8

    $evidence = @(
        @{ path = $resultRelativePath; kind = "result" },
        @{ path = $logRelativePath; kind = "log" }
    )
    if ($status -eq "passed") {
        $evidence += @(
            @{ path = $installerRelativePath; kind = "installer" },
            @{ path = $signatureRelativePath; kind = "signature-report" },
            @{ path = $wordLoadRelativePath; kind = "word-load-state" },
            @{ path = $diagnosticsRelativePath; kind = "diagnostics-report" }
        )
    }

    [ordered]@{
        id = "vsto-installation"
        name = "VSTO user-level installation and diagnostics"
        status = $status
        startedAt = $startedAt.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'")
        finishedAt = [DateTime]::UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'")
        evidence = $evidence
    } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $resolvedEvidenceDirectory "check-fragment.json") -Encoding utf8
}

$temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$workDirectory = [IO.Path]::GetFullPath((Join-Path $temporaryRoot ("FormulaBridge-VstoSmoke-" + [Guid]::NewGuid().ToString("N"))))
$temporaryPrefix = $temporaryRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (-not $workDirectory.StartsWith($temporaryPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Temporary work directory escaped the system temporary directory."
}
New-Item -ItemType Directory -Path $workDirectory | Out-Null

$resolvedInstallerPath = $null
$resolvedBuildMetadataPath = $null
$signTool = $null
$mage = $null
$sentinelPath = Join-Path $workDirectory "synthetic-document-sentinel.docx"
$sentinelHash = $null
$rawMsiLogs = @()
$installed = $false
$programFileNames = @(
    "FormulaBridge.WordAddIn.dll",
    "FormulaBridge.WordAddIn.dll.manifest",
    "FormulaBridge.WordAddIn.vsto",
    "Microsoft.Office.Tools.Common.v4.0.Utilities.dll",
    "FormulaBridge.Diagnostics.exe"
)

try {
    $script:currentAssertionId = "current-user-installation"
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Set-Assertion "current-user-installation" "blocked" "Clean-install preflight requires a non-elevated Windows token."
        throw "Clean-install preflight rejected an elevated Windows token."
    }

    $script:currentAssertionId = "installation-lifecycle-smoke"
    if (Get-Process -Name WINWORD -ErrorAction SilentlyContinue) {
        Set-Assertion "installation-lifecycle-smoke" "blocked" "Word must be closed before the smoke run."
        throw "Word is already running."
    }

    $script:currentAssertionId = "current-user-installation"
    $resolvedInstallerPath = (Resolve-Path -LiteralPath $InstallerPath).Path
    if (-not $BuildMetadataPath) {
        $BuildMetadataPath = Join-Path (Split-Path -Parent $resolvedInstallerPath) "build-metadata.json"
    }
    $resolvedBuildMetadataPath = (Resolve-Path -LiteralPath $BuildMetadataPath).Path
    $signTool = Resolve-CommandPath $SignToolPath "signtool.exe" "Windows SDK signtool.exe"
    $mage = Resolve-CommandPath $MagePath "mage.exe" ".NET Framework mage.exe"

    $existingUserRegistration = Test-RegistryKey ([Microsoft.Win32.RegistryHive]::CurrentUser) ([Microsoft.Win32.RegistryView]::Registry64) $addInRegistryPath
    $existingMachineRegistration = Test-RegistryKey ([Microsoft.Win32.RegistryHive]::LocalMachine) ([Microsoft.Win32.RegistryView]::Registry64) $addInRegistryPath
    $existingInstallContent = (Test-Path -LiteralPath $installDirectory) -and
        [bool](Get-ChildItem -LiteralPath $installDirectory -Force | Select-Object -First 1)
    $productStateBeforeInstall = Get-MsiProductState $resolvedInstallerPath
    $relatedProductsBeforeInstall = @(Get-MsiRelatedProducts $resolvedInstallerPath)
    if ($existingUserRegistration -or
        $existingMachineRegistration -or
        $existingInstallContent -or
        $productStateBeforeInstall -ne -1 -or
        $relatedProductsBeforeInstall.Count -gt 0) {
        Set-Assertion "current-user-installation" "blocked" "Clean-install preflight found an existing product, registration, or installation payload."
        throw "Clean-install preflight requires a pristine FormulaBridge Phase 0 installation state."
    }
    Assert-MsiDocumentPrivacyContract $resolvedInstallerPath

    Copy-Item -LiteralPath $resolvedInstallerPath -Destination $installerEvidencePath
    Copy-Item -LiteralPath (Join-Path $projectRoot "corpus\phase0\word\minimal-document.docx") -Destination $sentinelPath
    $sentinelHash = (Get-FileHash -LiteralPath $sentinelPath -Algorithm SHA256).Hash
    Write-SmokeLog "Clean-install preflight passed with a non-elevated token and no existing FormulaBridge installation state."

    $allUsers = Get-MsiProperty $resolvedInstallerPath "ALLUSERS"
    $installPerUser = Get-MsiProperty $resolvedInstallerPath "MSIINSTALLPERUSER"
    if (($allUsers -and $allUsers -notin @("2", "")) -or ($installPerUser -and $installPerUser -ne "1")) {
        Set-Assertion "current-user-installation" "failed" "The MSI property contract is not per-user."
        throw "The MSI property contract is not per-user."
    }

    $cleanLog = Join-Path $workDirectory "clean-install.raw.log"
    $rawMsiLogs += $cleanLog
    Invoke-Msi "clean-install" @("/i", $resolvedInstallerPath) $cleanLog
    $installed = $true

    $registration = Read-CurrentUserRegistration
    $machineRegistered = Test-RegistryKey ([Microsoft.Win32.RegistryHive]::LocalMachine) ([Microsoft.Win32.RegistryView]::Registry64) $addInRegistryPath
    if (-not $registration -or $registration.LoadBehavior -ne 3 -or $machineRegistered) {
        Set-Assertion "current-user-installation" "failed" "The add-in was not registered only for the current user with LoadBehavior 3."
        throw "Current-user registration verification failed."
    }
    Set-Assertion "current-user-installation" "passed"

    $script:currentAssertionId = "signature-verification"
    Invoke-SignatureVerification $signTool $mage $installDirectory $resolvedBuildMetadataPath
    Set-Assertion "signature-verification" "passed"

    $script:currentAssertionId = "automatic-ribbon-load"
    [void](Invoke-WordLoadProbe "clean-install")
    Set-Assertion "automatic-ribbon-load" "passed"

    $script:currentAssertionId = "installation-lifecycle-smoke"
    $repeatLog = Join-Path $workDirectory "repeated-install.raw.log"
    $rawMsiLogs += $repeatLog
    Invoke-Msi "repeated-install" @("/i", $resolvedInstallerPath) $repeatLog
    [void](Invoke-WordLoadProbe "repeated-install")

    $repairLog = Join-Path $workDirectory "repair.raw.log"
    $rawMsiLogs += $repairLog
    Invoke-Msi "repair" @("/fa", $resolvedInstallerPath) $repairLog
    $latestLoadState = Invoke-WordLoadProbe "repair"
    $latestLoadState | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $wordLoadEvidencePath -Encoding utf8
    Set-Assertion "installation-lifecycle-smoke" "passed"

    $installedDiagnostics = Join-Path $installDirectory "FormulaBridge.Diagnostics.exe"
    $policyBefore = Get-RegistryPolicyFingerprint
    $script:currentAssertionId = "diagnostics-load-state-consistency"
    $healthyDiagnosticsPath = Join-Path $workDirectory "diagnostics-healthy.json"
    [void](Invoke-Diagnostics $installedDiagnostics $healthyDiagnosticsPath @(0))
    $healthyDiagnostics = Get-Content -LiteralPath $healthyDiagnosticsPath -Raw | ConvertFrom-Json
    $loadChecks = @($healthyDiagnostics.checks | Where-Object { $_.id -in @("add-in-load-state", "ribbon-load-state") })
    if ($healthyDiagnostics.status -ne "passed" -or $loadChecks.Count -ne 2 -or @($loadChecks | Where-Object { $_.status -ne "passed" }).Count -ne 0) {
        Set-Assertion "diagnostics-load-state-consistency" "failed" "Diagnostics did not agree with the observed Word load state."
        throw "Healthy diagnostics did not agree with Word load state."
    }
    if ($latestLoadState.addInId -ne $addInId -or -not $latestLoadState.ribbonLoadedAt) {
        Set-Assertion "diagnostics-load-state-consistency" "failed" "The captured Word load state is incomplete."
        throw "The captured Word load state is incomplete."
    }
    Set-Assertion "diagnostics-load-state-consistency" "passed"

    $script:currentAssertionId = "diagnostics-failure-detection"
    $stateBackup = Join-Path $workDirectory "word-load-state.backup.json"
    Copy-Item -LiteralPath $statePath -Destination $stateBackup
    Remove-Item -LiteralPath $statePath -Force
    $missingStateDiagnosticsPath = Join-Path $workDirectory "diagnostics-missing-state.json"
    [void](Invoke-Diagnostics $installedDiagnostics $missingStateDiagnosticsPath @(1))
    $missingStateDiagnostics = Get-Content -LiteralPath $missingStateDiagnosticsPath -Raw | ConvertFrom-Json
    if (@($missingStateDiagnostics.checks | Where-Object { $_.id -eq "ribbon-load-state" -and $_.status -eq "failed" }).Count -ne 1) {
        Set-Assertion "diagnostics-failure-detection" "failed" "Diagnostics did not detect missing Ribbon load state."
        throw "Diagnostics did not detect missing Ribbon load state."
    }
    Set-Assertion "diagnostics-failure-detection" "passed"
    Copy-Item -LiteralPath $stateBackup -Destination $statePath -Force

    $script:currentAssertionId = "diagnostics-fault-smoke"
    Set-Content -LiteralPath $statePath -Value "{ malformed load state" -Encoding utf8
    $malformedStateDiagnosticsPath = Join-Path $workDirectory "diagnostics-malformed-state.json"
    [void](Invoke-Diagnostics $installedDiagnostics $malformedStateDiagnosticsPath @(1))
    $malformedStateDiagnostics = Get-Content -LiteralPath $malformedStateDiagnosticsPath -Raw | ConvertFrom-Json
    if (@($malformedStateDiagnostics.checks | Where-Object { $_.id -eq "ribbon-load-state" -and $_.status -eq "failed" }).Count -ne 1) {
        Set-Assertion "diagnostics-fault-smoke" "failed" "Diagnostics did not reject malformed load state."
        throw "Diagnostics did not reject malformed load state."
    }
    Set-Assertion "diagnostics-fault-smoke" "passed"
    Copy-Item -LiteralPath $stateBackup -Destination $statePath -Force

    $script:currentAssertionId = "diagnostics-respects-policy"
    $policyAfter = Get-RegistryPolicyFingerprint
    if ($policyBefore -ne $policyAfter) {
        Set-Assertion "diagnostics-respects-policy" "failed" "Diagnostics modified Office resiliency or policy state."
        throw "Diagnostics modified Office resiliency or policy state."
    }
    Set-Assertion "diagnostics-respects-policy" "passed"

    [void](Invoke-Diagnostics $installedDiagnostics $diagnosticsEvidencePath @(0))

    $uninstallLog = Join-Path $workDirectory "uninstall.raw.log"
    $rawMsiLogs += $uninstallLog
    $script:currentAssertionId = "non-destructive-uninstall"
    Invoke-Msi "uninstall" @("/x", $resolvedInstallerPath) $uninstallLog
    $installed = $false

    $userRegisteredAfterUninstall = Test-RegistryKey ([Microsoft.Win32.RegistryHive]::CurrentUser) ([Microsoft.Win32.RegistryView]::Registry64) $addInRegistryPath
    $sentinelHashAfter = (Get-FileHash -LiteralPath $sentinelPath -Algorithm SHA256).Hash
    $programFilesAfterUninstall = $programFileNames |
        ForEach-Object { Join-Path $installDirectory $_ } |
        Where-Object { Test-Path -LiteralPath $_ }
    if ($programFilesAfterUninstall.Count -gt 0) {
        Set-Assertion "non-destructive-uninstall" "failed" "Uninstall left program files in the per-user installation directory."
        throw "Uninstall left program files."
    }
    if ($userRegisteredAfterUninstall -or (Test-Path -LiteralPath $statePath) -or $sentinelHashAfter -ne $sentinelHash) {
        Set-Assertion "non-destructive-uninstall" "failed" "Uninstall left registration/state or changed the synthetic document sentinel."
        throw "Non-destructive uninstall verification failed."
    }
    Set-Assertion "non-destructive-uninstall" "passed"

    $script:currentAssertionId = "diagnostics-privacy"
    $privacyPaths = @($logPath, $signatureEvidencePath, $wordLoadEvidencePath, $diagnosticsEvidencePath)
    if (-not (Test-EvidencePrivacy $privacyPaths)) {
        Set-Assertion "diagnostics-privacy" "failed" "Text evidence contains a user name or user profile path."
        throw "Evidence privacy verification failed."
    }
    Set-Assertion "diagnostics-privacy" "passed"
}
catch {
    $currentAssertion = $script:assertionById[$script:currentAssertionId]
    if ($currentAssertion.status -notin @("failed", "blocked")) {
        Set-Assertion $script:currentAssertionId "failed" "The assertion failed; see the redacted smoke log."
    }
    Write-SmokeLog ("Smoke run did not pass during assertion " + $script:currentAssertionId + "; errorType=" + (Get-SafeErrorType $_))
}
finally {
    if ($installed -and $resolvedInstallerPath) {
        try {
            $cleanupLog = Join-Path $workDirectory "cleanup-uninstall.raw.log"
            $rawMsiLogs += $cleanupLog
            Invoke-Msi "cleanup-uninstall" @("/x", $resolvedInstallerPath) $cleanupLog
        }
        catch {
            Write-SmokeLog ("Cleanup uninstall failed; errorType=" + (Get-SafeErrorType $_))
        }
    }

    try {
        Archive-RawMsiLogs
    }
    catch {
        Set-Assertion "diagnostics-privacy" "failed" "MSI log summaries could not be archived safely."
        Write-SmokeLog ("MSI log summary failed; errorType=" + (Get-SafeErrorType $_))
    }

    Write-ResultEvidence
    if ((Get-OverallStatus) -eq "passed" -and -not (Test-EvidencePrivacy @($resultPath, $logPath, $signatureEvidencePath, $wordLoadEvidencePath, $diagnosticsEvidencePath))) {
        Set-Assertion "diagnostics-privacy" "failed" "Final text evidence contains a user name or user profile path."
        Write-ResultEvidence
    }

    if (Test-Path -LiteralPath $workDirectory) {
        $verifiedWorkDirectory = [IO.Path]::GetFullPath($workDirectory)
        if ($verifiedWorkDirectory.StartsWith($temporaryPrefix, [StringComparison]::OrdinalIgnoreCase)) {
            Remove-Item -LiteralPath $verifiedWorkDirectory -Recurse -Force
        }
    }
}

$overallStatus = Get-OverallStatus
Write-Output ("VSTO smoke result: " + $overallStatus)
if ($overallStatus -ne "passed") {
    exit 1
}
