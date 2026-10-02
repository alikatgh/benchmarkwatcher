"""Isolated fixture server for CI browser tests; never writes production data."""
from datetime import date, timedelta
import argparse
import json
import logging
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from cryptography.fernet import Fernet
import secrets

from app import create_app
from app import analysis_providers
from tests.e2e.workbook_fixture import write_workbook, provider_response


def main(workbooks=False, companies=False):
    with TemporaryDirectory(prefix='benchmarkwatcher-e2e-') as directory:
        library = Path(directory) / 'models'
        library.mkdir()
        write_workbook(library / 'Sample Company.xlsx')
        if workbooks:
            for name in ['005930 Samsung', 'Samsung SDI', 'ZZZ Samsung Research', 'AT&T <Labs>'] + [f'Workbook example {i:03}' for i in range(64)]:
                write_workbook(library / f'{name}.xlsx')
        for name, category, base, step in [('Gold', 'precious', 2000, 1.25), ('Oil', 'energy', 80, -.05), ('Copper', 'metal', 9000, 2.5)]:
            history = [{'date': (date.today() - timedelta(days=119-i)).isoformat(),
                        'price': round(base + i * step, 4)} for i in range(120)]
            item = {'id': name.lower(), 'name': name, 'category': category,
                    'price': history[-1]['price'], 'date': history[-1]['date'],
                    'currency': 'USD', 'unit': 'test unit', 'frequency': 'daily',
                    'source_name': 'Synthetic test data', 'source_url': 'https://example.com',
                    'updated_at': history[-1]['date'] + 'T00:00:00Z',
                    'source_type': 'FIXTURE', 'history': history}
            (Path(directory) / f'{item["id"]}.json').write_text(json.dumps(item))

        class Config:
            SECRET_KEY = 'ci-only-fixture-server'
            JSON_DATA_DIR = directory
            CACHE_TYPE = 'SimpleCache'
            RATELIMIT_ENABLED = False
            WORKSPACE_ENABLED = workbooks or companies
            WORKBOOK_LIBRARY_ENABLED = workbooks
            WORKSPACE_SESSION_SECRET = secrets.token_hex(32)
            WORKSPACE_ENCRYPTION_KEY = Fernet.generate_key().decode()
            WORKSPACE_COOKIE_SECURE = False
            WORKSPACE_DB = str(Path(directory) / 'workspace.sqlite3')
            MODEL_LIBRARY_DIR = str(library)
            MODEL_LIBRARY_SOURCE_URL = ''
            TESTING = True

        if workbooks or companies:
            analysis_providers._send = provider_response
        if companies:
            from app import sec_client, company_financials
            from tests.sec_fixture import fake_fetch
            sec_client.fetch = fake_fetch
            company_financials.fetch = fake_fetch
            def company_provider(provider, key, payload=None):
                if provider == 'deepseek' and payload and 'messages' in payload:
                    context = json.loads(payload['messages'][-1]['content'])
                    if 'evidence' in context:
                        return {'usage': {'prompt_tokens': 1400, 'completion_tokens': 70, 'prompt_cache_hit_tokens': 400}, 'choices':[{'finish_reason':'stop','message':{'content':'This synthetic company reports revenue and operating cash flow in the linked filing. The figures are historical; the supplied evidence does not explain their causes. [S1]'}}]}
                if provider == 'typesafe' and payload and isinstance(payload.get('state'),dict):
                    return {'model':'jev-1.13.0','usage':{'input_tokens':1500,'output_tokens':40},'answers':{k:{'type':'choice','choice':v,'confidence':1} for k,v in {'metric':'revenue','operation':'series','start':'unspecified','end':'unspecified'}.items()}}
                return provider_response(provider,key,payload)
            analysis_providers._send = company_provider
        app = create_app(Config)
        logging.getLogger('werkzeug').setLevel(logging.WARNING)
        print('SYNTHETIC PREVIEW: temporary data; workbook mode uses simulated providers.', flush=True)
        app.run(host='127.0.0.1', port=int(os.getenv('PLAYWRIGHT_PORT', '5781')),
                load_dotenv=False, debug=False, use_reloader=False)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workbooks', action='store_true', help='Enable temporary workbook accounts and simulated providers.')
    parser.add_argument('--companies', action='store_true', help='Enable synthetic SEC filings, accounts and simulated providers.')
    args=parser.parse_args()
    main(workbooks=args.workbooks,companies=args.companies)
