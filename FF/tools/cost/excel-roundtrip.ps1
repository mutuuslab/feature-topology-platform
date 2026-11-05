# SW 개발비 산정 엑셀 내보내기 왕복 확인(20-94 §10, D-COST-13) — 내보낸 파일을 Excel이 다시 계산한 총개발비·총 공수를 JSON으로.
# 사용: powershell -NoProfile -File tools/cost/excel-roundtrip.ps1 -File <내보낸.xlsx>
# Windows + Excel 필요. 파일은 임시 복사본으로 열고 저장하지 않는다. 비교는 호출자가 API 결과와 한다.
param([Parameter(Mandatory = $true)][string]$File)
$ErrorActionPreference = 'Stop'
$work = Join-Path ([System.IO.Path]::GetTempPath()) ("ff-cost-rt-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $work | Out-Null
$copy = Join-Path $work 'export.xlsx'
Copy-Item -Force $File $copy
$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false
$xl.DisplayAlerts = $false
try {
  $wb = $xl.Workbooks.Open($copy, 0, $true)
  try {
    $xl.CalculateFull()
    $db = $wb.Worksheets.Item('01_대시보드')
    $out = [ordered]@{
      totalCost = $db.Range('B6').Value2
      totalMm = $db.Range('E6').Value2
      selected = $db.Range('H6').Value2
      project = $wb.Worksheets.Item('02_프로젝트설정').Range('C6').Value2
    }
    $out | ConvertTo-Json -Compress
  } finally { $wb.Close($false) }
} finally {
  $xl.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl) | Out-Null
  Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}
