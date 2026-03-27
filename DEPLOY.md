# EC2 Deployment Checklist
## FinanceCore — Amazon Linux 2023 on EC2 + RDS MySQL

---

## PART 1 — AWS Pre-requisites (do once)

### 1.1 RDS MySQL instance
- [ ] Launch an **Amazon RDS MySQL 8.0** instance (or Aurora MySQL-compatible).
- [ ] Place it in the **same VPC** as your EC2, in a **private subnet** (no public access).
- [ ] Create a **Security Group for RDS** allowing inbound TCP **3306** only from the EC2 Security Group.
- [ ] Note the **RDS Endpoint hostname**, port (3306), and master credentials.

### 1.2 Create the database and run the schema
```bash
mysql -h <RDS_ENDPOINT> -u admin -p
```
Inside MySQL:
```sql
CREATE DATABASE financetracker CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'financeuser'@'%' IDENTIFIED BY '<STRONG_PASSWORD>';
GRANT SELECT, INSERT, UPDATE, DELETE ON financetracker.* TO 'financeuser'@'%';
FLUSH PRIVILEGES;
EXIT;
```
Then run the schema:
```bash
mysql -h <RDS_ENDPOINT> -u financeuser -p financetracker < schema.sql
```

### 1.3 Store credentials in AWS Secrets Manager
```bash
aws secretsmanager create-secret \
  --name "prod/financetracker/rds" \
  --region ap-southeast-1 \
  --secret-string '{
    "username": "financeuser",
    "password": "<STRONG_PASSWORD>",
    "host":     "<RDS_ENDPOINT>",
    "port":     3306,
    "dbname":   "financetracker"
  }'
```

### 1.4 IAM Role for EC2
- [ ] Create an **IAM Role** (type: EC2).
- [ ] Attach an inline policy granting only:
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "secretsmanager:GetSecretValue",
    "Resource": "arn:aws:secretsmanager:ap-southeast-1:<ACCOUNT_ID>:secret:prod/financetracker/rds*"
  }]
}
```
- [ ] **Attach the role to your EC2 instance** (Actions → Security → Modify IAM Role).

### 1.5 EC2 Security Group
- [ ] Allow inbound **TCP 3000** (or 80/443) from your IP / load balancer.
- [ ] Allow inbound **TCP 22** (SSH) from your IP only.

---

## PART 2 — Server Setup (run on the EC2 instance via SSH)

### 2.1 Connect to EC2
```bash
ssh -i your-key.pem ec2-user@<EC2_PUBLIC_IP>
```

### 2.2 Install Node.js 20 (LTS) via NVM
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
node -v   # should print v20.x.x
```

### 2.3 Install Git and clone the project
```bash
sudo yum install -y git
git clone https://github.com/<your-org>/finance-tracker.git
cd finance-tracker
```
Or upload files directly:
```bash
scp -i your-key.pem -r ./finance-tracker ec2-user@<EC2_IP>:~/
```

### 2.4 Install dependencies
```bash
npm install --production
```

### 2.5 Configure environment variables
```bash
cp .env.example .env
nano .env
```
Set at minimum:
```
PORT=3000
AWS_REGION=ap-southeast-1
DB_SECRET_NAME=prod/financetracker/rds
```
> **No DB credentials needed in .env on EC2** — they are fetched from Secrets Manager via the attached IAM role.

---

## PART 3 — Run as a System Service (PM2)

### 3.1 Install PM2 globally
```bash
npm install -g pm2
```

### 3.2 Start the application
```bash
pm2 start server.js --name finance-tracker
pm2 save                          # persist across reboots
pm2 startup systemd               # generate & run the startup command it prints
```

### 3.3 Verify
```bash
pm2 status
curl http://localhost:3000/health
# Expected: {"status":"ok","timestamp":"..."}
```

---

## PART 4 — (Optional) Reverse Proxy with Nginx + HTTPS

### 4.1 Install Nginx
```bash
sudo yum install -y nginx
sudo systemctl enable --now nginx
```

### 4.2 Configure proxy
```bash
sudo nano /etc/nginx/conf.d/finance-tracker.conf
```
Paste:
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```
```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 4.3 HTTPS via Certbot (Let's Encrypt)
```bash
sudo yum install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

---

## PART 5 — Health Checks & Monitoring

| Check | Command |
|---|---|
| App process | `pm2 status` |
| App logs | `pm2 logs finance-tracker` |
| Health endpoint | `curl http://localhost:3000/health` |
| DB connectivity | Check server startup log for "Connection pool ready" |
| Nginx status | `sudo systemctl status nginx` |

---

## Quick Reference: Useful Commands

```bash
pm2 restart finance-tracker   # Restart app
pm2 reload finance-tracker    # Zero-downtime reload
pm2 stop finance-tracker      # Stop app
pm2 logs finance-tracker      # Stream logs
pm2 monit                     # Live CPU/memory dashboard
```
