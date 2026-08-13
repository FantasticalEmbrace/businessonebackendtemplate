# 🚀 HM Herbs Deployment Guide

This guide covers generic production deployment. **For Linode / Akamai (recommended), use [LINODE_DEPLOY.md](./LINODE_DEPLOY.md)** — Linode, NodeBalancer, Managed MySQL, Nginx, PM2, and SSL.

## 📋 Pre-Deployment Checklist

### 1. Environment Configuration
- [ ] Copy production env template to your server (`backend/.env.linode.example` → `backend/.env`)
- [ ] Update all production values in `backend/.env`
- [ ] Set `PRODUCTION_DOMAIN` to your actual domain
- [ ] Generate strong `JWT_SECRET` and `POS_ENCRYPTION_KEY`
- [ ] Configure production database credentials

### 2. Database Setup
- [ ] Create production database (Linode Managed MySQL)
- [ ] Run database migrations/schema
- [ ] Import initial data if needed
- [ ] Test database connectivity

### 3. Domain & SSL
- [ ] Point domain A record to NodeBalancer IP
- [ ] Configure SSL certificate on the Linode (Let's Encrypt)
- [ ] Update `FRONTEND_URL` and `PRODUCTION_DOMAIN` in environment

## 🔧 Environment Variables

### Required Production Variables
```bash
# Server
NODE_ENV=production
PORT=3001
PRODUCTION_DOMAIN=yourdomain.com
FRONTEND_URL=https://yourdomain.com

# Database
DB_HOST=your-production-db-host
DB_USER=your-production-db-user
DB_PASSWORD=your-secure-db-password
DB_NAME=hmherbs_production

# Security (CRITICAL - Generate new values)
JWT_SECRET=your-super-long-random-production-jwt-secret
POS_ENCRYPTION_KEY=your-production-pos-encryption-key
```

### Optional Variables
```bash
# Redis (recommended for production)
REDIS_URL=redis://your-redis-host:6379

# Email
SMTP_HOST=your-smtp-host
SMTP_PORT=587
SMTP_USER=your-email@domain.com
SMTP_PASS=your-email-password

# Logging
LOG_LEVEL=warn
```

## 🌐 Deployment Options

### Option 1: Traditional Server (VPS — Linode)

1. **Install Dependencies**
   ```bash
   # Install Node.js 18+
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs
   
   # Install PM2 for process management
   npm install -g pm2
   ```

2. **Deploy Application**
   ```bash
   # Clone repository
   git clone https://github.com/your-username/HMHerbs.git
   cd HMHerbs
   
   # Install dependencies
   npm install
   
   # Copy and configure environment
   cp backend/.env.linode.example backend/.env
   # Edit backend/.env with your production values
   
   # Start with PM2
   pm2 start backend/server.js --name "hmherbs-backend"
   pm2 startup
   pm2 save
   ```

3. **Configure Nginx (Reverse Proxy)**
   ```nginx
   server {
       listen 80;
       server_name yourdomain.com;
       
       # Frontend files
       location / {
           root /var/www/hmherbs;
           try_files $uri $uri/ /index.html;
       }
       
       # API proxy
       location /api/ {
           proxy_pass http://localhost:3001;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
       }
   }
   ```

See **[LINODE_DEPLOY.md](./LINODE_DEPLOY.md)** for the full step-by-step guide including NodeBalancer and Managed MySQL.

### Option 2: Docker Deployment

1. **Create Dockerfile**
   ```dockerfile
   FROM node:18-alpine
   
   WORKDIR /app
   COPY package*.json ./
   RUN npm ci --only=production
   
   COPY . .
   
   EXPOSE 3001
   CMD ["node", "backend/server.js"]
   ```

2. **Create docker-compose.yml**
   ```yaml
   version: '3.8'
   services:
     app:
       build: .
       ports:
         - "3001:3001"
       environment:
         - NODE_ENV=production
       env_file:
         - .env.production
       depends_on:
         - db
     
     db:
       image: mysql:8.0
       environment:
         MYSQL_ROOT_PASSWORD: ${DB_PASSWORD}
         MYSQL_DATABASE: ${DB_NAME}
       volumes:
         - db_data:/var/lib/mysql
   
   volumes:
     db_data:
   ```

### Option 3: Cloud Platforms

#### Heroku
```bash
# Install Heroku CLI and login
heroku create your-app-name

# Set environment variables
heroku config:set NODE_ENV=production
heroku config:set JWT_SECRET=your-jwt-secret
# ... set all other production variables

# Deploy
git push heroku main
```

#### Vercel
```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod

# Set environment variables in Vercel dashboard
```

## 🔒 Security Checklist

- [ ] Use HTTPS in production
- [ ] Set strong, unique JWT_SECRET
- [ ] Configure firewall (only allow ports 80, 443, 22)
- [ ] Regular security updates
- [ ] Database access restricted to application only
- [ ] Enable database SSL if available
- [ ] Configure proper CORS origins
- [ ] Set up monitoring and logging

## 📊 Monitoring & Maintenance

### Health Checks
- [ ] Set up uptime monitoring
- [ ] Configure error alerting
- [ ] Monitor database performance
- [ ] Track API response times

### Backups
- [ ] Automated database backups
- [ ] File upload backups
- [ ] Environment configuration backups

### Updates
- [ ] Regular dependency updates
- [ ] Security patch schedule
- [ ] Database maintenance windows

## 🆘 Troubleshooting

### Common Issues

1. **CORS Errors**
   - Verify `PRODUCTION_DOMAIN` is set correctly
   - Check CORS configuration in `backend/server.js`

2. **Database Connection**
   - Verify database credentials
   - Check network connectivity
   - Ensure database server is running

3. **API Not Working**
   - Check if backend server is running on correct port
   - Verify reverse proxy configuration
   - Check server logs for errors

4. **Frontend Not Loading Products**
   - Verify API base URL configuration
   - Check browser console for errors
   - Test API endpoints directly

### Logs
```bash
# PM2 logs
pm2 logs hmherbs-backend

# System logs
sudo journalctl -u nginx
sudo journalctl -u mysql
```

## 📞 Support

If you encounter issues during deployment:

1. Check the logs first
2. Verify all environment variables are set
3. Test each component individually
4. Check firewall and network settings

For additional help, create an issue in the repository with:
- Deployment method used
- Error messages
- Environment details
- Steps already tried
