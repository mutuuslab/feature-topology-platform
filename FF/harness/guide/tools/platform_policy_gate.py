#!/usr/bin/env python3
"""Control Plane policy gate (verification location: PLATFORM).

First line of defence before a kill_command v2 is signed and handed to the
CCS / OTA backend (IF-05 / IF-07). The vehicle (LPC + Safety Guard) re-checks
everything safety-relevant; this gate adds checks only the platform can do:
Registry state and class consistency, approvals and roles (incl. restore
approvers vs. kill approvers from the audit ledger), message time window,
order sequence, rolling-window caps for mass kill/restore, market/regulatory
preconditions and evidence completeness (guide Ch.8, verification matrix 8.4).

The same caps are enforced again by the independent policy engine of the
signing HSM (FFG-SEC-003): this gate alone is not trusted for mass actions.

Usage:
    python tools/platform_policy_gate.py <command.json> [--registry registry.json]
Exit code 0 = PASS, 1 = FAIL, 2 = schema error.
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker

HERE = Path(__file__).resolve().parent
SCHEMA = HERE.parent / "schema" / "kill_command.v2.schema.json"
DEFAULT_REGISTRY = HERE.parent / "schema" / "examples" / "registry.json"

F_RANK = {"F0": 0, "F1": 1, "F2": 2, "F3": 3, "F4": 4}


@dataclass(frozen=True)
class Finding:
    rule: str
    ok: bool
    message: str


def _ts(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def schema_errors(cmd: dict) -> list[str]:
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    return [f"{'/'.join(map(str, e.path)) or '<root>'}: {e.message}"
            for e in sorted(validator.iter_errors(cmd), key=lambda e: list(e.path))]


def evaluate(cmd: dict, registry: dict, now: datetime | None = None) -> list[Finding]:
    out: list[Finding] = []
    now = now or datetime.now(timezone.utc)
    feat = cmd["feature"]
    reg = registry["features"].get(feat["id"])
    led = registry.get("ledger", {}).get(feat["id"], {})
    pol = registry["policy"]
    req = cmd["request"]
    reason = cmd["reason"]["category"]
    market = cmd["target"]["market"]

    def add(rule: str, ok: bool, msg: str) -> None:
        out.append(Finding(rule, ok, msg))

    # FFG-PLT-002 Registry state
    released = reg is not None and (reg["status"] == "RELEASED" or
                                    (reg["status"] == "DECOMMISSIONED" and req == "deactivate"))
    ok = released and reg["version"] == feat["version"]
    add("FFG-PLT-002", ok, "feature version is RELEASED in Registry" if ok else
        "feature/version unknown or not RELEASED in Registry")
    if reg is None:
        return out

    # FFG-CLS-009 the Registry itself must be consistent (class and deactivation profile)
    prof, dc, frank = reg.get("profile", {}), reg["deact_class"], F_RANK[reg["f_class"]]
    issues = []
    if frank >= 2 and dc == "DC0":
        issues.append(f"{reg['f_class']} with DC0 (immediate deactivation of a safety-relevant feature)")
    if dc == "DC2" and not (prof.get("takeover_ms", 0) > 0 and prof.get("ramp_ms", 0) > 0):
        issues.append("DC2 needs takeover_ms and ramp_ms > 0")
    if frank >= 2 and dc != "DC4" and not prof.get("fault_ramp_ms", 0) > 0:
        issues.append("F2+ needs fault_ramp_ms > 0")
    if dc == "DC1" and not prof.get("max_pending_ms", 0) > 0:
        issues.append("DC1 needs max_pending_ms > 0")
    if dc in ("DC1", "DC2", "DC3") and not prof.get("max_cycle_wait_ms", 0) > 0:
        issues.append(f"{dc} needs max_cycle_wait_ms > 0 (commercial wait)")
    add("FFG-CLS-009", not issues, "deactivation class and profile consistent" if not issues else
        "Registry error: " + "; ".join(issues))

    # FFG-ADS-002 an ADS feature must be remotely terminable (never DC4)
    if reg.get("ads_feature"):
        ok = dc != "DC4"
        add("FFG-ADS-002", ok, "ADS feature has a remote termination path" if ok else
            "ADS feature classified DC4: remote termination impossible (UN ADS GTR proposal 4.1.4.4)")

    # FFG-ADS-010 a decommissioned feature can never be activated or restored
    if reg.get("status") == "DECOMMISSIONED":
        ok = req == "deactivate"
        add("FFG-ADS-010", ok, "deactivation of a decommissioned feature" if ok else
            f"{req} of a decommissioned feature is forbidden (UN ADS GTR proposal 5.3.2.16(e))")

    # FFG-PLT-003 classes are Registry data, never operator choice
    ok = feat["deact_class"] == reg["deact_class"] and feat["f_class"] == reg["f_class"]
    add("FFG-PLT-003", ok, "f_class/deact_class equal Registry" if ok else
        f"declared {feat['f_class']}/{feat['deact_class']} != Registry {reg['f_class']}/{reg['deact_class']}")

    # FFG-PLT-004 DC4 / GSR mandatory systems are not runtime flags: no remote request at all
    ok = not (reg["deact_class"] == "DC4" or reg["gsr_mandatory"])
    add("FFG-PLT-004", ok, "not a DC4 / GSR-mandatory feature" if ok else
        "no remote request (deactivate/activate/restore) for DC4 / GSR-mandatory systems")

    # FFG-PLT-005 four-eyes, roles by F class
    approvers = [a["approver_id"] for a in cmd["approvals"]]
    roles = {a["role"] for a in cmd["approvals"]}
    distinct = len(set(approvers)) == len(approvers) and len(approvers) >= 2
    need_fsm = F_RANK[reg["f_class"]] >= 2 and req in ("deactivate", "restore") and reason in ("SAFETY", "SECURITY")
    signed = all(len(a.get("approval_sig", "")) >= 64 for a in cmd["approvals"])
    overlap = set(approvers) & set(led.get("last_kill_approvers", [])) if req == "restore" else set()
    ok = distinct and signed and (not need_fsm or "FSM" in roles) and not overlap
    add("FFG-PLT-005", ok, "two distinct, personally signed approvers with required roles" if ok else
        "approvals must be >= 2 distinct persons with approval_sig; F2+ safety/security actions need FSM; "
        f"restore approvers must differ from kill approvers{' (overlap: ' + ', '.join(sorted(overlap)) + ')' if overlap else ''}")

    # FFG-PLT-006 commercial/operational reasons: deferred class + user notice
    if reason in ("COMMERCIAL", "OPERATIONAL") and F_RANK[reg["f_class"]] >= 2:
        ok = cmd["user_notice"]["required"] is True and bool(cmd["user_notice"].get("text_ref"))
        add("FFG-PLT-006", ok, "user notice prepared (applied at next ignition cycle, DC3)" if ok else
            "F2+ commercial change needs user notice (UN R156 7.2.2.2), applied as DC3")

    # FFG-PLT-007 message validity window: no pre-signed future commands, not expired
    nb, ex, iss = _ts(cmd["validity"]["not_before"]), _ts(cmd["validity"]["expires_at"]), _ts(cmd["issued_at"])
    ttl_h = (ex - nb).total_seconds() / 3600.0
    lead_h = (nb - iss).total_seconds() / 3600.0
    problems = []
    if not 0.0 < ttl_h <= pol["max_command_ttl_hours"]:
        problems.append(f"validity {ttl_h:.1f} h outside (0, {pol['max_command_ttl_hours']}] h")
    if not 0.0 <= lead_h <= pol["max_not_before_lead_hours"]:
        problems.append(f"not_before {lead_h:.1f} h after issued_at (allowed 0..{pol['max_not_before_lead_hours']} h)")
    skew_s = pol.get("max_clock_skew_seconds", 300)
    if (iss - now).total_seconds() > skew_s:
        problems.append(f"issued_at {iss.isoformat()} lies in the future (> {skew_s} s skew): pre-signed command")
    if ex <= now:
        problems.append("already expired at gate time (validity is [not_before, expires_at))")
    add("FFG-PLT-007", not problems, f"validity window {ttl_h:.1f} h, lead {lead_h:.2f} h" if not problems
        else "; ".join(problems))

    # FFG-PLT-017 order sequence = ledger + 1 (no gaps, no replay, no exhaustion)
    expect = led.get("last_order_seq", 0) + 1
    ok = cmd["command_seq"] == expect
    add("FFG-PLT-017", ok, f"order sequence {cmd['command_seq']} follows ledger" if ok else
        f"order sequence {cmd['command_seq']} != ledger + 1 ({expect})")

    # FFG-PLT-008 scope caps and canary for widening actions
    n = len(cmd["scope"]["vehicle_ids"])
    cap = reg["max_vehicles"]
    if req in ("activate", "restore"):
        cap = min(cap, registry["policy"]["canary_max_vehicles"])
    ok = n <= cmd["scope"]["max_vehicles"] <= cap
    add("FFG-PLT-008", ok, f"scope {n} <= declared {cmd['scope']['max_vehicles']} <= cap {cap}" if ok else
        f"scope violates cap (n={n}, declared={cmd['scope']['max_vehicles']}, cap={cap})")

    # FFG-SEC-003 mass action: rolling window across commands, not per message
    if req in ("deactivate", "restore"):
        window = timedelta(hours=pol["kill_window_hours"])
        recent = sum(r["vehicles"] for r in led.get("recent", [])
                     if r["request"] == req and now - _ts(r["at"]) <= window)
        total = recent + n
        ok = total <= reg["max_per_window"] or {"FSM", "CSM"} <= roles
        add("FFG-SEC-003", ok, f"{req}: {total} vehicles in {pol['kill_window_hours']} h window "
            f"(cap {reg['max_per_window']})" if ok else
            f"{req}: {total} vehicles in window > cap {reg['max_per_window']}; FSM + CSM approval and staged execution required")

    # FFG-PLT-009 market and regulatory preconditions
    regu = cmd["regulatory"]
    problems = []
    if market not in reg["markets_approved"]:
        problems.append(f"feature not approved for market {market}")
    if reg["type_approval_relevant"] and req == "activate" and regu["type_approval_impact"] == "EXTENSION_REQUIRED":
        problems.append("type-approval extension pending (UN R156 7.1.1.9 / 2018/858 Art.33-34)")
    if market == "CN" and req in ("activate", "restore") and F_RANK[reg["f_class"]] >= 2:
        if not regu.get("cn_filing_id"):
            problems.append("China: OTA filing / change permit id missing (MIIT/SAMR 2025)")
        if not cmd["user_notice"].get("user_confirmation_required"):
            problems.append("China: in-vehicle user confirmation required (GB 44496-2024)")
    if reason == "SAFETY" and req == "deactivate" and F_RANK[reg["f_class"]] >= 2:
        if not (regu.get("recall_campaign_id") or regu.get("containment_justification")):
            problems.append("safety kill needs recall campaign id or documented containment decision")
    add("FFG-PLT-009", not problems, "market/regulatory preconditions met" if not problems else "; ".join(problems))

    # FFG-PLT-010 evidence completeness (incl. SBOM) for widening actions
    ev = cmd["evidence"]
    if req in ("activate", "restore"):
        ok = bool(ev.get("bom_baseline_id")) and bool(ev.get("sbom_ref"))
        add("FFG-PLT-010", ok, "BOM baseline and SBOM referenced" if ok else
            "activate/restore requires bom_baseline_id and sbom_ref")
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("command")
    ap.add_argument("--registry", default=str(DEFAULT_REGISTRY))
    ap.add_argument("--json", action="store_true", help="machine readable output")
    ap.add_argument("--now", help="gate time (ISO 8601), default: current UTC time")
    a = ap.parse_args(argv)
    cmd = json.loads(Path(a.command).read_text(encoding="utf-8"))
    registry = json.loads(Path(a.registry).read_text(encoding="utf-8"))

    errs = schema_errors(cmd)
    if errs:
        result = {"result": "SCHEMA_FAIL", "rule": "FFG-PLT-001", "errors": errs}
        print(json.dumps(result, ensure_ascii=False, indent=1) if a.json else
              "[X] FFG-PLT-001 schema\n" + "\n".join(f"    - {e}" for e in errs))
        return 2

    findings = evaluate(cmd, registry, _ts(a.now) if a.now else None)
    passed = all(f.ok for f in findings)
    if a.json:
        print(json.dumps({"result": "PASS" if passed else "FAIL",
                          "findings": [f.__dict__ for f in findings]}, ensure_ascii=False, indent=1))
    else:
        print("[O] FFG-PLT-001 schema")
        for f in findings:
            print(f"[{'O' if f.ok else 'X'}] {f.rule} {f.message}")
        print("PASS" if passed else "FAIL")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
