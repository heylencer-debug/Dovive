# run-pipeline-auto.ps1
# Self-restarting pipeline runner — logs to file, survives session drops
param(
    [string]$Keyword = "elderberry gummies",
    [string]$From = "P1"
)

$ScriptDir = "C:\Users\Carl Rebadomia\.openclaw\workspace\dovive\scout"
$LogFile = "$ScriptDir\pipeline-run.log"
$MaxRetries = 3
$Retry = 0

Set-Location $ScriptDir

while ($Retry -lt $MaxRetries) {
    $Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $Msg = "[$Timestamp] Starting pipeline: '$Keyword' from $From (attempt $($Retry + 1)/$MaxRetries)"
    Write-Host $Msg
    Add-Content -Path $LogFile -Value $Msg

    node run-pipeline.js --keyword $Keyword --from $From 2>&1 | Tee-Object -Append -FilePath $LogFile

    if ($LASTEXITCODE -eq 0) {
        $Done = "[$Timestamp] PIPELINE COMPLETE"
        Write-Host $Done
        Add-Content -Path $LogFile -Value $Done
        break
    } else {
        $Retry++
        $ErrMsg = "[$Timestamp] Pipeline exited with code $LASTEXITCODE. Retry $Retry/$MaxRetries in 10s..."
        Write-Host $ErrMsg
        Add-Content -Path $LogFile -Value $ErrMsg
        Start-Sleep -Seconds 10
    }
}
