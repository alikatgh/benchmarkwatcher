from flask import Flask
from config import Config
from app.extensions import cache

def create_app(config_class=Config):
    app = Flask(__name__)
    app.config.from_object(config_class)

    cache.init_app(app)

    from app import routes
    app.register_blueprint(routes.bp)

    return app
