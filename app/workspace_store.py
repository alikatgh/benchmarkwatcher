"""Private workspace storage. Secrets never enter a Flask session or template."""
import hashlib
import json
import os
import secrets
import sqlite3
import time
from datetime import timedelta
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken
from flask import current_app, g, session


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL, recovery_hash TEXT NOT NULL,
 default_provider TEXT NOT NULL DEFAULT 'deepseek', created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
 expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS provider_keys (
 user_id INTEGER NOT NULL REFERENCES users(id), provider TEXT NOT NULL,
 ciphertext TEXT NOT NULL, models TEXT NOT NULL, checked_at INTEGER NOT NULL,
 PRIMARY KEY(user_id, provider)
);
CREATE TABLE IF NOT EXISTS analyses (
 id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
 title TEXT NOT NULL, workbook TEXT NOT NULL, question TEXT NOT NULL,
 provider TEXT NOT NULL, result TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS analyses_owner ON analyses(user_id, created_at);
CREATE TABLE IF NOT EXISTS attempts (
 user_id INTEGER NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS attempts_owner ON attempts(user_id, created_at);
"""


def init_workspace(app):
    enabled = app.config.setdefault('WORKSPACE_ENABLED', os.getenv('WORKSPACE_ENABLED') == '1')
    if not enabled:
        return
    # Config's random fallback is fine for public pages, never for accounts.
    secret = app.config.get('WORKSPACE_SESSION_SECRET') or os.getenv('WORKSPACE_SESSION_SECRET')
    encryption = app.config.get('WORKSPACE_ENCRYPTION_KEY') or os.getenv('WORKSPACE_ENCRYPTION_KEY')
    if not secret or len(secret) < 32 or not encryption:
        raise RuntimeError('Workspace requires persistent session and encryption keys.')
    app.extensions['workspace_cipher'] = Fernet(encryption.encode())
    app.config.update(SECRET_KEY=secret, SESSION_COOKIE_HTTPONLY=True,
                      SESSION_COOKIE_SAMESITE='Lax', PERMANENT_SESSION_LIFETIME=timedelta(days=7))
    app.config['SESSION_COOKIE_SECURE'] = app.config.get('WORKSPACE_COOKIE_SECURE', os.getenv('WORKSPACE_LOCAL_HTTP') != '1')
    app.config.setdefault('MODEL_LIBRARY_DIR', os.getenv('MODEL_LIBRARY_DIR', ''))
    app.config.setdefault('MODEL_LIBRARY_SOURCE_URL', os.getenv('MODEL_LIBRARY_SOURCE_URL', ''))
    app.config.setdefault('WORKSPACE_DB', os.getenv('WORKSPACE_DB', str(Path(app.instance_path) / 'workspace.sqlite3')))
    path = Path(app.config['WORKSPACE_DB'])
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
    os.close(fd)
    os.chmod(path, 0o600)
    with sqlite3.connect(path) as conn:
        conn.executescript(SCHEMA)
    app.teardown_appcontext(close_db)
    from app.workspace_routes import bp
    app.register_blueprint(bp)


def db():
    if 'workspace_db' not in g:
        g.workspace_db = sqlite3.connect(current_app.config['WORKSPACE_DB'], timeout=10)
        g.workspace_db.row_factory = sqlite3.Row
        g.workspace_db.execute('PRAGMA foreign_keys=ON')
    return g.workspace_db


def close_db(error=None):
    conn = g.pop('workspace_db', None)
    if conn is not None:
        conn.close()


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def sign_in(user_id):
    session.clear()
    token = secrets.token_urlsafe(32)
    session.update(workspace_token=token, csrf=secrets.token_urlsafe(32))
    session.permanent = True
    conn = db()
    with conn:
        conn.execute('DELETE FROM sessions WHERE expires_at < ?', (int(time.time()),))
        conn.execute('INSERT INTO sessions VALUES (?, ?, ?)',
                     (digest(token), user_id, int(time.time()) + 7 * 86400))


def current_user():
    token = session.get('workspace_token', '')
    if not isinstance(token, str) or not token:
        return None
    return db().execute('SELECT users.* FROM users JOIN sessions ON users.id=sessions.user_id '
                        'WHERE token_hash=? AND expires_at>?', (digest(token), int(time.time()))).fetchone()


def save_key(user_id, provider, key, models):
    payload = json.dumps({'owner': user_id, 'provider': provider, 'key': key}).encode()
    encrypted = current_app.extensions['workspace_cipher'].encrypt(payload).decode()
    with db():
        db().execute('INSERT INTO provider_keys VALUES (?, ?, ?, ?, ?) '
                     'ON CONFLICT(user_id, provider) DO UPDATE SET ciphertext=excluded.ciphertext, '
                     'models=excluded.models, checked_at=excluded.checked_at',
                     (user_id, provider, encrypted, json.dumps(models), int(time.time())))


def read_key(user_id, provider):
    row = db().execute('SELECT ciphertext FROM provider_keys WHERE user_id=? AND provider=?',
                       (user_id, provider)).fetchone()
    if not row:
        raise ValueError('Connect this provider in AI settings first.')
    try:
        payload = json.loads(current_app.extensions['workspace_cipher'].decrypt(row['ciphertext'].encode()))
        if payload['owner'] != user_id or payload['provider'] != provider:
            raise ValueError()
        return payload['key']
    except (InvalidToken, ValueError, KeyError, TypeError):
        raise ValueError('This saved key cannot be read. Reconnect the provider in AI settings.') from None


def reserve_analysis(user_id):
    """Atomically reserve a call before contacting a paid provider."""
    conn = db()
    now = int(time.time())
    conn.execute('BEGIN IMMEDIATE')
    try:
        conn.execute('DELETE FROM attempts WHERE created_at < ?', (now - 86400,))
        count = conn.execute('SELECT count(*) FROM attempts WHERE user_id=?', (user_id,)).fetchone()[0]
        if count >= current_app.config.get('WORKSPACE_DAILY_ANALYSES', 30):
            raise ValueError('Your daily analysis limit has been reached. Try again tomorrow.')
        conn.execute('INSERT INTO attempts VALUES (?, ?)', (user_id, now))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
