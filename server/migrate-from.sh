#!/usr/bin/env bash
# Переезд сайта на новый сервер: забираем со старого то, чего нет в репозитории.
#
# Запускается НА НОВОМ сервере от root, после server/bootstrap.sh и
# ДО переключения DNS:
#
#   bash <(curl -fsSL https://raw.githubusercontent.com/dkaratsapov-web/karkas_comfort/claude/karkas-comfort-redesign-0zy3xi/server/migrate-from.sh) \
#        --from СТАРЫЙ_IP
#
# Что переносится (всё остальное приедет обычной выгрузкой из репозитория):
#   api/config.php          почта, токен Telegram, доступы CRM
#   api/leads.csv           накопленные заявки
#   /etc/letsencrypt        сертификат — чтобы https работал сразу после
#                           переключения домена, без предупреждения браузера
#   ~deploy/.ssh/authorized_keys  ключ выгрузки: со старым ключом в GitHub
#                           придётся поменять только адрес сервера
#
# Пароль старого сервера спрашивается один раз: соединение держится
# открытым и переиспользуется (ControlMaster).
#
# Скрипт идемпотентный: повторный запуск ничего не ломает. Ничего на
# старом сервере он не меняет и не удаляет — только читает.
set -euo pipefail

OLD=""; DOMAIN="xn--80aa2abbmnbmggrx.xn--p1ai"; OLD_USER="root"; PORT="22"; FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --from)   OLD="$2"; shift 2 ;;
    --domain) DOMAIN="$2"; shift 2 ;;
    --user)   OLD_USER="$2"; shift 2 ;;
    --port)   PORT="$2"; shift 2 ;;
    --force)  FORCE=1; shift ;;
    *) echo "Неизвестный аргумент: $1"; exit 1 ;;
  esac
done

[ -n "$OLD" ] || { echo "Укажите адрес старого сервера: --from 1.2.3.4"; exit 1; }
[ "$(id -u)" = "0" ] || { echo "Запускать от root"; exit 1; }

PUBLIC="/var/www/$DOMAIN/public"
[ -d "$PUBLIC" ] || { echo "Нет каталога $PUBLIC — сначала выполните server/bootstrap.sh"; exit 1; }

CTL=/tmp/migrate-%r@%h
SSH=(ssh -p "$PORT" -o ControlMaster=auto -o ControlPath="$CTL" -o ControlPersist=600
     -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15)
remote() { "${SSH[@]}" "$OLD_USER@$OLD" "$@"; }

echo "==> 1/6 Связь со старым сервером $OLD"
echo "    пароль спросят один раз"
remote true || { echo "Не подключиться к $OLD_USER@$OLD:$PORT"; exit 1; }
remote "[ -d '$PUBLIC' ]" || { echo "На старом сервере нет каталога $PUBLIC — проверьте домен (--domain)"; exit 1; }
echo "    есть"

copy_file() {   # путь, владелец, права
  local path="$1" own="$2" mode="$3" name; name="$(basename "$path")"
  if ! remote "[ -f '$path' ]"; then echo "    $name: на старом сервере нет — пропускаю"; return; fi
  if [ -s "$path" ] && [ "$FORCE" = "0" ]; then
    cp -a "$path" "$path.before-migrate.$(date +%Y%m%d%H%M)"
    echo "    $name: здесь уже есть непустой файл — старую копию сохранил рядом"
  fi
  remote "cat '$path'" > "$path.migrate.tmp"
  mv "$path.migrate.tmp" "$path"
  chown "$own" "$path"; chmod "$mode" "$path"
  echo "    $name: перенесён ($(wc -c <"$path") байт)"
}

echo "==> 2/6 Почта и токены (api/config.php)"
copy_file "$PUBLIC/api/config.php" "deploy:www-data" 640

echo "==> 3/6 Накопленные заявки (api/leads.csv)"
# Заявки не перезаписываем, а сливаем: скрипт можно запустить второй раз
# через неделю после переключения домена и забрать хвост заявок, которые
# успели упасть на старый сервер, ничего не потеряв из новых.
LEADS="$PUBLIC/api/leads.csv"
if remote "[ -f '$LEADS' ]"; then
  remote "cat '$LEADS'" > "$LEADS.old.tmp"
  before=0; [ -f "$LEADS" ] && before=$(wc -l <"$LEADS")
  if [ -s "$LEADS" ]; then cp -a "$LEADS" "$LEADS.before-migrate.$(date +%Y%m%d%H%M)"; fi
  # сначала строки со старого сервера (они раньше по времени), затем здешние;
  # повторы убираем, порядок не меняем
  awk '!seen[$0]++' "$LEADS.old.tmp" "$LEADS" 2>/dev/null > "$LEADS.merged.tmp" || cp "$LEADS.old.tmp" "$LEADS.merged.tmp"
  mv "$LEADS.merged.tmp" "$LEADS"; rm -f "$LEADS.old.tmp"
  chown www-data:www-data "$LEADS"; chmod 660 "$LEADS"
  echo "    строк было $before, стало $(wc -l <"$LEADS")"
else
  echo "    leads.csv: на старом сервере нет — пропускаю"
fi

echo "==> 4/6 Сертификат Let's Encrypt"
if remote "[ -d /etc/letsencrypt/live/$DOMAIN ]"; then
  [ -d /etc/letsencrypt ] && tar czf "/root/letsencrypt-before-migrate-$(date +%Y%m%d%H%M).tgz" -C / etc/letsencrypt 2>/dev/null || true
  remote "tar czf - -C / etc/letsencrypt" | tar xzf - -C /
  echo "    перенесён, годен до: $(openssl x509 -enddate -noout -in "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" | cut -d= -f2)"
  systemctl enable --now certbot.timer >/dev/null 2>&1 || true
else
  echo "    на старом сервере сертификата нет — выпустим после переключения DNS:"
  echo "      certbot certonly --webroot -w $PUBLIC -d $DOMAIN -d www.$DOMAIN --agree-tos -m ПОЧТА -n"
fi

echo "==> 5/6 Ключ выгрузки из GitHub"
# Если на новый сервер лёг тот же открытый ключ, что был на старом, то в
# секретах GitHub достаточно поменять один VPS_HOST — ключ останется прежним.
OLDKEYS="$(remote "cat /home/deploy/.ssh/authorized_keys 2>/dev/null || true")"
if [ -n "$OLDKEYS" ] && id -u deploy >/dev/null 2>&1; then
  install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
  touch /home/deploy/.ssh/authorized_keys
  added=0
  while IFS= read -r k; do
    [ -n "$k" ] || continue
    grep -qxF "$k" /home/deploy/.ssh/authorized_keys || { echo "$k" >> /home/deploy/.ssh/authorized_keys; added=$((added+1)); }
  done <<< "$OLDKEYS"
  chown deploy:deploy /home/deploy/.ssh/authorized_keys; chmod 600 /home/deploy/.ssh/authorized_keys
  echo "    ключей со старого сервера добавлено: $added (в GitHub хватит поменять VPS_HOST)"
else
  echo "    ключей на старом сервере не нашлось — в GitHub меняем все четыре секрета"
fi

echo "==> 6/6 Проверка нового сервера в обход DNS"
nginx -t >/dev/null 2>&1 && systemctl reload nginx || echo "    !! nginx -t ругается, посмотрите: nginx -t"
bad=0
for u in / /proekty/ /obekty/ /kontakty/ /video/ /assets/css/style.css; do
  code=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 15 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN$u" || true)
  printf '    %-22s %s\n' "$u" "$code"
  [ "$code" = "200" ] || bad=1
done

ssh -O exit -o ControlPath="$CTL" "$OLD_USER@$OLD" 2>/dev/null || true

echo
if [ "$bad" = "0" ]; then
  echo "Новый сервер отдаёт сайт целиком. Можно переключать A-записи домена на этот сервер."
else
  echo "Часть адресов не отдаётся — скорее всего сайт сюда ещё не выгружали."
  echo "Запустите в GitHub: Actions → Deploy to VPS → Run workflow, затем повторите этот скрипт."
fi
echo "Старый сервер не трогали: он продолжает работать, пока домен не переключён."
