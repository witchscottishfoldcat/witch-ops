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
    $s = $size / 48.0
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.Clear([System.Drawing.Color]::Transparent)

    # base plate: dark rounded square with vertical gradient
    $bgPath = Get-RoundedRectPath (1.5 * $s) (1.5 * $s) (45 * $s) (45 * $s) (12 * $s)
    $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.PointF(0, 0)),
        (New-Object System.Drawing.PointF(0, $size)),
        [System.Drawing.Color]::FromArgb(255, 35, 35, 39),
        [System.Drawing.Color]::FromArgb(255, 21, 21, 23))
    $g.FillPath($bgBrush, $bgPath)
    $borderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(24, 255, 255, 255), [Math]::Max(1.0, $s))
    $g.DrawPath($borderPen, $bgPath)

    # minimalist line-art cat face (cyan -> purple gradient stroke)
    $gradBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.PointF(0, 0)),
        (New-Object System.Drawing.PointF($size, $size)),
        [System.Drawing.Color]::FromArgb(255, 100, 210, 255),
        [System.Drawing.Color]::FromArgb(255, 191, 90, 242))

    $catPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $catPath.AddLines([System.Drawing.PointF[]]@(
        (New-Object System.Drawing.PointF((15.5 * $s), (21.5 * $s))),
        (New-Object System.Drawing.PointF((17.2 * $s), (10.8 * $s))),
        (New-Object System.Drawing.PointF((24.0 * $s), (16.2 * $s))),
        (New-Object System.Drawing.PointF((30.8 * $s), (10.8 * $s))),
        (New-Object System.Drawing.PointF((32.5 * $s), (21.5 * $s)))))
    $catPath.AddBezier(
        (New-Object System.Drawing.PointF((32.5 * $s), (21.5 * $s))),
        (New-Object System.Drawing.PointF((35.5 * $s), (25.5 * $s))),
        (New-Object System.Drawing.PointF((35.0 * $s), (32.5 * $s))),
        (New-Object System.Drawing.PointF((24.0 * $s), (36.2 * $s))))
    $catPath.AddBezier(
        (New-Object System.Drawing.PointF((24.0 * $s), (36.2 * $s))),
        (New-Object System.Drawing.PointF((13.0 * $s), (32.5 * $s))),
        (New-Object System.Drawing.PointF((12.5 * $s), (25.5 * $s))),
        (New-Object System.Drawing.PointF((15.5 * $s), (21.5 * $s))))
    $catPath.CloseFigure()

    $linePen = New-Object System.Drawing.Pen($gradBrush, (2.6 * $s))
    $linePen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $linePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $linePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawPath($linePen, $catPath)

    # dot eyes
    $g.FillEllipse($gradBrush, (18.4 * $s), (23.9 * $s), (3.2 * $s), (3.2 * $s))
    $g.FillEllipse($gradBrush, (26.4 * $s), (23.9 * $s), (3.2 * $s), (3.2 * $s))

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
