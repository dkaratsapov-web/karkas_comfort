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

# Код 000 ничего не объясняет, поэтому показываем и текст ошибки,
# и результат проверки сертификата.
ok() {
  curl -sS -o /dev/null --max-time 20 --cacert "$1" \
    -w 'код %{http_code}, проверка сертификата %{ssl_verify_result}, время %{time_total}s\n' \
    -H 'Authorization: proverka' "$API" 2>&1 | tr '\n' ' '
}
code_of() { printf '%s' "$1" | sed -n 's/.*код \([0-9]*\).*/\1/p'; }

# Уже есть и работает — ничего не делаем
if [ -f "$OUT" ]; then
  r=$(ok "$OUT"); echo "проверка имеющегося файла: $r"
  if [ "$(code_of "$r")" = "401" ]; then
    echo "сертификат для MAX уже на месте и работает"
    exit 0
  fi
fi

# Системного доверия достаточно? Тогда файл не нужен
sys=$(curl -sS -o /dev/null --max-time 20 -w 'код %{http_code}, проверка сертификата %{ssl_verify_result}' \
        -H 'Authorization: proverka' "$API" 2>&1 | tr '\n' ' ')
echo "с системным доверием: $sys"
if [ "$(code_of "$sys")" = "401" ]; then
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

# Файлы приходят в PEM или DER. Каждый пропускаем через openssl:
# так в набор попадает ровно сертификат, без лишних байт вокруг,
# на которых curl отказывался принимать файл целиком.
: > "$TMP/bundle.pem"
for f in "$TMP"/*.cer; do
  [ -s "$f" ] || continue
  openssl x509 -in "$f" -outform PEM 2>/dev/null >> "$TMP/bundle.pem" \
    || openssl x509 -inform DER -in "$f" -outform PEM 2>/dev/null >> "$TMP/bundle.pem" \
    || echo "  $(basename "$f") не разобрался как сертификат"
done

echo "что скачалось:"
for f in "$TMP"/*.cer; do
  [ -s "$f" ] || { echo "  $(basename "$f"): пусто"; continue; }
  subj=$(openssl x509 -noout -subject -in "$f" 2>/dev/null \
      || openssl x509 -inform DER -noout -subject -in "$f" 2>/dev/null \
      || echo "не сертификат, $(head -c 40 "$f" | tr -d '\0' | tr '\n' ' ')")
  echo "  $(basename "$f") ($(wc -c < "$f") байт): $subj"
done

echo "чем подписан сам MAX:"
openssl s_client -connect platform-api2.max.ru:443 -servername platform-api2.max.ru \
  -showcerts </dev/null 2>/dev/null \
  | grep -E '^ *[0-9]+ s:|^ *i:' | sed 's/^/  /' | head -8 \
  || echo "  цепочку получить не удалось"

if [ ! -s "$TMP/bundle.pem" ]; then
  echo "скачать не удалось — отправка в MAX работать не будет"
  exit 0
fi
echo "в наборе сертификатов: $(grep -c 'BEGIN CERTIFICATE' "$TMP/bundle.pem") шт., $(wc -c < "$TMP/bundle.pem") байт"
echo "первая строка набора: $(head -1 "$TMP/bundle.pem" | cat -A | head -c 60)"
echo "openssl проверяет цепочку MAX этим набором:"
openssl s_client -connect platform-api2.max.ru:443 -servername platform-api2.max.ru \
  -CAfile "$TMP/bundle.pem" </dev/null 2>/dev/null \
  | grep -E 'Verify return code|Verification' | sed 's/^/  /' | head -3 \
  || echo "  проверить не удалось"

# Главная проверка: этим сертификатом связь с MAX действительно
# устанавливается. Без токена MAX отвечает 401 — этого достаточно.
res=$(ok "$TMP/bundle.pem")
echo "  с корневым Минцифры: $res"
got=$(code_of "$res")
if [ "$got" != "401" ] && [ "$got" != "200" ]; then
  # сервер может отдавать неполную цепочку: добавляем системные
  cat /etc/ssl/certs/ca-certificates.crt >> "$TMP/bundle.pem" 2>/dev/null || true
  res=$(ok "$TMP/bundle.pem")
  echo "  вместе с системными: $res"
  got=$(code_of "$res")
fi
if [ "$got" != "401" ] && [ "$got" != "200" ]; then
  echo "сертификат скачан, но связь с MAX им не проверяется (ответ $got) — не ставлю"
  exit 0
fi

install -D -m 644 "$TMP/bundle.pem" "$OUT"
chown root:www-data "$OUT" 2>/dev/null || true
echo "сертификат установлен: $OUT"
openssl x509 -noout -subject -enddate -in "$OUT" | sed 's/^/  /'
echo "  проверка связи с MAX: $got (401 — связь есть, токен не проверялся)"
