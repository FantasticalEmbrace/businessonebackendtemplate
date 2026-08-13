@echo off
cd /d %~dp0
echo Testing image download...
echo.
node -e "console.log('Node.js is working!'); const https = require('https'); const fs = require('fs'); const path = require('path'); const file = fs.createWriteStream(path.join(__dirname, '../images/products/test-simple.jpg')); https.get('https://i0.wp.com/hmherbs.com/application/files/cache/thumbnails/advanced-blood-pressure-cherry-16b990287119135911b07a9185adfa14.jpg', (res) => { console.log('Status:', res.statusCode); res.pipe(file); file.on('finish', () => { file.close(); console.log('SUCCESS! File saved.'); }); }).on('error', (err) => { console.error('ERROR:', err.message); }); setTimeout(() => {}, 10000);"
echo.
echo Check images/products/test-simple.jpg
pause

