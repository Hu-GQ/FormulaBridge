$ErrorActionPreference = "Stop"
$fbProjectRoot = Split-Path -Parent $PSScriptRoot
$fbAssetRoot = [System.IO.Path]::GetFullPath((Join-Path $fbProjectRoot "assets"))
Add-Type -AssemblyName System.Drawing

function New-FormulaBridgeIcon {
    param([int]$Size)
    $fbOutput = [System.IO.Path]::GetFullPath((Join-Path $fbAssetRoot "app-icon-$Size.png"))
    if (-not $fbOutput.StartsWith($fbAssetRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Icon output escaped the assets directory."
    }
    $fbBitmap = New-Object System.Drawing.Bitmap($Size, $Size)
    $fbGraphics = [System.Drawing.Graphics]::FromImage($fbBitmap)
    $fbGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $fbGraphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    try {
        $fbGraphics.Clear([System.Drawing.Color]::FromArgb(91, 95, 199))
        $fbFontSize = [Math]::Max(11, [Math]::Round($Size * 0.43))
        $fbFont = New-Object System.Drawing.Font("Cambria Math", $fbFontSize, [System.Drawing.FontStyle]::Italic, [System.Drawing.GraphicsUnit]::Pixel)
        $fbBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
        $fbFormat = New-Object System.Drawing.StringFormat
        $fbFormat.Alignment = [System.Drawing.StringAlignment]::Center
        $fbFormat.LineAlignment = [System.Drawing.StringAlignment]::Center
        try {
            $fbGraphics.DrawString("ƒ+", $fbFont, $fbBrush, (New-Object System.Drawing.RectangleF(0, 0, $Size, $Size)), $fbFormat)
        }
        finally {
            $fbFormat.Dispose()
            $fbBrush.Dispose()
            $fbFont.Dispose()
        }
        $fbBitmap.Save($fbOutput, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $fbGraphics.Dispose()
        $fbBitmap.Dispose()
    }
    Get-Item -LiteralPath $fbOutput | Select-Object FullName, Length
}

New-FormulaBridgeIcon 32
New-FormulaBridgeIcon 64

