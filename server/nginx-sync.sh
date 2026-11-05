#!/usr/bin/env bash
# Приводит конфигурацию nginx на сервере к шаблону из репозитория.
#
# Шаблон меняется вместе с сайтом (новые адреса, правила отдачи),
# а конфигурация на сервере живёт отдельно и сама не обновляется.
# Так, например, адрес событий бота MAX был бы закрыт общим запретом
# php, и MAX не смог бы доставить ни одного события.
#
# Безопасность: прежняя конфигурация сохраняется, новая проверяется
# nginx -t, и при ошибке возвращается прежняя. Сайт важнее новизны.
#
#   bash nginx-sync.sh <шаблон> <домен> [корень сайта]
set -u

TPL=${1:?нужен файл шаблона}
D=${2:?нужен домен}
ROOT=${3:-/var/www/$D/public}
CONF=/etc/nginx/sites-available/$D.conf
LINK=/etc/nginx/sites-enabled/$D.conf

[ "$(id -u)" = 0 ] || { echo "нет прав root — пропускаю"; exit 0; }
[ -f "$TPL" ] || { echo "шаблон не найден"; exit 0; }

SOCK=$(ls /run/php/php*-fpm.sock 2>/dev/null | head -1)
[ -n "$SOCK" ] || { echo "php-fpm не найден — конфигурацию не трогаю"; exit 0; }

# http2 задаётся по-разному: отдельной директивой на nginx 1.25.1+
# и суффиксом в listen на старых.
VER=$(nginx -v 2>&1 | sed -n 's|.*/\([0-9.]*\).*|\1|p')
if [ "$(printf '%s\n1.25.1\n' "$VER" | sort -V | head -1)" = "1.25.1" ]; then
  H2_LISTEN=""; H2_DIRECTIVE="    http2 on;\n"
else
  H2_LISTEN=" http2"; H2_DIRECTIVE=""
fi

NEW=$(mktemp)
sed -e "s|__DOMAIN__|$D|g" -e "s|__PHP_SOCK__|$SOCK|g" \
    -e "s|__HTTP2_LISTEN__|$H2_LISTEN|g" -e "s|__HTTP2_DIRECTIVE__|$H2_DIRECTIVE|g" \
    "$TPL" > "$NEW"

# без сертификата оставляем как есть: иначе nginx не примет ssl_certificate
if [ ! -f "/etc/letsencrypt/live/$D/fullchain.pem" ]; then
  echo "сертификата нет — конфигурацию не меняю"
  rm -f "$NEW"; exit 0
fi

if [ -f "$CONF" ] && cmp -s "$NEW" "$CONF"; then
  echo "конфигурация уже совпадает с шаблоном"
  rm -f "$NEW"; exit 0
fi

BAK=$CONF.bak-$(date +%Y%m%d-%H%M%S)
[ -f "$CONF" ] && cp -a "$CONF" "$BAK" && echo "прежняя сохранена: $BAK"
install -m 644 "$NEW" "$CONF"
rm -f "$NEW"
ln -sfn "$CONF" "$LINK"

if nginx -t >/tmp/ngsync 2>&1; then
  systemctl reload nginx 2>/dev/null || systemctl restart nginx 2>/dev/null || true
  echo "конфигурация обновлена из шаблона"
else
  echo "новая конфигурация не прошла проверку:"
  sed 's/^/  /' /tmp/ngsync
  if [ -f "$BAK" ]; then
    cp -a "$BAK" "$CONF"
    nginx -t >/dev/null 2>&1 && { systemctl reload nginx 2>/dev/null || true; }
    echo "вернул прежнюю"
  fi
fi

systemctl is-active --quiet nginx || systemctl start nginx 2>/dev/null || true
echo "nginx: $(systemctl is-active nginx)"
curl -sk -o /dev/null -w '  локально https: %{http_code}\n' --resolve "$D:443:127.0.0.1" "https://$D/" || true
code=$(curl -sk -o /dev/null -w '%{http_code}' -X POST --resolve "$D:443:127.0.0.1" "https://$D/api/max-bot.php" -d '{}' || true)
echo "  адрес событий бота отвечает: $code (403 — закрыт, 200 — принимает)"
