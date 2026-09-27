"""Synthetic workbook and provider transport for local browser checks only."""
import json
import zipfile
from xml.sax.saxutils import escape


def write_workbook(path):
    def cell(ref, value):
        if isinstance(value, str):
            return f'<c r="{ref}" t="inlineStr"><is><t>{escape(value)}</t></is></c>'
        return f'<c r="{ref}"><v>{value}</v></c>'

    columns = list('CDEFGHIJKLMN')
    periods = [f'Q{q}{year}' for year in (24, 25, 26) for q in range(1, 5)]
    rows = [cell('B2', 'Metric') + ''.join(cell(f'{c}2', p) for c, p in zip(columns, periods))]
    for row, name, base in [(3, 'Operating Income', 10), (4, 'Revenue', 100)]:
        rows.append(cell(f'B{row}', name) + ''.join(cell(f'{c}{row}', base + i * 5) for i, c in enumerate(columns)))
    with zipfile.ZipFile(path, 'w') as book:
        book.writestr('xl/workbook.xml', '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Model" sheetId="1" r:id="rId1"/></sheets></workbook>')
        book.writestr('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/model.xml"/></Relationships>')
        book.writestr('xl/styles.xml', '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs><xf numFmtId="0"/></cellXfs></styleSheet>')
        book.writestr('xl/worksheets/model.xml', '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + ''.join(f'<row r="{i+2}">{row}</row>' for i, row in enumerate(rows)) + '</sheetData></worksheet>')


def provider_response(provider, key, payload=None):
    """Stub only the HTTP boundary; production parsing/calculation/storage run."""
    from app.analysis_providers import ProviderError
    if key != f'fixture-{provider}-key':
        raise ProviderError(f'Use fixture-{provider}-key in this sample server.')
    if provider == 'typesafe' and payload.get('state') == 'Connection test.':
        return {'answers': {'connected': {'type': 'noul', 'noul': 1}}}
    if provider == 'deepseek' and payload is None:
        return {'data': [{'id': 'fixture-chat'}]}
    if provider == 'typesafe':
        question = payload['state']['user_question']
    else:
        context = json.loads(payload['messages'][-1]['content'])
        if 'result' in context:
            assert context['result']['points'][0]['source'] == 'Model!C3'
            content = 'The saved Operating Income series starts at 10 (Model!C3) and 15 (Model!D3).'
            return {'choices': [{'finish_reason': 'stop', 'message': {'content': content}}]}
        question = context['question']
    supported = question == 'Show Operating Income across the available periods.'
    plan = {'metric': 'r3' if supported else 'unspecified', 'operation': 'series' if supported else 'unsupported',
            'start': 'unspecified', 'end': 'unspecified'}
    if provider == 'typesafe':
        return {'model': 'jev-latest', 'answers': {name: {'type': 'choice', 'choice': choice, 'confidence': 1} for name, choice in plan.items()}}
    return {'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps(plan)}}]}
