"""Background scheduler for offer expiry, request expiry, and notification retries."""

from __future__ import annotations

import logging
import threading

from app.core.config import settings
from app.db.session import SessionLocal

logger = logging.getLogger("scrapsetu.scheduler")


class Scheduler(threading.Thread):
    def __init__(self) -> None:
        super().__init__(name="scrapsetu-scheduler", daemon=True)
        self._stop = threading.Event()

    def run(self) -> None:
        logger.info("scheduler started (interval=%ss)", settings.offer_expiry_sweep_seconds)
        while not self._stop.wait(settings.offer_expiry_sweep_seconds):
            self.tick()

    def tick(self) -> None:
        from app.services.notifications import dispatch_pending
        from app.services.offers import expire_stale_offers
        from app.services.requests import expire_stale_requests

        db = SessionLocal()
        try:
            expire_stale_offers(db)
            expire_stale_requests(db)
            dispatch_pending(db)
        except Exception:  # noqa: BLE001 - never kill the scheduler
            logger.exception("scheduler tick failed")
            db.rollback()
        finally:
            db.close()

    def stop(self) -> None:
        self._stop.set()
