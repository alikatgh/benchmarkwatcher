"""Read selected XLSX snapshots without running formulas or external links."""
import hashlib
import math
import posixpath
import re
import zipfile
from functools import lru_cache
from pathlib import Path
from xml.etree import ElementTree as ET

NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
RID = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'
PERIOD = re.compile(r'^(?:F?Q[1-4][\s\-\'’]?(?:\d{2}|\d{4})|(?:FY\s*)?20\d{2}|FY\s*\d{2})[AEae]?$')


def catalog(root):
    if not root or not Path(root).is_dir():
        return []
    base = Path(root).resolve()
    entries = []
    for path in sorted(base.rglob('*.xlsx')):
        if path.name.startswith('~$') or not path.resolve().is_relative_to(base):
            continue
        relative = path.relative_to(base).as_posix()
        entries.append({'id': hashlib.sha256(relative.encode()).hexdigest()[:24],
                        'name': path.stem, 'file': relative})
    return entries


def load_model(root, model_id):
    entry = next((x for x in catalog(root) if x['id'] == model_id), None)
    if not entry:
        raise KeyError('Workbook not found.')
    path = Path(root).resolve() / entry['file']
    stat = path.stat()
    return _read(str(path), stat.st_mtime_ns, stat.st_size, entry['id'])


@lru_cache(maxsize=16)
def _read(path, mtime, size, model_id):
    if size > 15 * 1024 * 1024:
        raise ValueError('This workbook exceeds the supported size.')
    try:
        with zipfile.ZipFile(path) as z:
            if len(z.infolist()) > 2000 or sum(i.file_size for i in z.infolist()) > 40 * 1024 * 1024:
                raise ValueError('This workbook exceeds the supported size.')
            workbook = ET.fromstring(z.read('xl/workbook.xml'))
            sheets = workbook.findall('s:sheets/s:sheet', NS)
            selected = next((s for s in sheets if s.get('name') == 'Model' and s.get('state', 'visible') == 'visible'), None)
            result = {'id': model_id, 'name': Path(path).stem, 'filename': Path(path).name,
                      'version': hashlib.sha256(Path(path).read_bytes()).hexdigest(),
                      'sheets': [s.get('name') for s in sheets if s.get('state', 'visible') == 'visible'],
                      'external_links': any(n.startswith('xl/externalLinks/') for n in z.namelist()),
                      'metrics': [], 'periods': []}
            if selected is None:
                return result
            rels = {r.get('Id'): r for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
            rel = rels[selected.get(RID)]
            if rel.get('TargetMode') == 'External':
                raise ValueError('External worksheets are not supported.')
            target = posixpath.normpath(posixpath.join('xl', rel.get('Target', ''))).lstrip('/')
            if not target.startswith('xl/worksheets/'):
                raise ValueError('Invalid worksheet location.')
            strings = []
            if 'xl/sharedStrings.xml' in z.namelist():
                strings = [''.join(n.itertext()) for n in ET.fromstring(z.read('xl/sharedStrings.xml'))]
            formats = {9: '0%', 10: '0.00%'}
            styles = []
            if 'xl/styles.xml' in z.namelist():
                style_root = ET.fromstring(z.read('xl/styles.xml'))
                formats.update({int(n.get('numFmtId')): n.get('formatCode') for n in style_root.findall('s:numFmts/s:numFmt', NS)})
                styles = [formats.get(int(n.get('numFmtId', '0')), '') for n in style_root.findall('s:cellXfs/s:xf', NS)]
            rows = {}
            for row in ET.fromstring(z.read(target)).findall('s:sheetData/s:row', NS):
                cells = {}
                for c in row.findall('s:c', NS):
                    ref = c.get('r', '')
                    if not re.fullmatch('[A-Z]+[1-9][0-9]*', ref):
                        continue
                    value = c.find('s:v', NS)
                    raw = value.text if value is not None else None
                    kind = c.get('t', 'n')
                    if kind == 's':
                        value = strings[int(raw)] if raw is not None else None
                    elif kind == 'inlineStr':
                        node = c.find('s:is', NS)
                        value = ''.join(node.itertext()) if node is not None else None
                    elif kind in ('str', 'e'):
                        value = raw
                    elif kind == 'n' and raw is not None:
                        value = float(raw)
                        if not math.isfinite(value):
                            value = None
                    else:
                        value = None
                    style = int(c.get('s', '0'))
                    fmt = styles[style] if style < len(styles) else ''
                    cells[re.sub('[0-9]', '', ref)] = {'value': value, 'cell': ref,
                        'formula': c.find('s:f', NS) is not None, 'error': kind == 'e',
                        'percent': '%' in re.sub(r'"[^"]*"|\\.', '', fmt)}
                rows[int(row.get('r'))] = cells
            headers = []
            header_row = 0
            for number, cells in rows.items():
                if number > 8:
                    continue
                candidates = []
                for col, cell in cells.items():
                    value = cell['value']
                    if isinstance(value, (int, float)) and 2000 <= value <= 2099 and int(value) == value:
                        value = str(int(value))
                    if isinstance(value, str) and PERIOD.fullmatch(value.strip()):
                        candidates.append({'id': col, 'label': value.strip(), 'cell': cell['cell']})
                if len(candidates) > len(headers):
                    headers, header_row = candidates, number
            if len(headers) < 2 or len(headers) > 250:
                return result
            result['periods'] = headers
            for number, cells in rows.items():
                label = cells.get('B', {}).get('value')
                if number <= header_row or not isinstance(label, str) or not label.strip():
                    continue
                values = {p['id']: cells.get(p['id'], {'value': None, 'cell': f"{p['id']}{number}",
                          'formula': False, 'error': False, 'percent': False}) for p in headers}
                if any(isinstance(v['value'], (int, float)) for v in values.values()):
                    result['metrics'].append({'id': f'r{number}', 'label': label.strip(),
                                               'cell': f'B{number}', 'values': values})
            return result
    except (zipfile.BadZipFile, ET.ParseError, KeyError, IndexError, TypeError, OSError):
        raise ValueError('This workbook could not be read. Its source file needs review.') from None


def calculate(model, metric_id, operation, start, end):
    metric = next((m for m in model['metrics'] if m['id'] == metric_id), None)
    periods = {p['id']: p for p in model['periods']}
    if metric is None or operation not in ('series', 'value', 'change'):
        raise ValueError('Choose an available metric and analysis operation.')
    if operation != 'series' and end not in periods:
        raise ValueError('Specify an available reporting period.')
    if operation == 'change' and (start not in periods or start == end):
        raise ValueError('Choose two different reporting periods to compare.')
    if operation == 'change' and ('Q' in periods[start]['label'].upper()) != ('Q' in periods[end]['label'].upper()):
        raise ValueError('Compare periods of the same frequency: quarter to quarter or year to year.')
    columns = list(periods) if operation == 'series' else ([start, end] if operation == 'change' else [end])
    points = []
    for col in columns:
        cell = metric['values'][col]
        value = cell['value'] if isinstance(cell['value'], (int, float)) and not cell['error'] else None
        if value is not None and (not math.isfinite(value) or (cell['percent'] and not math.isfinite(value * 100))):
            raise ValueError('These values exceed the supported calculation range.')
        points.append({'period': periods[col]['label'], 'value': value, 'percent': cell['percent'],
                       'source': f"Model!{cell['cell']}", 'header': f"Model!{periods[col]['cell']}",
                       'formula': cell['formula']})
    result = {'metric': metric['label'], 'operation': operation, 'points': points,
              'filename': model['filename'], 'version': model['version'],
              'basis': 'Saved workbook values. Historical figures and assumptions may coexist. Units follow the source workbook and have not been independently verified.'}
    if operation == 'change':
        a, b = points
        if a['value'] is None or b['value'] is None:
            raise ValueError('One selected period has no usable saved value. Missing data cannot be treated as zero.')
        if a['percent'] != b['percent']:
            raise ValueError('The selected cells use different units. Review the workbook before comparing them.')
        result['difference'] = b['value'] - a['value']
        result['relative_change'] = (b['value'] / a['value'] - 1) * 100 if a['value'] > 0 else None
        result['difference_unit'] = 'percentage points' if a['percent'] else 'workbook units'
        if a['percent']:
            result['difference'] *= 100
        if not math.isfinite(result['difference']) or (result['relative_change'] is not None and not math.isfinite(result['relative_change'])):
            raise ValueError('These values exceed the supported calculation range.')
    return result
