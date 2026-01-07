import os

class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY') or 'you-will-never-guess'
    JSON_DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')
