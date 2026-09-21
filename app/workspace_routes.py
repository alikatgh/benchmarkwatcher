"""Authenticated, owner-scoped research workspace."""
import json
import re
import secrets
import sqlite3
import time
from flask import Blueprint, abort, current_app, flash, g, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash
from app.extensions import limiter
from app.workspace_store import current_user, db, digest, read_key, reserve_analysis, save_key, sign_in
from app.model_library import catalog, calculate, load_model
from app.analysis_providers import PROVIDERS, analyze, test_key

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
    return render_template('workspace.html', mode=mode, user=g.workspace_user,
                           csrf=session['csrf'], providers=PROVIDERS, **values)


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
    books = [b for b in all_books if query.casefold() in b['name'].casefold()]
    page_number = max(1, min(request.args.get('page', 1, type=int) or 1, 10000))
    saved = db().execute('SELECT id,title,provider,created_at FROM analyses WHERE user_id=? ORDER BY created_at DESC LIMIT 30', (g.workspace_user['id'],)).fetchall()
    return page('home', books=books[(page_number-1)*60:page_number*60], query=query,
                count=len(books), total=len(all_books), page_number=page_number, saved=saved)


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
                if request.form.get('consent') != 'yes':
                    raise ValueError('Confirm sharing the question and workbook context with your provider.')
                selection = request.form.get('provider_model', '').split(':', 1)
                if len(selection) != 2:
                    raise ValueError('Select a connected provider and model.')
                provider, model_name = selection
                connection = next((c for c in connections() if c['provider'] == provider), None)
                if not connection or model_name not in connection['models']:
                    raise ValueError('Select a model from your connected provider.')
                key = read_key(g.workspace_user['id'], provider)
                reserve_analysis(g.workspace_user['id'])
                result = analyze(provider, key, model_name, question, workbook,
                                 explain=request.form.get('explain') == 'yes')
            else:
                abort(400)
            analysis_id = secrets.token_urlsafe(18)
            with db():
                db().execute('INSERT INTO analyses VALUES (?,?,?,?,?,?,?,?)',
                    (analysis_id, g.workspace_user['id'], f"{workbook['name']} · {result['metric']}", model_id,
                     question, provider, json.dumps(result, allow_nan=False), int(time.time())))
            return redirect(url_for('workspace.analysis', analysis_id=analysis_id))
        except ValueError as exc:
            flash(str(exc), 'error')
    return page('model', workbook=workbook, connections=connections(), question=question)


@bp.get('/analyses/<analysis_id>')
def analysis(analysis_id):
    record = db().execute('SELECT * FROM analyses WHERE id=? AND user_id=?', (analysis_id, g.workspace_user['id'])).fetchone()
    if record is None:
        abort(404)
    return page('analysis', record=record, result=json.loads(record['result']))


@bp.post('/analyses/<analysis_id>/delete')
def delete_analysis(analysis_id):
    with db():
        count = db().execute('DELETE FROM analyses WHERE id=? AND user_id=?', (analysis_id, g.workspace_user['id'])).rowcount
    if not count:
        abort(404)
    flash('Analysis deleted.', 'success')
    return redirect(url_for('workspace.home'))
