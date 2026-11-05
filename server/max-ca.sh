#!/usr/bin/env bash
# Корневой сертификат для обращений к MAX.
#
# Серверы MAX отдают сертификат, выпущенный Минцифры. На Ubuntu такого
# корневого сертификата нет, и запрос к MAX падает с ошибкой проверки
# ещё до того, как дело дойдёт до токена.
#
# Сертификат кладётся отдельным файлом и используется ТОЛЬКО для
# запросов к max.ru. В системное доверие он не добавляется намеренно:
# тогда любой выпущенный этим центром сертификат считался бы
# действительным для всех сайтов, включая банки и почту.
#
#   bash max-ca.sh /путь/к/сайту/public
set -u

ROOT=${1:?нужен каталог сайта}
OUT=$ROOT/api/max-ca.pem
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
API=https://platform-api2.max.ru/updates?limit=1

ok() { curl -sS -o /dev/null -w '%{http_code}' --max-time 20 --cacert "$1" \
         -H 'Authorization: proverka' "$API" 2>/dev/null; }

# Уже есть и работает — ничего не делаем
if [ -f "$OUT" ] && [ "$(ok "$OUT")" = "401" ]; then
  echo "сертификат для MAX уже на месте и работает"
  exit 0
fi

# Системного доверия достаточно? Тогда файл не нужен
if [ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 -H 'Authorization: proverka' "$API" 2>/dev/null)" = "401" ]; then
  echo "системного доверия хватает, отдельный сертификат не нужен"
  rm -f "$OUT"
  exit 0
fi

echo "беру корневой сертификат Минцифры"
for u in https://gu-st.ru/content/Other/doc/russian_trusted_root_ca.cer \
         https://gu-st.ru/content/Other/doc/russian_trusted_sub_ca.cer; do
  f=$TMP/$(basename "$u")
  code=$(curl -sS -o "$f" -w '%{http_code}' --max-time 30 "$u" 2>/dev/null || true)
  echo "  $(basename "$u"): $code"
done

# Файлы приходят в PEM или DER — приводим к PEM и складываем в один
: > "$TMP/bundle.pem"
for f in "$TMP"/*.cer; do
  [ -s "$f" ] || continue
  if grep -q 'BEGIN CERTIFICATE' "$f"; then
    cat "$f" >> "$TMP/bundle.pem"
  else
    openssl x509 -inform DER -in "$f" >> "$TMP/bundle.pem" 2>/dev/null || true
  fi
done

if [ ! -s "$TMP/bundle.pem" ]; then
  echo "скачать не удалось — отправка в MAX работать не будет"
  exit 0
fi

# Главная проверка: этим сертификатом связь с MAX действительно
# устанавливается. Без токена MAX отвечает 401 — этого достаточно.
got=$(ok "$TMP/bundle.pem")
if [ "$got" != "401" ] && [ "$got" != "200" ]; then
  echo "сертификат скачан, но связь с MAX им не проверяется (ответ $got) — не ставлю"
  exit 0
fi

install -D -m 644 "$TMP/bundle.pem" "$OUT"
chown root:www-data "$OUT" 2>/dev/null || true
echo "сертификат установлен: $OUT"
openssl x509 -noout -subject -enddate -in "$OUT" | sed 's/^/  /'
echo "  проверка связи с MAX: $got (401 — связь есть, токен не проверялся)"
