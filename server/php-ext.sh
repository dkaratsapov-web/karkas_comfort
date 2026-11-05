#!/usr/bin/env bash
# Доставляет расширения php, без которых сайт не работает.
#
# Админка, бот и приём заявок режут русский текст по символам
# (mb_substr): без mbstring страница падает с 500 и ничего не пишет
# в журналы nginx. curl нужен для отправки заявок в Telegram, MAX
# и CRM. На свежей Ubuntu эти пакеты не ставятся вместе с php-fpm.
set -u

need="mbstring curl"
ver=$(php -r 'echo PHP_MAJOR_VERSION . "." . PHP_MINOR_VERSION;' 2>/dev/null)
[ -n "$ver" ] || ver=$(ls -d /etc/php/*/fpm 2>/dev/null | head -1 | awk -F/ '{print $4}')
[ -n "$ver" ] || { echo "php не найден"; exit 0; }
echo "php $ver"

missing=""
for ext in $need; do
  if php -m 2>/dev/null | grep -qix "$ext"; then
    echo "  $ext: есть"
  else
    echo "  $ext: НЕТ"
    missing="$missing php$ver-$ext"
  fi
done

[ -n "$missing" ] || { echo "все нужные расширения на месте"; exit 0; }

echo "ставлю:$missing"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null 2>&1
# shellcheck disable=SC2086
if apt-get install -y -qq $missing >/dev/null 2>&1; then
  systemctl reload "php$ver-fpm" 2>/dev/null || systemctl restart "php$ver-fpm" 2>/dev/null || true
  echo "готово, php-fpm перечитан"
else
  echo "установить не удалось — проверьте доступ к репозиториям пакетов"
  exit 0
fi

for ext in $need; do
  php -m 2>/dev/null | grep -qix "$ext" && echo "  $ext: теперь есть" || echo "  $ext: всё ещё нет"
done
