# Dot-sourced only by the clean-account installation smoke. Its observation and
# fault evidence is captured while Word is alive, with no policy modification.
$script:diagnosticObservations = [ordered]@{}

function Save-DiagnosticObservations {
    [ordered]@{ schemaVersion = 1; scenarios = $script:diagnosticObservations } |
        ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $diagnosticsEvidencePath -Encoding utf8
}

function Get-DiagnosticObservation {
    param([string]$Scenario, [int[]]$AllowedExitCodes = @(0, 1))
    $before = Get-RegistryPolicyFingerprint
    $output = Join-Path $workDirectory ("diagnostics-" + $Scenario + '.json')
    [void](Invoke-Diagnostics (Join-Path $installDirectory 'FormulaBridge.Diagnostics.exe') $output $AllowedExitCodes)
    $report = Get-Content -LiteralPath $output -Raw | ConvertFrom-Json
    if ($before -ne (Get-RegistryPolicyFingerprint)) {
        Set-Assertion 'diagnostics-respects-policy' 'failed' 'Diagnostics modified Office policy or resiliency state.'
        throw 'Diagnostics modified Office policy or resiliency state.'
    }
    Set-Assertion 'diagnostics-respects-policy' 'passed'
    $script:diagnosticObservations[$Scenario] = $report
    Save-DiagnosticObservations
    return $report
}

function Assert-DiagnosticStatus {
    param($Report, [string]$Check, [string]$Status)
    if (@($Report.checks | Where-Object { $_.id -eq $Check -and $_.status -eq $Status }).Count -ne 1) {
        throw "Diagnostics did not produce the required $Check status."
    }
}

function Invoke-ActiveWordDiagnostics {
    param($Word)
    $script:currentAssertionId = 'diagnostics-load-state-consistency'
    $healthy = Get-DiagnosticObservation 'healthy' @(0)
    if (-not $Word.COMAddIns.Item($addInId).Connect -or $healthy.status -ne 'passed') { throw 'Healthy diagnostics disagreed with live Word.' }
    Assert-DiagnosticStatus $healthy 'add-in-load-state' 'passed'
    Assert-DiagnosticStatus $healthy 'ribbon-load-state' 'passed'
    Set-Assertion 'diagnostics-load-state-consistency' 'passed'
    $script:currentAssertionId = 'diagnostics-prerequisite-and-signature-checks'
    foreach ($id in @('word-x64','vsto-runtime','webview2-runtime','deployment-signatures')) { Assert-DiagnosticStatus $healthy $id 'passed' }
    Set-Assertion 'diagnostics-prerequisite-and-signature-checks' 'passed'
    $backup = [IO.File]::ReadAllBytes($statePath)
    try {
        $script:currentAssertionId = 'diagnostics-failure-detection'
        Remove-Item -LiteralPath $statePath -Force
        $missing = Get-DiagnosticObservation 'missing-state' @(1)
        Assert-DiagnosticStatus $missing 'ribbon-load-state' 'failed'
        Set-Assertion 'diagnostics-failure-detection' 'passed'
        $script:currentAssertionId = 'diagnostics-fault-smoke'
        [IO.File]::WriteAllText($statePath, '{ malformed load state')
        $malformed = Get-DiagnosticObservation 'malformed-state' @(1)
        Assert-DiagnosticStatus $malformed 'ribbon-load-state' 'failed'
        Set-Assertion 'diagnostics-fault-smoke' 'passed'
    }
    finally { [IO.File]::WriteAllBytes($statePath, $backup) }
}

function Invoke-DisabledWordDiagnostics {
    $script:currentAssertionId = 'diagnostics-real-disabled-state'
    $word = $null
    $addin = $null
    $registryRoot = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryView]::Registry64)
    $registration = $registryRoot.OpenSubKey($addInRegistryPath, $true)
    if (-not $registration) { $registryRoot.Dispose(); throw 'The isolated installation registration is missing.' }
    $previous = $registration.GetValue('LoadBehavior')
    try {
        # This modifies only the installation created by this smoke, never policy
        # or opaque DisabledItems. A fresh Word process must observe disconnection.
        $registration.SetValue('LoadBehavior', 2, [Microsoft.Win32.RegistryValueKind]::DWord)
        $word = New-Object -ComObject Word.Application
        $word.Visible = $false
        $addin = $word.COMAddIns.Item($addInId)
        if ($addin.Connect) { throw 'The disabled-state test unexpectedly loaded the add-in.' }
        $disabled = Get-DiagnosticObservation 'disabled-word' @(1)
        Assert-DiagnosticStatus $disabled 'load-behavior' 'failed'
        Assert-DiagnosticStatus $disabled 'ribbon-load-state' 'failed'
        $script:diagnosticObservations['disabled-observation'] = [ordered]@{ connected = $false; wordResponded = ([string]$word.Version).Length -gt 0 }
        Save-DiagnosticObservations
        Set-Assertion 'diagnostics-real-disabled-state' 'passed'
    }
    finally {
        try {
            if ($addin) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($addin) }
            if ($word) { $word.Quit(0); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($word) }
        }
        finally {
            $registration.SetValue('LoadBehavior', $previous, [Microsoft.Win32.RegistryValueKind]::DWord)
            $registration.Dispose()
            $registryRoot.Dispose()
        }
    }
}
