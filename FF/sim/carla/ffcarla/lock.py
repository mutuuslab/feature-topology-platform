"""검증 서버 점유 잠금 — 같은 CARLA 서버(host:port)에서 실행기는 한 번에 하나만 돈다.
두 실행이 한 세계를 함께 쓰면 서로의 차량·동기 tick을 건드려 판정이 조용히 틀린다(2026-10-17 확인: 동시 실행에서 FAULT-ONBOARD FAIL·종료 1).
FF 백엔드 대기열은 한 프로세스 안만 줄 세우므로, 개발 백엔드·시험·다른 백엔드가 함께 붙는 경우를 여기서 막는다(OS 파일 잠금, 프로세스가 죽으면 풀린다)."""
from __future__ import annotations

import os
import re
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path


class ServerBusy(RuntimeError):
    pass


def lock_path(host: str, port: int) -> Path:
    return Path(tempfile.gettempdir()) / f"ff-carla-{re.sub(r'[^A-Za-z0-9.]', '_', host)}-{port}.lock"


def _try(fd: int) -> bool:
    try:
        if os.name == 'nt':
            import msvcrt
            os.lseek(fd, 0, os.SEEK_SET)
            msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except OSError:
        return False


def _release(fd: int) -> None:
    if os.name == 'nt':
        import msvcrt
        os.lseek(fd, 0, os.SEEK_SET)
        msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
    else:
        import fcntl
        fcntl.flock(fd, fcntl.LOCK_UN)


@contextmanager
def server_lock(host: str, port: int, timeout_s: float):
    """잠금을 잡을 때까지 기다린다(timeout_s 넘으면 ServerBusy)."""
    path = lock_path(host, port)
    fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o600)
    try:
        deadline = time.monotonic() + timeout_s
        while not _try(fd):
            if time.monotonic() >= deadline:
                raise ServerBusy(f'검증 서버 {host}:{port}를 다른 실행이 쓰는 중입니다 ({timeout_s:.0f} s 대기 후 포기, 잠금 {path})')
            time.sleep(0.2)
        try:
            yield
        finally:
            _release(fd)
    finally:
        os.close(fd)
