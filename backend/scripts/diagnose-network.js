// Network Diagnostic Tool - Check for firewall/network issues
const https = require('https');
const http = require('http');
const dns = require('dns');
const { URL } = require('url');

const imageUrl = 'https://i0.wp.com/example.com/application/files/cache/thumbnails/advanced-blood-pressure-cherry-16b990287119135911b07a9185adfa14.jpg';

console.log('🔍 Network Diagnostic Tool\n');
console.log('='.repeat(60));
console.log('Testing:', imageUrl);
console.log('='.repeat(60));
console.log('');

// Test 1: DNS Resolution
console.log('1️⃣ Testing DNS Resolution...');
const parsedUrl = new URL(imageUrl);
dns.lookup(parsedUrl.hostname, (err, address, family) => {
    if (err) {
        console.log('   ❌ DNS Resolution FAILED:', err.message);
        console.log('   This indicates a network/DNS issue');
        process.exit(1);
    } else {
        console.log(`   ✅ DNS Resolution OK: ${parsedUrl.hostname} -> ${address} (IPv${family})`);
    }
    
    // Test 2: Basic HTTP Connection
    console.log('\n2️⃣ Testing HTTP Connection...');
    const options = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'HEAD', // Just get headers, not full content
        headers: {
            'User-Agent': 'Mozilla/5.0'
        },
        timeout: 10000
    };
    
    const req = https.request(options, (res) => {
        console.log(`   ✅ Connection Successful!`);
        console.log(`   Status Code: ${res.statusCode}`);
        console.log(`   Content-Type: ${res.headers['content-type']}`);
        console.log(`   Content-Length: ${res.headers['content-length']} bytes`);
        console.log(`   Server: ${res.headers['server'] || 'Unknown'}`);
        
        if (res.statusCode === 200) {
            console.log('\n3️⃣ Testing Full Image Download...');
            testFullDownload();
        } else if (res.statusCode === 301 || res.statusCode === 302) {
            console.log(`   ⚠️  Redirect to: ${res.headers.location}`);
            console.log('\n3️⃣ Testing Full Image Download (following redirect)...');
            testFullDownload();
        } else {
            console.log(`   ⚠️  Unexpected status code: ${res.statusCode}`);
            console.log('   This might indicate the server is blocking requests');
        }
    });
    
    req.on('error', (error) => {
        console.log(`   ❌ Connection FAILED: ${error.message}`);
        console.log(`   Error Code: ${error.code}`);
        
        if (error.code === 'ETIMEDOUT') {
            console.log('   ⚠️  TIMEOUT - Firewall or network may be blocking');
        } else if (error.code === 'ECONNREFUSED') {
            console.log('   ⚠️  CONNECTION REFUSED - Server may be blocking');
        } else if (error.code === 'ENOTFOUND') {
            console.log('   ⚠️  HOST NOT FOUND - DNS issue');
        } else if (error.code === 'CERT_HAS_EXPIRED' || error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
            console.log('   ⚠️  SSL CERTIFICATE ISSUE - May need to bypass');
        }
    });
    
    req.on('timeout', () => {
        console.log('   ❌ Connection TIMEOUT');
        console.log('   ⚠️  This strongly suggests firewall/network blocking');
        req.destroy();
    });
    
    req.setTimeout(10000);
    req.end();
});

function testFullDownload() {
    const parsedUrl = new URL(imageUrl);
    const options = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'image/*',
            'Referer': 'https://businessonecomprehensive.com/'
        },
        timeout: 15000
    };
    
    let dataReceived = 0;
    const startTime = Date.now();
    
    const req = https.request(options, (res) => {
        console.log(`   Status: ${res.statusCode}`);
        
        res.on('data', (chunk) => {
            dataReceived += chunk.length;
            process.stdout.write(`\r   Downloaded: ${(dataReceived / 1024).toFixed(1)} KB`);
        });
        
        res.on('end', () => {
            const elapsed = Date.now() - startTime;
            console.log(`\n   ✅ Download Complete!`);
            console.log(`   Total Size: ${(dataReceived / 1024).toFixed(2)} KB`);
            console.log(`   Time: ${elapsed}ms`);
            console.log(`   Speed: ${(dataReceived / 1024 / (elapsed / 1000)).toFixed(1)} KB/s`);
            
            // Check if it's a valid image
            if (dataReceived > 0) {
                console.log('\n✅ ALL TESTS PASSED - Network is working!');
                console.log('The issue is likely in the download script, not the network.');
            } else {
                console.log('\n⚠️  WARNING - Received 0 bytes');
            }
        });
    });
    
    req.on('error', (error) => {
        console.log(`\n   ❌ Download FAILED: ${error.message}`);
        console.log(`   Error Code: ${error.code}`);
        console.log('\n❌ NETWORK ISSUE DETECTED');
        console.log('Possible causes:');
        console.log('  - Firewall blocking outbound connections');
        console.log('  - Corporate proxy requiring authentication');
        console.log('  - Antivirus blocking downloads');
        console.log('  - Network timeout settings too low');
    });
    
    req.on('timeout', () => {
        console.log('\n   ❌ Download TIMEOUT');
        console.log('\n❌ NETWORK TIMEOUT ISSUE');
        console.log('The connection is timing out. This could be:');
        console.log('  - Firewall blocking the connection');
        console.log('  - Network too slow');
        console.log('  - Server not responding');
        req.destroy();
    });
    
    req.setTimeout(15000);
    req.end();
}

// Also test if we can reach the main website
console.log('0️⃣ Testing connection to main website...');
dns.lookup('example.com', (err, address) => {
    if (err) {
        console.log('   ❌ Cannot resolve example.com:', err.message);
    } else {
        console.log(`   ✅ example.com resolves to: ${address}`);
    }
});

