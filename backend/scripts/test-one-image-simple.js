// Simple test - download ONE image and show all output
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const imageUrl = 'https://i0.wp.com/hmherbs.com/application/files/cache/thumbnails/advanced-blood-pressure-cherry-16b990287119135911b07a9185adfa14.jpg';

console.log('Testing download of ONE image...');
console.log('URL:', imageUrl);
console.log('');

const parsedUrl = new URL(imageUrl);
const imagesDir = path.join(__dirname, '../../images/products');

// Create directory
if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true });
    console.log('Created directory:', imagesDir);
}

const filename = 'test-download-' + Date.now() + '.jpg';
const filePath = path.join(imagesDir, filename);

console.log('Saving to:', filePath);
console.log('');

const file = fs.createWriteStream(filePath);

const options = {
    hostname: parsedUrl.hostname,
    path: parsedUrl.pathname + parsedUrl.search,
    method: 'GET',
    headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'image/*'
    }
};

console.log('Starting download...');
console.log('Hostname:', options.hostname);
console.log('Path:', options.path);
console.log('');

const req = https.request(options, (response) => {
    console.log('Response received!');
    console.log('Status:', response.statusCode);
    console.log('Content-Type:', response.headers['content-type']);
    console.log('Content-Length:', response.headers['content-length']);
    console.log('');
    
    if (response.statusCode !== 200) {
        console.error('ERROR: Status code is not 200:', response.statusCode);
        file.close();
        fs.unlink(filePath, () => {});
        process.exit(1);
    }
    
    let bytesReceived = 0;
    
    response.on('data', (chunk) => {
        bytesReceived += chunk.length;
        process.stdout.write(`\rDownloaded: ${(bytesReceived / 1024).toFixed(1)} KB`);
    });
    
    response.pipe(file);
    
    file.on('finish', () => {
        file.close();
        const stats = fs.statSync(filePath);
        console.log('\n');
        console.log('✅ SUCCESS!');
        console.log('File saved:', filePath);
        console.log('File size:', (stats.size / 1024).toFixed(2), 'KB');
        process.exit(0);
    });
});

req.on('error', (error) => {
    console.error('\n❌ ERROR:', error.message);
    console.error('Error code:', error.code);
    file.close();
    fs.unlink(filePath, () => {});
    process.exit(1);
});

req.setTimeout(30000, () => {
    console.error('\n❌ TIMEOUT');
    req.destroy();
    file.close();
    fs.unlink(filePath, () => {});
    process.exit(1);
});

req.end();

