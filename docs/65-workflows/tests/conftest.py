import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import wf_model as wm  # noqa: E402


@pytest.fixture()
def model():
    """매번 새로 읽은 모델 — 결함 주입 테스트가 서로 오염시키지 않게 한다."""
    return wm.load_model()
