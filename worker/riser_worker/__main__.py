"""``python -m riser_worker`` - the CLI without an installed console script.

Same entry point as the ``riser`` command, so a studio can drive the worker
straight out of a checkout or a vendored copy without a pip install.
"""

from __future__ import annotations

import sys

from .cli import main

if __name__ == "__main__":
    sys.exit(main())
