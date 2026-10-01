#!/usr/bin/env bash
# Настройка чистого VPS под сайт «Каркас Комфорт» (Ubuntu 22.04/24.04).
#
# Запускается один раз на новом сервере от root:
#   bash <(curl -fsSL https://raw.githubusercontent.com/dkaratsapov-web/karkas_comfort/claude/karkas-comfort-redesign-0zy3xi/server/bootstrap.sh) \
#        --domain xn--80aa2abbmnbmggrx.xn--p1ai \
#        --email  почта@для.сертификата \
#        --key    "ssh-ed25519 AAAA… ключ-для-деплоя"
#
# Что делает: ставит nginx, PHP-FPM и certbot, заводит пользователя deploy
# с доступом только по ключу, раскладывает каталоги сайта, включает
# брандмауэр и автообновления, разворачивает конфиг nginx из шаблона
# и выпускает сертификат Let's Encrypt с автопродлением.
#
# ПОДСЕЛЕНИЕ НА ЗАНЯТЫЙ СЕРВЕР. Скрипт сам распознаёт, что сервер уже
# обжит, и ведёт себя осторожно: не трогает чужие конфиги nginx, не
# удаляет сайт по умолчанию, не переключает брандмауэр и ничего не
# переустанавливает. Наш сайт добавляется отдельным server-блоком
# в своём каталоге — так на одном nginx живёт сколько угодно сайтов.
# Если на сервере панель управления (ISPmanager, FastPanel, HestiaCP)
# или Apache, скрипт остановится и скажет об этом: там сайты заводят
# через панель, иначе она перезапишет конфиги.
#
# Скрипт идемпотентный: повторный запуск ничего не ломает.
set -euo pipefail

DOMAIN=""; EMAIL=""; PUBKEY=""; DEPLOY_USER="deploy"
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --email)  EMAIL="$2";  shift 2 ;;
    --key)    PUBKEY="$2"; shift 2 ;;
    --user)   DEPLOY_USER="$2"; shift 2 ;;
    *) echo "Неизвестный аргумент: $1"; exit 1 ;;
  esac
done

[ -n "$DOMAIN" ] || { echo "Укажите --domain (в punycode, например xn--80aa2abbmnbmggrx.xn--p1ai)"; exit 1; }
[ -n "$EMAIL" ]  || { echo "Укажите --email для уведомлений Let's Encrypt"; exit 1; }
[ "$(id -u)" = "0" ] || { echo "Запускать от root"; exit 1; }

REPO_RAW="https://raw.githubusercontent.com/dkaratsapov-web/karkas_comfort/claude/karkas-comfort-redesign-0zy3xi"
ROOT="/var/www/$DOMAIN"
PUBLIC="$ROOT/public"

echo "==> 1/8 Осмотр сервера"
SHARED=0
for panel in ispmanager fastpanel2 hestia vesta cpanel plesk; do
  if systemctl list-unit-files 2>/dev/null | grep -qi "^$panel" || [ -d "/usr/local/$panel" ]; then
    echo "!! На сервере найдена панель управления ($panel)."
    echo "   Заводите сайт через неё: создайте домен $DOMAIN, укажите корень каталога"
    echo "   и выпустите сертификат. Выгрузка по SSH после этого работает так же."
    exit 1
  fi
done
if systemctl is-active --quiet apache2 2>/dev/null; then
  echo "!! На сервере работает Apache, а конфигурация в репозитории написана под nginx."
  echo "   Либо добавьте VirtualHost вручную (правила возьмите из server/.htaccess),"
  echo "   либо напишите — подготовлю конфигурацию под Apache."
  exit 1
fi
if systemctl is-active --quiet nginx 2>/dev/null; then
  SHARED=1
  SITES=$(ls /etc/nginx/sites-enabled/ 2>/dev/null | grep -v "^default$" | wc -l)
  echo "    nginx уже работает, сайтов включено: $SITES — подселяемся, чужое не трогаем"
else
  echo "    чистый сервер — настраиваем с нуля"
fi

echo "==> 2/8 Пакеты"
export DEBIAN_FRONTEND=noninteractive
# На Ubuntu 22.04 после установки пакетов needrestart показывает диалог
# «какие службы перезапустить» и ждёт ответа. В неинтерактивном запуске
# это выглядит как зависание, поэтому отвечаем за него заранее.
export NEEDRESTART_MODE=a
export NEEDRESTART_SUSPEND=1

# Сразу после создания сервера система ставит обновления сама и держит
# блокировку apt. Молча ждать её — выглядит как зависший скрипт,
# поэтому ждём с объяснением и ограничением по времени.
waited=0
while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || fuser /var/lib/apt/lists/lock >/dev/null 2>&1; do
  if [ "$waited" = "0" ]; then
    echo "    apt занят фоновым обновлением системы — ждём, это нормально"
  fi
  sleep 5; waited=$((waited + 5))
  if [ "$waited" -ge 600 ]; then
    echo "    !! apt занят уже 10 минут. Посмотрите, кто держит блокировку:"
    echo "       fuser -v /var/lib/dpkg/lock-frontend"
    exit 1
  fi
  [ $((waited % 60)) = 0 ] && echo "    ждём apt: $((waited / 60)) мин"
done

apt-get update -qq
PKGS=""
for pkg in nginx certbot python3-certbot-nginx rsync curl ca-certificates; do
  dpkg -s "$pkg" >/dev/null 2>&1 || PKGS="$PKGS $pkg"
done
ls /run/php/php*-fpm.sock >/dev/null 2>&1 || PKGS="$PKGS php-fpm"
if [ "$SHARED" = "0" ]; then
  for pkg in ufw fail2ban unattended-upgrades; do
    dpkg -s "$pkg" >/dev/null 2>&1 || PKGS="$PKGS $pkg"
  done
fi
if [ -n "$PKGS" ]; then
  echo "    ставим:$PKGS (на слабом сервере это 2–5 минут)"
  apt-get install -y -o Dpkg::Use-Pty=0 -o Dpkg::Options::=--force-confold $PKGS 2>&1 | grep -E "^(Setting up|Unpacking|Получено|Настраивается)" | tail -5 || true
else
  echo "    всё нужное уже стоит"
fi

PHP_SOCK="$(ls /run/php/php*-fpm.sock 2>/dev/null | head -1 || true)"
[ -n "$PHP_SOCK" ] || { echo "PHP-FPM не поднялся — проверьте: systemctl status php*-fpm"; exit 1; }
echo "    PHP-FPM: $PHP_SOCK"

echo "==> 3/8 Пользователь $DEPLOY_USER"
id -u "$DEPLOY_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$DEPLOY_USER"
usermod -aG www-data "$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
touch "/home/$DEPLOY_USER/.ssh/authorized_keys"

GENERATED_KEY=""
if [ -z "$PUBKEY" ]; then
  # Ключ не передали — заводим пару прямо здесь. Приватный покажем в конце,
  # его нужно будет скопировать в секрет GitHub. Так пароль и ключ нигде
  # не всплывают в переписке и не попадают в репозиторий.
  if [ ! -f /root/deploy_key ]; then
    ssh-keygen -t ed25519 -N "" -C "github-actions@$DOMAIN" -f /root/deploy_key >/dev/null
  fi
  PUBKEY="$(cat /root/deploy_key.pub)"
  GENERATED_KEY="/root/deploy_key"
fi

grep -qxF "$PUBKEY" "/home/$DEPLOY_USER/.ssh/authorized_keys" || echo "$PUBKEY" >> "/home/$DEPLOY_USER/.ssh/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys"
chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"

echo "==> 4/8 Каталоги сайта"
install -d -o "$DEPLOY_USER" -g www-data -m 2755 "$ROOT" "$PUBLIC" "$PUBLIC/api"
# Заглушка, чтобы сайт отвечал ещё до первой выгрузки
[ -f "$PUBLIC/index.html" ] || printf '<!doctype html><meta charset="utf-8"><title>Каркас Комфорт</title><p>Сервер готов, ждём выгрузку сайта.</p>\n' > "$PUBLIC/index.html"
chown -R "$DEPLOY_USER:www-data" "$PUBLIC"

echo "==> 5/8 Приём заявок"
# config.php хранит почту и токены: создаётся один раз и выгрузкой не перезаписывается
if [ ! -f "$PUBLIC/api/config.php" ]; then
  curl -fsSL "$REPO_RAW/server/api/config.php" -o "$PUBLIC/api/config.php" || true
fi
if [ -f "$PUBLIC/api/config.php" ]; then
  chown "$DEPLOY_USER:www-data" "$PUBLIC/api/config.php"; chmod 640 "$PUBLIC/api/config.php"
fi
touch "$PUBLIC/api/leads.csv"
chown www-data:www-data "$PUBLIC/api/leads.csv"; chmod 660 "$PUBLIC/api/leads.csv"

echo "==> 6/8 Конфигурация nginx"
curl -fsSL "$REPO_RAW/server/nginx-site.conf.template" -o /tmp/site.conf.template
# HTTP/2 включается по-разному: до nginx 1.25 — флагом в listen,
# с 1.25 — отдельной директивой. Старый nginx на директиве падает.
NGINX_VER="$(nginx -v 2>&1 | sed -n 's|.*/\([0-9.]*\).*|\1|p')"
if [ "$(printf '%s\n1.25.1\n' "$NGINX_VER" | sort -V | head -1)" = "1.25.1" ]; then
  HTTP2_LISTEN=""; HTTP2_DIRECTIVE="    http2 on;\n"
else
  HTTP2_LISTEN=" http2"; HTTP2_DIRECTIVE=""
fi
echo "    nginx $NGINX_VER"
sed -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__PHP_SOCK__|$PHP_SOCK|g" \
    -e "s|__HTTP2_LISTEN__|$HTTP2_LISTEN|g" -e "s|__HTTP2_DIRECTIVE__|$HTTP2_DIRECTIVE|g" \
    /tmp/site.conf.template > "/etc/nginx/sites-available/$DOMAIN.conf"
ln -sf "/etc/nginx/sites-available/$DOMAIN.conf" "/etc/nginx/sites-enabled/$DOMAIN.conf"
# сайт по умолчанию убираем только на чистом сервере: на обжитом за ним
# может стоять чужой проект
if [ "$SHARED" = "0" ]; then rm -f /etc/nginx/sites-enabled/default; fi
# до выпуска сертификата https-блоки ссылаются на несуществующие файлы — временно оставляем только http
if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  cat > "/etc/nginx/sites-available/$DOMAIN.conf.http" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN www.$DOMAIN;
    root $PUBLIC;
    index index.html;
    location /.well-known/acme-challenge/ { root $PUBLIC; }
    location / { try_files \$uri \$uri/ \$uri/index.html =404; }
}
NGINX
  ln -sf "/etc/nginx/sites-available/$DOMAIN.conf.http" "/etc/nginx/sites-enabled/$DOMAIN.conf"
fi
nginx -t && systemctl reload nginx

echo "==> 7/8 Брандмауэр и автообновления"
if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH >/dev/null 2>&1 || true
  ufw allow 'Nginx Full' >/dev/null 2>&1 || true
  if [ "$SHARED" = "0" ]; then
    ufw --force enable >/dev/null
  elif ! ufw status 2>/dev/null | grep -q "Status: active"; then
    echo "    брандмауэр выключен — не включаю: на обжитом сервере это может"
    echo "    отрезать порты чужих служб. Включить вручную: ufw enable"
  fi
fi
if [ "$SHARED" = "0" ]; then
  systemctl enable --now fail2ban >/dev/null 2>&1 || true
  dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true
fi

echo "==> 8/8 Сертификат Let's Encrypt"
if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  if certbot certonly --webroot -w "$PUBLIC" -d "$DOMAIN" -d "www.$DOMAIN" \
       --agree-tos -m "$EMAIL" --non-interactive; then
    echo "    сертификат выпущен"
  else
    echo "    !! не удалось выпустить сертификат — обычно это значит, что A-записи домена"
    echo "       ещё не указывают на этот сервер. Проверьте DNS и повторите:"
    echo "       certbot certonly --webroot -w $PUBLIC -d $DOMAIN -d www.$DOMAIN --agree-tos -m $EMAIL -n"
  fi
fi
if [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  [ -f /etc/letsencrypt/options-ssl-nginx.conf ] || curl -fsSL https://raw.githubusercontent.com/certbot/certbot/main/certbot-nginx/src/certbot_nginx/_internal/tls_configs/options-ssl-nginx.conf -o /etc/letsencrypt/options-ssl-nginx.conf
  [ -f /etc/letsencrypt/ssl-dhparams.pem ] || openssl dhparam -out /etc/letsencrypt/ssl-dhparams.pem 2048
  ln -sf "/etc/nginx/sites-available/$DOMAIN.conf" "/etc/nginx/sites-enabled/$DOMAIN.conf"
  nginx -t && systemctl reload nginx
fi
systemctl enable --now certbot.timer >/dev/null 2>&1 || true

echo "==> Проверка"
systemctl is-active --quiet nginx && echo "    nginx работает"
curl -s -o /dev/null -w "    http://$DOMAIN → %{http_code}\n" --max-time 10 "http://$DOMAIN/" || true
[ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ] && curl -s -o /dev/null -w "    https://$DOMAIN → %{http_code}\n" --max-time 10 "https://$DOMAIN/" || true

IP="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"

cat <<DONE

================================================================
Готово. Сервер принимает выгрузку сайта.

Добавьте четыре секрета в GitHub:
Settings → Secrets and variables → Actions → New repository secret

  VPS_HOST     $IP
  VPS_USER     $DEPLOY_USER
  VPS_PATH     $PUBLIC
  VPS_SSH_KEY  приватный ключ (ниже, если он создавался здесь)

После этого каждая правка сайта будет уезжать сюда сама.
Почту для заявок впишите в $PUBLIC/api/config.php — выгрузка его не трогает.
================================================================
DONE

if [ -n "$GENERATED_KEY" ]; then
  cat <<KEY

Приватный ключ для секрета VPS_SSH_KEY — скопируйте целиком,
вместе со строками BEGIN и END:

KEY
  cat "$GENERATED_KEY"
  cat <<KEY

Скопировали? Тогда уберите его с сервера, он больше не нужен:
  rm -f $GENERATED_KEY $GENERATED_KEY.pub
KEY
fi
