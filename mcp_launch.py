"""Spousteci soubor pro MCP server.

Existuje proto, aby MCP klient (Claude Code, Antigravity, ...) nemusel resit
pracovni adresar - staci mu absolutni cesta k tomuhle souboru.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from flowbridge.mcp_server import run  # noqa: E402

if __name__ == "__main__":
    run()
