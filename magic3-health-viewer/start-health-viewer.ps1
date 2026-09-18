param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$mime = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8' }
$listener = $null
$port = $null

foreach ($candidatePort in 8840..8870) {
    $candidate = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $candidatePort)
    try { $candidate.Start(); $listener=$candidate; $port=$candidatePort; break }
    catch [System.Net.Sockets.SocketException] { $candidate.Stop() }
}
if ($null -eq $listener) { Write-Host 'Geen vrije lokale poort gevonden tussen 8840 en 8870.' -ForegroundColor Red; exit 1 }

try {
    Write-Host "Magic3-dashboard draait op http://localhost:$port/"
    Write-Host 'Laat dit venster open. Stop later met Ctrl+C.'
    if (-not $NoBrowser) { Start-Process "http://localhost:$port/" }
    while ($true) {
        $client = $listener.AcceptTcpClient()
        try {
            $stream = $client.GetStream()
            $reader = [System.IO.StreamReader]::new($stream,[System.Text.Encoding]::ASCII,$false,1024,$true)
            $requestLine=$reader.ReadLine(); while(($line=$reader.ReadLine()) -ne $null -and $line -ne ''){}
            $requestPath='/'; if($requestLine -match '^GET\s+([^\s]+)\s+HTTP/'){$requestPath=([Uri]::UnescapeDataString($Matches[1]) -split '\?')[0]}
            $fileName=if($requestPath -eq '/'){'index.html'}else{$requestPath.TrimStart('/')}
            if($fileName -notmatch '^[a-zA-Z0-9._-]+$'){throw 'Ongeldig pad'}
            $filePath=Join-Path $root $fileName
            if(-not(Test-Path -LiteralPath $filePath -PathType Leaf)){throw 'Niet gevonden'}
            $body=[System.IO.File]::ReadAllBytes($filePath); $extension=[System.IO.Path]::GetExtension($filePath)
            $contentType=if($mime.ContainsKey($extension)){$mime[$extension]}else{'application/octet-stream'}
            $header="HTTP/1.1 200 OK`r`nContent-Type: $contentType`r`nContent-Length: $($body.Length)`r`nCache-Control: no-store`r`nX-Content-Type-Options: nosniff`r`nConnection: close`r`n`r`n"
            $headerBytes=[System.Text.Encoding]::ASCII.GetBytes($header); $stream.Write($headerBytes,0,$headerBytes.Length); $stream.Write($body,0,$body.Length)
        } catch {
            if($stream){$body=[System.Text.Encoding]::UTF8.GetBytes('Niet gevonden');$header="HTTP/1.1 404 Not Found`r`nContent-Type: text/plain; charset=utf-8`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n";$headerBytes=[System.Text.Encoding]::ASCII.GetBytes($header);$stream.Write($headerBytes,0,$headerBytes.Length);$stream.Write($body,0,$body.Length)}
        } finally {
            if($reader){$reader.Dispose();$reader=$null};if($stream){$stream.Dispose();$stream=$null};$client.Dispose()
        }
    }
} finally { $listener.Stop() }
