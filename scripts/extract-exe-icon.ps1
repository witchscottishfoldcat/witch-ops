# Extract the icon embedded in the exe to verify what Windows will show
Add-Type -AssemblyName System.Drawing
$exe = 'C:\Users\92964\Documents\witchcat-ops-target\debug\witchcat-ops.exe'
$icon = [System.Drawing.Icon]::ExtractAssociatedIcon($exe)
$bmp = $icon.ToBitmap()
$out = 'D:\ADM\witchcat-ops\scripts\exe_icon_extract.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host ("extracted: {0} ({1}x{2})" -f $out, $bmp.Width, $bmp.Height)
