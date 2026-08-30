param(
    [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"
$fbProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutputPath) {
    $OutputPath = Join-Path $fbProjectRoot "artifacts\formulabridge-smoke.docx"
}
$fbResolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
$fbArtifactRoot = [System.IO.Path]::GetFullPath((Join-Path $fbProjectRoot "artifacts"))
if (-not $fbResolvedOutput.StartsWith($fbArtifactRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "The smoke-test output must remain inside the project artifacts directory."
}

$fbOutputDirectory = Split-Path -Parent $fbResolvedOutput
[System.IO.Directory]::CreateDirectory($fbOutputDirectory) | Out-Null

Push-Location $fbProjectRoot
try {
    $fbCompiledJson = & node "tools\create-word-smoke-fixture.js"
    if ($LASTEXITCODE -ne 0) {
        throw "The formula compiler failed."
    }
    $fbCompiled = $fbCompiledJson | ConvertFrom-Json
}
finally {
    Pop-Location
}

$fbContentTypes = @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>
'@

$fbRootRelationships = @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>
'@

$fbDocumentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">' +
    '<w:body><w:p><w:r><w:t>FormulaBridge clean-machine smoke test</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t xml:space="preserve">Inline equation: </w:t></w:r>' + $fbCompiled.inline.ooxml + '</w:p>' +
    $fbCompiled.display.ooxml +
    $fbCompiled.numbered.ooxml +
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>' +
    '</w:body></w:document>'

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Add-FormulaBridgeZipText {
    param(
        [System.IO.Compression.ZipArchive]$Archive,
        [string]$EntryName,
        [string]$Content
    )
    $fbEntry = $Archive.CreateEntry($EntryName, [System.IO.Compression.CompressionLevel]::Optimal)
    $fbStream = $fbEntry.Open()
    $fbUtf8 = New-Object System.Text.UTF8Encoding($false)
    $fbWriter = New-Object System.IO.StreamWriter($fbStream, $fbUtf8)
    try {
        $fbWriter.Write($Content)
    }
    finally {
        $fbWriter.Dispose()
        $fbStream.Dispose()
    }
}

$fbFileStream = [System.IO.File]::Open($fbResolvedOutput, [System.IO.FileMode]::Create, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
$fbArchive = New-Object System.IO.Compression.ZipArchive($fbFileStream, [System.IO.Compression.ZipArchiveMode]::Create, $false)
try {
    Add-FormulaBridgeZipText $fbArchive "[Content_Types].xml" $fbContentTypes
    Add-FormulaBridgeZipText $fbArchive "_rels/.rels" $fbRootRelationships
    Add-FormulaBridgeZipText $fbArchive "word/document.xml" $fbDocumentXml
}
finally {
    $fbArchive.Dispose()
    $fbFileStream.Dispose()
}

$fbWord = $null
$fbDocument = $null
try {
    $fbWord = New-Object -ComObject Word.Application
    $fbWord.Visible = $false
    $fbWord.DisplayAlerts = 0
    $fbDocument = $fbWord.Documents.Open($fbResolvedOutput, $false, $true)
    $fbMathCount = $fbDocument.OMaths.Count
    $fbControlCount = $fbDocument.ContentControls.Count
    $fbFieldCount = $fbDocument.Fields.Count
    $fbTags = @()
    for ($fbIndex = 1; $fbIndex -le $fbControlCount; $fbIndex += 1) {
        $fbTags += $fbDocument.ContentControls.Item($fbIndex).Tag
    }
    if ($fbMathCount -lt 3) {
        throw "Word found $fbMathCount native equations; expected at least 3."
    }
    if ($fbControlCount -lt 3) {
        throw "Word found $fbControlCount FormulaBridge content controls ($($fbTags -join ', ')); expected at least 3."
    }
    if ($fbFieldCount -lt 1) {
        throw "Word found $fbFieldCount native numbering fields; expected at least 1."
    }
    [pscustomobject]@{
        OutputPath = $fbResolvedOutput
        NativeEquationCount = $fbMathCount
        ContentControlCount = $fbControlCount
        ContentControlTags = $fbTags -join ", "
        NumberingFieldCount = $fbFieldCount
        WordVersion = $fbWord.Version
        ReadOnlyOpen = $fbDocument.ReadOnly
    }
}
finally {
    if ($fbDocument) {
        try {
            $fbDocument.Close(0)
        }
        catch {
            Write-Warning "Word closed the test document before cleanup completed: $($_.Exception.Message)"
        }
    }
    if ($fbWord) {
        try {
            $fbWord.Quit()
        }
        catch {
            Write-Warning "Word exited before the automation cleanup call completed: $($_.Exception.Message)"
        }
    }
    if ($fbDocument) {
        try {
            [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($fbDocument)
        }
        catch {
            Write-Warning "The Word document COM handle was already released."
        }
    }
    if ($fbWord) {
        try {
            [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($fbWord)
        }
        catch {
            Write-Warning "The Word application COM handle was already released."
        }
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
