# 개발비 산정 엔진 기준값 추출(20-94 §10) — Windows + Microsoft Excel이 있는 PC에서 손으로 한 번 돌린다(CI는 결과 JSON만 쓴다).
# 시나리오(tools/cost/golden-scenarios.json)마다 엑셀 산정 도구 v1.3의 임시 복사본을 열어 입력 칸을 바꾸고 다시 계산한 뒤,
# 엔진이 받는 입력과 엑셀이 낸 계산값을 data/golden/cost/<name>.json으로 쓴다. 원본 엑셀은 복사만 하고 저장하지 않는다.
# 스크립트는 UTF-8 BOM으로 저장한다(5.1이 한글 시트 이름을 깨뜨리지 않게).
# 사용: powershell -NoProfile -ExecutionPolicy Bypass -File tools/cost/excel-golden.ps1 -Source <엑셀 경로> [-Out data/golden/cost]
param(
  [Parameter(Mandatory = $true)][string]$Source,
  [string]$Scenarios = "",
  [string]$Out = ""
)
# Windows PowerShell 5.1은 param 기본값에서 $PSScriptRoot가 비어 있다 — 본문에서 채운다
if (-not $Scenarios) { $Scenarios = Join-Path $PSScriptRoot "golden-scenarios.json" }
if (-not $Out) { $Out = Join-Path $PSScriptRoot "..\..\data\golden\cost" }
$ErrorActionPreference = 'Stop'
$inv = [System.Globalization.CultureInfo]::InvariantCulture

# 숫자는 왕복("R") 표기 — 1원 비교라 자릿수를 버리지 않는다
function ConvertTo-J($v) {
  if ($null -eq $v) { return 'null' }
  if ($v -is [string]) { return '"' + ($v -replace '\\', '\\\\' -replace '"', '\"' -replace "`r", '\r' -replace "`n", '\n' -replace "`t", '\t') + '"' }
  if ($v -is [bool]) { if ($v) { return 'true' } else { return 'false' } }
  if ($v -is [double] -or $v -is [single] -or $v -is [decimal] -or $v -is [int] -or $v -is [long]) { return ([double]$v).ToString('R', $inv) }
  if ($v -is [System.Collections.IDictionary]) {
    $parts = foreach ($k in $v.Keys) { (ConvertTo-J ([string]$k)) + ':' + (ConvertTo-J $v[$k]) }
    return '{' + ($parts -join ',') + '}'
  }
  if ($v -is [System.Collections.IEnumerable]) {
    $parts = foreach ($x in $v) { ConvertTo-J $x }
    return '[' + ($parts -join ',') + ']'
  }
  return (ConvertTo-J ([string]$v))
}

function Col([string]$letters) { $n = 0; foreach ($ch in $letters.ToCharArray()) { $n = $n * 26 + ([int][char]$ch - 64) }; return $n }
function Cell($ws, [string]$addr) { $x = $ws.Range($addr).Value2; if ($x -is [string] -and $x -eq '') { return $null }; return $x }

$spec = Get-Content -Raw -Encoding UTF8 $Scenarios | ConvertFrom-Json
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$work = Join-Path $env:TEMP "ff-cost-golden"
New-Item -ItemType Directory -Force -Path $work | Out-Null
$sha = [System.Security.Cryptography.SHA256]::Create()
$srcHash = (($sha.ComputeHash([System.IO.File]::ReadAllBytes($Source)) | ForEach-Object { $_.ToString('x2') }) -join '')

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false
$xl.DisplayAlerts = $false
try {
  foreach ($sc in $spec.scenarios) {
    $copy = Join-Path $work "$($sc.name).xlsx"
    Copy-Item -Force $Source $copy
    $wb = $xl.Workbooks.Open($copy, 0, $false)
    try {
      $fdb = $wb.Worksheets.Item('03_FeatureDB')
      $ids = $fdb.Range('A5:A3000').Value2
      $rowOf = @{}
      for ($i = 1; $i -le 2996; $i++) { $id = $ids[$i, 1]; if ($id) { $rowOf[[string]$id] = $i + 4 } }
      foreach ($c in $sc.cells) {
        $sheet, $key, $col, $val = $c[0], $c[1], $c[2], $c[3]
        $ws = $wb.Worksheets.Item($sheet)
        $addr = if ($col) { if (-not $rowOf.ContainsKey($key)) { throw "$($sc.name): 03_FeatureDB에 $key 없음" }; "$col$($rowOf[$key])" } else { $key }
        # JSON 값은 PSObject로 감싸여 있어 COM이 받지 못한다 — 숫자는 double, 그 밖은 문자열로 풀어 넣는다
        if ($null -eq $val) { $ws.Range($addr).ClearContents() | Out-Null }
        elseif ($val -is [int] -or $val -is [long] -or $val -is [double] -or $val -is [decimal]) { $ws.Range($addr).Value2 = [double]$val }
        else { $ws.Range($addr).Value2 = [string]$val }
      }
      $xl.CalculateFull()

      # 03 — 입력 칸이 있거나 유효 수량이 0보다 큰 행: 입력(AF~AO)과 계산값(AR~BD·BF·BG·BM)
      $grid = $fdb.Range('A5:BW3000').Value2
      $in = [ordered]@{ qty = 'AF'; changeType = 'AG'; asil = 'AH'; variants = 'AI'; m = 'AJ'; o = 'AK'; p = 'AL'; priority = 'AM'; owned = 'AN'; actual = 'AO' }
      $outCols = [ordered]@{ overall = 'M'; points = 'T'; nominal = 'U'; repAsilF = 'BH'; bundleIncluded = 'AR'; effQty = 'AS'; asilF = 'AT'; aam = 'AU'; variantF = 'AV'; path = 'AW'; m = 'AX'; o = 'AY'; p = 'AZ'; e = 'BA'; variance = 'BB'; laborKrw = 'BC'; benchEur = 'BD'; check = 'BF'; mre = 'BG'; prereqCheck = 'BM'; baseEffort = 'BW' }
      $lines = New-Object System.Collections.ArrayList
      for ($i = 1; $i -le 2996; $i++) {
        $id = $grid[$i, 1]
        if (-not $id) { continue }
        $hasInput = $false
        foreach ($l in $in.Values) { $x = $grid[$i, (Col $l)]; if ($null -ne $x -and -not ($x -is [string] -and $x -eq '')) { $hasInput = $true } }
        $eff = $grid[$i, (Col 'AS')]
        if (-not $hasInput -and -not ($eff -is [double] -and $eff -gt 0)) { continue }
        $inputs = [ordered]@{}; foreach ($k in $in.Keys) { $x = $grid[$i, (Col $in[$k])]; $inputs[$k] = if ($x -is [string] -and $x -eq '') { $null } else { $x } }
        $outs = [ordered]@{}; foreach ($k in $outCols.Keys) { $x = $grid[$i, (Col $outCols[$k])]; $outs[$k] = if ($x -is [string] -and $x -eq '') { $null } else { $x } }
        [void]$lines.Add([ordered]@{ refId = [string]$id; row = $i + 4; inputs = $inputs; excel = $outs })
      }

      $mbdWs = $wb.Worksheets.Item('12_MBD복잡도')
      $mbd = New-Object System.Collections.ArrayList
      for ($r = 7; $r -le 206; $r++) {
        $id = Cell $mbdWs "B$r"
        if (-not $id) { continue }
        [void]$mbd.Add([ordered]@{ refId = [string]$id; counts = @((Cell $mbdWs "D$r"), (Cell $mbdWs "E$r"), (Cell $mbdWs "F$r"), (Cell $mbdWs "G$r"), (Cell $mbdWs "H$r")); excelMm = (Cell $mbdWs "N$r") })
      }
      $taskY = @(); for ($r = 17; $r -le 35; $r++) { $taskY += , (Cell $mbdWs "S$r") }

      $ps = $wb.Worksheets.Item('02_프로젝트설정')
      $bs = $wb.Worksheets.Item('05_기준값')
      $db = $wb.Worksheets.Item('01_대시보드')
      $drivers = [ordered]@{}; for ($r = 32; $r -le 44; $r++) { $drivers[(Cell $ps "B$r")] = [ordered]@{ direct = (Cell $ps "D$r"); applied = (Cell $ps "F$r"); multiplier = (Cell $ps "E$r") } }
      $common = New-Object System.Collections.ArrayList
      for ($r = 50; $r -le 56; $r++) { [void]$common.Add([ordered]@{ item = (Cell $ps "B$r"); input = (Cell $ps "C$r"); role = (Cell $ps "D$r"); mm = (Cell $ps "E$r"); rate = (Cell $ps "F$r"); krw = (Cell $ps "G$r") }) }
      $direct = New-Object System.Collections.ArrayList
      for ($r = 62; $r -le 69; $r++) { [void]$direct.Add([ordered]@{ item = (Cell $ps "B$r"); qty = (Cell $ps "C$r"); unitPrice = (Cell $ps "E$r"); krw = (Cell $ps "F$r") }) }
      $inhouse = [ordered]@{}; for ($r = 73; $r -le 81; $r++) { $inhouse[(Cell $bs "B$r")] = (Cell $bs "H$r") }
      $roleRates = [ordered]@{}; for ($r = 73; $r -le 81; $r++) { $roleRates[(Cell $bs "B$r")] = (Cell $bs "I$r") }
      $roleWeights = [ordered]@{}; for ($r = 98; $r -le 106; $r++) { $roleWeights[(Cell $bs "B$r")] = (Cell $bs "G$r") }
      $aam = [ordered]@{}; for ($r = 26; $r -le 31; $r++) { $aam[(Cell $bs "B$r")] = (Cell $bs "J$r") }
      $dash = [ordered]@{}
      foreach ($r in 13..29) { $dash["E$r"] = (Cell $db "E$r"); $dash["F$r"] = (Cell $db "F$r") }
      foreach ($a in @('B34', 'C34', 'D34', 'E34', 'B35', 'C35', 'D35', 'E35', 'B36', 'C36', 'D36', 'E36', 'H34', 'I34', 'H35', 'I35', 'H36', 'I36', 'H37', 'I37', 'E42', 'E43', 'E44', 'E45', 'L42', 'L44')) { $dash[$a] = (Cell $db $a) }
      foreach ($r in 87..109) { $dash["E$r"] = (Cell $db "E$r") }

      $doc = [ordered]@{
        scenario = $sc.name
        what = $sc.what
        source = [ordered]@{ file = (Split-Path -Leaf $Source); sha256 = $srcHash }
        settings = [ordered]@{
          aace = (Cell $ps 'C10'); confidence = (Cell $ps 'C11'); preset = (Cell $ps 'C12'); rateBasis = (Cell $ps 'C14'); method = (Cell $ps 'C15')
          ohOverride = (Cell $ps 'D17'); feeOverride = (Cell $ps 'D18'); vat = (Cell $ps 'C19')
          anchorEur = (Cell $ps 'C23'); euRate = (Cell $ps 'C24'); hoursPerPm = (Cell $ps 'C25'); fx = (Cell $ps 'C26')
          drivers = $drivers; common = $common; directExpenses = $direct
          inhouseRates = $inhouse; mbdBaseY = (Cell $mbdWs 'Q13'); mbdTaskY = $taskY
        }
        lines = $lines
        mbd = $mbd
        excel = [ordered]@{
          ohDefault = (Cell $ps 'C17'); feeDefault = (Cell $ps 'C18'); oh = (Cell $ps 'E17'); fee = (Cell $ps 'E18'); mmPerPt = (Cell $ps 'C27'); eaf = (Cell $ps 'E45')
          commonMm = (Cell $ps 'E57'); commonKrw = (Cell $ps 'G57'); directKrw = (Cell $ps 'F70')
          roleRates = $roleRates; roleWeights = $roleWeights; blendedRate = (Cell $bs 'I108'); aam = $aam
          mbdHours = @((Cell $mbdWs 'S36'), (Cell $mbdWs 'T36'), (Cell $mbdWs 'U36'), (Cell $mbdWs 'V36'), (Cell $mbdWs 'W36'))
          anchorSuggest = (Cell ($wb.Worksheets.Item('06_교정')) 'E34')
          dashboard = $dash
        }
      }
      $path = Join-Path $Out "$($sc.name).json"
      [System.IO.File]::WriteAllText($path, (ConvertTo-J $doc) + "`n", (New-Object System.Text.UTF8Encoding $false))
      Write-Host "$($sc.name): 줄 $($lines.Count) · MBD $($mbd.Count) · 총개발비 $($dash['F27'])"
    } finally {
      $wb.Close($false)
      Remove-Item -Force $copy -ErrorAction SilentlyContinue
    }
  }
} finally {
  $xl.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl) | Out-Null
}
