#!/usr/bin/env bash
# Нарезка ролика для первого экрана.
#
# На вход — один мастер-файл из Higgsfield (16:9, 24 к/с, 24–32 секунды,
# без звука). На выходе — то, что умеет быстро перематываться прокруткой:
#
#   flight.mp4         широкий, прямой ход        (H.264)
#   flight.webm        он же в VP9, для запаса
#   flight-rev.mp4     широкий, задом наперёд     (для доезда вверх)
#   flight-mob.mp4     вертикальная обрезка под телефон, втрое легче
#   flight-mob-rev.mp4 вертикальная, задом наперёд
#   flight-poster.jpg  первый кадр: виден, пока ролик качается
#
# Ключевой кадр ставится каждую секунду (-g = частоте кадров): без этого
# перемотка к нужной секунде идёт рывками. Все остановки в flight.json
# поэтому ставятся на целые секунды.
#
# Запуск:
#   bash tools/flight-video.sh путь/к/мастеру.mp4 [папка-назначения]
#
# По умолчанию складывает в assets/video/flight-v1/. Для новой версии
# ролика заводите новую папку (flight-v2): у статики долгий кеш, и по
# тому же адресу браузер отдаст старый файл.
set -euo pipefail

SRC="${1:-}"
OUT="${2:-assets/video/flight-v1}"
[ -n "$SRC" ] && [ -f "$SRC" ] || { echo "Укажите мастер-файл: bash tools/flight-video.sh master.mp4"; exit 1; }
command -v ffmpeg >/dev/null || { echo "Нужен ffmpeg: apt install ffmpeg"; exit 1; }

FPS=24
mkdir -p "$OUT"

echo "==> Приведение к $FPS кадрам в секунду"
ffmpeg -y -loglevel error -i "$SRC" -an -r $FPS -vf "scale=1920:-2" -c:v libx264 -preset slow -crf 23 \
  -g $FPS -keyint_min $FPS -sc_threshold 0 -pix_fmt yuv420p -movflags +faststart "$OUT/flight.mp4"

echo "==> Обратный ход"
ffmpeg -y -loglevel error -i "$OUT/flight.mp4" -an -vf reverse -c:v libx264 -preset slow -crf 23 \
  -g $FPS -keyint_min $FPS -sc_threshold 0 -pix_fmt yuv420p -movflags +faststart "$OUT/flight-rev.mp4"

echo "==> Вертикальная обрезка для телефона (центр кадра, 9:16)"
ffmpeg -y -loglevel error -i "$OUT/flight.mp4" -an -vf "crop=ih*9/16:ih,scale=720:-2" \
  -c:v libx264 -preset slow -crf 25 -g $FPS -keyint_min $FPS -sc_threshold 0 \
  -pix_fmt yuv420p -movflags +faststart "$OUT/flight-mob.mp4"
ffmpeg -y -loglevel error -i "$OUT/flight-mob.mp4" -an -vf reverse -c:v libx264 -preset slow -crf 25 \
  -g $FPS -keyint_min $FPS -sc_threshold 0 -pix_fmt yuv420p -movflags +faststart "$OUT/flight-mob-rev.mp4"

echo "==> Запасной формат VP9"
ffmpeg -y -loglevel error -i "$OUT/flight.mp4" -an -c:v libvpx-vp9 -crf 34 -b:v 0 \
  -g $FPS -keyint_min $FPS -row-mt 1 -deadline good -cpu-used 2 "$OUT/flight.webm"

echo "==> Постер (первый кадр)"
ffmpeg -y -loglevel error -i "$OUT/flight.mp4" -frames:v 1 -q:v 4 "$OUT/flight-poster.jpg"

echo
echo "Готово. Что получилось:"
du -h "$OUT"/* | sed 's/^/  /'
echo
echo "Длительность: $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/flight.mp4") с"
echo "Дальше: заполните блок video в src/data/flight.json (src, srcMobile, poster,"
echo "duration и таблицу keys «прогресс → секунда»), затем npm run build && npm run verify."
