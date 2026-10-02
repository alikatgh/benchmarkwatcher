"""Read numeric Inline XBRL and its contexts; never execute filing markup."""
import re
from decimal import Decimal, InvalidOperation
from html.parser import HTMLParser


def label(name):
    known = {'IPhoneMember': 'iPhone', 'IPadMember': 'iPad', 'WearablesHomeandAccessoriesMember': 'Wearables, home and accessories', 'US': 'United States', 'CN': 'China'}
    name = name.split(':')[-1]
    if name in known: return known[name]
    name = re.sub(r'(Member|Axis|Domain)$', '', name)
    return re.sub(r'(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])', ' ', name).strip()


class InlineFiling(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.contexts, self.units, self.facts, self.excerpts = {}, {}, [], []
        self.context = self.unit = self.fact = None
        self.capture = None
        self.text = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        local = tag.split(':')[-1]
        if local == 'context':
            self.context = {'id': a.get('id'), 'dimensions': []}
        elif self.context is not None and local == 'typedmember':
            self.context['dimensions'].append((a.get('dimension', ''), 'Typed dimension'))
        elif self.context is not None and local in ('startdate', 'enddate', 'instant', 'explicitmember'):
            self.capture = (local, a.get('dimension'), [])
        elif local == 'unit':
            self.unit = {'id': a.get('id'), 'measures': []}
        elif self.unit is not None and local == 'measure':
            self.capture = ('measure', None, [])
        elif tag in ('ix:nonfraction', 'ix:nondecimal') and self.fact is None:
            self.fact = {'tag': a.get('name', ''), 'context': a.get('contextref'), 'unit': a.get('unitref'),
                         'scale': a.get('scale', '0'), 'sign': a.get('sign', ''), 'format': a.get('format', '').split(':')[-1].lower(), 'id': a.get('id', ''), 'text': [], 'nil': a.get('xsi:nil') == 'true'}
        if tag in ('script', 'style', 'ix:hidden'):
            self.hidden += 1
        if tag in ('p', 'div', 'tr') and self.text:
            self._paragraph()

    def handle_endtag(self, tag):
        local = tag.split(':')[-1]
        if self.capture and local == self.capture[0]:
            kind, dimension, text = self.capture
            value = ''.join(text).strip()
            if kind == 'measure' and self.unit is not None:
                self.unit['measures'].append(value.split(':')[-1])
            elif self.context is not None:
                if kind == 'explicitmember':
                    self.context['dimensions'].append((dimension or '', value))
                else:
                    self.context[kind] = value
            self.capture = None
        if local == 'context' and self.context is not None:
            self.contexts[self.context['id']] = self.context
            self.context = None
        if local == 'unit' and self.unit is not None:
            self.units[self.unit['id']] = '/'.join(self.unit['measures'])
            self.unit = None
        if tag in ('ix:nonfraction', 'ix:nondecimal') and self.fact is not None:
            fact, self.fact = self.fact, None
            try:
                raw = ''.join(fact.pop('text')).strip().replace('\u00a0', '').replace(' ', '')
                transform = fact.pop('format')
                if transform in ('num-comma-decimal', 'numcommadecimal'):
                    raw = raw.replace('.', '').replace(',', '.')
                elif transform in ('', 'num-dot-decimal', 'numdotdecimal', 'num-dot-decimal-in', 'numdotdecimalin'):
                    raw = raw.replace(',', '')
                else:
                    # Unsupported transformations remain missing, never guessed.
                    return
                scale = int(fact.pop('scale'))
                if fact.pop('nil') or not -12 <= scale <= 15 or raw in ('', '—', '–', '-'):
                    return
                value = Decimal(raw.strip('()')) * (Decimal(10) ** scale)
                if fact.pop('sign') == '-' or raw.startswith('('):
                    value = -abs(value)
                if value.is_finite() and abs(value) < Decimal('1e30'):
                    self.facts.append(dict(fact, value=float(value)))
            except (ValueError, InvalidOperation):
                pass
        if tag in ('script', 'style', 'ix:hidden'):
            self.hidden = max(0, self.hidden - 1)
        if tag in ('p', 'div', 'tr'):
            self._paragraph()

    def handle_data(self, data):
        if self.capture:
            self.capture[2].append(data)
        if self.fact:
            self.fact['text'].append(data)
        if not self.hidden and len(self.text) < 500:
            self.text.append(data)

    def _paragraph(self):
        text = re.sub(r'\s+', ' ', ' '.join(self.text)).strip()
        self.text = []
        if 120 <= len(text) <= 2200 and re.search(r'net sales|revenue|cash flows|operating income|net interest|premiums', text, re.I):
            if len(self.excerpts) < 40 and text not in self.excerpts:
                self.excerpts.append(text)


def parse_filing(html):
    parser = InlineFiling()
    parser.feed(html)
    parser.close()
    result = []
    for fact in parser.facts:
        context = parser.contexts.get(fact['context'])
        if not context:
            continue
        result.append(dict(fact, start=context.get('startdate'), end=context.get('enddate', context.get('instant')),
                           dimensions=context['dimensions'], unit=parser.units.get(fact['unit'], '')))
    return result, parser.excerpts
