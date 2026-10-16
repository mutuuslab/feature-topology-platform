"""FF 가상검증 실행기 진입점 — python sim/carla/ffcarla_cli.py --out <dir> (자세한 내용: ffcarla/cli.py)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ffcarla.cli import main  # noqa: E402

if __name__ == '__main__':
    sys.exit(main())
