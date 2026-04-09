Обнова уже развернутых

cd /var/www/dataforge
docker compose pull control-backend && docker compose up -d control-backend
docker compose pull control-frontend && docker compose up -d control-frontend

cd /root/dataforge-worker
docker compose pull worker && docker compose up -d worker

Обнова Worker паблик

bash scripts/publish-worker.sh
или
& "C:\Program Files\Git\bin\bash.exe" -c "sed -i 's/\r$//' scripts/publish-worker.sh && bash scripts/publish-worker.sh"