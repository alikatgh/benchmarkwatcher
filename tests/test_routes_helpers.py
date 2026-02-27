from app.routes import (
    build_commodities_response,
    is_valid_internal_key,
    parse_bool_flag,
    validate_range,
    validate_since,
    validate_view,
)


def test_validate_range_sanitizes_invalid_values():
    assert validate_range('1M') == '1M'
    assert validate_range('bad') == 'ALL'


def test_validate_view_sanitizes_invalid_values():
    assert validate_view('grid') == 'grid'
    assert validate_view('compact') == 'compact'
    assert validate_view('table') is None


def test_parse_bool_flag_permissive_true_values():
    for value in ['1', 'true', 'TRUE', 'yes', 'on', ' On ']:
        assert parse_bool_flag(value) is True

    for value in ['0', 'false', 'no', 'off', '', 'random']:
        assert parse_bool_flag(value) is False

    assert parse_bool_flag(None, default=True) is True


def test_validate_since_iso_date_only():
    assert validate_since('2026-02-28') == '2026-02-28'
    assert validate_since('2026/02/28') is None
    assert validate_since('') is None


def test_is_valid_internal_key_requires_both_and_match():
    assert is_valid_internal_key('abc', 'abc') is True
    assert is_valid_internal_key('', 'abc') is False
    assert is_valid_internal_key('abc', '') is False
    assert is_valid_internal_key('abc', 'def') is False


def test_build_commodities_response_public_shape():
    payload = build_commodities_response(
        commodities=[{'id': 'gold'}],
        date_range='ALL',
        category='precious',
        since=None,
        include_history=False,
    )

    assert payload['data'][0]['id'] == 'gold'
    assert payload['meta']['count'] == 1
    assert payload['meta']['range'] == 'ALL'
    assert payload['meta']['category'] == 'precious'
    assert payload['meta']['since'] is None
    assert payload['meta']['partial'] is False
    assert payload['meta']['include_history'] is False


def test_build_commodities_response_internal_shape():
    payload = build_commodities_response(
        commodities=[],
        date_range='1M',
        category=None,
    )

    assert payload['meta'] == {
        'count': 0,
        'range': '1M',
        'category': None,
    }
