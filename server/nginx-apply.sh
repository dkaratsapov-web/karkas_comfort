#!/usr/bin/env bash
# Обновление конфигурации nginx из шаблона репозитория.
#
# Нужен тогда, когда поменялись правила отдачи сайта (редиректы, кеш,
# заголовки) — то есть файл server/nginx-site.conf.template. Сами
# страницы на сервер попадают сами, через workflow «Deploy to VPS»;
# конфиг трогает только этот скрипт, потому что для него нужен root.
#
# Запуск на сервере от root (домен — в punycode):
#   bash <(curl -fsSL https://raw.githubusercontent.com/dkaratsapov-web/karkas_comfort/claude/karkas-comfort-redesign-0zy3xi/server/nginx-apply.sh) \
#        --domain xn--80aa2abbmnbmggrx.xn--p1ai
#
# Чужие сайты на том же nginx не затрагиваются: правится только файл
# /etc/nginx/sites-available/<домен>.conf. Если новая конфигурация
# не проходит проверку, возвращается прежняя, и nginx не перезапускается.
set -euo pipefail

DOMAIN=""
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

echo "==> Проверка"
curl -s -o /dev/null -w "    http://$DOMAIN/  → %{http_code} %{redirect_url}\n" \
  --max-time 10 --max-redirs 0 --resolve "$DOMAIN:80:127.0.0.1" "http://$DOMAIN/" || true
curl -sk -o /dev/null -w "    https://$DOMAIN/ → %{http_code} %{redirect_url}\n" \
  --max-time 10 --max-redirs 0 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/" || true
echo "Готово."
