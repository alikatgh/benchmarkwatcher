"""Authenticated, owner-scoped research workspace."""
import json
import re
import secrets
import sqlite3
import time
from flask import Blueprint, abort, current_app, flash, g, jsonify, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash
from app.extensions import limiter
from app.workspace_store import current_user, db, digest, read_key, reserve_analysis, save_key, sign_in
from app.model_library import catalog, calculate, load_model
from app.analysis_providers import PROVIDERS, analyze, test_key
from app.analysis_providers import research_plan, explain_research, ProviderError
from app.company_research import build_report, resolve_company, scenario, valuation, number
from app.workbook_presentation import present_result

bp = Blueprint('workspace', __name__, url_prefix='/workspace')
DUMMY_HASH = generate_password_hash(secrets.token_urlsafe(24))


@bp.before_request
def protect():
    request.max_content_length = 16 * 1024
    session.setdefault('csrf', secrets.token_urlsafe(32))
    g.workspace_user = current_user()
    if request.method == 'POST':
        supplied = request.form.get('csrf', '')
        if not secrets.compare_digest(supplied.encode(), session['csrf'].encode()):
            abort(400, description='The form expired. Reload the page and try again.')
    if request.endpoint not in ('workspace.login', 'workspace.register', 'workspace.recover') and not g.workspace_user:
        return redirect(url_for('workspace.login'))


@bp.after_request
def private_response(response):
    response.headers['Cache-Control'] = 'no-store, private'
    response.headers['X-Robots-Tag'] = 'noindex, nofollow'
    response.vary.add('Cookie')
    return response


def page(mode, **values):
    if g.workspace_user:
        values.setdefault('connections', connections())
        chat_workbook = values.get('workbook')
        model_id = chat_workbook['id'] if chat_workbook else (
            values['record']['workbook'] if mode == 'analysis' else session.get('chat_workbook'))
        if not chat_workbook and model_id:
            try:
                chat_workbook = load_model(current_app.config['MODEL_LIBRARY_DIR'], model_id)
            except (KeyError, ValueError):
                pass
        if chat_workbook:
            session['chat_workbook'] = chat_workbook['id']
        values['chat_workbook'] = chat_workbook
        # The conversation stays current even while inspecting an older result.
        values['chat_history'] = []
        if model_id:
            history = db().execute(
                '''SELECT id,question,provider,result FROM analyses
                   WHERE user_id=? AND workbook=? AND provider IN ('typesafe','deepseek')
                   ORDER BY rowid DESC LIMIT 20''',
                (g.workspace_user['id'], model_id)).fetchall()
            values['chat_history'] = [chat_message(row) for row in reversed(history)]
        values['chat_preferences'] = session.get('chat_preferences', {})
        values['chat_permissions'] = session.get('chat_permissions', [])
        values['analysis_steps'] = list(values['chat_history'])
        if mode == 'analysis' and not any(m['id'] == values['record']['id'] for m in values['analysis_steps']):
            values['analysis_steps'].insert(0, chat_message(values['record']))
        values['show_canvas'] = mode == 'analysis' or (mode == 'model' and bool(values['analysis_steps']) and request.args.get('controls') != '1')
        values['active_analysis_id'] = values['record']['id'] if mode == 'analysis' else (
            values['analysis_steps'][-1]['id'] if values['analysis_steps'] else '')
    return render_template('workspace.html', mode=mode, user=g.workspace_user,
                           csrf=session['csrf'], providers=PROVIDERS, **values)


def chat_message(row):
    result = json.loads(row['result']) if isinstance(row['result'], str) else row['result']
    return dict(row, result=result, presentation=present_result(result))


def previous_selection(workbook):
    analysis_id = request.form.get('context_analysis_id', '')
    if not analysis_id:
        return None
    row = db().execute('SELECT result FROM analyses WHERE id=? AND user_id=? AND workbook=?',
                      (analysis_id, g.workspace_user['id'], workbook['id'])).fetchone()
    if not row:
        raise ValueError('The previous answer is no longer available. Choose New topic and name the metric in your question.')
    result = json.loads(row['result'])
    plan = result.get('plan')
    if result.get('version') != workbook['version'] or not plan:
        raise ValueError('The workbook or previous selection changed. Choose New topic and name the metric in your question.')
    return {key: plan[key] for key in ('metric', 'operation', 'start', 'end')}


def valid_password(password):
    return 12 <= len(password) <= 256


@bp.route('/register', methods=['GET', 'POST'])
@limiter.limit('5 per hour', methods=['POST'])
def register():
    if request.method == 'POST':
        username = request.form.get('username', '').strip().lower()
        password = request.form.get('password', '')
        if not re.fullmatch(r'[a-z0-9][a-z0-9_.-]{2,39}', username) or not valid_password(password):
            flash('Use a 3–40 character username and a password of 12–256 characters.', 'error')
        else:
            recovery = secrets.token_urlsafe(24)
            try:
                with db():
                    cursor = db().execute('INSERT INTO users(username,password_hash,recovery_hash,created_at) VALUES (?,?,?,?)',
                        (username, generate_password_hash(password), digest(recovery), int(time.time())))
                sign_in(cursor.lastrowid)
                g.workspace_user = current_user()
                return page('recovery_code', recovery_code=recovery)
            except sqlite3.IntegrityError:
                flash('That username is unavailable.', 'error')
    return page('register')


@bp.route('/login', methods=['GET', 'POST'])
@limiter.limit('5 per minute', methods=['POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username', '').strip().lower()[:40]
        password = request.form.get('password', '')
        row = db().execute('SELECT * FROM users WHERE username=?', (username,)).fetchone()
        matches = check_password_hash(row['password_hash'] if row else DUMMY_HASH, password[:257])
        if row and matches and len(password) <= 256:
            sign_in(row['id'])
            return redirect(url_for('workspace.home'))
        flash('Username or password is incorrect.', 'error')
    return page('login')


@bp.route('/recover', methods=['GET', 'POST'])
@limiter.limit('5 per hour', methods=['POST'])
def recover():
    if request.method == 'POST':
        username = request.form.get('username', '').strip().lower()[:40]
        row = db().execute('SELECT * FROM users WHERE username=?', (username,)).fetchone()
        code = request.form.get('recovery', '').strip()
        password = request.form.get('password', '')
        if row and secrets.compare_digest(digest(code), row['recovery_hash']) and valid_password(password):
            replacement = secrets.token_urlsafe(24)
            with db():
                db().execute('UPDATE users SET password_hash=?, recovery_hash=? WHERE id=?',
                             (generate_password_hash(password), digest(replacement), row['id']))
                db().execute('DELETE FROM sessions WHERE user_id=?', (row['id'],))
            sign_in(row['id'])
            g.workspace_user = current_user()
            return page('recovery_code', recovery_code=replacement)
        flash('Check your username and recovery code, and use a password of 12–256 characters.', 'error')
    return page('recover')


@bp.post('/logout')
def logout():
    with db():
        db().execute('DELETE FROM sessions WHERE token_hash=?', (digest(session.get('workspace_token', '')),))
    session.clear()
    return redirect(url_for('workspace.login'))


def connections():
    rows = db().execute('SELECT provider, models, checked_at FROM provider_keys WHERE user_id=?', (g.workspace_user['id'],)).fetchall()
    return [{'provider': r['provider'], 'models': json.loads(r['models']), 'checked_at': r['checked_at']} for r in rows]


@bp.route('/settings', methods=['GET', 'POST'])
@limiter.limit('6 per minute', methods=['POST'])
def settings():
    if request.method == 'POST':
        provider = request.form.get('provider', '')
        action = request.form.get('action')
        if provider not in PROVIDERS:
            abort(400)
        try:
            if action == 'connect':
                if request.form.get('consent') != 'yes':
                    raise ValueError('Confirm the provider connection test before saving your key.')
                key = request.form.get('api_key', '').strip()
                models = test_key(provider, key)
                save_key(g.workspace_user['id'], provider, key, models)
                flash('Connection tested. Your key is saved encrypted.', 'success')
            elif action == 'remove':
                with db():
                    db().execute('DELETE FROM provider_keys WHERE user_id=? AND provider=?', (g.workspace_user['id'], provider))
                flash('Saved key removed. Revoke it at the provider too if you want to disable it everywhere.', 'success')
            elif action == 'default':
                if provider not in {c['provider'] for c in connections()}:
                    raise ValueError('Connect this provider first.')
                with db():
                    db().execute('UPDATE users SET default_provider=? WHERE id=?', (provider, g.workspace_user['id']))
                flash('Default provider updated.', 'success')
            else:
                abort(400)
        except ValueError as exc:
            flash(str(exc), 'error')
        return redirect(url_for('workspace.settings'))
    return page('settings', connections=connections())


@bp.get('/')
def home():
    query = request.args.get('q', '').strip()[:100]
    all_books = catalog(current_app.config['MODEL_LIBRARY_DIR'])
    books = [b for b in all_books if all(term in b['name'].casefold() for term in query.casefold().split())]
    page_number = max(1, min(request.args.get('page', 1, type=int) or 1, 10000))
    saved = db().execute('SELECT id,title,provider,created_at FROM analyses WHERE user_id=? ORDER BY created_at DESC LIMIT 30', (g.workspace_user['id'],)).fetchall()
    return page('home', books=books[(page_number-1)*60:page_number*60], query=query,
                count=len(books), total=len(all_books), page_number=page_number, saved=saved,
                search_index=[{'name': b['name'], 'url': url_for('workspace.model', model_id=b['id'])} for b in all_books])


def workbook_or_404(model_id):
    try:
        return load_model(current_app.config['MODEL_LIBRARY_DIR'], model_id)
    except KeyError:
        abort(404)


@bp.route('/models/<model_id>', methods=['GET', 'POST'])
@limiter.limit('10 per minute', methods=['POST'])
def model(model_id):
    try:
        workbook = workbook_or_404(model_id)
    except ValueError as exc:
        flash(str(exc), 'error')
        return redirect(url_for('workspace.home'))
    question = request.form.get('question', '').strip()
    if request.method == 'POST':
        try:
            if request.form.get('action') == 'manual':
                result = calculate(workbook, request.form.get('metric'), request.form.get('operation'),
                                   request.form.get('start'), request.form.get('end'))
                provider = 'local'
                question = f"{result['operation']}: {result['metric']}"
            elif request.form.get('action') == 'ask':
                if not 3 <= len(question) <= 1500:
                    raise ValueError('Enter a question between 3 and 1,500 characters.')
                selection = request.form.get('provider_model', '').split(':', 1)
                if len(selection) != 2:
                    raise ValueError('Select a connected provider and model.')
                provider, model_name = selection
                connection = next((c for c in connections() if c['provider'] == provider), None)
                if not connection or model_name not in connection['models']:
                    raise ValueError('Select a model from your connected provider.')
                key = read_key(g.workspace_user['id'], provider)
                explain = request.form.get('explain') == 'yes'
                explanation_key = explanation_model = None
                if explain:
                    explanation_model = request.form.get('explanation_model', '')
                    deepseek = next((c for c in connections() if c['provider'] == 'deepseek'), None)
                    if not deepseek or explanation_model not in deepseek['models']:
                        raise ValueError('Connect DeepSeek and select one of its explanation models in AI chat.')
                    explanation_key = read_key(g.workspace_user['id'], 'deepseek')
                scope = '|'.join((model_id, provider + ':' + model_name, explanation_model or ''))
                permissions = session.get('chat_permissions', [])
                if request.form.get('consent') != 'yes' and scope not in permissions:
                    raise ValueError('Confirm sharing the question and workbook context with your provider.')
                context = previous_selection(workbook)
                context_options = {'previous_selection': context} if context else {}
                reserve_analysis(g.workspace_user['id'])
                result = analyze(provider, key, model_name, question, workbook,
                                 explain=explain, explanation_key=explanation_key,
                                 explanation_model=explanation_model, **context_options)
                if request.form.get('consent') == 'yes' and request.form.get('remember_consent') == 'yes':
                    session['chat_permissions'] = [p for p in permissions if p != scope][-9:] + [scope]
                session['chat_preferences'] = {
                    'provider_model': request.form['provider_model'],
                    'explain': 'yes' if explain else '',
                    'explanation_model': explanation_model or '',
                }
            else:
                abort(400)
            analysis_id = secrets.token_urlsafe(18)
            result['library_source'] = current_app.config.get('MODEL_LIBRARY_SOURCE_URL', '')
            with db():
                db().execute('INSERT INTO analyses VALUES (?,?,?,?,?,?,?,?)',
                    (analysis_id, g.workspace_user['id'], f"{workbook['name']} · {result['metric']}", model_id,
                     question, provider, json.dumps(result, allow_nan=False), int(time.time())))
            if request.headers.get('Accept') == 'application/json':
                message = chat_message({'id': analysis_id, 'question': question, 'provider': provider, 'result': result})
                return jsonify(id=analysis_id, url=url_for('workspace.analysis', analysis_id=analysis_id),
                               html=render_template('components/workbook_exchange.html', message=message, providers=PROVIDERS),
                               analysis_html=render_template('components/workbook_step.html', message=message,
                                                             providers=PROVIDERS, csrf=session['csrf']),
                               permissions=session.get('chat_permissions', []))
            return redirect(url_for('workspace.analysis', analysis_id=analysis_id))
        except ValueError as exc:
            if request.headers.get('Accept') == 'application/json':
                return jsonify(error=str(exc)), 422
            flash(str(exc), 'error')
    return page('model', workbook=workbook, connections=connections(), question=question)


@bp.get('/analyses/<analysis_id>')
def analysis(analysis_id):
    record = db().execute('SELECT * FROM analyses WHERE id=? AND user_id=?', (analysis_id, g.workspace_user['id'])).fetchone()
    if record is None:
        abort(404)
    result = json.loads(record['result'])
    if result.get('kind') == 'company_report':
        return page('company_report', record=record, result=result, connections=connections())
    return page('analysis', record=record, result=result)


def save_research(result, question, provider='local'):
    analysis_id = secrets.token_urlsafe(18)
    suffix = ' · Memory sensitivity' if 'scenario' in result else ' · Company research'
    with db():
        db().execute('INSERT INTO analyses VALUES (?,?,?,?,?,?,?,?)',
            (analysis_id, g.workspace_user['id'], result['company'] + suffix,
             result['company_id'], question, provider, json.dumps(result, allow_nan=False), int(time.time())))
    return redirect(url_for('workspace.analysis', analysis_id=analysis_id))


@bp.post('/research')
@limiter.limit('10 per minute', methods=['POST'])
def research():
    question = request.form.get('company', '').strip()[:1500]
    try:
        resolve_company(question)
        start = time.monotonic()
        report = build_report()
        report['elapsed_ms'] = round((time.monotonic() - start) * 1000)
        return save_research(report, question)
    except ValueError as exc:
        flash(str(exc), 'error')
        return redirect(url_for('workspace.home'))


def selected_connection(value, required_provider=None):
    selection = value.split(':', 1)
    if len(selection) != 2:
        raise ValueError('Select a connected provider and model.')
    provider, model_name = selection
    connection = next((c for c in connections() if c['provider'] == provider), None)
    if (not connection or model_name not in connection['models'] or
        (required_provider and provider != required_provider)):
        raise ValueError('Select a model from the required connected provider.')
    return provider, model_name


@bp.post('/analyses/<analysis_id>/follow-up')
@limiter.limit('10 per minute', methods=['POST'])
def research_follow_up(analysis_id):
    record = db().execute('SELECT * FROM analyses WHERE id=? AND user_id=?',
                         (analysis_id, g.workspace_user['id'])).fetchone()
    if record is None:
        abort(404)
    report = json.loads(record['result'])
    if report.get('kind') != 'company_report':
        abort(400)
    # Keep the saved source snapshot, but never carry commentary into a new case.
    for field in ('explanation', 'explanation_notice', 'explanation_usage', 'provider_metadata', 'plan'):
        report.pop(field, None)
    start = time.monotonic()
    provider = 'local'
    try:
        action = request.form.get('action')
        if action == 'scenario':
            report['scenario'] = scenario(report, request.form.get('price_change'), request.form.get('flow_through'))
            question = f"Memory price change {report['scenario']['price_change']:+g}%; earnings flow-through {report['scenario']['flow_through']:g}%"
        elif action == 'valuation':
            report['valuation'] = valuation(report, request.form.get('market_cap'), request.form.get('as_of'))
            question = 'Historical valuation multiples using my equity value'
        elif action == 'ask':
            question = request.form.get('question', '').strip()
            if not 3 <= len(question) <= 1500:
                raise ValueError('Enter a follow-up between 3 and 1,500 characters.')
            if request.form.get('consent') != 'yes':
                raise ValueError('Confirm sharing this follow-up with your selected provider.')
            provider, model_name = selected_connection(request.form.get('provider_model', ''))
            commentary = request.form.get('explanation_model', '')
            if commentary:
                _, commentary_model = selected_connection(commentary, 'deepseek')
            flow = number(request.form.get('flow_through', '100'), 'Earnings flow-through (%)', 0, 100)
            reserve_analysis(g.workspace_user['id'])
            plan, metadata = research_plan(provider, read_key(g.workspace_user['id'], provider), model_name, question)
            if plan['operation'] == 'memory_price':
                report['scenario'] = scenario(report, plan['price_change'], flow)
            elif not commentary:
                raise ValueError('For a written answer, select a connected DeepSeek explanation model. Jev selects calculations; it does not write the research note.')
            report.update(plan=plan, provider_metadata=metadata)
            if commentary:
                try:
                    text, usage = explain_research(read_key(g.workspace_user['id'], 'deepseek'), commentary_model, question, report)
                    report.update(explanation=text, explanation_usage={'model': commentary_model, 'usage': usage})
                except ProviderError:
                    report['explanation_notice'] = 'The AI explanation failed. The source report and calculated case were saved; no automatic retry was made.'
        else:
            abort(400)
        report['parent_analysis'] = analysis_id
        report['elapsed_ms'] = round((time.monotonic() - start) * 1000)
        return save_research(report, question, provider)
    except ValueError as exc:
        flash(str(exc), 'error')
        return redirect(url_for('workspace.analysis', analysis_id=analysis_id))


@bp.post('/analyses/<analysis_id>/delete')
def delete_analysis(analysis_id):
    with db():
        count = db().execute('DELETE FROM analyses WHERE id=? AND user_id=?', (analysis_id, g.workspace_user['id'])).rowcount
    if not count:
        abort(404)
    flash('Analysis deleted.', 'success')
    return redirect(url_for('workspace.home'))
