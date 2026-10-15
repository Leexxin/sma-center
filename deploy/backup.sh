#!/bin/sh
set -eu
cd /opt/sma-center
umask 077
mkdir -p /root/sma-center-backups
container=$(docker compose ps -q sma-center)
test -n "$container"
data_path=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' "$container")
test -d "$data_path"
backup_file="/root/sma-center-backups/sma-center-$(date +%Y%m%d-%H%M%S).tar.gz"
trap 'docker compose start sma-center' EXIT
docker compose stop sma-center
tar -czf "$backup_file" -C "$data_path" .
chmod 600 "$backup_file"
echo "Backup: $backup_file"
