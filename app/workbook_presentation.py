"""Read-only presentation of saved calculations. Never changes source values."""
import re
from decimal import Decimal


def value_text(point):
    value = point.get('value')
    if value is None:
        return 'Unavailable'
    return f"{value * 100 if point.get('percent') else value:,.2f}" + ('%' if point.get('percent') else '')


def readable_explanation(text):
    # Format standalone numbers, leaving years, period labels and cell references
    # intact. Keep the original commentary in the saved record.
    def format_number(match):
        token = match.group()
        value = Decimal(token.replace(',', ''))
        if '.' not in token and 1900 <= value <= 2199:
            return token
        return format(value, ',.2f').rstrip('0').rstrip('.') if '.' in token else format(value, ',.0f')
    text = re.sub(r'(?<![\w.,])[-+]?\d+(?:,\d{3})*(?:\.\d+)?(?!\w|[.,]\d)', format_number, text)
    paragraphs = []
    for paragraph in text.split('\n\n'):
        sentences = re.split(r'(?<=[.!?])\s+(?=[A-Z])', paragraph.strip())
        chunk = ''
        for sentence in sentences:
            if chunk and len(chunk) + len(sentence) > 320:
                paragraphs.append(chunk)
                chunk = ''
            chunk = (chunk + ' ' + sentence).strip()
        if chunk:
            paragraphs.append(chunk)
    return paragraphs


def present_result(result):
    groups = {}
    for point in result.get('points', []):
        label = str(point['period'])
        frequency = 'Quarterly' if re.fullmatch(r'Q[1-4]\s*\d{2,4}', label, re.I) else 'Annual' if re.fullmatch(r'\d{4}', label) else 'Other periods'
        unit = 'Percent' if point.get('percent') else 'Workbook units'
        groups.setdefault((frequency, unit), []).append(dict(point, display=value_text(point)))
    charts = []
    for (frequency, unit), points in groups.items():
        available = [p for p in points if p['value'] is not None]
        chart = {'label': frequency, 'unit': unit, 'points': points, 'count': len(available),
                 'first': points[0], 'last': points[-1], 'segments': [], 'ticks': [], 'nodes': []}
        if available:
            values = [p['value'] * (100 if p.get('percent') else 1) for p in available]
            # Normalize before subtracting so finite but extreme inputs cannot overflow.
            scale = max(abs(v) for v in values) or 1
            low, high = min(0, min(values) / scale), max(0, max(values) / scale)
            span = high - low or 1
            segment = []
            for i, point in enumerate(points):
                x = 86 + (i / max(1, len(points) - 1)) * 610
                if point['value'] is None:
                    if segment:
                        chart['segments'].append(' '.join(segment))
                    segment = []
                    continue
                scaled = point['value'] * (100 if point.get('percent') else 1) / scale
                y = 180 - (scaled - low) / span * 148
                segment.append(f'{x:.2f},{y:.2f}')
                chart['nodes'].append(dict(point, x=round(x, 2), y=round(y, 2)))
            if segment:
                chart['segments'].append(' '.join(segment))
            for ratio in (0, .5, 1):
                value = (low + span * ratio) * scale
                label = f'{value / 1e9:,.1f}B' if abs(value) >= 1e9 else f'{value / 1e6:,.1f}M' if abs(value) >= 1e6 else f'{value / 1e3:,.1f}k' if abs(value) >= 1e3 else f'{value:,.1f}'
                chart['ticks'].append({'y': 180 - ratio * 148, 'label': label + ('%' if unit == 'Percent' else '')})
        # At most six x labels; all exact values remain in Source data.
        chart['labels'] = [{'x': round(86 + i / max(1, len(points) - 1) * 610, 2), 'text': p['period']}
                           for i, p in enumerate(points) if i in {round(j * (len(points) - 1) / min(5, max(1, len(points) - 1))) for j in range(min(6, len(points)))}]
        charts.append(chart)
    return {'groups': charts, 'explanation': readable_explanation(result.get('explanation', '')),
            'missing': sum(p.get('value') is None for p in result.get('points', []))}
