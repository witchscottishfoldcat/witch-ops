# Witchcat Ops 图标生成器
# 设计:深色圆角底板 + 青紫渐变猫头(与 public/logo.svg 同稿)
# 用法: powershell.exe -ExecutionPolicy Bypass -File scripts/gen-icon.ps1

Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'
$iconsDir = 'D:\ADM\witchcat-ops\src-tauri\icons'

function Get-RoundedRectPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $path.AddArc($x, $y, $d, $d, 180, 90)
    $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    return $path
}

function New-CatIcon([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.Clear([System.Drawing.Color]::Transparent)

    # base plate: flat ink-black rounded square, inset ~6.25% so the rounded
    # corners stay fully visible against any taskbar background (no bleed)
    $off = $size * 0.0625
    $inner = $size * 0.875
    $bgPath = Get-RoundedRectPath $off $off $inner $inner ($inner * 0.26)
    $bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 28, 28, 30))
    $g.FillPath($bgBrush, $bgPath)

    # glyph: terminal prompt ">_" flat white, drawn in the inset 42/48 grid
    $gs = $inner / 48.0
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 245, 245, 247), (4.6 * $gs))
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

    $chevron = [System.Drawing.PointF[]]@(
        (New-Object System.Drawing.PointF(($off + 15.0 * $gs), ($off + 16.5 * $gs))),
        (New-Object System.Drawing.PointF(($off + 22.5 * $gs), ($off + 24.0 * $gs))),
        (New-Object System.Drawing.PointF(($off + 15.0 * $gs), ($off + 31.5 * $gs))))
    $g.DrawLines($pen, $chevron)
    $g.DrawLine($pen, ($off + 27.0 * $gs), ($off + 31.5 * $gs), ($off + 36.0 * $gs), ($off + 31.5 * $gs))

    $g.Dispose()
    return $bmp
}

function Get-PngBytes($bmp) {
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bytes = $ms.ToArray()
    $ms.Dispose()
    return $bytes
}

# 1) 生成各尺寸 PNG
$pngTargets = @{
    '32x32.png'        = 32
    '128x128.png'      = 128
    '128x128@2x.png'   = 256
    'icon.png'         = 512
    'StoreLogo.png'    = 256
    'Square30x30Logo.png'   = 30
    'Square44x44Logo.png'   = 44
    'Square71x71Logo.png'   = 71
    'Square89x89Logo.png'   = 89
    'Square107x107Logo.png' = 107
    'Square142x142Logo.png' = 142
    'Square150x150Logo.png' = 150
    'Square284x284Logo.png' = 284
    'Square310x310Logo.png' = 310
}
foreach ($name in $pngTargets.Keys) {
    $bmp = New-CatIcon $pngTargets[$name]
    $bmp.Save((Join-Path $iconsDir $name), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "生成 $name ($($pngTargets[$name])px)"
}

# 2) Build multi-size ICO (PNG frames: 16/24/32/48/64/256)
#    Keep raw bytes in File IO (real byte[]), never through the pipeline,
#    and write with explicit (buffer, offset, count): PowerShell pipeline
#    unrolls/coerces arrays and corrupts binary output.
$frames = @(16, 24, 32, 48, 64, 256)
$tmpPaths = @()
foreach ($f in $frames) {
    $bmp = New-CatIcon $f
    $tmp = Join-Path $env:TEMP "witchcat_ico_$f.png"
    $bmp.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    $tmpPaths += $tmp
}
$pngs = @()
foreach ($tmp in $tmpPaths) {
    $pngs += , ([System.IO.File]::ReadAllBytes($tmp))
}
$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ms)
$bw.Write([uint16]0)              # reserved
$bw.Write([uint16]1)              # type = icon
$bw.Write([uint16]$frames.Count)  # count
$offset = 6 + 16 * $frames.Count
for ($i = 0; $i -lt $frames.Count; $i++) {
    $sz = $frames[$i]
    $b = [byte]($(if ($sz -ge 256) { 0 } else { $sz }))
    $bw.Write($b); $bw.Write($b)  # width, height (0 means 256)
    $bw.Write([byte]0); $bw.Write([byte]0)   # colors, reserved
    $bw.Write([uint16]1); $bw.Write([uint16]32)  # planes, bitcount
    $bw.Write([uint32]$pngs[$i].Length)
    $bw.Write([uint32]$offset)
    $offset += $pngs[$i].Length
}
for ($i = 0; $i -lt $frames.Count; $i++) {
    $ms.Write($pngs[$i], 0, $pngs[$i].Length)
}
$bw.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $iconsDir 'icon.ico'), $ms.ToArray())
$bw.Dispose()
foreach ($tmp in $tmpPaths) { Remove-Item $tmp -Force }
Write-Host "icon.ico written ($($frames -join '/')) px, total $offset bytes)"
Write-Host '全部完成'
