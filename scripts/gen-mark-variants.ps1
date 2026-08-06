# Abstract brand-mark variants (no cat) - flat geometric style
# D: terminal prompt glyph >_    E: W monogram    F: activity pulse
# All: white glyph on ink-black rounded plate (Apple monochrome)
# Output: scripts/preview_D.png / preview_E.png / preview_F.png (256px)

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

function New-MarkIcon([int]$size, [scriptblock]$drawGlyph) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)
    # ink-black plate
    $bgPath = Get-RoundedRectPath 0 0 $size $size ($size * 0.234)
    $bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 28, 28, 30))
    $g.FillPath($bgBrush, $bgPath)
    & $drawGlyph $g $size
    $g.Dispose()
    return $bmp
}

$white = [System.Drawing.Color]::FromArgb(255, 245, 245, 247)

function New-GlyphPen([float]$width) {
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 245, 245, 247), $width)
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    return $pen
}

# D: terminal prompt >_
$drawD = {
    param($g, $size)
    $s = $size / 48.0
    $pen = New-GlyphPen (4.6 * $s)
    # chevron: (15,16.5) -> (22.5,24) -> (15,31.5)
    $chevron = [System.Drawing.PointF[]]@(
        (New-Object System.Drawing.PointF((15 * $s), (16.5 * $s))),
        (New-Object System.Drawing.PointF((22.5 * $s), (24 * $s))),
        (New-Object System.Drawing.PointF((15 * $s), (31.5 * $s))))
    $g.DrawLines($pen, $chevron)
    # underscore bar: (27,31.5) -> (36,31.5)
    $g.DrawLine($pen, (27 * $s), (31.5 * $s), (36 * $s), (31.5 * $s))
}

# E: W monogram
$drawE = {
    param($g, $size)
    $s = $size / 48.0
    $pen = New-GlyphPen (4.4 * $s)
    $pts = [System.Drawing.PointF[]]@(
        (New-Object System.Drawing.PointF((13.5 * $s), (15.5 * $s))),
        (New-Object System.Drawing.PointF((19 * $s), (32.5 * $s))),
        (New-Object System.Drawing.PointF((24 * $s), (20.5 * $s))),
        (New-Object System.Drawing.PointF((29 * $s), (32.5 * $s))),
        (New-Object System.Drawing.PointF((34.5 * $s), (15.5 * $s))))
    $g.DrawLines($pen, $pts)
}

# F: activity pulse
$drawF = {
    param($g, $size)
    $s = $size / 48.0
    $pen = New-GlyphPen (4.2 * $s)
    $pts = [System.Drawing.PointF[]]@(
        (New-Object System.Drawing.PointF((12 * $s), (25.5 * $s))),
        (New-Object System.Drawing.PointF((19.5 * $s), (25.5 * $s))),
        (New-Object System.Drawing.PointF((22.5 * $s), (16.5 * $s))),
        (New-Object System.Drawing.PointF((26 * $s), (33.5 * $s))),
        (New-Object System.Drawing.PointF((29 * $s), (25.5 * $s))),
        (New-Object System.Drawing.PointF((36 * $s), (25.5 * $s))))
    $g.DrawLines($pen, $pts)
}

(New-MarkIcon 256 $drawD).Save((Join-Path $outDir 'preview_D.png'), [System.Drawing.Imaging.ImageFormat]::Png)
(New-MarkIcon 256 $drawE).Save((Join-Path $outDir 'preview_E.png'), [System.Drawing.Imaging.ImageFormat]::Png)
(New-MarkIcon 256 $drawF).Save((Join-Path $outDir 'preview_F.png'), [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host 'previews D/E/F generated'
