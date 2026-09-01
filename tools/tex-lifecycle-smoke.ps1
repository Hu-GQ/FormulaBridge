# Called only after the supported-platform and benign-isolation gates have passed.
function Invoke-TexLifecycleSmoke {
    $harnessProject = Join-Path $projectRoot 'tests\fixtures\TexLifecycleHarness\TexLifecycleHarness.csproj'
    & dotnet build $harnessProject --configuration Release --nologo *> $null
    if ($LASTEXITCODE -ne 0) { throw 'The lifecycle test host could not be built.' }
    $harness = Join-Path $projectRoot 'tests\fixtures\TexLifecycleHarness\bin\Release\net10.0-windows\TexLifecycleHarness.exe'
    $sequenceRoot = Join-Path $workspace 'lifecycle'
    New-Item -ItemType Directory -Path $sequenceRoot -Force | Out-Null
    $sequence = [Collections.Generic.List[object]]::new()
    $specs = @(
        @{ id = 'initial-benign'; source = 'formula\benign-lualatex.tex' },
        @{ id = 'cancel'; source = 'malicious-tex\resource-cancellation.tex' },
        @{ id = 'after-cancel'; source = 'formula\benign-lualatex.tex' },
        @{ id = 'timeout'; source = 'malicious-tex\resource-exhaustion.tex' },
        @{ id = 'after-timeout'; source = 'formula\benign-lualatex.tex' },
        @{ id = 'memory'; source = 'malicious-tex\resource-memory.tex' },
        @{ id = 'after-memory'; source = 'formula\benign-lualatex.tex' },
        @{ id = 'output-files'; source = 'malicious-tex\resource-output.tex' },
        @{ id = 'after-output-files'; source = 'formula\benign-lualatex.tex' },
        @{ id = 'output-bytes'; source = 'malicious-tex\resource-output-bytes.tex' },
        @{ id = 'after-output-bytes'; source = 'formula\benign-lualatex.tex' },
        @{ id = 'child-process'; source = 'malicious-tex\shell-and-process.tex' },
        @{ id = 'after-child-process'; source = 'formula\benign-lualatex.tex' }
    )
    foreach ($spec in $specs) {
        $caseRoot = Join-Path $sequenceRoot $spec.id
        $job = Join-Path $caseRoot 'job'
        $output = Join-Path $job 'output'
        New-Item -ItemType Directory -Path $output -Force | Out-Null
        $lifecycleInputPath = Join-Path $job 'input.tex'
        $source = Get-CaseSource $spec.source
        $source = $source.Replace('@@OUTPUT_FILE_COUNT@@', ([long]$policy.ceilings.outputFiles + 1).ToString([Globalization.CultureInfo]::InvariantCulture))
        $source = $source.Replace('@@OUTPUT_BYTES@@', ([long]$policy.ceilings.outputBytes + 1).ToString([Globalization.CultureInfo]::InvariantCulture))
        Write-TexInput $lifecycleInputPath $source
        $request = Join-Path $caseRoot 'request.json'
        $seconds = if ($spec.id -eq 'timeout') { 2 } else { [int]$policy.ceilings.interactiveSeconds }
        Write-EvidenceJson $request ([ordered]@{
            schemaVersion = 1; enginePath = [IO.Path]::GetFullPath($EnginePath); texRoot = [IO.Path]::GetFullPath($TexRoot)
            engineSha256 = $ExpectedEngineSha256; jobRoot = $job; inputPath = $lifecycleInputPath; outputDirectory = $output
            mode = 'interactive'; testWallClockSeconds = $seconds
        })
        $sequence.Add([ordered]@{ id = $spec.id; request = $request; cancelWhenReady = ($spec.id -eq 'cancel') })
    }
    $sequencePath = Join-Path $sequenceRoot 'sequence.json'
    Write-EvidenceJson $sequencePath @($sequence)
    $word = $null
    $document = $null
    $range = $null
    $hostProcess = $null
    $wordResponsive = $false
    $wordProbes = 0
    $wordAvailable = -not (Get-Process -Name WINWORD -ErrorAction SilentlyContinue)
    $lifecycle = $null
    try {
        if ($wordAvailable) {
            try {
                $word = New-Object -ComObject Word.Application
                $word.Visible = $false
                $word.AutomationSecurity = 3
                $document = $word.Documents.Add()
                $range = $document.Content
                $range.Text = 'FormulaBridge synthetic resource-lifecycle sentinel'
                $wordResponsive = $true
            }
            catch { $wordAvailable = $false; $wordResponsive = $false }
        }
        $start = [Diagnostics.ProcessStartInfo]::new($harness)
        $start.UseShellExecute = $false
        $start.CreateNoWindow = $true
        $start.RedirectStandardOutput = $true
        $start.RedirectStandardError = $true
        $start.ArgumentList.Add($sequencePath)
        $hostProcess = [Diagnostics.Process]::Start($start)
        $stdout = $hostProcess.StandardOutput.ReadToEndAsync()
        $stderr = $hostProcess.StandardError.ReadToEndAsync()
        $deadline = [DateTime]::UtcNow.AddMinutes(8)
        do {
            if ($wordAvailable) {
                try {
                    $wordProbes++
                    $wordResponsive = $wordResponsive -and ([string]$word.Version).Length -gt 0 -and
                        ([string]$range.Text).Trim() -eq 'FormulaBridge synthetic resource-lifecycle sentinel'
                }
                catch { $wordResponsive = $false }
            }
            if ([DateTime]::UtcNow -ge $deadline) { $hostProcess.Kill($true); throw 'Lifecycle host exceeded its bounded test timeout.' }
        } while (-not $hostProcess.WaitForExit(500))
        if ($wordAvailable) {
            try {
                $wordProbes++
                $wordResponsive = $wordResponsive -and ([string]$word.Version).Length -gt 0 -and
                    ([string]$range.Text).Trim() -eq 'FormulaBridge synthetic resource-lifecycle sentinel'
            }
            catch { $wordResponsive = $false }
        }
        $text = $stdout.GetAwaiter().GetResult()
        [void]$stderr.GetAwaiter().GetResult()
        $lifecycle = $text | ConvertFrom-Json -Depth 20
        $lifecycle | Add-Member -NotePropertyName wordResponsive -NotePropertyValue ($wordAvailable -and $wordResponsive -and $wordProbes -gt 0)
        $lifecycle | Add-Member -NotePropertyName wordProbeCount -NotePropertyValue $wordProbes
        Write-EvidenceJson $lifecycleReportPath $lifecycle
        if ($hostProcess.ExitCode -ne 0) { throw 'Lifecycle host failed; completed cases are preserved in lifecycle-report.' }
        $policyPath = Join-Path $sequenceRoot 'policy.json'
        Write-EvidenceJson $policyPath $policy
        $assessment = (& node (Join-Path $projectRoot 'tools\tex-lifecycle-evidence.js') $lifecycleReportPath $policyPath) | ConvertFrom-Json
        if ($LASTEXITCODE -ne 0) { throw 'Lifecycle evidence validation failed.' }
        if ($assessment.cancellation) { Set-Assertion 'cancellation-and-process-tree' 'passed' '' }
        else { Set-Assertion 'cancellation-and-process-tree' 'failed' 'Cancellation or timeout did not prove complete process and identity cleanup.' }
        if ($assessment.recovery) { Set-Assertion 'same-host-recovery' 'passed' '' }
        else { Set-Assertion 'same-host-recovery' 'failed' 'One host did not recover after each verified adversarial task.' }
        if (-not $assessment.resources) { Set-Assertion 'resource-and-process-limits' 'failed' 'Same-host resource probes did not demonstrate the immutable ceilings.' }
        if ($assessment.word) { Set-Assertion 'word-survives-resource-failures' 'passed' '' }
        elseif (-not $wordAvailable) { Set-Assertion 'word-survives-resource-failures' 'blocked' 'A separate available Word instance is required; close existing Word windows before this test.' }
        else { Set-Assertion 'word-survives-resource-failures' 'failed' 'Word did not preserve and respond with the synthetic sentinel during the resource probes.' }
    }
    finally {
        if ($hostProcess) { if (-not $hostProcess.HasExited) { $hostProcess.Kill($true); [void]$hostProcess.WaitForExit(5000) }; $hostProcess.Dispose() }
        if ($range) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($range) }
        if ($document) { $document.Close(0); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($document) }
        if ($word) { $word.Quit(0); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($word) }
    }
}
