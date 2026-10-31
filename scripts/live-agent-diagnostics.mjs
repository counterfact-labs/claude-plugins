// Public reason contracts from counterfact-local contract/cli-refusals.ts,
// CLI 0.2.9 and origin/main. Syntax alone is unsafe: a token can be an identifier.
// Unknown future codes stay unavailable until reviewed; never fall back to text.
const reasons = new Set([
  'folder_too_large', 'low_balance', 'local_checks_paused', 'cli_update_required',
  'release_unavailable', 'plan_over_limit', 'invalid_plan', 'invalid_body',
  'body_too_large', 'free_cap_reached', 'org_spend_limit', 'not_reserved',
  'reservation_expired', 'stale_quote', 'max_dollars_exceeded', 'outside_project',
  'launch_folder_unavailable', 'folder_unavailable', 'local_read_failed',
  'local_git_failed', 'repeat_too_soon', 'console_unavailable', 'unavailable',
  'invalid_configuration', 'invalid_request', 'unauthorized', 'not_allowed',
  'not_found', 'rate_limited', 'reservation_closed', 'reservation_closing',
  'delivery_incomplete', 'check_conflict', 'invalid_email', 'wrong_code', 'expired',
  'too_many_attempts', 'email_unavailable', 'request_failed', 'invalid_response',
  'browser_sign_in_pending', 'cancelled', 'console_unreachable',
  'invalid_console_url', 'relay_unreachable', 'results_not_saved',
  'results_saved_report_failed', 'results_pending', 'results_discarded',
  'folder_busy', 'completion_settings_mismatch',
]);
const reasonCode = value => reasons.has(value) ? value : 'not_reported';

export function mcpFailureMessage(structured) {
  const exitCode = Number.isSafeInteger(structured?.exitCode) ? structured.exitCode : 'not_reported';
  return `MCP analysis did not complete successfully (reason: ${reasonCode(structured?.reason)}; exitCode: ${exitCode})`;
}

const stages = new Map([
  ['/api/cli/checks', 'checks'], ['/api/cli/checks/mode', 'checks/mode'],
  ['/api/cli/checks/local', 'checks/local'], ['/api/cli/relay-reservations', 'relay-reservations'],
  ['/api/cli/balance', 'balance'], ['/api/cli/fix-requests', 'fix-requests'],
]);
const actions = new Set(['create', 'reserve', 'status', 'heartbeat', 'fail', 'complete']);
export function consoleRefusal(path, action, { status, value }) {
  if (status < 300) return undefined;
  // Stage labels are constants; arbitrary paths, query strings and IDs stay private.
  const stage = stages.get(path) ?? 'console';
  const operation = path === '/api/cli/relay-reservations' && actions.has(action) ? '/' + action : '';
  return `console refusal: ${reasonCode(value?.code)} (HTTP ${status}; ${stage}${operation})`;
}
