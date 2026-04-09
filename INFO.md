Установить Docker
curl -fsSL https://get.docker.com | sh

Обнова уже развернутых

cd /var/www/dataforge
docker compose pull control-backend && docker compose up -d control-backend
docker compose pull control-frontend && docker compose up -d control-frontend

cd /root/dataforge-worker
docker compose pull worker && docker compose up -d worker

Обнова Worker паблик

bash scripts/publish-worker.sh
или
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\scripts\publish-worker.ps1

Nginx for worker
apt update && apt install -y nginx certbot python3-certbot-nginx

cat > /etc/nginx/sites-available/dataforge-worker <<'EOF'
server {
    listen 80;
    server_name fl.dataforge.me;

    location / {
        proxy_pass http://127.0.0.1:4001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support (if needed)
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Large request bodies (imports, etc.)
        client_max_body_size 50m;
    }
}
EOF

ln -sf /etc/nginx/sites-available/dataforge-worker /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

certbot --nginx -d fl.dataforge.me

ufw allow 80/tcp && ufw allow 443/tcp && ufw deny 4001/tcp