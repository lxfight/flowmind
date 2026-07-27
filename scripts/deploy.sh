#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

MIRROR_MODE="${FLOWMIND_MIRROR_MODE:-auto}"
case "$MIRROR_MODE" in
  auto|official|china) ;;
  *)
    echo "[deploy] FLOWMIND_MIRROR_MODE 仅支持 auto、official 或 china" >&2
    exit 2
    ;;
esac

DETECT_ONLY=false
REFRESH_MIRRORS=false
SERVICES=()
for argument in "$@"; do
  case "$argument" in
    --detect-only) DETECT_ONLY=true ;;
    --refresh-mirrors) REFRESH_MIRRORS=true ;;
    --*)
      echo "[deploy] 未知参数: $argument" >&2
      exit 2
      ;;
    *) SERVICES+=("$argument") ;;
  esac
done

MIRROR_CACHE_FILE="${FLOWMIND_MIRROR_CACHE_FILE:-$PROJECT_DIR/.flowmind-build-sources.env}"
CACHED_VARIABLES=" "
if [[ "$MIRROR_MODE" == "auto" && "$REFRESH_MIRRORS" == "false" && -f "$MIRROR_CACHE_FILE" ]]; then
  while IFS='=' read -r key value; do
    case "$key" in
      PYPI_INDEX_URL|NPM_REGISTRY|DEBIAN_MIRROR|DEBIAN_SECURITY_MIRROR|ALPINE_MIRROR)
        if [[ -z "${!key:-}" && -n "$value" ]]; then
          printf -v "$key" '%s' "$value"
          export "$key"
          CACHED_VARIABLES+="$key "
        fi
        ;;
    esac
  done < "$MIRROR_CACHE_FILE"
fi

measure_ms() {
  local url="$1"
  local timing
  if ! timing="$(curl -L --connect-timeout 2 --max-time 5 -o /dev/null -sS -w '%{http_code} %{time_total}' "$url" 2>/dev/null)"; then
    return 1
  fi
  local status="${timing%% *}"
  local seconds="${timing#* }"
  if [[ ! "$status" =~ ^[23] ]]; then
    return 1
  fi
  awk -v seconds="$seconds" 'BEGIN { printf "%.0f", seconds * 1000 }'
}

select_source() {
  local variable="$1"
  local label="$2"
  local official_source="$3"
  local china_source="$4"
  local official_probe="$5"
  local china_probe="$6"

  if [[ -n "${!variable:-}" ]]; then
    if [[ "$CACHED_VARIABLES" == *" $variable "* ]]; then
      echo "[deploy] $label: 复用上次选择 ${!variable}"
    else
      echo "[deploy] $label: 使用环境变量指定的源 ${!variable}"
    fi
    export "$variable"
    return
  fi

  local selected="$official_source"
  local reason="官方源"
  if [[ "$MIRROR_MODE" == "china" ]]; then
    selected="$china_source"
    reason="强制国内源"
  elif [[ "$MIRROR_MODE" == "auto" ]] && command -v curl >/dev/null 2>&1; then
    local official_ms=""
    local china_ms=""
    official_ms="$(measure_ms "$official_probe" || true)"
    china_ms="$(measure_ms "$china_probe" || true)"
    if [[ -n "$china_ms" ]] && { [[ -z "$official_ms" ]] || (( china_ms * 100 < official_ms * 80 )); }; then
      selected="$china_source"
      reason="国内源更快 (${china_ms}ms${official_ms:+ / 官方 ${official_ms}ms})"
    elif [[ -n "$official_ms" ]]; then
      reason="官方源更合适 (${official_ms}ms${china_ms:+ / 国内 ${china_ms}ms})"
    elif [[ -n "$china_ms" ]]; then
      selected="$china_source"
      reason="官方源不可用 / 国内 ${china_ms}ms"
    else
      reason="测速均失败，回退官方源"
    fi
  elif [[ "$MIRROR_MODE" == "auto" ]]; then
    reason="未找到 curl，回退官方源"
  fi

  printf -v "$variable" '%s' "$selected"
  export "$variable"
  echo "[deploy] $label: $reason"
}

select_source \
  PYPI_INDEX_URL PyPI \
  https://pypi.org/simple \
  https://pypi.tuna.tsinghua.edu.cn/simple \
  https://pypi.org/simple/uv/ \
  https://pypi.tuna.tsinghua.edu.cn/simple/uv/
select_source \
  NPM_REGISTRY npm \
  https://registry.npmjs.org \
  https://registry.npmmirror.com \
  https://registry.npmjs.org/react \
  https://registry.npmmirror.com/react
select_source \
  DEBIAN_MIRROR Debian \
  http://deb.debian.org/debian \
  https://mirrors.tuna.tsinghua.edu.cn/debian \
  https://deb.debian.org/debian/README \
  https://mirrors.tuna.tsinghua.edu.cn/debian/README
select_source \
  ALPINE_MIRROR Alpine \
  https://dl-cdn.alpinelinux.org/alpine \
  https://mirrors.aliyun.com/alpine \
  https://dl-cdn.alpinelinux.org/alpine/latest-stable/main/aarch64/APKINDEX.tar.gz \
  https://mirrors.aliyun.com/alpine/latest-stable/main/aarch64/APKINDEX.tar.gz

if [[ "$DEBIAN_MIRROR" == *"tuna.tsinghua.edu.cn"* ]]; then
  DEBIAN_SECURITY_MIRROR="${DEBIAN_SECURITY_MIRROR:-https://mirrors.tuna.tsinghua.edu.cn/debian-security}"
else
  DEBIAN_SECURITY_MIRROR="${DEBIAN_SECURITY_MIRROR:-http://deb.debian.org/debian-security}"
fi
export DEBIAN_SECURITY_MIRROR

if [[ "$MIRROR_MODE" == "auto" ]]; then
  cache_tmp="${MIRROR_CACHE_FILE}.tmp.$$"
  umask 077
  printf '%s\n' \
    "PYPI_INDEX_URL=$PYPI_INDEX_URL" \
    "NPM_REGISTRY=$NPM_REGISTRY" \
    "DEBIAN_MIRROR=$DEBIAN_MIRROR" \
    "DEBIAN_SECURITY_MIRROR=$DEBIAN_SECURITY_MIRROR" \
    "ALPINE_MIRROR=$ALPINE_MIRROR" > "$cache_tmp"
  mv "$cache_tmp" "$MIRROR_CACHE_FILE"
fi

if [[ "$DETECT_ONLY" == "true" ]]; then
  echo "[deploy] 镜像源探测完成，未执行构建"
  exit 0
fi

export DOCKER_BUILDKIT=1
export COMPOSE_BAKE=true
docker compose config --quiet

if ((${#SERVICES[@]} > 0)); then
  echo "[deploy] 使用 BuildKit 依赖缓存构建服务: ${SERVICES[*]}"
  docker compose build "${SERVICES[@]}"
  docker compose up -d --no-build --wait --wait-timeout 180 "${SERVICES[@]}"
else
  echo "[deploy] 使用 BuildKit 依赖缓存构建全部服务"
  docker compose build
  docker compose up -d --no-build --wait --wait-timeout 180
fi
