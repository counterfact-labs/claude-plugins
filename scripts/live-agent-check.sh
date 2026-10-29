#!/usr/bin/env bash
set -euo pipefail
# Do not inherit shell tracing into a run that handles an account key.
set +x
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec node "$script_dir/live-agent-check.mjs" "$@"
