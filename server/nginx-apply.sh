#!/usr/bin/env bash
# Обновление конфигурации nginx из шаблона репозитория.
#
# Нужен тогда, когда поменялись правила отдачи сайта (редиректы, кеш,
# заголовки) — то есть файл server/nginx-site.conf.template. Сами
# страницы на сервер попадают сами, через workflow «Deploy to VPS»;
# конфиг трогает только этот скрипт, потому что для него нужен root.
#
# Запуск на сервере от root, одной строкой:
#   bash <(curl -fsSL https://raw.githubusercontent.com/dkaratsapov-web/karkas_comfort/claude/karkas-comfort-redesign-0zy3xi/server/nginx-apply.sh)
#
# Домен по умолчанию — каркаскомфорт.рф; другой задаётся --domain
# (в punycode). Заодно скрипт поправит права на api/ и проверит,
# отвечает ли админка.
#
# Чужие сайты на том же nginx не затрагиваются: правится только файл
# /etc/nginx/sites-available/<домен>.conf. Если новая конфигурация
# не проходит проверку, возвращается прежняя, и nginx не перезапускается.
set -euo pipefail

DOMAIN="xn--80aa2abbmnbmggrx.xn--p1ai"
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    *) echo "Неизвестный аргумент: $1"; exit 1 ;;
  esac
done
[ -n "$DOMAIN" ] || { echo "Укажите --domain (в punycode, например xn--80aa2abbmnbmggrx.xn--p1ai)"; exit 1; }
[ "$(id -u)" = "0" ] || { echo "Запускать от root"; exit 1; }

REPO_RAW="https://raw.githubusercontent.com/dkaratsapov-web/karkas_comfort/claude/karkas-comfort-redesign-0zy3xi"
CONF="/etc/nginx/sites-available/$DOMAIN.conf"

echo "==> Шаблон из репозитория"
curl -fsSL "$REPO_RAW/server/nginx-site.conf.template" -o /tmp/site.conf.template

PHP_SOCK="$(ls /run/php/php*-fpm.sock 2>/dev/null | head -1 || true)"
[ -n "$PHP_SOCK" ] || PHP_SOCK="/run/php/php-fpm.sock"
NGINX_VER="$(nginx -v 2>&1 | sed -n 's|.*/\([0-9.]*\).*|\1|p')"
if [ "$(printf '%s\n1.25.1\n' "$NGINX_VER" | sort -V | head -1)" = "1.25.1" ]; then
  HTTP2_LISTEN=""; HTTP2_DIRECTIVE="    http2 on;\n"
else
  HTTP2_LISTEN=" http2"; HTTP2_DIRECTIVE=""
fi
echo "    nginx $NGINX_VER, PHP-FPM $PHP_SOCK"

echo "==> Новая конфигурация"
[ -f "$CONF" ] && cp -a "$CONF" "$CONF.bak"
sed -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__PHP_SOCK__|$PHP_SOCK|g" \
    -e "s|__HTTP2_LISTEN__|$HTTP2_LISTEN|g" -e "s|__HTTP2_DIRECTIVE__|$HTTP2_DIRECTIVE|g" \
    /tmp/site.conf.template > "$CONF"
ln -sf "$CONF" "/etc/nginx/sites-enabled/$DOMAIN.conf"

if nginx -t; then
  systemctl reload nginx
  echo "    nginx перезапущен"
else
  echo "!! проверка не прошла — возвращаю прежнюю конфигурацию"
  [ -f "$CONF.bak" ] && cp -a "$CONF.bak" "$CONF"
  nginx -t >/dev/null 2>&1 || true
  exit 1
fi

echo "==> Права на состояние админки"
# Админка и приём заявок работают от php (www-data) и пишут в api/:
# пользователи, настройки, заявки. Папка должна быть доступна группе.
PUBLIC="/var/www/$DOMAIN/public"
if [ -d "$PUBLIC/api" ]; then
  DEPLOY_USER="$(stat -c %U "$PUBLIC" 2>/dev/null || echo deploy)"
  chown -R "$DEPLOY_USER:www-data" "$PUBLIC/api"
  chmod 2775 "$PUBLIC/api"
  for f in settings.json leads.jsonl leads-state.json admin-users.json admin-throttle.json leads.csv; do
    [ -f "$PUBLIC/api/$f" ] && chmod 660 "$PUBLIC/api/$f"
  done
  echo "    $(stat -c '%A %U:%G' "$PUBLIC/api") $PUBLIC/api"
else
  echo "    каталог $PUBLIC/api не найден — пропускаю"
fi

echo "==> Проверка"
curl -s -o /dev/null -w "    http://$DOMAIN/       → %{http_code} %{redirect_url}\n" \
  --max-time 10 --max-redirs 0 --resolve "$DOMAIN:80:127.0.0.1" "http://$DOMAIN/" || true
curl -sk -o /dev/null -w "    https://$DOMAIN/      → %{http_code} %{redirect_url}\n" \
  --max-time 10 --max-redirs 0 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/" || true
ADMIN=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 10 --max-redirs 0 \
  --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/admin/" || true)
echo "    https://$DOMAIN/admin/ → $ADMIN"
case "$ADMIN" in
  200|302) echo "    админка отвечает" ;;
  403)     echo "    !! 403: php в /admin/ по-прежнему закрыт — проверьте, что шаблон накатился" ;;
  404)     echo "    !! 404: файлов админки нет на сервере — запустите выгрузку (Actions → Deploy to VPS)" ;;
  502|504) echo "    !! $ADMIN: не отвечает PHP-FPM — systemctl status php*-fpm" ;;
  *)       echo "    !! неожиданный ответ $ADMIN" ;;
esac
echo "Готово."
