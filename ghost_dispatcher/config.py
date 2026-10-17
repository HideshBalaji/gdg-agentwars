"""Explicit modes: offline never contacts Google or a carrier."""

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


@dataclass(frozen=True)
class Settings:
    mode: str = "offline"
    database: str = "runs/ghost.sqlite"
    dataset: str = "builtin"
    data_dir: str = "data"
    token: str = "ghost-demo"
    origin: str = "http://localhost:3000"
    seed_file: str | None = None
    pro_model: str = ""
    flash_model: str = ""
    mcp_url: str = ""
    carrier_url: str = ""
    api_url: str = "http://127.0.0.1:8000"
    maps_key: str = ""
    sheet_id: str = ""
    calendar_id: str = ""
    google_token_file: str = ""
    demo_recipient: str = ""

    @classmethod
    def from_env(cls):
        load_dotenv()
        settings = cls(
            mode=os.getenv("GHOST_MODE", "offline"),
            database=os.getenv("GHOST_DATABASE", "runs/ghost.sqlite"),
            dataset=os.getenv("GHOST_DATASET", "collected"),
            data_dir=os.getenv("GHOST_DATA_DIR", "data"),
            token=os.getenv("GHOST_API_TOKEN", "ghost-demo"),
            origin=os.getenv("GHOST_UI_ORIGIN", "http://localhost:3000"),
            seed_file=os.getenv("GHOST_SEED_FILE") or None,
            pro_model=os.getenv("GEMINI_PRO_MODEL", ""),
            flash_model=os.getenv("GEMINI_FLASH_MODEL", ""),
            mcp_url=os.getenv("GHOST_MCP_URL", ""),
            carrier_url=os.getenv("GHOST_CARRIER_URL", ""),
            api_url=os.getenv("GHOST_API_URL", "http://127.0.0.1:8000"),
            maps_key=os.getenv("GOOGLE_MAPS_API_KEY", ""),
            sheet_id=os.getenv("GOOGLE_SHEET_ID", ""),
            calendar_id=os.getenv("GOOGLE_CALENDAR_ID", ""),
            google_token_file=os.getenv("GOOGLE_OAUTH_TOKEN_FILE", ""),
            demo_recipient=os.getenv("GOOGLE_DEMO_RECIPIENT", ""),
        )
        if settings.mode not in {"offline", "live"}:
            raise ValueError("GHOST_MODE must be offline or live")
        if settings.dataset not in {"builtin", "collected"}:
            raise ValueError("GHOST_DATASET must be builtin or collected")
        if settings.mode == "live":
            if settings.token == "ghost-demo" or len(settings.token) < 24:
                raise ValueError(
                    "Live mode requires a private GHOST_API_TOKEN of at least 24 chars"
                )
            if not all((os.getenv("GOOGLE_API_KEY"), settings.pro_model, settings.flash_model)):
                raise ValueError("Live mode requires GOOGLE_API_KEY and both Gemini model IDs")
            if not settings.mcp_url:
                raise ValueError("Live mode requires GHOST_MCP_URL; start ghost-mcp first")
        Path(settings.database).parent.mkdir(parents=True, exist_ok=True)
        return settings
