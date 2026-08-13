// Script to check MySQL credentials and list admin users
const path = require('path');
const { loadBackendEnv, buildDbConfig, createConnection } = require('./utils/dbConfig');

async function checkCredentials() {
    loadBackendEnv();

    console.log('🔍 Checking MySQL Credentials and Admin Users\n');
    console.log('='.repeat(60));

    const cfg = buildDbConfig();

    console.log('\n📋 Current .env Configuration:');
    console.log('   DB_HOST:', cfg.host);
    console.log('   DB_PORT:', cfg.port);
    console.log('   DB_USER:', cfg.user);
    console.log('   DB_NAME:', cfg.database);
    console.log('   DB_SSL:', cfg.ssl ? 'enabled' : 'disabled');
    console.log('   DB_PASSWORD:', cfg.password ? '***' + String(cfg.password).slice(-3) : 'NOT SET');
    console.log('\n   📁 .env file location:', path.join(__dirname, '.env'));

    console.log('\n🔌 Testing Database Connection...');

    try {
        const connection = await createConnection();
        console.log('✅ Successfully connected to MySQL database!\n');

        const [version] = await connection.execute('SELECT VERSION() as version');
        console.log('   MySQL Version:', version[0].version);

        try {
            const [admins] = await connection.execute(
                'SELECT id, email, first_name, last_name, role, is_active, created_at FROM admin_users ORDER BY created_at'
            );

            console.log('\n👤 Admin Users in Database:');
            console.log('   ' + '-'.repeat(58));

            if (admins.length === 0) {
                console.log('   ⚠️  No admin users found in database.');
                console.log('   💡 You may need to create an admin user.');
            } else {
                admins.forEach((admin, index) => {
                    console.log(`\n   Admin #${index + 1}:`);
                    console.log(`      ID: ${admin.id}`);
                    console.log(`      Email: ${admin.email}`);
                    console.log(`      Name: ${admin.first_name} ${admin.last_name}`);
                    console.log(`      Role: ${admin.role}`);
                    console.log(`      Active: ${admin.is_active ? '✅ Yes' : '❌ No'}`);
                    console.log(`      Created: ${admin.created_at}`);
                });
            }
        } catch (tableError) {
            if (tableError.code === 'ER_NO_SUCH_TABLE' || tableError.errno === 1146) {
                console.log('\n❌ admin_users table does not exist!');
                console.log('   💡 Import the database: npm run db:build-staging (see database/DEPLOY-DATABASE.md)');
            } else {
                console.log('\n⚠️  Error querying admin_users table:', tableError.message);
            }
        }

        await connection.end();
        console.log('\n' + '='.repeat(60));
        console.log('✅ Check complete!\n');
    } catch (error) {
        console.log('❌ Failed to connect to MySQL database!\n');
        console.log('   Error Code:', error.code || error.errno);
        console.log('   Error Message:', error.message);

        if (error.code === 'ER_ACCESS_DENIED_ERROR' || error.errno === 1045) {
            console.log('\n💡 Wrong username/password, or user lacks access.');
            console.log('   Linode: use Connection Details from Cloud Manager → Databases.');
        } else if (error.code === 'ECONNREFUSED') {
            console.log('\n💡 Server unreachable — check DB_HOST, DB_PORT, MySQL running, and allow list.');
        } else if (String(error.message).includes('SSL') || String(error.message).includes('certificate')) {
            console.log('\n💡 Linode Managed MySQL: DB_SSL=true and DB_SSL_CA_PATH=./certs/ca-certificate.crt');
        } else if (error.code === 'ER_BAD_DB_ERROR') {
            console.log('\n💡 Database name in .env does not exist on the server.');
        }

        console.log('\n' + '='.repeat(60));
        process.exit(1);
    }
}

checkCredentials().catch(console.error);
