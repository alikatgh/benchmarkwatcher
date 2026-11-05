"""Safe optional Meta boundary; importing this module never loads a provider."""

import re


MODEL = 'muse-spark-1.3'
EXPIRY = '2026-11-05T02:00:00Z'
RESERVATION_USD = '0.050000000'
ERROR_CODES = frozenset({
    'not_activated', 'activation_invalid', 'grant_expired',
    'credential_missing_or_invalid', 'ledger_unavailable', 'grant_stopped',
    'grant_busy', 'budget_exhausted', 'duplicate_request', 'idempotency_conflict',
    'invalid_request_id', 'input_rejected', 'unsupported_question', 'plan_mismatch',
    'request_deadline_exceeded', 'request_failed', 'provider_http_401',
    'provider_http_403', 'provider_http_402', 'provider_http_429',
    'provider_http_rejected', 'response_json_invalid', 'response_type_rejected',
    'response_too_large', 'response_length_invalid', 'transport_failed',
    'worker_launch_failed', 'worker_io_failed', 'worker_output_invalid',
    'worker_exited', 'worker_failed', 'local_execution_failed',
    'response_rejected', 'response_envelope_invalid', 'response_incomplete',
    'response_failed', 'response_output_invalid', 'response_output_item_invalid',
    'response_reasoning_invalid', 'response_message_count_invalid',
    'response_refused', 'response_content_invalid', 'response_plan_text_invalid',
    'response_plan_json_invalid', 'response_selection_invalid',
    'usage_exceeds_reservation', 'source_unavailable',
})
MONEY = re.compile(r'(?:0|[1-9][0-9]{0,2})\.[0-9]{9}\Z')


class MetaError(Exception):
    """Fixed public errors, independent of provider exception text."""

    def __init__(self, code, *, provider_requests=0):
        self.code = code if isinstance(code, str) and code in ERROR_CODES else 'request_failed'
        self.provider_requests = 1 if provider_requests == 1 else 0
        super().__init__(self.code)

    @property
    def status(self):
        if self.code in {'duplicate_request', 'idempotency_conflict', 'grant_busy'}:
            return 409
        if self.code == 'budget_exhausted':
            return 429
        if self.code in {'invalid_request_id', 'input_rejected'}:
            return 400
        if self.code in {'unsupported_question', 'plan_mismatch'}:
            return 422
        if self.code == 'request_deadline_exceeded':
            return 504
        if self.code in {'not_activated', 'activation_invalid', 'grant_expired',
                         'credential_missing_or_invalid', 'ledger_unavailable',
                         'grant_stopped', 'source_unavailable'}:
            return 503
        return 502

    @property
    def message(self):
        messages = {
            'not_activated': 'Meta mode has not been activated by the local operator.',
            'budget_exhausted': 'The shared Meta allowance is exhausted.',
            'grant_busy': 'Another Meta question is running. Wait for it to finish.',
            'duplicate_request': 'This request ID was already reserved and will not be sent again.',
            'idempotency_conflict': 'This request ID was already used for a different question or scope.',
            'source_unavailable': 'The retained filing proof could not be verified. No Meta request was sent.',
            'input_rejected': 'The bounded Meta request could not be prepared. No Meta request was sent.',
            'request_deadline_exceeded': 'Meta reached its deadline. The reservation remains consumed; no retry was made.',
        }
        return messages.get(self.code, 'Meta research is unavailable. No answer was substituted or retried.')


def off_status(code='not_activated'):
    return {'enabled': False, 'available': False, 'code': code,
            'model': MODEL, 'budget_limit_usd': None, 'reserved_usd': '0.000000000',
            'remaining_usd': '0.000000000', 'per_request_reservation_usd': RESERVATION_USD,
            'expires_at': None, 'provider_invoice_cap_verified': False,
            'retries': 0, 'concurrency': 1}


def safe_status(adapter):
    """Only known status fields and bounded values can reach the browser."""
    if adapter is None:
        return off_status()
    try:
        raw = adapter.status()
        if not isinstance(raw, dict):
            return off_status('ledger_unavailable')
        code = raw.get('code')
        if not isinstance(code, str) or code not in ERROR_CODES | {'ready'}:
            return off_status('ledger_unavailable')
        state = off_status(code)
        state['enabled'] = raw.get('enabled') is True
        state['available'] = state['enabled'] and raw.get('available') is True and code == 'ready'
        state['expires_at'] = EXPIRY if raw.get('expires_at') == EXPIRY else None
        for field in ('budget_limit_usd', 'reserved_usd', 'remaining_usd'):
            value = raw.get(field)
            if isinstance(value, str) and MONEY.fullmatch(value):
                state[field] = value
        return state
    except Exception:
        return off_status('ledger_unavailable')
