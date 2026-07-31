import asyncio
import logging

import httpx

from app.core.config import get_settings
from app.core.database import async_session_factory
from app.services.webhook_delivery import process_next_delivery

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def run() -> None:
    settings = get_settings()
    timeout = httpx.Timeout(settings.webhook_request_timeout)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
        while True:
            try:
                processed = await process_next_delivery(async_session_factory, client)
                if not processed:
                    await asyncio.sleep(settings.webhook_worker_poll_seconds)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Webhook worker iteration failed")
                await asyncio.sleep(settings.webhook_worker_poll_seconds)


if __name__ == "__main__":
    asyncio.run(run())
