"""정책 게이트 대조 러너 — 코드 패키지 게이트(harness/guide/tools/platform_policy_gate.py)의 evaluate()로 사례를 판정한다.

사용: python gate_parity.py <platform_policy_gate.py> <cases.json>  (사례: [{name, cmd, registry, now}] JSON, UTF-8 — Windows 파이프 한계로 파일로 받는다)
출력: [{name, findings: [{rule, ok}]}] JSON. 스키마 검사는 하지 않는다(TS 쪽 zod 대조 시험이 맡는다).
"""
import importlib.util
import json
import sys

sys.dont_write_bytecode = True  # harness/guide 복사본에 __pycache__를 남기지 않는다(guide:check가 매니페스트 밖 파일로 잡는다)

spec = importlib.util.spec_from_file_location("platform_policy_gate", sys.argv[1])
gate = importlib.util.module_from_spec(spec)
sys.modules["platform_policy_gate"] = gate  # dataclass가 모듈을 찾는다(파일 경로 import)
spec.loader.exec_module(gate)

with open(sys.argv[2], encoding="utf-8") as fh:
    cases = json.load(fh)
out = []
for c in cases:
    findings = gate.evaluate(c["cmd"], c["registry"], gate._ts(c["now"]))
    out.append({"name": c["name"], "findings": [{"rule": f.rule, "ok": f.ok} for f in findings]})
sys.stdout.write(json.dumps(out))
