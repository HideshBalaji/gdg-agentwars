import importlib

import ghost_dispatcher

PACKAGES = (
    "ghost_dispatcher.agents",
    "ghost_dispatcher.models",
    "ghost_dispatcher.services",
    "ghost_dispatcher.tools",
    "ghost_dispatcher.memory",
    "mcp_server",
    "mock_services",
)


def test_version():
    assert ghost_dispatcher.__version__ == "0.1.0"


def test_packages_import():
    for name in PACKAGES:
        importlib.import_module(name)
