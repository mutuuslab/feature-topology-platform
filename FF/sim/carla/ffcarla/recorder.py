"""CARLA recorder 기록 요약 — client.show_recorder_file_info(path, False) 글을 맵·프레임·길이로 읽는다(carla 모듈 없이 시험 가능)."""
from __future__ import annotations

import re


def recording_summary(info: str) -> dict:
    """CARLA 0.9.16 형식: 머리 'Version: 2' · 'Map: Town04' · 'Date: …', 꼬리 'Frames: 1400' · 'Duration: 69.95 seconds'.
    알아보지 못하면 None — 서버가 기록을 읽지 못하면 머리부터 다르다."""
    def find(pat: str):
        m = re.search(pat, info, re.MULTILINE)
        return m.group(1) if m else None

    frames, dur = find(r'^Frames:\s*(\d+)'), find(r'^Duration:\s*([\d.]+)\s*seconds')
    return dict(format=find(r'^Version:\s*(\S+)'), map=find(r'^Map:\s*(\S+)'), frames=int(frames) if frames else None,
                durationS=float(dur) if dur else None, readable=bool(frames and dur))
