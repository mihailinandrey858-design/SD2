# SDonate

Веб-панель SDonate: Node.js-сервер (`server.js`) отдаёт статические страницы и JSON API (`/api/...`). Данные хранятся в `data/*.json`.

## Запуск на VPS

### 1. Требования

- Node.js 18+ и npm
- Открытый порт (по умолчанию 3000) или reverse proxy на 80/443

### 2. Установка

```bash
git clone <url-репозитория> sd
cd sd
npm install --omit=dev
```

### 3. Настройка

```bash
cp .env.example .env
nano .env
```

Минимум для первого запуска:

- `SDONATE_ADMIN_EMAIL` и `SDONATE_ADMIN_PASSWORD` (от 12 символов) — создаётся аккаунт администратора;
- `PUBLIC_BASE_URL` — публичный адрес, например `http://123.45.67.89:3000` или `https://sdonate.example.com`. Если не задать, ссылки строятся из заголовка Host запроса;
- `SMTP_*` — чтобы письма сброса пароля уходили на почту (без SMTP ссылка пишется в лог сервера);
- `SDONATE_TELEGRAM_BOT_TOKEN` + `SDONATE_TELEGRAM_CHAT_ID` — уведомления о заявках в Telegram;
- `RECAPTCHA_SITE_KEY` + `RECAPTCHA_SECRET_KEY` — Google reCAPTCHA v2 («Я не робот») на входе и регистрации. Ключи создаются на https://www.google.com/recaptcha/admin/create (тип: reCAPTCHA v2 → флажок «Я не робот»; в домены добавь IP сервера и/или свой домен). Без ключей капча отключена.

### 4. Запуск

```bash
npm start
```

Сервер слушает `0.0.0.0:3000` — сайт доступен снаружи по `http://<IP-VPS>:3000`.

### 5. Автозапуск через systemd

`/etc/systemd/system/sdonate.service`:

```ini
[Unit]
Description=SDonate
After=network.target

[Service]
WorkingDirectory=/opt/sd
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now sdonate
```

### 6. HTTPS через nginx (рекомендуется)

```nginx
server {
    listen 80;
    server_name sdonate.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Затем выпусти сертификат: `sudo certbot --nginx -d sdonate.example.com` и укажи `PUBLIC_BASE_URL=https://sdonate.example.com` в `.env`.

Важно: заголовки `X-Forwarded-Proto` и `X-Forwarded-Host` обязательны — по ним сервер определяет HTTPS для cookie и строит публичные ссылки.

## Локальный запуск

```bash
npm install
npm start
```

Сайт будет на `http://localhost:3000`. Страницы также открываются без сервера (как файлы) — тогда API работает в демо-режиме на localStorage.
