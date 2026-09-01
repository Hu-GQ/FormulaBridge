Add-Type -AssemblyName System.Drawing
$bitmap = New-Object Drawing.Bitmap 100, 100
$graphics = [Drawing.Graphics]::FromImage($bitmap)
try {
    $graphics.Clear([Drawing.Color]::White)
    $bitmap.Save(($args[-1] + ".png"), [Drawing.Imaging.ImageFormat]::Png)
}
finally {
    $graphics.Dispose()
    $bitmap.Dispose()
}
