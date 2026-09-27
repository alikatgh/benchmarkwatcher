"""The benchmark redesign preserves the optional private workbook shell."""
from tests.test_workspace import workspace, register  # Reuse isolated account fixtures.


def test_public_shell_hides_workbook_link_when_feature_disabled(app_client):
    app_client.application.config['WORKSPACE_ENABLED'] = False
    response = app_client.get('/?view=compact')
    assert response.status_code == 200
    html = response.get_data(as_text=True)
    assert 'id="table-workspace"' in html
    assert 'Workbook studio' not in html
    assert '/workspace/' not in html
    assert 'All values are historical observations and derived summaries.' in html
    assert 'Imported workbooks may contain' not in html


def test_enabled_shell_keeps_studio_entry_and_authenticated_navigation(workspace, tmp_path):
    data = tmp_path / 'data'
    data.mkdir()
    workspace.config['JSON_DATA_DIR'] = str(data)
    client = workspace.test_client()
    public = client.get('/?view=compact')
    assert public.status_code == 200
    html = public.get_data(as_text=True)
    assert 'aria-label="Workbook studio"' in html
    assert 'href="/workspace/"' in html
    assert 'css/benchmark-workspace.css?v=' in html
    assert 'id="research-workspace"' in html
    assert client.get('/workspace/').status_code == 302

    login = client.get('/workspace/login')
    assert login.status_code == 200
    html = login.get_data(as_text=True)
    assert 'href="/workspace/register"' in html
    assert 'href="/workspace/recover"' in html
    assert 'css/workspace.css?v=' in html
    assert 'css/benchmark-workspace.css?v=' in html
    assert 'Imported workbooks may contain historical figures and assumptions.' in html
    assert 'AI commentary is separate from calculated results.' in html
    assert 'All values are historical observations and derived summaries.' not in html
    assert 'no-store' in login.headers['Cache-Control']

    register(client)
    home = client.get('/workspace/')
    assert home.status_code == 200
    html = home.get_data(as_text=True)
    assert 'href="/workspace/settings"' in html
    assert 'action="/workspace/logout"' in html
    assert 'action="/workspace/research"' in html
    assert 'Workbook library' in html
    assert 'Saved analyses' in html
    assert client.get('/workspace/settings').status_code == 200
