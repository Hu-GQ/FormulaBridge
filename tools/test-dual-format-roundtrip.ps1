[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$EvidenceDirectory,

    [string]$ExpectedCommit,
    [string]$PdfToPpmPath,
    [string]$PrintToPdfPrinter = "Microsoft Print to PDF",

    [switch]$ProvisionPrintCapture,
    [switch]$PackageOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$resolvedEvidenceDirectory = [IO.Path]::GetFullPath($EvidenceDirectory)
$checkId = "dual-format-roundtrip"
$checkName = "SVG and PNG Word round trip"
$startedAt = [DateTime]::UtcNow
$requiredAssertionIds = @(
    "self-contained-svg-png",
    "save-reopen-roundtrip",
    "same-document-copy",
    "cross-document-copy",
    "print-and-pdf-output",
    "works-without-formulabridge"
)
$script:assertionById = [ordered]@{}
$script:currentAssertionId = $requiredAssertionIds[0]
$script:preflight = $true
$script:word = $null
$script:anchorDocument = $null
$script:openDocuments = @()
$script:capturePrinterName = $null
$script:capturePortName = $null
$script:capturePrinterCreated = $false
$script:capturePortCreated = $false

foreach ($assertionId in $requiredAssertionIds) {
    $script:assertionById[$assertionId] = [ordered]@{
        id = $assertionId
        status = "not-run"
        reason = "The assertion was not reached."
    }
}

function ConvertTo-PortablePath {
    param([string]$RelativePath)
    return $RelativePath.Replace("\", "/")
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

function Import-WordInteropAssemblies {
    $officeAssembly = Get-ChildItem (Join-Path $env:WINDIR "assembly\GAC_MSIL\office") `
        -Recurse -Filter office.dll -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending |
        Select-Object -First 1
    $wordAssembly = Get-ChildItem (Join-Path $env:WINDIR "assembly\GAC_MSIL\Microsoft.Office.Interop.Word") `
        -Recurse -Filter Microsoft.Office.Interop.Word.dll -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending |
        Select-Object -First 1

    if (-not $officeAssembly -or -not $wordAssembly) {
        throw "The Microsoft Office primary interop assemblies are unavailable."
    }

    Add-Type -Path $officeAssembly.FullName
    Add-Type -Path $wordAssembly.FullName
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

    return (@("passed", "not-run", "blocked", "failed") |
        Where-Object { $precedence[$_] -eq $highest } |
        Select-Object -First 1)
}

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

    $portableRelativePath = $RelativePath.Replace("/", [IO.Path]::DirectorySeparatorChar)
    $candidate = [IO.Path]::GetFullPath((Join-Path $resolvedEvidenceDirectory $portableRelativePath))
    $prefix = $resolvedEvidenceDirectory.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $candidate.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Evidence path escaped EvidenceDirectory."
    }
    return $candidate
}

function Invoke-NodePackageTool {
    param([string[]]$Arguments)

    & node (Join-Path $PSScriptRoot "dual-format-package.js") @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "The dual-format package tool failed with exit code $LASTEXITCODE."
    }
}

if ($PackageOnly) {
    $fixtureDirectory = Join-Path $resolvedEvidenceDirectory "fixture"
    $sourceDocumentPath = Join-Path $fixtureDirectory "source.docx"
    $assetsDirectory = Join-Path $fixtureDirectory "assets"
    $inspectionPath = Join-Path $resolvedEvidenceDirectory "package-inspection.json"

    Invoke-NodePackageTool @(
        "create",
        "--output", $sourceDocumentPath,
        "--inspection", $inspectionPath,
        "--assets", $assetsDirectory
    )
    return
}

$resultRelativePath = "evidence/$checkId/result/result.json"
$logRelativePath = "evidence/$checkId/log/smoke.log"
$docxPackageRelativePath = "evidence/$checkId/docx-package/roundtrip-documents.zip"
$pdfRelativePath = "evidence/$checkId/pdf/word-export.pdf"
$printRelativePath = "evidence/$checkId/print-output/word-print.pdf"
$visualRelativePath = "evidence/$checkId/visual-diff/visual-diff.json"
$resultPath = Resolve-EvidencePath $resultRelativePath
$logPath = Resolve-EvidencePath $logRelativePath
$docxPackagePath = Resolve-EvidencePath $docxPackageRelativePath
$pdfPath = Resolve-EvidencePath $pdfRelativePath
$printPath = Resolve-EvidencePath $printRelativePath
$visualPath = Resolve-EvidencePath $visualRelativePath
$workDirectory = Resolve-EvidencePath "work"
$documentEvidenceDirectory = Join-Path $workDirectory "docx-evidence"

foreach ($path in @($resultPath, $logPath, $docxPackagePath, $pdfPath, $printPath, $visualPath)) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $path) -Force | Out-Null
}
New-Item -ItemType Directory -Path $documentEvidenceDirectory -Force | Out-Null

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

function Invoke-PackageInspection {
    param(
        [string]$DocumentPath,
        [string]$Name
    )

    $inspectionPath = Join-Path $documentEvidenceDirectory ($Name + "-inspection.json")
    Invoke-NodePackageTool @(
        "inspect",
        "--input", $DocumentPath,
        "--output", $inspectionPath
    )
    return (Get-Content -LiteralPath $inspectionPath -Raw | ConvertFrom-Json)
}

function Assert-DualFormatPackage {
    param(
        [object]$Inspection,
        [int]$ExpectedReferences,
        [string]$Description
    )

    if ($Inspection.svgMediaParts -lt 1 -or $Inspection.pngMediaParts -lt 1) {
        throw "$Description lost an SVG or PNG media part."
    }
    if (
        $Inspection.svgBlipReferences -ne $ExpectedReferences -or
        $Inspection.pngFallbackReferences -ne $ExpectedReferences
    ) {
        throw "$Description does not contain the expected dual-format drawing references."
    }
    if (
        $Inspection.externalImageRelationships -ne 0 -or
        $Inspection.externalFontRelationships -ne 0 -or
        $Inspection.danglingImageReferences -ne 0 -or
        $Inspection.externalSvgReferences -ne 0 -or
        $Inspection.externalFontReferences -ne 0 -or
        $Inspection.executableSvgElements -ne 0
    ) {
        throw "$Description contains an external or executable SVG dependency."
    }
}

function Save-WordDocument {
    param(
        [object]$Document,
        [string]$Path
    )

    $wdFormatDocumentDefault = 16
    $Document.SaveAs2($Path, $wdFormatDocumentDefault)
}

function Get-InlineShapeCount {
    param([object]$Document)

    $inlineShapes = $Document.InlineShapes
    if ($null -eq $inlineShapes) {
        return 0
    }
    try {
        return [int]$inlineShapes.Count
    }
    catch {
        return @($inlineShapes).Count
    }
}

function Get-InlineShape {
    param(
        [object]$Document,
        [int]$Index
    )

    $inlineShapes = $Document.InlineShapes
    try {
        return $inlineShapes.Item($Index)
    }
    catch {
        return @($inlineShapes)[$Index - 1]
    }
}

function Close-WordDocument {
    param([object]$Document)

    if ($null -ne $Document) {
        try {
            $Document.Close(0)
        }
        catch {
        }
    }
}

function Wait-ForFile {
    param(
        [string]$Path,
        [int]$TimeoutSeconds
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $previousLength = -1
    $stableObservations = 0
    do {
        if (Test-Path -LiteralPath $Path) {
            $item = Get-Item -LiteralPath $Path
            if ($item.Length -gt 0) {
                if ($item.Length -eq $previousLength) {
                    $stableObservations += 1
                }
                else {
                    $previousLength = $item.Length
                    $stableObservations = 0
                }
                if ($stableObservations -ge 2) {
                    return
                }
            }
        }
        Start-Sleep -Milliseconds 200
    } while ([DateTime]::UtcNow -lt $deadline)

    throw "Timed out waiting for the print output."
}

function Assert-PdfStructure {
    param(
        [string]$Path,
        [string]$Description
    )

    $item = Get-Item -LiteralPath $Path -ErrorAction Stop
    if ($item.Length -lt 1024) {
        throw "$Description is unexpectedly small."
    }

    $stream = [IO.File]::OpenRead($Path)
    try {
        $header = New-Object byte[] 5
        if ($stream.Read($header, 0, $header.Length) -ne $header.Length) {
            throw "$Description has no PDF header."
        }
        if ([Text.Encoding]::ASCII.GetString($header) -ne "%PDF-") {
            throw "$Description is not a PDF."
        }
    }
    finally {
        $stream.Dispose()
    }
}

function Invoke-PdfRender {
    param(
        [string]$RendererPath,
        [string]$InputPath,
        [string]$OutputPrefix
    )

    & $RendererPath "-png" "-singlefile" "-r" "144" $InputPath $OutputPrefix 2>&1 |
        ForEach-Object { Write-SmokeLog ("pdftoppm: " + $_) }
    if ($LASTEXITCODE -ne 0) {
        throw "pdftoppm failed with exit code $LASTEXITCODE."
    }

    $renderedPath = $OutputPrefix + ".png"
    if (-not (Test-Path -LiteralPath $renderedPath)) {
        throw "pdftoppm did not create the expected PNG."
    }
    return $renderedPath
}

function Get-InkBounds {
    param(
        [Drawing.Bitmap]$Bitmap,
        [switch]$UseAlpha
    )

    $minimumX = $Bitmap.Width
    $minimumY = $Bitmap.Height
    $maximumX = -1
    $maximumY = -1

    for ($y = 0; $y -lt $Bitmap.Height; $y += 1) {
        for ($x = 0; $x -lt $Bitmap.Width; $x += 1) {
            $pixel = $Bitmap.GetPixel($x, $y)
            $isInk = if ($UseAlpha) {
                $pixel.A -gt 32
            }
            else {
                (($pixel.R + $pixel.G + $pixel.B) / 3) -lt 245
            }
            if ($isInk) {
                $minimumX = [Math]::Min($minimumX, $x)
                $minimumY = [Math]::Min($minimumY, $y)
                $maximumX = [Math]::Max($maximumX, $x)
                $maximumY = [Math]::Max($maximumY, $y)
            }
        }
    }

    if ($maximumX -lt $minimumX -or $maximumY -lt $minimumY) {
        throw "The rendered image contains no visible formula ink."
    }

    return [Drawing.Rectangle]::FromLTRB($minimumX, $minimumY, $maximumX + 1, $maximumY + 1)
}

function New-NormalizedBitmap {
    param(
        [Drawing.Bitmap]$Bitmap,
        [Drawing.Rectangle]$Bounds
    )

    $normalized = New-Object Drawing.Bitmap 160, 50
    $graphics = [Drawing.Graphics]::FromImage($normalized)
    try {
        $graphics.Clear([Drawing.Color]::White)
        $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $destination = New-Object Drawing.Rectangle 0, 0, 160, 50
        $graphics.DrawImage($Bitmap, $destination, $Bounds, [Drawing.GraphicsUnit]::Pixel)
    }
    finally {
        $graphics.Dispose()
    }
    return $normalized
}

function Compare-FormulaVisual {
    param(
        [string]$ReferencePath,
        [string]$RenderedPath,
        [string]$Description
    )

    $reference = [Drawing.Bitmap]::FromFile($ReferencePath)
    $rendered = [Drawing.Bitmap]::FromFile($RenderedPath)
    $normalizedReference = $null
    $normalizedRendered = $null
    try {
        $referenceBounds = Get-InkBounds $reference -UseAlpha
        $renderedBounds = Get-InkBounds $rendered
        $normalizedReference = New-NormalizedBitmap $reference $referenceBounds
        $normalizedRendered = New-NormalizedBitmap $rendered $renderedBounds

        $absoluteError = 0.0
        $referenceInk = 0
        $renderedInk = 0
        $pixelCount = $normalizedReference.Width * $normalizedReference.Height

        for ($y = 0; $y -lt $normalizedReference.Height; $y += 1) {
            for ($x = 0; $x -lt $normalizedReference.Width; $x += 1) {
                $referencePixel = $normalizedReference.GetPixel($x, $y)
                $renderedPixel = $normalizedRendered.GetPixel($x, $y)
                $referenceGray = ($referencePixel.R + $referencePixel.G + $referencePixel.B) / 3.0
                $renderedGray = ($renderedPixel.R + $renderedPixel.G + $renderedPixel.B) / 3.0
                $absoluteError += [Math]::Abs($referenceGray - $renderedGray) / 255.0
                if ($referenceGray -lt 200) { $referenceInk += 1 }
                if ($renderedGray -lt 200) { $renderedInk += 1 }
            }
        }

        $meanAbsoluteError = $absoluteError / $pixelCount
        $referenceAspect = $referenceBounds.Width / [double]$referenceBounds.Height
        $renderedAspect = $renderedBounds.Width / [double]$renderedBounds.Height
        $aspectRatioDelta = [Math]::Abs($referenceAspect - $renderedAspect) / $referenceAspect
        $inkRatioDelta = [Math]::Abs($referenceInk - $renderedInk) / [double][Math]::Max(1, $referenceInk)

        if ($meanAbsoluteError -gt 0.35) {
            throw "$Description exceeds the normalized mean-absolute-error tolerance."
        }
        if ($aspectRatioDelta -gt 0.35) {
            throw "$Description exceeds the aspect-ratio tolerance."
        }
        if ($inkRatioDelta -gt 0.70) {
            throw "$Description exceeds the visible-ink tolerance."
        }

        return [ordered]@{
            renderedWidth = $rendered.Width
            renderedHeight = $rendered.Height
            inkBounds = [ordered]@{
                x = $renderedBounds.X
                y = $renderedBounds.Y
                width = $renderedBounds.Width
                height = $renderedBounds.Height
            }
            meanAbsoluteError = [Math]::Round($meanAbsoluteError, 6)
            aspectRatioDelta = [Math]::Round($aspectRatioDelta, 6)
            inkRatioDelta = [Math]::Round($inkRatioDelta, 6)
        }
    }
    finally {
        if ($null -ne $normalizedReference) { $normalizedReference.Dispose() }
        if ($null -ne $normalizedRendered) { $normalizedRendered.Dispose() }
        $reference.Dispose()
        $rendered.Dispose()
    }
}

$sourceDocumentPath = Join-Path $documentEvidenceDirectory "source.docx"
$roundtripDocumentPath = Join-Path $documentEvidenceDirectory "save-reopen.docx"
$sameCopyDocumentPath = Join-Path $documentEvidenceDirectory "same-document-copy.docx"
$crossCopyDocumentPath = Join-Path $documentEvidenceDirectory "cross-document-copy.docx"
$assetsDirectory = Join-Path $workDirectory "assets"
$sourceInspectionPath = Join-Path $documentEvidenceDirectory "source-inspection.json"
$referencePngPath = Join-Path $assetsDirectory "formula.png"
$captureOutputPath = Join-Path $workDirectory ("print-capture-{0}.pdf" -f $PID)
$pdfRenderer = $null
$failureReason = $null
$effectivePrinterName = $PrintToPdfPrinter

try {
    Write-SmokeLog ("Starting dual-format Word round-trip smoke for commit " + ($ExpectedCommit ?? "<unspecified>"))

    if (Get-Process -Name WINWORD -ErrorAction SilentlyContinue) {
        throw "Close all Word windows before running the isolated round-trip smoke."
    }

    $pdfRenderer = Resolve-CommandPath $PdfToPpmPath "pdftoppm.exe" "Poppler pdftoppm"
    Import-WordInteropAssemblies
    $printer = Get-CimInstance -ClassName Win32_Printer |
        Where-Object { $_.Name -eq $PrintToPdfPrinter } |
        Select-Object -First 1
    if (-not $printer) {
        throw "The requested print-to-PDF printer is unavailable."
    }
    if (-not $ProvisionPrintCapture -and $printer.PortName -eq "PORTPROMPT:") {
        throw "The requested print-to-PDF printer requires an interactive output prompt; rerun with -ProvisionPrintCapture."
    }

    if ($ProvisionPrintCapture) {
        $script:capturePrinterName = "FormulaBridge Phase0 Capture {0}" -f $PID
        $script:capturePortName = $captureOutputPath
        if (Get-Printer -Name $script:capturePrinterName -ErrorAction SilentlyContinue) {
            throw "The temporary print capture printer already exists."
        }
        if (Get-PrinterPort -Name $script:capturePortName -ErrorAction SilentlyContinue) {
            throw "The temporary print capture port already exists."
        }
        Add-PrinterPort -Name $script:capturePortName -ErrorAction Stop
        $script:capturePortCreated = $true
        Add-Printer `
            -Name $script:capturePrinterName `
            -DriverName $printer.DriverName `
            -PortName $script:capturePortName `
            -ErrorAction Stop
        $script:capturePrinterCreated = $true
        $effectivePrinterName = $script:capturePrinterName
    }

    $script:word = New-Object -ComObject Word.Application
    $script:word.Visible = $false
    $script:word.DisplayAlerts = 0
    $script:word.AutomationSecurity = 3

    $formulaBridgeAddIn = $null
    try {
        $formulaBridgeAddIn = $script:word.COMAddIns.Item("FormulaBridge.WordAddIn")
    }
    catch {
    }
    if ($null -ne $formulaBridgeAddIn -and $formulaBridgeAddIn.Connect) {
        $formulaBridgeAddIn.Connect = $false
    }
    if ($null -ne $formulaBridgeAddIn -and $formulaBridgeAddIn.Connect) {
        throw "FormulaBridge could not be unloaded from the smoke Word instance."
    }

    $script:anchorDocument = $script:word.Documents.Add()

    $script:preflight = $false
    Write-SmokeLog "Preflight passed with a dedicated hidden Word instance and FormulaBridge disconnected."

    Invoke-NodePackageTool @(
        "create",
        "--output", $sourceDocumentPath,
        "--inspection", $sourceInspectionPath,
        "--assets", $assetsDirectory
    )
    $sourceInspection = Get-Content -LiteralPath $sourceInspectionPath -Raw | ConvertFrom-Json
    Assert-DualFormatPackage $sourceInspection 1 "The source DOCX"
    Set-Assertion "self-contained-svg-png" "passed"
    Write-SmokeLog "The source package contains self-contained SVG and PNG fallback media."

    $script:currentAssertionId = "save-reopen-roundtrip"
    $document = $script:word.Documents.Open($sourceDocumentPath, $false, $false)
    Save-WordDocument $document $roundtripDocumentPath
    Close-WordDocument $document
    $document = $null

    $document = $script:word.Documents.Open($roundtripDocumentPath, $false, $false)
    if ((Get-InlineShapeCount $document) -ne 1) {
        throw "The reopened document does not contain exactly one formula drawing."
    }
    $document.Save()
    Close-WordDocument $document
    $document = $null

    $roundtripInspection = Invoke-PackageInspection $roundtripDocumentPath "save-reopen"
    Assert-DualFormatPackage $roundtripInspection 1 "The saved and reopened DOCX"
    Set-Assertion "save-reopen-roundtrip" "passed"
    Write-SmokeLog "Word save, close, and reopen preserved the dual-format relationship."

    $script:currentAssertionId = "same-document-copy"
    $document = $script:word.Documents.Open($roundtripDocumentPath, $false, $false)
    (Get-InlineShape $document 1).Range.Copy()
    $newParagraph = $document.Paragraphs.Add()
    $pasteRange = $newParagraph.Range
    $pasteRange.Collapse(1)
    $pasteRange.Paste()
    if ((Get-InlineShapeCount $document) -ne 2) {
        throw "Ordinary same-document copy did not create a second formula drawing."
    }
    Save-WordDocument $document $sameCopyDocumentPath
    Close-WordDocument $document
    $document = $null

    $sameCopyInspection = Invoke-PackageInspection $sameCopyDocumentPath "same-document-copy"
    Assert-DualFormatPackage $sameCopyInspection 2 "The same-document copy DOCX"
    Set-Assertion "same-document-copy" "passed"
    Write-SmokeLog "Ordinary same-document copy preserved both formats."

    $script:currentAssertionId = "cross-document-copy"
    $document = $script:word.Documents.Open($roundtripDocumentPath, $false, $false)
    (Get-InlineShape $document 1).Range.Copy()
    $targetDocument = $script:word.Documents.Add()
    $targetRange = $targetDocument.Range(0, 0)
    $targetRange.Paste()
    if ((Get-InlineShapeCount $targetDocument) -ne 1) {
        throw "Ordinary cross-document copy did not create a formula drawing."
    }
    Save-WordDocument $targetDocument $crossCopyDocumentPath
    Close-WordDocument $targetDocument
    $targetDocument = $null
    Close-WordDocument $document
    $document = $null

    $crossCopyInspection = Invoke-PackageInspection $crossCopyDocumentPath "cross-document-copy"
    Assert-DualFormatPackage $crossCopyInspection 1 "The cross-document copy DOCX"
    Set-Assertion "cross-document-copy" "passed"
    Write-SmokeLog "Ordinary cross-document copy preserved both formats."

    $script:currentAssertionId = "print-and-pdf-output"
    $document = $script:word.Documents.Open($roundtripDocumentPath, $false, $true)
    $wdExportFormatPdf = 17
    $document.ExportAsFixedFormat($pdfPath, $wdExportFormatPdf)

    $script:word.ActivePrinter = $effectivePrinterName
    [object]$background = $false
    [object]$append = $false
    [object]$range = 0
    [object]$outputFileName = if ($ProvisionPrintCapture) { [Type]::Missing } else { $printPath }
    [object]$from = ""
    [object]$to = ""
    [object]$item = 0
    [object]$copies = 1
    [object]$pages = ""
    [object]$pageType = 0
    [object]$printToFile = -not $ProvisionPrintCapture
    [object]$collate = $true
    $document.Activate()
    Write-SmokeLog ("Printing through Word active printer: " + $script:word.ActivePrinter)
    $documentPointer = [Runtime.InteropServices.Marshal]::GetIUnknownForObject($document)
    try {
        $typedDocument = [Runtime.InteropServices.Marshal]::GetTypedObjectForIUnknown(
            $documentPointer,
            [Microsoft.Office.Interop.Word._Document])
    }
    finally {
        [void][Runtime.InteropServices.Marshal]::Release($documentPointer)
    }
    $typedDocument.PrintOut(
        [ref]$background,
        [ref]$append,
        [ref]$range,
        [ref]$outputFileName,
        [ref]$from,
        [ref]$to,
        [ref]$item,
        [ref]$copies,
        [ref]$pages,
        [ref]$pageType,
        [ref]$printToFile,
        [ref]$collate)
    $pendingPrintPath = if ($ProvisionPrintCapture) { $captureOutputPath } else { $printPath }
    Wait-ForFile $pendingPrintPath 30
    if ($ProvisionPrintCapture) {
        Move-Item -LiteralPath $captureOutputPath -Destination $printPath
    }
    Close-WordDocument $document
    $document = $null

    Assert-PdfStructure $pdfPath "The Word PDF export"
    Assert-PdfStructure $printPath "The Word print output"
    $exportRenderPath = Invoke-PdfRender $pdfRenderer $pdfPath (Join-Path $workDirectory "word-export")
    $printRenderPath = Invoke-PdfRender $pdfRenderer $printPath (Join-Path $workDirectory "word-print")

    Add-Type -AssemblyName System.Drawing
    $exportVisual = Compare-FormulaVisual $referencePngPath $exportRenderPath "The Word PDF export"
    $printVisual = Compare-FormulaVisual $referencePngPath $printRenderPath "The Word print output"
    [ordered]@{
        schemaVersion = 1
        renderer = "Poppler pdftoppm"
        normalization = [ordered]@{
            width = 160
            height = 50
        }
        tolerances = [ordered]@{
            maximumMeanAbsoluteError = 0.35
            maximumAspectRatioDelta = 0.35
            maximumInkRatioDelta = 0.70
        }
        export = $exportVisual
        print = $printVisual
    } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $visualPath -Encoding utf8

    Set-Assertion "print-and-pdf-output" "passed"
    Write-SmokeLog "Word print and PDF export passed structure and tolerance-based visual checks."

    $script:currentAssertionId = "works-without-formulabridge"
    Set-Assertion "works-without-formulabridge" "passed"
    Write-SmokeLog "All Word operations completed with FormulaBridge absent or disconnected."

    Compress-Archive -Path (Join-Path $documentEvidenceDirectory "*") -DestinationPath $docxPackagePath
}
catch {
    $failureReason = $_.Exception.Message
    if ($script:preflight) {
        Set-Assertion $script:currentAssertionId "blocked" $failureReason
    }
    else {
        Set-Assertion $script:currentAssertionId "failed" ("The smoke failed with " + (Get-SafeErrorType $_) + ".")
    }
    Write-SmokeLog ("Smoke stopped: " + (Get-SafeErrorType $_) + ": " + $failureReason)
    Write-SmokeLog ("Failure line: " + $_.InvocationInfo.ScriptLineNumber)
    Write-SmokeLog ("Stack: " + $_.ScriptStackTrace)
}
finally {
    foreach ($openDocument in $script:openDocuments) {
        Close-WordDocument $openDocument
    }
    if ($null -ne $script:anchorDocument) {
        Close-WordDocument $script:anchorDocument
        $script:anchorDocument = $null
    }
    if ($null -ne $script:word) {
        try {
            $script:word.Quit()
        }
        catch {
        }
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($script:word)
        $script:word = $null
    }
    if ($script:capturePrinterCreated) {
        try {
            Remove-Printer -Name $script:capturePrinterName -ErrorAction Stop
        }
        catch {
            $failureReason = "The temporary print capture printer could not be removed."
            Set-Assertion "print-and-pdf-output" "failed" $failureReason
            Write-SmokeLog ("Temporary capture printer cleanup failed with " + (Get-SafeErrorType $_) + ".")
        }
        $script:capturePrinterCreated = $false
    }
    if ($script:capturePortCreated) {
        try {
            Remove-PrinterPort -Name $script:capturePortName -ErrorAction Stop
        }
        catch {
            $failureReason = "The temporary print capture port could not be removed."
            Set-Assertion "print-and-pdf-output" "failed" $failureReason
            Write-SmokeLog ("Temporary capture port cleanup failed with " + (Get-SafeErrorType $_) + ".")
        }
        $script:capturePortCreated = $false
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}

$overallStatus = Get-OverallStatus
$result = [ordered]@{
    schemaVersion = 1
    checkId = $checkId
    status = $overallStatus
    assertions = @($script:assertionById.Values)
}
$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $resultPath -Encoding utf8

$evidence = @(
    [ordered]@{ path = $resultRelativePath; kind = "result" },
    [ordered]@{ path = $logRelativePath; kind = "log" }
)
if ($overallStatus -eq "passed") {
    $evidence += [ordered]@{ path = $docxPackageRelativePath; kind = "docx-package" }
    $evidence += [ordered]@{ path = $pdfRelativePath; kind = "pdf" }
    $evidence += [ordered]@{ path = $printRelativePath; kind = "print-output" }
    $evidence += [ordered]@{ path = $visualRelativePath; kind = "visual-diff" }
}

$fragment = [ordered]@{
    id = $checkId
    name = $checkName
    status = $overallStatus
    startedAt = $startedAt.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'")
    finishedAt = [DateTime]::UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'")
    evidence = $evidence
}
if ($overallStatus -eq "blocked" -or $overallStatus -eq "not-run") {
    $fragment.reason = Protect-EvidenceText ($failureReason ?? "The smoke did not complete.")
}
$fragment | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $resolvedEvidenceDirectory "check-fragment.json") -Encoding utf8

if ($overallStatus -eq "passed") {
    exit 0
}
exit 1
