#!/usr/bin/env bash
# Включает https на боевом сервере и оставляет nginx работающим.
#
# Запускается выгрузкой: вызов из workflow короткий, поэтому весь вывод
# целиком виден в логе. Сам по сервере не ходит — его туда копируют.
#
#   bash https-on.sh <домен>
set -u

D=${1:?нужен домен}
CFG=/etc/nginx/sites-available/$D.conf
HTTP=$CFG.http
LINK=/etc/nginx/sites-enabled/$D.conf
LIVE=/etc/letsencrypt/live/$D/fullchain.pem

echo "служба до:    $(systemctl is-active nginx 2>/dev/null)"
echo "включено до:  $(readlink -f "$LINK" 2>/dev/null || echo 'ссылки нет')"
if [ -f "$LIVE" ]; then
  echo "сертификат:   годен до $(openssl x509 -enddate -noout -in "$LIVE" | cut -d= -f2)"
else
  echo "сертификат:   нет файла $LIVE"
fi
echo "конфигурации:"
ls -l /etc/nginx/sites-available/ | sed 's/^/  /'

if [ -f "$LIVE" ] && [ -f "$CFG" ]; then
  ln -sfn "$CFG" "$LINK"
  if nginx -t 2>/tmp/ngt; then
    echo "полная конфигурация принята"
    systemctl reload nginx 2>/dev/null || systemctl restart nginx 2>/dev/null || true
  else
    echo "nginx отверг полную конфигурацию:"
    sed 's/^/  /' /tmp/ngt
    ln -sfn "$HTTP" "$LINK"
    nginx -t >/dev/null 2>&1 && { systemctl reload nginx 2>/dev/null || systemctl restart nginx 2>/dev/null || true; }
  fi
else
  echo "включать нечего: нет сертификата либо файла $CFG"
fi

systemctl is-active --quiet nginx || systemctl start nginx 2>/dev/null || true
echo "служба после:   $(systemctl is-active nginx 2>/dev/null)"
echo "включено после: $(readlink -f "$LINK" 2>/dev/null)"

if command -v ufw >/dev/null && ufw status 2>/dev/null | head -1 | grep -q active; then
  ufw status | grep -q 443 || ufw allow 443/tcp >/dev/null 2>&1 || true
fi

ss -ltn 2>/dev/null | awk '/:80 |:443 /{printf "  слушает %s\n", $4}'
curl -s  -o /dev/null -w '  локально http  %{http_code}\n' --resolve "$D:80:127.0.0.1"  "http://$D/"  || true
curl -sk -o /dev/null -w '  локально https %{http_code}\n' --resolve "$D:443:127.0.0.1" "https://$D/" || true
tail -5 /var/log/nginx/error.log 2>/dev/null | sed 's/^/  ошибка nginx: /' || true
