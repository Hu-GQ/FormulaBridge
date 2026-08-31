[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("test", "production")]
    [string]$TrustLevel,

    [Parameter(Mandatory = $true)]
    [string]$CertificateThumbprint,

    [string]$TimestampUrl,
    [string]$OutputDirectory,
    [string]$MSBuildPath,
    [string]$SignToolPath,
    [string]$MagePath,
    [string]$WixPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$wordAddInProject = Join-Path $projectRoot "src\desktop\FormulaBridge.WordAddIn\FormulaBridge.WordAddIn.csproj"
$diagnosticsProject = Join-Path $projectRoot "src\desktop\FormulaBridge.Diagnostics\FormulaBridge.Diagnostics.csproj"
$wixSource = Join-Path $projectRoot "installer\FormulaBridge.Installer\Package.wxs"

function Resolve-CommandPath {
    param(
        [string]$ExplicitPath,
        [string]$CommandName,
        [string]$Description
    )

    if ($ExplicitPath) {
        $resolved = Resolve-Path -LiteralPath $ExplicitPath -ErrorAction SilentlyContinue
        if (-not $resolved) {
            throw "$Description is missing: $ExplicitPath"
        }
        return $resolved.Path
    }

    $command = Get-Command $CommandName -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    throw "$Description is unavailable. Install the required build workload or pass its explicit path."
}

function Resolve-MSBuildPath {
    param([string]$ExplicitPath)

    if ($ExplicitPath) {
        return Resolve-CommandPath $ExplicitPath "MSBuild.exe" "Visual Studio MSBuild.exe"
    }

    $command = Get-Command "MSBuild.exe" -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $vswherePath = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path -LiteralPath $vswherePath) {
        $installationPath = & $vswherePath -latest -products * -requires Microsoft.VisualStudio.Component.VSTO -property installationPath
        if ($installationPath) {
            $candidate = Join-Path $installationPath "MSBuild\Current\Bin\MSBuild.exe"
            if (Test-Path -LiteralPath $candidate) {
                return $candidate
            }
        }
    }

    throw "Visual Studio MSBuild.exe with Microsoft.VisualStudio.Tools.Office.targets is unavailable."
}

function Invoke-Checked {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$Description
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Description failed with exit code $LASTEXITCODE."
    }
}

function Get-Sha256Text {
    param([string]$Value)

    $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
    $hash = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($hash.ComputeHash($bytes))).Replace("-", "").ToLowerInvariant()
    }
    finally {
        $hash.Dispose()
    }
}

function Assert-CodeSigningCertificate {
    param(
        [string]$Thumbprint,
        [string]$Level,
        [string]$Timestamp
    )

    $normalizedThumbprint = $Thumbprint.Replace(" ", "").ToUpperInvariant()
    $certificate = Get-Item -LiteralPath ("Cert:\CurrentUser\My\" + $normalizedThumbprint) -ErrorAction SilentlyContinue

    if (-not $certificate) {
        throw "The requested signing certificate is not in Cert:\CurrentUser\My."
    }
    if (-not $certificate.HasPrivateKey) {
        throw "The requested signing certificate has no private key."
    }
    if ($certificate.NotAfter.ToUniversalTime() -le [DateTime]::UtcNow) {
        throw "The requested signing certificate is expired."
    }

    $codeSigningOid = "1.3.6.1.5.5.7.3.3"
    $supportsCodeSigning = $false
    foreach ($extension in $certificate.Extensions) {
        if ($extension -is [Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]) {
            foreach ($oid in $extension.EnhancedKeyUsages) {
                if ($oid.Value -eq $codeSigningOid) {
                    $supportsCodeSigning = $true
                }
            }
        }
    }
    if (-not $supportsCodeSigning) {
        throw "The requested certificate is not valid for code signing."
    }

    $chainTrusted = $certificate.Verify()
    if ($Level -eq "production") {
        if (-not $Timestamp) {
            throw "production signing requires TimestampUrl."
        }
        if (-not $chainTrusted) {
            throw "production signing requires a certificate with a trusted chain."
        }
        if ($certificate.Subject -eq $certificate.Issuer) {
            throw "production signing cannot use a self-signed certificate."
        }
    }

    return [pscustomobject]@{
        Certificate = $certificate
        Thumbprint = $normalizedThumbprint
        ChainTrusted = $chainTrusted
    }
}

function Invoke-SignToolSign {
    param(
        [string]$ToolPath,
        [string]$Thumbprint,
        [string]$Timestamp,
        [string]$ArtifactPath
    )

    $arguments = @("sign", "/sha1", $Thumbprint, "/fd", "sha256")
    if ($Timestamp) {
        $arguments += @("/tr", $Timestamp, "/td", "sha256")
    }
    $arguments += $ArtifactPath
    Invoke-Checked $ToolPath $arguments ("signtool sign " + (Split-Path -Leaf $ArtifactPath))
}

function Invoke-SignToolVerify {
    param(
        [string]$ToolPath,
        [string]$ArtifactPath
    )

    Invoke-Checked $ToolPath @("verify", "/pa", "/all", "/v", $ArtifactPath) ("signtool verify " + (Split-Path -Leaf $ArtifactPath))
}

$signing = Assert-CodeSigningCertificate $CertificateThumbprint $TrustLevel $TimestampUrl
$msbuild = Resolve-MSBuildPath $MSBuildPath
$signtool = Resolve-CommandPath $SignToolPath "signtool.exe" "Windows SDK signtool.exe"
$mage = Resolve-CommandPath $MagePath "mage.exe" ".NET Framework mage.exe"
$wix = Resolve-CommandPath $WixPath "wix.exe" "WiX Toolset 4 wix.exe"

if (-not $OutputDirectory) {
    $runFolder = [DateTime]::UtcNow.ToString("yyyyMMddTHHmmssfffZ")
    $OutputDirectory = Join-Path $projectRoot ("artifacts\vsto-installer\" + $runFolder)
}
$resolvedOutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $resolvedOutputDirectory) {
    if (Get-ChildItem -LiteralPath $resolvedOutputDirectory -Force | Select-Object -First 1) {
        throw "OutputDirectory must be empty: $resolvedOutputDirectory"
    }
}
else {
    New-Item -ItemType Directory -Path $resolvedOutputDirectory | Out-Null
}

$publishDirectory = Join-Path $resolvedOutputDirectory "publish"
$payloadDirectory = Join-Path $resolvedOutputDirectory "payload"
$manifestFilesDirectory = Join-Path $resolvedOutputDirectory "manifest-files"
$diagnosticsDirectory = Join-Path $resolvedOutputDirectory "diagnostics"
$installerPath = Join-Path $resolvedOutputDirectory "FormulaBridge.Phase0.x64.msi"
New-Item -ItemType Directory -Path $publishDirectory | Out-Null
New-Item -ItemType Directory -Path $payloadDirectory | Out-Null
New-Item -ItemType Directory -Path $manifestFilesDirectory | Out-Null
New-Item -ItemType Directory -Path $diagnosticsDirectory | Out-Null

Invoke-Checked $msbuild @(
    $diagnosticsProject,
    "/t:Rebuild",
    "/p:Configuration=Release",
    "/p:Platform=x64",
    "/p:OutputPath=$diagnosticsDirectory\",
    "/nologo",
    "/verbosity:minimal"
) "Build FormulaBridge.Diagnostics"

Invoke-Checked $msbuild @(
    $wordAddInProject,
    "/t:Publish",
    "/p:Configuration=Release",
    "/p:Platform=x64",
    "/p:SignManifests=true",
    ("/p:ManifestCertificateThumbprint=" + $signing.Thumbprint),
    "/p:PublishUrl=$publishDirectory\",
    "/nologo",
    "/verbosity:minimal"
) "Publish FormulaBridge.WordAddIn"

$publishedApplicationManifest = Get-ChildItem -LiteralPath $publishDirectory -Filter "FormulaBridge.WordAddIn.dll.manifest" -File -Recurse | Select-Object -First 1
$publishedDeploymentManifest = Get-ChildItem -LiteralPath $publishDirectory -Filter "FormulaBridge.WordAddIn.vsto" -File -Recurse | Select-Object -First 1
$diagnosticsExecutable = Join-Path $diagnosticsDirectory "FormulaBridge.Diagnostics.exe"

if (-not $publishedApplicationManifest -or -not $publishedDeploymentManifest) {
    throw "The VSTO publish did not produce both application and deployment manifests."
}
$addInPublishDirectory = $publishedApplicationManifest.Directory.FullName
$publishedWordAddInAssembly = Join-Path $addInPublishDirectory "FormulaBridge.WordAddIn.dll"
$publishedUtilitiesAssembly = Join-Path $addInPublishDirectory "Microsoft.Office.Tools.Common.v4.0.Utilities.dll"
if (-not (Test-Path -LiteralPath $publishedWordAddInAssembly) -or
    -not (Test-Path -LiteralPath $publishedUtilitiesAssembly) -or
    -not (Test-Path -LiteralPath $diagnosticsExecutable)) {
    throw "The VSTO or diagnostics binary is missing after build."
}

$manifestWordAddInAssembly = Join-Path $manifestFilesDirectory "FormulaBridge.WordAddIn.dll"
$manifestUtilitiesAssembly = Join-Path $manifestFilesDirectory "Microsoft.Office.Tools.Common.v4.0.Utilities.dll"
$payloadApplicationManifest = Join-Path $payloadDirectory "FormulaBridge.WordAddIn.dll.manifest"
$payloadDeploymentManifest = Join-Path $payloadDirectory "FormulaBridge.WordAddIn.vsto"
Copy-Item -LiteralPath $publishedWordAddInAssembly -Destination $manifestWordAddInAssembly
Copy-Item -LiteralPath $publishedUtilitiesAssembly -Destination $manifestUtilitiesAssembly
Copy-Item -LiteralPath $publishedApplicationManifest.FullName -Destination $payloadApplicationManifest
Copy-Item -LiteralPath $publishedDeploymentManifest.FullName -Destination $payloadDeploymentManifest

Invoke-SignToolSign $signtool $signing.Thumbprint $TimestampUrl $manifestWordAddInAssembly
Invoke-SignToolSign $signtool $signing.Thumbprint $TimestampUrl $diagnosticsExecutable

$applicationManifestArguments = @(
    "-Update",
    $payloadApplicationManifest,
    "-FromDirectory",
    $manifestFilesDirectory,
    "-CertHash",
    $signing.Thumbprint
)
if ($TimestampUrl) {
    $applicationManifestArguments += @("-TimestampUri", $TimestampUrl)
}
Invoke-Checked $mage $applicationManifestArguments "mage -Update application manifest"

$deploymentManifestArguments = @(
    "-Update",
    $payloadDeploymentManifest,
    "-AppManifest",
    $payloadApplicationManifest,
    "-CertHash",
    $signing.Thumbprint
)
if ($TimestampUrl) {
    $deploymentManifestArguments += @("-TimestampUri", $TimestampUrl)
}
Invoke-Checked $mage $deploymentManifestArguments "mage -Update deployment manifest"

Invoke-Checked $mage @("-Verify", $payloadApplicationManifest) "mage -Verify application manifest"
Invoke-Checked $mage @("-Verify", $payloadDeploymentManifest) "mage -Verify deployment manifest"

Copy-Item -LiteralPath $manifestWordAddInAssembly -Destination (Join-Path $payloadDirectory "FormulaBridge.WordAddIn.dll")
Copy-Item -LiteralPath $manifestUtilitiesAssembly -Destination (Join-Path $payloadDirectory "Microsoft.Office.Tools.Common.v4.0.Utilities.dll")

Invoke-Checked $wix @(
    "build",
    $wixSource,
    "-arch",
    "x64",
    "-d",
    ("AddInPublishDir=" + $payloadDirectory),
    "-d",
    ("DiagnosticsPath=" + $diagnosticsExecutable),
    "-o",
    $installerPath
) "wix build per-user installer"

Invoke-SignToolSign $signtool $signing.Thumbprint $TimestampUrl $installerPath
Invoke-SignToolVerify $signtool $manifestWordAddInAssembly
Invoke-SignToolVerify $signtool $diagnosticsExecutable
Invoke-SignToolVerify $signtool $installerPath
Invoke-SignToolVerify $signtool $manifestUtilitiesAssembly

$commit = (& git -C $projectRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) {
    throw "Unable to resolve the source commit."
}
$metadata = [ordered]@{
    schemaVersion = 1
    trustLevel = $TrustLevel
    commit = $commit
    builtAt = [DateTime]::UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'")
    certificate = [ordered]@{
        thumbprint = $signing.Thumbprint.ToLowerInvariant()
        subjectSha256 = Get-Sha256Text $signing.Certificate.Subject
        issuerSha256 = Get-Sha256Text $signing.Certificate.Issuer
        chainTrusted = $signing.ChainTrusted
        timestamped = [bool]$TimestampUrl
    }
    artifacts = [ordered]@{
        installer = "FormulaBridge.Phase0.x64.msi"
        applicationManifest = "payload/FormulaBridge.WordAddIn.dll.manifest"
        deploymentManifest = "payload/FormulaBridge.WordAddIn.vsto"
        wordAddInAssembly = "payload/FormulaBridge.WordAddIn.dll"
        officeToolsUtilities = "payload/Microsoft.Office.Tools.Common.v4.0.Utilities.dll"
        diagnostics = "diagnostics/FormulaBridge.Diagnostics.exe"
    }
}
$metadataPath = Join-Path $resolvedOutputDirectory "build-metadata.json"
$metadata | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $metadataPath -Encoding utf8

Write-Output $resolvedOutputDirectory
