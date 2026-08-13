// Minimal test - just fetch one image URL and see what happens
const https = require('https');
const fs = require('fs').promises;
const path = require('path');

const imageUrl = 'https://i0.wp.com/hmherbs.com/application/files/cache/thumbnails/advanced-blood-pressure-cherry-16b990287119135911b07a9185adfa14.jpg';

console.log('Testing image download...');
console.log('URL:', imageUrl);
console.log('');

// Parse URL
const url = new URL(imageUrl);
const options = {
    hostname: url.hostname,
    path: url.pathname + url.search,
    method: 'GET',
    headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'image/*',
        'Referer': 'https://hmherbs.com/'
    },
    timeout: 10000 // 10 second timeout
};

console.log('Hostname:', options.hostname);
console.log('Path:', options.path);
console.log('');

const req = https.request(options, (res) => {
    console.log('Response received!');
    console.log('Status:', res.statusCode);
    console.log('Headers:', JSON.stringify(res.headers, null, 2));
    
    if (res.statusCode !== 200) {
        console.error('Non-200 status code:', res.statusCode);
        process.exit(1);
    }
    
    const chunks = [];
    let totalSize = 0;
    
    res.on('data', (chunk) => {
        chunks.push(chunk);
        totalSize += chunk.length;
        process.stdout.write(`\rDownloaded: ${(totalSize / 1024).toFixed(1)} KB`);
    });
    
    res.on('end', async () => {
        console.log('\n\nDownload complete!');
        console.log('Total size:', (totalSize / 1024).toFixed(2), 'KB');
        
        const buffer = Buffer.concat(chunks);
        
        // Save file
        const imagesDir = path.join(__dirname, '../../images/products');
        await fs.mkdir(imagesDir, { recursive: true });
        const filePath = path.join(imagesDir, 'test-minimal.jpg');
        await fs.writeFile(filePath, buffer);
        
        console.log('File saved to:', filePath);
        console.log('✅ SUCCESS!');
        process.exit(0);
    });
});

req.on('error', (error) => {
    console.error('Request error:', error.message);
    console.error('Error code:', error.code);
    process.exit(1);
});

req.on('timeout', () => {
    console.error('Request timeout!');
    req.destroy();
    process.exit(1);
});

req.setTimeout(10000);

console.log('Starting request...');
req.end();

