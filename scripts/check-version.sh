#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
version="$(tr -d '[:space:]' < "${project_dir}/VERSION")"
frontend_version="$(node -p "require('${project_dir}/frontend/package.json').version")"
backend_version="$(sed -n 's/^version = "\([^"]*\)"/\1/p' "${project_dir}/backend/pyproject.toml" | head -n1)"

if [[ ! "${version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+([+-][0-9A-Za-z.-]+)?$ ]]; then
  echo "VERSION is not a valid semantic version: ${version}" >&2
  exit 1
fi

if [[ "${version}" != "${frontend_version}" || "${version}" != "${backend_version}" ]]; then
  echo "Version mismatch: VERSION=${version}, frontend=${frontend_version}, backend=${backend_version}" >&2
  exit 1
fi

if [[ -n "${1:-}" && "v${version}" != "${1}" ]]; then
  echo "Tag ${1} does not match VERSION v${version}" >&2
  exit 1
fi

printf '%s\n' "${version}"
