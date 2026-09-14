# Deploy Business One platform (API + storefront/admin) to the POS Linode ONLY.
# Never use against HM Herbs (e.g. 172.238.208.164).
# Usage: .\deploy\sync-platform-linode.ps1
# Preserves remote backend/.env (not included in the pack).
param(
    [string]$Remote = "root@172.238.220.29",
    [string]$RemoteDir = "/var/www/business-one-platform"
)

$ErrorActionPreference = "Stop"

if ($Remote -notmatch '172\.238\.220\.29' -or $RemoteDir -ne '/var/www/business-one-platform') {
    throw "Refusing deploy: only root@172.238.220.29 + /var/www/business-one-platform allowed."
}

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$pack = "$env:TEMP\business-one-platform-linode.tgz"
Write-Host "Packing for Business One Linode only ($Remote)..."
& tar -czf $pack --exclude=node_modules --exclude=backend/node_modules --exclude=.git --exclude=.env --exclude=backend/.env --exclude=.lh-tmp --exclude=deploy/db-connection.env --exclude=*.tgz .
if ($LASTEXITCODE -ne 0) { throw "tar pack failed" }

Write-Host "Uploading..."
ssh $Remote "hostname; test ! -d /var/www/hmherbs; mkdir -p $RemoteDir"
scp -q $pack "${Remote}:/tmp/business-one-platform-linode.tgz"
Remove-Item $pack -Force

ssh $Remote "set -e; hostname; test ! -d /var/www/hmherbs; cd $RemoteDir; tar -xzf /tmp/business-one-platform-linode.tgz; rm -f /tmp/business-one-platform-linode.tgz; cd backend; test -f .env; npm install --omit=dev; systemctl restart business-one-platform; systemctl is-active business-one-platform"

Write-Host "Deployed to $RemoteDir only (business-one-platform)."
