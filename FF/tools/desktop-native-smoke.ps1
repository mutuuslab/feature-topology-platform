param([int]$TimeoutSeconds = 75, [string]$Executable = '')
$ErrorActionPreference = 'Stop'
$desktopRoot = Split-Path -Parent $PSScriptRoot
$desktopExe = if ($Executable) { (Resolve-Path -LiteralPath $Executable).Path } else { Join-Path $desktopRoot 'src-tauri\target\release\feature-platform-desktop.exe' }
if (-not (Test-Path -LiteralPath $desktopExe -PathType Leaf)) { throw 'Desktop executable not found.' }
$launched = $null
$nodePid = $null
$nodeCreated = $null
try {
  $launched = Start-Process -FilePath $desktopExe -WindowStyle Hidden -PassThru
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $launched.Refresh()
    if ($launched.HasExited) { throw "Desktop process exited with code $($launched.ExitCode) before its local service became ready (an existing instance may already be running)." }
    $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $($launched.Id)" | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*backend*dist*main.js*' })
    if ($children.Count -eq 1) {
      $nodePid = [int]$children[0].ProcessId
      $nodeCreated = $children[0].CreationDate
      $listeners = @(Get-NetTCPConnection -State Listen -OwningProcess $nodePid -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -eq '127.0.0.1' })
      foreach ($listener in $listeners) {
        try {
          $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$($listener.LocalPort)/api/health" -TimeoutSec 2
          if ($response.StatusCode -eq 200) {
            Write-Output "PASS: desktop process $($launched.Id), local backend $nodePid, health HTTP 200"
            return
          }
        } catch { }
      }
    }
    Start-Sleep -Milliseconds 500
  }
  throw 'Desktop local service did not become ready.'
} finally {
  if ($launched) {
    $launched.Refresh()
    if (-not $launched.HasExited) {
      $null = $launched.CloseMainWindow()
      if (-not $launched.WaitForExit(10000)) { Stop-Process -Id $launched.Id -Force }
    }
  }
  if ($nodePid) {
    try { Wait-Process -Id $nodePid -Timeout 5 -ErrorAction Stop } catch { }
    $remaining = Get-CimInstance Win32_Process -Filter "ProcessId = $nodePid" -ErrorAction SilentlyContinue
    if ($remaining -and $remaining.CreationDate -eq $nodeCreated -and $remaining.CommandLine -like '*backend*dist*main.js*') {
      Stop-Process -Id $nodePid -Force
      throw 'Backend required forced cleanup after window exit.'
    }
  }
}
