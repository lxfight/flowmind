#!/usr/bin/env bash
set -euo pipefail

commit_range="${1:?usage: check-commit-messages.sh <git-range>}"
pattern='^(feat|fix|perf|refactor|style|docs|test|build|ci|chore|revert)(\([A-Za-z0-9._/-]+\))?(!)?: .+'
invalid=0

while IFS= read -r subject; do
  [[ -z "${subject}" || "${subject}" == Merge\ * ]] && continue
  if [[ ! "${subject}" =~ ${pattern} ]]; then
    echo "Invalid Conventional Commit subject: ${subject}" >&2
    invalid=1
  fi
done < <(git log --format=%s "${commit_range}")

exit "${invalid}"
