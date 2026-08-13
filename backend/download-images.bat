@echo off
echo Starting image download...
cd /d %~dp0
node scripts/final-working-downloader.js
pause

