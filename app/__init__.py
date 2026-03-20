from flask import Flask, jsonify, request, render_template
from config import Config
from app.extensions import cache, limiter


def _wants_json():
    """Return True when the client expects a JSON response."""
    return (
        request.path.startswith('/api/')
        or request.path.startswith('/internal/')
        or request.accept_mimetypes.best_match(['application/json', 'text/html']) == 'application/json'
    )


def create_app(config_class=Config):
    app = Flask(__name__)
    app.config.from_object(config_class)

    cache.init_app(app)
    limiter.init_app(app)

    from app import routes
    app.register_blueprint(routes.bp)

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

    return app
