#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <version>" >&2
  exit 2
fi

case "$1" in
  v*) version=${1#v} ;;
  *) version=$1 ;;
esac

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

if ! docker compose ps --status running updater | grep -q flowmind-updater; then
  echo "FlowMind updater is not running; start it with: docker compose up -d updater" >&2
  exit 1
fi

request_id="cli-$(date +%s)-$$"
docker compose exec -T updater \
  python3 /app/cli.py "$version" --request-id "$request_id"

docker compose exec -T updater python3 -c \
  'import json; print(json.dumps(json.load(open("/state/update.json")), ensure_ascii=False, indent=2))'
