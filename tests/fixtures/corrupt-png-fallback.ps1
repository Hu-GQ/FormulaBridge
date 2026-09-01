param([string]$DocumentPath)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::Open($DocumentPath, [IO.Compression.ZipArchiveMode]::Update)
try {
    $archive.GetEntry("word/media/formula.png").Delete()
    $entry = $archive.CreateEntry("word/media/formula.png")
    $stream = $entry.Open()
    try {
        $bytes = [Text.Encoding]::ASCII.GetBytes("damaged fallback")
        $stream.Write($bytes, 0, $bytes.Length)
    }
    finally { $stream.Dispose() }
}
finally { $archive.Dispose() }
