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

echo "==> 1/8 Пакеты"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nginx php-fpm certbot python3-certbot-nginx ufw fail2ban \
                       unattended-upgrades rsync curl ca-certificates >/dev/null

PHP_SOCK="$(ls /run/php/php*-fpm.sock 2>/dev/null | head -1 || true)"
[ -n "$PHP_SOCK" ] || { echo "PHP-FPM не поднялся — проверьте: systemctl status php*-fpm"; exit 1; }
echo "    PHP-FPM: $PHP_SOCK"

echo "==> 2/8 Пользователь $DEPLOY_USER"
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

echo "==> 3/8 Каталоги сайта"
install -d -o "$DEPLOY_USER" -g www-data -m 2755 "$ROOT" "$PUBLIC" "$PUBLIC/api"
# Заглушка, чтобы сайт отвечал ещё до первой выгрузки
[ -f "$PUBLIC/index.html" ] || printf '<!doctype html><meta charset="utf-8"><title>Каркас Комфорт</title><p>Сервер готов, ждём выгрузку сайта.</p>\n' > "$PUBLIC/index.html"
chown -R "$DEPLOY_USER:www-data" "$PUBLIC"

echo "==> 4/8 Приём заявок"
# config.php хранит почту и токены: создаётся один раз и выгрузкой не перезаписывается
if [ ! -f "$PUBLIC/api/config.php" ]; then
  curl -fsSL "$REPO_RAW/server/api/config.php" -o "$PUBLIC/api/config.php" || true
fi
if [ -f "$PUBLIC/api/config.php" ]; then
  chown "$DEPLOY_USER:www-data" "$PUBLIC/api/config.php"; chmod 640 "$PUBLIC/api/config.php"
fi
touch "$PUBLIC/api/leads.csv"
chown www-data:www-data "$PUBLIC/api/leads.csv"; chmod 660 "$PUBLIC/api/leads.csv"

echo "==> 5/8 Конфигурация nginx"
curl -fsSL "$REPO_RAW/server/nginx-site.conf.template" -o /tmp/site.conf.template
sed -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__PHP_SOCK__|$PHP_SOCK|g" /tmp/site.conf.template > "/etc/nginx/sites-available/$DOMAIN.conf"
ln -sf "/etc/nginx/sites-available/$DOMAIN.conf" "/etc/nginx/sites-enabled/$DOMAIN.conf"
rm -f /etc/nginx/sites-enabled/default
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

echo "==> 6/8 Брандмауэр и автообновления"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null
systemctl enable --now fail2ban >/dev/null 2>&1 || true
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true

echo "==> 7/8 Сертификат Let's Encrypt"
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

echo "==> 8/8 Проверка"
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
