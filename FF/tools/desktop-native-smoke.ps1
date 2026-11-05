param([int]$TimeoutSeconds = 180, [string]$Executable = '', [string]$RetentionProof = '', [ValidateSet('', 'create', 'verify')][string]$RetentionPhase = '')
$ErrorActionPreference = 'Stop'
$desktopRoot = Split-Path -Parent $PSScriptRoot
$desktopExe = if ($Executable) { (Resolve-Path -LiteralPath $Executable).Path } else { Join-Path $desktopRoot 'src-tauri\target\release\feature-platform-desktop.exe' }
if (-not (Test-Path -LiteralPath $desktopExe -PathType Leaf)) { throw 'Desktop executable not found.' }
$launched = Start-Process -FilePath $desktopExe -WindowStyle Hidden -PassThru
try {
  $smokeArgs = @((Join-Path $PSScriptRoot 'unleash\native-smoke.py'), '--pid', $launched.Id, '--exe', $desktopExe, '--timeout', $TimeoutSeconds)
  if ($RetentionPhase) { $smokeArgs += @('--retention-proof', $RetentionProof, '--retention-phase', $RetentionPhase) }
  & python @smokeArgs
  if ($LASTEXITCODE -ne 0) { throw 'Native Tauri lifecycle smoke failed.' }
} finally {
  $launched.Refresh()
  if (-not $launched.HasExited) {
    $null = $launched.CloseMainWindow()
    if (-not $launched.WaitForExit(40000)) { Stop-Process -InputObject $launched -Force }
  }
}
