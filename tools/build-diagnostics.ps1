[CmdletBinding()]
param([string]$OutputDirectory, [switch]$TestHarness)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $projectRoot 'artifacts\diagnostics' }
$output = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $output -Force | Out-Null
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$references = Join-Path ${env:ProgramFiles(x86)} 'Reference Assemblies\Microsoft\Framework\.NETFramework\v4.8'
if (-not (Test-Path -LiteralPath $compiler) -or -not (Test-Path -LiteralPath $references)) { throw '.NET Framework 4.8 compiler/reference assemblies are required.' }
$source = Join-Path $projectRoot 'src\desktop\FormulaBridge.Diagnostics'
$name = if ($TestHarness) { 'FormulaBridge.Diagnostics.Tests.exe' } else { 'FormulaBridge.Diagnostics.exe' }
$arguments = @('/nologo', '/noconfig', '/target:exe', '/platform:x64', '/nostdlib+', '/warnaserror+', "/out:$(Join-Path $output $name)")
foreach ($reference in @('mscorlib','System','System.Core','System.Xml','System.Security','System.Runtime.Serialization')) {
    $arguments += '/reference:' + (Join-Path $references ($reference + '.dll'))
}
foreach ($file in @('Program.cs','VstoDiagnostics.cs','WindowsDiagnosticProbe.cs','DeploymentTrust.cs','Properties\AssemblyInfo.cs')) { $arguments += Join-Path $source $file }
if ($TestHarness) {
    $arguments += '/main:FormulaBridge.Diagnostics.DiagnosticsHarness'
    $arguments += Join-Path $projectRoot 'tests\fixtures\DiagnosticsHarness.cs'
}
& $compiler @arguments
if ($LASTEXITCODE -ne 0) { throw 'Diagnostics compilation failed.' }
Write-Output (Join-Path $output $name)
