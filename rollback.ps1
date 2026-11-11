param([string]$Root = '', [switch]$Purge)

# Plan A rollback - no Python required. UTF-8 WITH BOM on purpose.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$OutputEncoding = [Text.Encoding]::UTF8
$pkg = $PSScriptRoot
$UTF8NoBom = New-Object System.Text.UTF8Encoding($false)
$LINE = '<script src="y3/embed.js"></script>'

function Say($s) { Write-Host $s }
function Ok($s) { Write-Host ('  [OK] ' + $s) -ForegroundColor Green }
function Warn($s) { Write-Host ('  [--] ' + $s) -ForegroundColor Yellow }

$cands = @()
if ($Root) { $cands += $Root }
$cands += $pkg
$cands += (Split-Path $pkg -Parent)
$parent = Split-Path $pkg -Parent
if ($parent) { $cands += (Split-Path $parent -Parent) }
$root = $null
foreach ($c in $cands) {
  if (-not $c) { continue }
  if (Test-Path (Join-Path $c 'admin.html')) { $root = (Resolve-Path $c).Path; break }
}
if (-not $root) { Write-Host '没有找到 admin.html，请把本包放回项目根再运行。' -ForegroundColor Red; exit 1 }

Say ''
Say ('项目根：' + $root)
$admin = Join-Path $root 'admin.html'

# 优先选「不含 Y3 引用」的最早备份：重复安装会产生多份，不能盲取最后一个
$baks = @(Get-ChildItem -LiteralPath $root -Filter 'admin.html.bak_PlanA_*' -File |
          Sort-Object Name)
if ($baks.Count -eq 0) { $baks = @(Get-ChildItem -LiteralPath $root -Filter 'admin.html.bak_*' -File | Sort-Object Name) }

$clean = @($baks | Where-Object {
  -not ($UTF8NoBom.GetString([IO.File]::ReadAllBytes($_.FullName))).Contains($LINE)
})

if ($clean.Count -gt 0) {
  Copy-Item -LiteralPath $clean[0].FullName -Destination $admin -Force
  Ok ('已从原始备份恢复：' + $clean[0].Name)
} elseif ($baks.Count -gt 0) {
  Copy-Item -LiteralPath $baks[0].FullName -Destination $admin -Force
  $t = $UTF8NoBom.GetString([IO.File]::ReadAllBytes($admin))
  $t = $t.Replace($LINE, '') -replace "`r?`n[ ]*`r?`n`r?`n", "`r`n"
  [IO.File]::WriteAllText($admin, $t, $UTF8NoBom)
  Warn ('已恢复最早备份并按行清理引用：' + $baks[0].Name)
} else {
  # 没备份：做【字节级】删除，而不是读取→解码→重写。
  # 引用行是纯 ASCII，在 UTF-8 / GBK 里字节完全一致，因此与文件编码无关，绝不破坏中文。
  $bytes = [IO.File]::ReadAllBytes($admin)
  $pat = [Text.Encoding]::ASCII.GetBytes($LINE)
  $out = New-Object 'System.Collections.Generic.List[byte]'
  $i = 0
  while ($i -lt $bytes.Length) {
    $hit = $false
    if (($i + $pat.Length) -le $bytes.Length) {
      $hit = $true
      for ($j = 0; $j -lt $pat.Length; $j++) {
        if ($bytes[$i + $j] -ne $pat[$j]) { $hit = $false; break }
      }
    }
    if ($hit) { $i += $pat.Length }
    else { $out.Add($bytes[$i]); $i++ }
  }
  [IO.File]::WriteAllBytes($admin, $out.ToArray())
  Warn '未找到备份，已按字节移除 Y3 引用行（其余字节原样保留，可能多留一个空行，不影响功能）'
}

if (-not ($UTF8NoBom.GetString([IO.File]::ReadAllBytes($admin))).Contains($LINE)) {
  Ok 'admin.html 已不含 Y3 引用'
} else {
  Write-Host '  [!!] 引用仍在，请手动删除该行' -ForegroundColor Red
}

if ($Purge) {
  $dst = Join-Path $root 'y3'
  if (Test-Path $dst) { Remove-Item -LiteralPath $dst -Recurse -Force; Ok '已删除 y3/ 目录' }
}

Say ''
Ok '回滚完成。原 admin.js / admin.css / data/game-config.json 全程未被改动。'
Say ''
Say '浏览器里的 Y3 测试数据仍在 localStorage（正式配置从未被写入）：'
Say '    wowpinball.y3.test.v1      Y3 编辑器自己的果实'
Say '    wowpinball.y3.staging.v1   暂存的导出配置'
Say '如需清掉，在浏览器控制台执行：'
Say "    localStorage.removeItem('wowpinball.y3.test.v1');"
Say "    localStorage.removeItem('wowpinball.y3.staging.v1');"
Say ''
