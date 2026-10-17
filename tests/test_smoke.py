import importlib

import ghost_dispatcher


def test_version():
    assert ghost_dispatcher.__version__ == "0.1.0"


def test_subpackages_import():
    for name in ("agents", "core", "mcp_server", "mock_services"):
        importlib.import_module(f"ghost_dispatcher.{name}")
