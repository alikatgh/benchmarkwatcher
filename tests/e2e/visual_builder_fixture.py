"""Small explicitly synthetic energy histories for graphics-editor verification."""
from scripts.public_data_store import LibraryWriter, series_id


def seed_library(path):
    with LibraryWriter(path, 'worldbank', 'WDI') as writer:
        for entity, name, values in [('AAA', 'Sample North', [20, 27, 32]),
                                     ('BBB', 'Sample South', [9, 15, 24])]:
            writer.add_series(dict(
                id=series_id('worldbank', entity, 'TEST.WIND', 'GW'),
                source='worldbank', dataset='WDI', entity_id=entity, entity_name=name,
                entity_type='country', indicator_id='TEST.WIND', indicator_name='Synthetic wind capacity',
                unit='GW', frequency='annual', source_url='https://example.com/synthetic-energy',
                attribution='Synthetic test observations; not real country data.',
                license='Test fixture', metadata={'definition': 'Synthetic installed wind capacity for UI testing.'}),
                [{'period':str(2023+i),'value':value,'metadata':{'flag':'E' if i==2 else '', 'note':'Synthetic observation'}} for i,value in enumerate(values)])
