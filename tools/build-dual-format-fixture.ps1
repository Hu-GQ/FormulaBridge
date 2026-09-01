[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$OutputDirectory,
    [ValidatePattern('^[0-9]+\.[0-9]+\.[0-9]+$')]
    [string]$FixtureVersion = "1.0.0",
    [string]$PdfToPpmPath = "pdftoppm"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $projectRoot "tests/fixtures/dual-format/formula.tex"
$outputPath = [IO.Path]::GetFullPath($OutputDirectory)
$buildPath = Join-Path $projectRoot ("artifacts/dual-format-fixture-{0}" -f $PID)
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
New-Item -ItemType Directory -Path $buildPath -Force | Out-Null

foreach ($engine in @("latex", "pdflatex")) {
    & $engine "-no-shell-escape" "-interaction=nonstopmode" "-halt-on-error" "-output-directory=$buildPath" $sourcePath
    if ($LASTEXITCODE -ne 0) { throw "$engine failed with exit code $LASTEXITCODE." }
}

$svgPath = Join-Path $outputPath "formula.svg"
$pngPath = Join-Path $outputPath "formula.png"
& dvisvgm "--no-fonts" "--bbox=papersize" "--output=$svgPath" (Join-Path $buildPath "formula.dvi")
if ($LASTEXITCODE -ne 0) { throw "dvisvgm failed with exit code $LASTEXITCODE." }
& $PdfToPpmPath "-png" "-singlefile" "-r" "288" (Join-Path $buildPath "formula.pdf") (Join-Path $outputPath "formula")
if ($LASTEXITCODE -ne 0) { throw "pdftoppm failed with exit code $LASTEXITCODE." }

$destinationSourcePath = Join-Path $outputPath "formula.tex"
if ($sourcePath -ne $destinationSourcePath) {
    Copy-Item -LiteralPath $sourcePath -Destination $destinationSourcePath
}
$svg = [IO.File]::ReadAllText($svgPath).Replace("`r`n", "`n")
[IO.File]::WriteAllText($svgPath, $svg, [Text.UTF8Encoding]::new($false))
$viewBox = [regex]::Match($svg, "viewBox='([^']+)'").Groups[1].Value.Split(" ")
if ($viewBox.Count -ne 4) { throw "The generated SVG has no usable viewBox." }
$invariant = [Globalization.CultureInfo]::InvariantCulture
$entries = @("formula.tex", "formula.svg", "formula.png") | ForEach-Object {
    [ordered]@{
        path = $_
        sha256 = (Get-FileHash -LiteralPath (Join-Path $outputPath $_) -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}
$manifest = [ordered]@{
    schemaVersion = 1
    fixtureVersion = $FixtureVersion
    formula = "x^2 + y^2 = z^2"
    provenance = [ordered]@{
        kind = "local-tex-render"
        engine = ((& latex --version | Select-Object -First 1).ToString())
        svgConverter = ((& dvisvgm --version | Select-Object -First 1).ToString())
        pngConverter = ((& $PdfToPpmPath -v 2>&1 | Select-Object -First 1).ToString())
        source = "formula.tex"
        shellEscape = $false
        commands = @(
            "latex -no-shell-escape -interaction=nonstopmode -halt-on-error formula.tex",
            "pdflatex -no-shell-escape -interaction=nonstopmode -halt-on-error formula.tex",
            "dvisvgm --no-fonts --bbox=papersize --output=formula.svg formula.dvi",
            "pdftoppm -png -singlefile -r 288 formula.pdf formula"
        )
    }
    svgDimensions = [ordered]@{
        width = [double]::Parse($viewBox[2], $invariant)
        height = [double]::Parse($viewBox[3], $invariant)
    }
    entries = $entries
}
$manifestJson = ($manifest | ConvertTo-Json -Depth 8).Replace("`r`n", "`n") + "`n"
[IO.File]::WriteAllText((Join-Path $outputPath "manifest.json"), $manifestJson, [Text.UTF8Encoding]::new($false))
