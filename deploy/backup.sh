#!/bin/sh
set -eu
cd /opt/atlas-personal-hub
umask 077
mkdir -p /root/atlas-backups
container=$(docker compose ps -q atlas)
test -n "$container"
data_path=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' "$container")
test -d "$data_path"
backup_file="/root/atlas-backups/atlas-$(date +%Y%m%d-%H%M%S).tar.gz"
trap 'docker compose start atlas' EXIT
docker compose stop atlas
tar -czf "$backup_file" -C "$data_path" .
chmod 600 "$backup_file"
echo "Backup: $backup_file"
