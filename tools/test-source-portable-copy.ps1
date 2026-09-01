[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$EvidenceDirectory,

    [Parameter(Mandatory = $true)]
    [ValidatePattern("^[0-9a-f]{40}$")]
    [string]$ExpectedCommit,

    [Parameter(Mandatory = $true)]
    [string]$FragmentPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$checkId = "source-portable-copy"
$checkName = "Source-portable ordinary copy"
$formulaTitle = "FormulaBridge Formula"
$formulaTagPrefix = "FormulaBridge.Formula:"
$carrierTag = "FormulaBridge.CopyCarrier:v1"
$formulaNamespace = "urn:formulabridge:formula-metadata:v1"
$latexSource = "x^2 + y^2 = z^2"
$visibleFormula = "x² + y² = z²"
$formulaLabel = "eq:quadratic"
$bookmarkName = "FormulaBridge_eq_quadratic"
$requiredAssertions = @(
    "managed-formula-payload",
    "same-document-copy",
    "cross-document-copy",
    "new-copy-identity",
    "move-preserves-identity",
    "save-reopen-preserves-source",
    "package-and-word-automation"
)
$startedAt = [DateTime]::UtcNow.ToString("o")
$currentAssertion = $requiredAssertions[0]
$assertions = [ordered]@{}
$logLines = [System.Collections.Generic.List[string]]::new()
$word = $null
$sourceDocument = $null
$targetDocument = $null
$reopenedSource = $null
$reopenedTarget = $null
$status = "failed"
$failure = $null
$evidence = [System.Collections.Generic.List[object]]::new()

foreach ($assertionId in $requiredAssertions) {
    $assertions[$assertionId] = [ordered]@{
        id = $assertionId
        status = "not-run"
        reason = "The automation has not reached this assertion"
    }
}

function Write-Utf8File {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$Content
    )

    $parent = Split-Path -Parent $Path
    if ($parent) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}

function Convert-ToPortablePath {
    param([Parameter(Mandatory = $true)][string]$Path)

    return $Path.Replace("\", "/")
}

function Set-AssertionPassed {
    param([Parameter(Mandatory = $true)][string]$Id)

    $script:assertions[$Id] = [ordered]@{
        id = $Id
        status = "passed"
    }
    $script:logLines.Add("PASS $Id")
}

function Get-SanitizedError {
    param([Parameter(Mandatory = $true)][System.Exception]$Exception)

    $message = $Exception.Message.Replace("`r", " ").Replace("`n", " ")
    if ($script:resolvedEvidenceDirectory) {
        $message = $message.Replace($script:resolvedEvidenceDirectory, "[evidence]")
    }
    if ($env:USERPROFILE) {
        $message = $message.Replace($env:USERPROFILE, "[user]")
    }
    return $Exception.GetType().Name + ": " + $message
}

function Get-PayloadChecksum {
    param([Parameter(Mandatory = $true)]$Payload)

    $canonical = @(
        [string]$Payload.schemaVersion,
        [string]$Payload.formulaId,
        [string]$Payload.label,
        [string]$Payload.latex
    ) -join "`n"
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($canonical)
        return -join ($sha256.ComputeHash($bytes) | ForEach-Object { $_.ToString("x2") })
    }
    finally {
        $sha256.Dispose()
    }
}

function New-FormulaPayload {
    param(
        [Parameter(Mandatory = $true)][string]$FormulaId,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Label,
        [Parameter(Mandatory = $true)][string]$Latex
    )

    $payload = [pscustomobject][ordered]@{
        schemaVersion = 1
        formulaId = $FormulaId
        label = $Label
        latex = $Latex
        checksum = ""
    }
    $payload.checksum = Get-PayloadChecksum -Payload $payload
    return $payload
}

function ConvertTo-CarrierText {
    param([Parameter(Mandatory = $true)]$Payload)

    $json = ConvertTo-Json -InputObject $Payload -Compress -Depth 4
    return [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($json))
}

function Get-ManagedControls {
    param([Parameter(Mandatory = $true)]$Document)

    $collection = $Document.SelectContentControlsByTitle($script:formulaTitle)
    $items = [System.Collections.Generic.List[object]]::new()
    for ($index = 1; $index -le $collection.Count; $index++) {
        $items.Add($collection.Item($index))
    }
    return $items.ToArray()
}

function Get-CopyCarrier {
    param(
        [Parameter(Mandatory = $true)]$Document,
        [Parameter(Mandatory = $true)]$FormulaControl
    )

    $collection = $Document.SelectContentControlsByTag($script:carrierTag)
    $matches = [System.Collections.Generic.List[object]]::new()
    for ($index = 1; $index -le $collection.Count; $index++) {
        $candidate = $collection.Item($index)
        if (
            $candidate.Range.Start -ge $FormulaControl.Range.Start -and
            $candidate.Range.End -le $FormulaControl.Range.End
        ) {
            $matches.Add($candidate)
        }
    }
    if ($matches.Count -ne 1) {
        throw "A managed formula must contain exactly one portable copy carrier"
    }
    return $matches[0]
}

function Read-FormulaPayload {
    param(
        [Parameter(Mandatory = $true)]$Document,
        [Parameter(Mandatory = $true)]$FormulaControl
    )

    $carrier = Get-CopyCarrier -Document $Document -FormulaControl $FormulaControl
    $carrierRange = $carrier.Range.Duplicate
    $carrierRange.TextRetrievalMode.IncludeHiddenText = $true
    $encoded = ($carrierRange.Text -replace "\s", "")
    try {
        $json = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded))
        $payload = ConvertFrom-Json -InputObject $json
    }
    catch {
        throw "The portable copy carrier is not valid base64 JSON"
    }

    if ($null -eq $payload) {
        throw "The portable copy carrier JSON decoded to null; encoded length: $($encoded.Length); carrier range: $($carrier.Range.Start)-$($carrier.Range.End)"
    }
    $propertyNames = @(
        $payload |
            Get-Member -MemberType NoteProperty |
            Select-Object -ExpandProperty Name
    )
    if ($propertyNames -notcontains "schemaVersion") {
        throw "The portable copy carrier JSON is missing schemaVersion; properties: $($propertyNames -join ',')"
    }

    if (
        $payload.schemaVersion -ne 1 -or
        $payload.formulaId -ne $FormulaControl.Tag.Substring($script:formulaTagPrefix.Length) -or
        $payload.checksum -ne (Get-PayloadChecksum -Payload $payload)
    ) {
        throw "The content-control identity and portable copy carrier disagree"
    }

    return $payload
}

function Write-FormulaPayload {
    param(
        [Parameter(Mandatory = $true)]$Document,
        [Parameter(Mandatory = $true)]$FormulaControl,
        [Parameter(Mandatory = $true)]$Payload
    )

    $carrier = Get-CopyCarrier -Document $Document -FormulaControl $FormulaControl
    $carrier.LockContents = $false
    $carrier.LockContentControl = $false
    $carrier.Range.Text = ConvertTo-CarrierText -Payload $Payload
    $carrier.Range.Font.Hidden = -1
    $carrier.Range.Font.Size = 1
    $carrier.Range.NoProofing = -1
    $FormulaControl.Tag = $script:formulaTagPrefix + $Payload.formulaId
}

function ConvertTo-XmlText {
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Value)

    return [System.Security.SecurityElement]::Escape($Value)
}

function Update-FormulaStore {
    param([Parameter(Mandatory = $true)]$Document)

    for ($index = $Document.CustomXMLParts.Count; $index -ge 1; $index--) {
        $part = $Document.CustomXMLParts.Item($index)
        if ($part.NamespaceURI -eq $script:formulaNamespace) {
            $part.Delete()
        }
    }

    $records = [System.Text.StringBuilder]::new()
    foreach ($control in (Get-ManagedControls -Document $Document)) {
        $payload = Read-FormulaPayload -Document $Document -FormulaControl $control
        [void]$records.Append("<fb:formula id=`"")
        [void]$records.Append((ConvertTo-XmlText -Value $payload.formulaId))
        [void]$records.Append("`" label=`"")
        [void]$records.Append((ConvertTo-XmlText -Value $payload.label))
        [void]$records.Append("`" checksum=`"")
        [void]$records.Append((ConvertTo-XmlText -Value $payload.checksum))
        [void]$records.Append("`"><fb:latex>")
        [void]$records.Append((ConvertTo-XmlText -Value $payload.latex))
        [void]$records.Append("</fb:latex></fb:formula>")
    }

    $xml = "<fb:formulas xmlns:fb=`"$($script:formulaNamespace)`" schemaVersion=`"1`">" +
        $records.ToString() + "</fb:formulas>"
    [void]$Document.CustomXMLParts.Add($xml)
}

function Add-ManagedFormula {
    param(
        [Parameter(Mandatory = $true)]$Document,
        [Parameter(Mandatory = $true)][string]$FormulaId,
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][string]$Latex
    )

    $payload = New-FormulaPayload -FormulaId $FormulaId -Label $Label -Latex $Latex
    $insertion = $Document.Range($Document.Content.End - 1, $Document.Content.End - 1)
    $start = $insertion.Start
    $insertion.InsertAfter($script:visibleFormula)
    $formulaRange = $Document.Range($start, $start + $script:visibleFormula.Length)
    $formulaControl = $Document.ContentControls.Add(0, $formulaRange)
    $formulaControl.Title = $script:formulaTitle
    $formulaControl.Tag = $script:formulaTagPrefix + $FormulaId

    $carrierText = ConvertTo-CarrierText -Payload $payload
    $carrierStart = $formulaControl.Range.End - 1
    $carrierInsertion = $Document.Range($carrierStart, $carrierStart)
    $carrierInsertion.InsertAfter($carrierText)
    $carrierRange = $Document.Range($carrierStart, $carrierStart + $carrierText.Length)
    $carrier = $Document.ContentControls.Add(1, $carrierRange)
    $carrier.Title = "FormulaBridge Copy Carrier"
    $carrier.Tag = $script:carrierTag
    $carrier.Range.Text = $carrierText
    $carrier.Range.Font.Hidden = -1
    $carrier.Range.Font.Size = 1
    $carrier.Range.NoProofing = -1

    Update-FormulaStore -Document $Document
    return $formulaControl
}

function Get-LastManagedControl {
    param([Parameter(Mandatory = $true)]$Document)

    $controls = @(Get-ManagedControls -Document $Document)
    if ($controls.Count -eq 0) {
        throw "Word did not paste a managed formula content control"
    }
    return $controls | Sort-Object { $_.Range.Start } | Select-Object -Last 1
}

function Copy-FormulaThroughClipboard {
    param(
        [Parameter(Mandatory = $true)]$Application,
        [Parameter(Mandatory = $true)]$FormulaControl,
        [Parameter(Mandatory = $true)]$TargetDocument
    )

    $FormulaControl.Range.Select()
    $Application.Selection.Copy()
    $TargetDocument.Activate()
    $target = $TargetDocument.Range($TargetDocument.Content.End - 1, $TargetDocument.Content.End - 1)
    $target.Select()
    $Application.Selection.Paste()
    return Get-LastManagedControl -Document $TargetDocument
}

function Remove-ContainedBookmarks {
    param([Parameter(Mandatory = $true)]$FormulaControl)

    while ($FormulaControl.Range.Bookmarks.Count -gt 0) {
        $FormulaControl.Range.Bookmarks.Item(1).Delete()
    }
}

function Reidentify-CopiedFormula {
    param(
        [Parameter(Mandatory = $true)]$Document,
        [Parameter(Mandatory = $true)]$FormulaControl
    )

    $payload = Read-FormulaPayload -Document $Document -FormulaControl $FormulaControl
    $replacement = New-FormulaPayload `
        -FormulaId ([Guid]::NewGuid().ToString("D")) `
        -Label "" `
        -Latex $payload.latex
    Remove-ContainedBookmarks -FormulaControl $FormulaControl
    Write-FormulaPayload -Document $Document -FormulaControl $FormulaControl -Payload $replacement
    Update-FormulaStore -Document $Document
    return $replacement
}

function Get-ControlByFormulaId {
    param(
        [Parameter(Mandatory = $true)]$Document,
        [Parameter(Mandatory = $true)][string]$FormulaId
    )

    $matches = @(
        Get-ManagedControls -Document $Document | Where-Object {
            $_.Tag -eq ($script:formulaTagPrefix + $FormulaId)
        }
    )
    if ($matches.Count -ne 1) {
        throw "Expected exactly one managed formula with the requested identity"
    }
    return $matches[0]
}

function Assert-Condition {
    param(
        [Parameter(Mandatory = $true)][bool]$Condition,
        [Parameter(Mandatory = $true)][string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

function Save-Docx {
    param(
        [Parameter(Mandatory = $true)]$Document,
        [Parameter(Mandatory = $true)][string]$Path
    )

    $Document.SaveAs2($Path, 12)
}

function Close-WordDocument {
    param($Document)

    if ($null -ne $Document) {
        try {
            $Document.Close(0)
        }
        catch {
        }
    }
}

function Invoke-DocxInspector {
    param(
        [Parameter(Mandatory = $true)][string]$NodePath,
        [Parameter(Mandatory = $true)][string]$InspectorPath,
        [Parameter(Mandatory = $true)][string]$DocumentPath
    )

    $output = & $NodePath $InspectorPath $DocumentPath 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "DOCX package inspection failed"
    }
    return ($output -join "`n" | ConvertFrom-Json)
}

$resolvedEvidenceDirectory = [System.IO.Path]::GetFullPath($EvidenceDirectory)
$resolvedFragmentPath = [System.IO.Path]::GetFullPath($FragmentPath)
$workingDirectory = Join-Path $resolvedEvidenceDirectory ("source-portable-copy-work-" + [Guid]::NewGuid().ToString("N"))
$sourcePath = Join-Path $workingDirectory "source.docx"
$targetPath = Join-Path $workingDirectory "target.docx"
$packageStaging = Join-Path $workingDirectory "package-evidence"
$resultRelativePath = "evidence/source-portable-copy/result/result.json"
$logRelativePath = "evidence/source-portable-copy/log/word-automation.log"
$packageRelativePath = "evidence/source-portable-copy/docx-package/package-evidence.zip"
$automationRelativePath = "evidence/source-portable-copy/word-automation/word-automation.json"
$resultPath = Join-Path $resolvedEvidenceDirectory $resultRelativePath
$logPath = Join-Path $resolvedEvidenceDirectory $logRelativePath
$packagePath = Join-Path $resolvedEvidenceDirectory $packageRelativePath
$automationPath = Join-Path $resolvedEvidenceDirectory $automationRelativePath

foreach ($staleEvidencePath in @(
    $resultPath,
    $logPath,
    $packagePath,
    $automationPath,
    $resolvedFragmentPath
)) {
    if (Test-Path -LiteralPath $staleEvidencePath) {
        Remove-Item -LiteralPath $staleEvidencePath -Force
    }
}

New-Item -ItemType Directory -Path $workingDirectory -Force | Out-Null

try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0
    $sourceDocument = $word.Documents.Add()
    $targetDocument = $word.Documents.Add()
    $sourceDocument.Activate()

    $originalId = [Guid]::NewGuid().ToString("D")
    $original = Add-ManagedFormula `
        -Document $sourceDocument `
        -FormulaId $originalId `
        -Label $formulaLabel `
        -Latex $latexSource
    $originalPayload = Read-FormulaPayload -Document $sourceDocument -FormulaControl $original
    $originalCarrier = Get-CopyCarrier -Document $sourceDocument -FormulaControl $original
    Assert-Condition ($originalPayload.latex -eq $latexSource) "The authoritative LaTeX source is missing"
    Assert-Condition ($originalPayload.label -eq $formulaLabel) "The formula label is missing"
    Assert-Condition ($originalCarrier.Range.Font.Hidden -ne 0) "The object-portable carrier is not hidden"
    Assert-Condition ($original.Range.Text.Contains($visibleFormula)) "The visible representation is missing"
    Set-AssertionPassed -Id "managed-formula-payload"

    [void]$sourceDocument.Bookmarks.Add($bookmarkName, $original.Range)
    $referenceRange = $sourceDocument.Range($sourceDocument.Content.End - 1, $sourceDocument.Content.End - 1)
    $referenceRange.InsertAfter(" Reference: ")
    $referenceRange.Collapse(0)
    [void]$sourceDocument.Fields.Add($referenceRange, -1, "REF $bookmarkName \\h", $false)

    $currentAssertion = "same-document-copy"
    $sameDocumentCopy = Copy-FormulaThroughClipboard `
        -Application $word `
        -FormulaControl $original `
        -TargetDocument $sourceDocument
    $sameDocumentPayload = Reidentify-CopiedFormula `
        -Document $sourceDocument `
        -FormulaControl $sameDocumentCopy
    Assert-Condition ((Get-ManagedControls -Document $sourceDocument).Count -eq 2) "Same-document paste did not create a second formula"
    Assert-Condition ($sameDocumentPayload.latex -eq $latexSource) "Same-document paste lost its LaTeX source"
    Set-AssertionPassed -Id "same-document-copy"

    $currentAssertion = "new-copy-identity"
    $originalAfterCopy = Read-FormulaPayload -Document $sourceDocument -FormulaControl $original
    Assert-Condition ($sameDocumentPayload.formulaId -ne $originalId) "Same-document paste reused the original UUID"
    Assert-Condition ($sameDocumentPayload.label -eq "") "Same-document paste retained the original label"
    Assert-Condition ($originalAfterCopy.formulaId -eq $originalId) "Copy changed the original UUID"
    Assert-Condition ($originalAfterCopy.label -eq $formulaLabel) "Copy changed the original label"
    Set-AssertionPassed -Id "new-copy-identity"

    $currentAssertion = "move-preserves-identity"
    $original.Range.Select()
    $word.Selection.Cut()
    $moveTarget = $sourceDocument.Range($sourceDocument.Content.End - 1, $sourceDocument.Content.End - 1)
    $moveTarget.Select()
    $word.Selection.Paste()
    $movedOriginal = Get-ControlByFormulaId -Document $sourceDocument -FormulaId $originalId
    Update-FormulaStore -Document $sourceDocument
    Assert-Condition $sourceDocument.Bookmarks.Exists($bookmarkName) "Moving the formula removed its reference bookmark"
    $bookmarkPayload = Read-FormulaPayload `
        -Document $sourceDocument `
        -FormulaControl (Get-ControlByFormulaId -Document $sourceDocument -FormulaId $originalId)
    Assert-Condition ($bookmarkPayload.formulaId -eq $originalId) "Moving the formula changed its UUID"
    Assert-Condition ($bookmarkPayload.label -eq $formulaLabel) "Moving the formula changed its label"
    [void]$sourceDocument.Fields.Update()
    Assert-Condition ($sourceDocument.Fields.Count -ge 1) "Moving the formula removed its managed REF field"
    Assert-Condition ($sourceDocument.Fields.Item(1).Code.Text.Contains($bookmarkName)) "The REF field no longer targets the original bookmark"
    Set-AssertionPassed -Id "move-preserves-identity"

    $currentAssertion = "cross-document-copy"
    $crossDocumentCopy = Copy-FormulaThroughClipboard `
        -Application $word `
        -FormulaControl $movedOriginal `
        -TargetDocument $targetDocument
    $crossDocumentPayload = Reidentify-CopiedFormula `
        -Document $targetDocument `
        -FormulaControl $crossDocumentCopy
    Assert-Condition ($crossDocumentPayload.formulaId -ne $originalId) "Cross-document paste reused the original UUID"
    Assert-Condition ($crossDocumentPayload.label -eq "") "Cross-document paste retained the original label"
    Assert-Condition ($crossDocumentPayload.latex -eq $latexSource) "Cross-document paste lost its LaTeX source"
    Assert-Condition (-not $targetDocument.Bookmarks.Exists($bookmarkName)) "Cross-document copy retained the source reference bookmark"
    $sourceOriginalAfterCrossCopy = Read-FormulaPayload -Document $sourceDocument -FormulaControl $movedOriginal
    Assert-Condition ($sourceOriginalAfterCrossCopy.formulaId -eq $originalId) "Cross-document copy changed the original UUID"
    Assert-Condition ($sourceOriginalAfterCrossCopy.label -eq $formulaLabel) "Cross-document copy changed the original label"
    Set-AssertionPassed -Id "cross-document-copy"

    $currentAssertion = "save-reopen-preserves-source"
    Update-FormulaStore -Document $sourceDocument
    Update-FormulaStore -Document $targetDocument
    Save-Docx -Document $sourceDocument -Path $sourcePath
    Save-Docx -Document $targetDocument -Path $targetPath
    Close-WordDocument -Document $sourceDocument
    $sourceDocument = $null
    $reopenedSource = $word.Documents.Open($sourcePath, $false, $false)
    Close-WordDocument -Document $targetDocument
    $targetDocument = $null
    $reopenedTarget = $word.Documents.Open($targetPath, $false, $false)
    $sourcePayloads = @(
        Get-ManagedControls -Document $reopenedSource | ForEach-Object {
            Read-FormulaPayload -Document $reopenedSource -FormulaControl $_
        }
    )
    $targetPayloads = @(
        Get-ManagedControls -Document $reopenedTarget | ForEach-Object {
            Read-FormulaPayload -Document $reopenedTarget -FormulaControl $_
        }
    )
    Assert-Condition ($sourcePayloads.Count -eq 2) "The source document did not retain both formula instances"
    Assert-Condition ($targetPayloads.Count -eq 1) "The target document did not retain its pasted formula"
    Assert-Condition (@($sourcePayloads | Where-Object { $_.formulaId -eq $originalId -and $_.label -eq $formulaLabel }).Count -eq 1) "The reopened original identity or label is wrong"
    Assert-Condition (@($sourcePayloads | Where-Object { $_.formulaId -eq $sameDocumentPayload.formulaId -and $_.label -eq "" }).Count -eq 1) "The reopened same-document copy identity is wrong"
    Assert-Condition (@($targetPayloads | Where-Object { $_.formulaId -eq $crossDocumentPayload.formulaId -and $_.label -eq "" }).Count -eq 1) "The reopened cross-document copy identity is wrong"
    Assert-Condition (@($sourcePayloads | Where-Object { $_.latex -ne $latexSource }).Count -eq 0) "The reopened source document changed LaTeX source"
    Assert-Condition (@($targetPayloads | Where-Object { $_.latex -ne $latexSource }).Count -eq 0) "The reopened target document changed LaTeX source"
    Set-AssertionPassed -Id "save-reopen-preserves-source"

    $currentAssertion = "package-and-word-automation"
    Close-WordDocument -Document $reopenedSource
    $reopenedSource = $null
    Close-WordDocument -Document $reopenedTarget
    $reopenedTarget = $null

    $nodePath = (Get-Command node -ErrorAction Stop).Source
    $inspectorPath = Join-Path $PSScriptRoot "source-portable-copy\inspect-docx.js"
    $sourceInspection = Invoke-DocxInspector `
        -NodePath $nodePath `
        -InspectorPath $inspectorPath `
        -DocumentPath $sourcePath
    $targetInspection = Invoke-DocxInspector `
        -NodePath $nodePath `
        -InspectorPath $inspectorPath `
        -DocumentPath $targetPath
    Assert-Condition ($sourceInspection.formulas.Count -eq 2) "Package inspection did not find both source-document formulas"
    Assert-Condition ($targetInspection.formulas.Count -eq 1) "Package inspection did not find the target-document formula"

    New-Item -ItemType Directory -Path $packageStaging -Force | Out-Null
    Copy-Item -LiteralPath $sourcePath -Destination (Join-Path $packageStaging "source.docx")
    Copy-Item -LiteralPath $targetPath -Destination (Join-Path $packageStaging "target.docx")
    Write-Utf8File -Path (Join-Path $packageStaging "package-inspection.json") -Content (([ordered]@{
        schemaVersion = 1
        source = $sourceInspection
        target = $targetInspection
    } | ConvertTo-Json -Depth 8) + "`n")
    New-Item -ItemType Directory -Path (Split-Path -Parent $packagePath) -Force | Out-Null
    [System.IO.Compression.ZipFile]::CreateFromDirectory(
        $packageStaging,
        $packagePath,
        [System.IO.Compression.CompressionLevel]::Optimal,
        $false
    )

    $automationEvidence = [ordered]@{
        schemaVersion = 1
        commit = $ExpectedCommit
        wordVersion = $word.Version
        clipboardPath = "Word.Selection.Copy/Paste and Word.Selection.Cut/Paste"
        original = [ordered]@{
            formulaId = $originalId
            label = $formulaLabel
        }
        sameDocumentCopy = [ordered]@{
            formulaId = $sameDocumentPayload.formulaId
            label = $sameDocumentPayload.label
        }
        crossDocumentCopy = [ordered]@{
            formulaId = $crossDocumentPayload.formulaId
            label = $crossDocumentPayload.label
        }
        move = [ordered]@{
            formulaId = $bookmarkPayload.formulaId
            label = $bookmarkPayload.label
            referenceBookmark = $bookmarkName
        }
        saveReopen = [ordered]@{
            sourceFormulaCount = $sourceInspection.formulas.Count
            targetFormulaCount = $targetInspection.formulas.Count
        }
    }
    Write-Utf8File -Path $automationPath -Content (($automationEvidence | ConvertTo-Json -Depth 8) + "`n")
    Set-AssertionPassed -Id "package-and-word-automation"
    $status = "passed"
}
catch {
    $failure = (Get-SanitizedError -Exception $_.Exception) + " at script line " + $_.InvocationInfo.ScriptLineNumber
    $assertions[$currentAssertion] = [ordered]@{
        id = $currentAssertion
        status = "failed"
        reason = $failure
    }
    $logLines.Add("FAIL $currentAssertion - $failure")
}
finally {
    Close-WordDocument -Document $sourceDocument
    Close-WordDocument -Document $targetDocument
    Close-WordDocument -Document $reopenedSource
    Close-WordDocument -Document $reopenedTarget
    if ($null -ne $word) {
        try {
            $word.Quit()
        }
        catch {
        }
    }

    for ($index = 0; $index -lt $requiredAssertions.Count; $index++) {
        $assertionId = $requiredAssertions[$index]
        if ($assertions[$assertionId].status -eq "not-run") {
            $assertions[$assertionId].reason = if ($failure) {
                "A previous assertion stopped the automation"
            }
            else {
                "The automation did not execute this assertion"
            }
        }
    }

    $resultEvidence = [ordered]@{
        schemaVersion = 1
        checkId = $checkId
        status = $status
        assertions = @($requiredAssertions | ForEach-Object { $assertions[$_] })
    }
    Write-Utf8File -Path $resultPath -Content (($resultEvidence | ConvertTo-Json -Depth 6) + "`n")
    Write-Utf8File -Path $logPath -Content (($logLines -join "`n") + "`n")

    if ($status -ne "passed" -and (Test-Path -LiteralPath $workingDirectory)) {
        try {
            New-Item -ItemType Directory -Path (Split-Path -Parent $packagePath) -Force | Out-Null
            [System.IO.Compression.ZipFile]::CreateFromDirectory(
                $workingDirectory,
                $packagePath,
                [System.IO.Compression.CompressionLevel]::Optimal,
                $false
            )
        }
        catch {
            $archiveFailure = Get-SanitizedError -Exception $_.Exception
            $logLines.Add("WARN failed to archive the synthetic reproduction package - $archiveFailure")
            Write-Utf8File -Path $logPath -Content (($logLines -join "`n") + "`n")
        }
    }

    $evidence.Add([ordered]@{ path = $resultRelativePath; kind = "result" })
    $evidence.Add([ordered]@{ path = $logRelativePath; kind = "log" })
    if (Test-Path -LiteralPath $packagePath) {
        $evidence.Add([ordered]@{ path = $packageRelativePath; kind = "docx-package" })
    }
    if (Test-Path -LiteralPath $automationPath) {
        $evidence.Add([ordered]@{ path = $automationRelativePath; kind = "word-automation" })
    }

    $fragment = [ordered]@{
        id = $checkId
        name = $checkName
        status = $status
        startedAt = $startedAt
        finishedAt = [DateTime]::UtcNow.ToString("o")
        evidence = $evidence.ToArray()
    }
    Write-Utf8File -Path $resolvedFragmentPath -Content (($fragment | ConvertTo-Json -Depth 6) + "`n")

    if (Test-Path -LiteralPath $workingDirectory) {
        Remove-Item -LiteralPath $workingDirectory -Recurse -Force
    }
}

if ($status -ne "passed") {
    [Console]::Error.WriteLine("source-portable-copy: " + $(if ($failure) { $failure } else { "automation failed" }))
    exit 1
}
