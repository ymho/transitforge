#!/usr/bin/env bash
set -euo pipefail
umask 077
# Suppress startup/runtime diagnostics too, including import and browser launch errors.
# Only the runner's fixed-label report is allowed on stdout. No raw artifact is kept.
finish() {
  unset DEBUG PWDEBUG NODE_DEBUG
  # The final always() step owns ledger removal, including failed AWS cleanup.
  # The main step retains it for that step if creation has an ambiguous result.
  if [[ "${CUTOVER_MODE:-}" == cleanup && "${GITHUB_RUN_ID:-}" =~ ^[0-9]+$ && "${GITHUB_RUN_ATTEMPT:-}" =~ ^[0-9]+$ ]]; then
    rm -f -- "${RUNNER_TEMP:?}/cutover-users-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}.json"
  fi
}
trap finish EXIT
unset DEBUG PWDEBUG NODE_DEBUG
if ! node --import tsx tools/cutover-validation/run.ts 2>/dev/null; then
  echo 'cutover validation: FAIL'
  exit 1
fi
