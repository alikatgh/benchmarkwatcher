import os

from flask import Flask, jsonify, request, render_template, url_for
from config import Config
from app.extensions import cache, limiter


def _wants_json():
    """Return True when the client expects a JSON response."""
    return (
        request.path.startswith('/api/')
        or request.path.startswith('/internal/')
        or request.accept_mimetypes.best_match(['application/json', 'text/html']) == 'application/json'
    )


def _versioned_url_for(endpoint, **values):
    """url_for variant that appends a content version (?v=<mtime>) to static
    URLs so a deploy busts the browser cache. Non-static endpoints are
    unchanged; falls back gracefully if the file is missing.
    """
    if endpoint == 'static' and 'filename' in values:
        try:
            from flask import current_app
            file_path = os.path.join(current_app.static_folder, values['filename'])
            values['v'] = int(os.path.getmtime(file_path))
        except (OSError, TypeError, ValueError):
            pass
    return url_for(endpoint, **values)


def create_app(config_class=Config):
    app = Flask(__name__)
    app.config.from_object(config_class)

    cache.init_app(app)
    limiter.init_app(app)

    from app import routes
    app.register_blueprint(routes.bp)

    # --- Static asset cache-busting ------------------------------------
    # Append each static file's mtime as ?v= so a deploy invalidates the
    # browser cache. Without this, soft reloads can serve stale JS/CSS even
    # under Cache-Control: no-cache (which relies on the browser revalidating).
    @app.context_processor
    def _inject_versioned_url_for():
        return {'url_for': _versioned_url_for}

    # --- Error handlers ------------------------------------------------

    @app.errorhandler(404)
    def not_found(e):
        if _wants_json():
            return jsonify({'error': 'Not found'}), 404
        return render_template('errors/404.html'), 404

    @app.errorhandler(429)
    def rate_limited(e):
        if _wants_json():
            return jsonify({'error': 'Rate limit exceeded', 'message': str(e.description)}), 429
        return render_template('errors/429.html'), 429

    @app.errorhandler(500)
    def internal_error(e):
        if _wants_json():
            return jsonify({'error': 'Internal server error'}), 500
        return render_template('errors/500.html'), 500

    # --- Security headers ----------------------------------------------
    @app.after_request
    def _set_security_headers(response):
        """Defence-in-depth response headers (the app previously set none).

        The CSP is permissive — 'unsafe-inline' is required by the inline
        <script>, inline <style>, and ~40 inline style= attributes, and the
        CDN origins are allow-listed (jsdelivr for Chart.js/zoom/date-fns,
        Google Fonts for Inter). It still blocks arbitrary external script/
        connect/frame origins, base-tag hijacking, and cross-origin form posts.
        Tightening to per-request nonces is a worthwhile follow-up.
        """
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'SAMEORIGIN'
        response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
        response.headers['Permissions-Policy'] = 'geolocation=(), microphone=(), camera=(), payment=()'
        response.headers['Content-Security-Policy'] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline'; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com data:; "
            "img-src 'self' data:; "
            "connect-src 'self'; "
            "frame-ancestors 'self'; "
            "base-uri 'self'; "
            "form-action 'self'"
        )
        return response

    return app
