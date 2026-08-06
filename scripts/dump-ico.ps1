$b = [System.IO.File]::ReadAllBytes('D:\ADM\witchcat-ops\src-tauri\icons\icon.ico')
Write-Host ('file length: ' + $b.Length)
$count = [BitConverter]::ToUInt16($b, 4)
Write-Host ('type=' + [BitConverter]::ToUInt16($b, 2) + ' count=' + $count)
for ($i = 0; $i -lt $count; $i++) {
    $o = 6 + 16 * $i
    $len = [BitConverter]::ToUInt32($b, $o + 8)
    $off = [BitConverter]::ToUInt32($b, $o + 12)
    $end = $off + $len
    $flag = if ($end -gt $b.Length) { ' OVERFLOW!' } else { ' ok' }
    Write-Host ("entry $i : " + $b[$o] + "x" + $b[$o + 1] + " len=$len off=$off end=$end" + $flag)
}
