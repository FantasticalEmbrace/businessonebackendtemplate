# Deploy Business One platform API to the POS Linode (not HM Herbs).
# Usage: .\deploy\sync-platform-linode.ps1 -Remote root@172.238.220.29
param(
    [string]$Remote = "root@172.238.220.29",
    [string]$RemoteDir = "/var/www/business-one-platform"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

Write-Host "Packing business-one-platform backend..."
$tarArgs = @(
    "-czf", "-",
    "--exclude=node_modules",
    "--exclude=.git",
    "--exclude=.env",
    "backend"
)
$proc = Start-Process -FilePath "tar" -ArgumentList $tarArgs -NoNewWindow -PassThru -RedirectStandardOutput "$env:TEMP\business-one-platform-linode.tgz" -Wait
if ($proc.ExitCode -ne 0) { throw "tar pack failed" }

Write-Host "Uploading to ${Remote}:${RemoteDir} ..."
ssh $Remote "mkdir -p $RemoteDir"
scp -q "$env:TEMP\business-one-platform-linode.tgz" "${Remote}:/tmp/business-one-platform-linode.tgz"
Remove-Item "$env:TEMP\business-one-platform-linode.tgz" -Force

ssh $Remote @"
set -e
cd $RemoteDir
tar -xzf /tmp/business-one-platform-linode.tgz
rm -f /tmp/business-one-platform-linode.tgz
cd backend
npm install --omit=dev
systemctl restart business-one-platform
systemctl is-active business-one-platform
"@

Write-Host ""
Write-Host "Platform API deployed to $RemoteDir/backend (systemd: business-one-platform)"
