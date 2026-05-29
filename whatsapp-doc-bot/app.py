import logging
import os
from flask import Flask
from config import Config
from routes.webhook import webhook_bp

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


def create_app(config_class=Config):
    app = Flask(__name__)
    app.config.from_object(config_class)

    app.register_blueprint(webhook_bp)

    @app.route("/health")
    def health():
        return {"status": "ok", "service": "whatsapp-doc-bot"}, 200

    logger.info("Aplicación iniciada correctamente")
    return app


app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
