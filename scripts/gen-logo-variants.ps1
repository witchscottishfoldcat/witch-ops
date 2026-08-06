# Witchcat logo variant previews - flat brand style (Claude/ChatGPT/Apple/Google-like)
# Solid silhouette cat head, flat colors, no gradients.
# Output: scripts/preview_A.png / preview_B.png / preview_C.png (256px)

Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'
$outDir = 'D:\ADM\witchcat-ops\scripts'

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

# Solid cat-head silhouette region (true transparent eye holes), 48-grid scaled
function Get-CatRegion([float]$s, [float]$ox, [float]$oy) {
    # head circle: center (24,27.5) r 11.5
    $headPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $headPath.AddEllipse(($ox + 12.5 * $s), ($oy + 16.0 * $s), (23.0 * $s), (23.0 * $s))
    # ears: 4-point polygons, slightly flattened tips, center valley between them
    $leftEar = [System.Drawing.PointF[]]@(
        (New-Object System.Drawing.PointF(($ox + 14.2 * $s), ($oy + 21.4 * $s))),
        (New-Object System.Drawing.PointF(($ox + 16.2 * $s), ($oy + 9.6 * $s))),
        (New-Object System.Drawing.PointF(($ox + 18.4 * $s), ($oy + 10.9 * $s))),
        (New-Object System.Drawing.PointF(($ox + 22.6 * $s), ($oy + 16.6 * $s))))
    $rightEar = [System.Drawing.PointF[]]@(
        (New-Object System.Drawing.PointF(($ox + 33.8 * $s), ($oy + 21.4 * $s))),
        (New-Object System.Drawing.PointF(($ox + 31.8 * $s), ($oy + 9.6 * $s))),
        (New-Object System.Drawing.PointF(($ox + 29.6 * $s), ($oy + 10.9 * $s))),
        (New-Object System.Drawing.PointF(($ox + 25.4 * $s), ($oy + 16.6 * $s))))
    $headPath.AddPolygon($leftEar)
    $headPath.AddPolygon($rightEar)

    $region = New-Object System.Drawing.Region($headPath)

    # eyes: punched out (transparent)
    $eyesPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $eyesPath.AddEllipse(($ox + 17.4 * $s), ($oy + 23.9 * $s), (4.4 * $s), (4.4 * $s))
    $eyesPath.AddEllipse(($ox + 26.2 * $s), ($oy + 23.9 * $s), (4.4 * $s), (4.4 * $s))
    $region.Exclude($eyesPath)
    return $region
}

function New-FlatIcon([int]$size, $bgColor, $glyphColor, [bool]$roundedBg) {
    $s = $size / 48.0
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    if ($roundedBg) {
        $bgPath = Get-RoundedRectPath 0 0 $size $size ($size * 0.234)
        $bgBrush = New-Object System.Drawing.SolidBrush($bgColor)
        $g.FillPath($bgBrush, $bgPath)
    }
    $glyphBrush = New-Object System.Drawing.SolidBrush($glyphColor)
    # glyph slightly inset from edges
    $inset = $size * 0.0625
    $region = Get-CatRegion (($size - 2 * $inset) / 48.0) $inset $inset
    $g.FillRegion($glyphBrush, $region)

    $g.Dispose()
    return $bmp
}

$white = [System.Drawing.Color]::FromArgb(255, 245, 245, 247)
$inkBlack = [System.Drawing.Color]::FromArgb(255, 28, 28, 30)
$indigo = [System.Drawing.Color]::FromArgb(255, 94, 92, 230)
$cream = [System.Drawing.Color]::FromArgb(255, 245, 240, 232)
$terra = [System.Drawing.Color]::FromArgb(255, 204, 102, 73)

# A: Apple/GitHub monochrome - black plate, white glyph
(New-FlatIcon 256 $inkBlack $white $true).Save((Join-Path $outDir 'preview_A.png'), [System.Drawing.Imaging.ImageFormat]::Png)
# B: iOS app-icon style - flat indigo plate, white glyph
(New-FlatIcon 256 $indigo $white $true).Save((Join-Path $outDir 'preview_B.png'), [System.Drawing.Imaging.ImageFormat]::Png)
# C: Claude warm style - cream plate, terracotta glyph
(New-FlatIcon 256 $cream $terra $true).Save((Join-Path $outDir 'preview_C.png'), [System.Drawing.Imaging.ImageFormat]::Png)

Write-Host 'previews generated: A/B/C'
