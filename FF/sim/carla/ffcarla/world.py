"""CARLA 0.9.16 구동 — 차량 동역학·센서만 맡는다. 판정은 run.ValidationRun이 한다.

- 검증 전용 서버(기본 127.0.0.1:2100)에 붙는다. FF가 만들지 않은 차량이 있으면 공유 월드로 보고 거부한다
  (LearnCarla 공유 서버 2000의 교통을 멈추게 하지 않는다 — 동기 모드는 월드 전체를 멈춘다).
- 동기 모드 20 Hz(물리 substep 0.01 s), 렌더 끔, Traffic Manager 쓰지 않음(포트 8000 계열 무관).
- Town04 고속도로: 시작점마다 가장 곧게 이어지는 차선을 따라가 가장 긴 경로를 고른다(결정적).
- 두 차량 모두 PythonAPI PIDLateralController로 차로를 유지한다. 종방향은 PI 속도 제어(적분 포화 방지) — 선행차는 80 km/h,
  자차는 기능 명령 속도를 따른다(기본 PID는 km/h 오차당 이득이라 사실상 on/off 제동이 되어 기능이 요구하지 않은 급감속을 낸다).
- 자차 감속은 0.5 s 이동 평균(변속·노면 순간값 제외)으로 잰다 — 기준 '최대 감속'은 차량이 실제로 겪는 감속이다.
- 실제 간격 = 경로 위 진행 거리 차 − 두 차량 반길이(범퍼 사이), 독립 기준 측정 = 자차 전방 레이더(정지물 반사 제외).
- CARLA recorder로 주행 전체를 남긴다 — client.replay_file로 같은 주행을 다시 볼 수 있다(재현 근거).
"""
from __future__ import annotations

import math
import os
import socket
import sys
from dataclasses import dataclass

CARLA_HOME = os.environ.get('CARLA_HOME', r'C:/project/2026-10-17_Carlra/sandbox/CARLA_0.9.16')
sys.path.insert(0, os.path.join(CARLA_HOME, 'PythonAPI', 'carla'))

import carla  # noqa: E402
from agents.navigation.controller import PIDLateralController  # noqa: E402

MAP = 'Town04'
STEP_S = 0.05
PREROLL_S = 20.0  # t=0 전에 두 차량을 80 km/h·목표 간격 정상 추종 상태로 만든다(판정에 넣지 않음)
ROLE_EGO, ROLE_LEAD = 'ff-ego', 'ff-lead'
EGO_BP, LEAD_BP = 'vehicle.lincoln.mkz_2020', 'vehicle.tesla.model3'
RADAR_AZ_DEG = 10.0  # 곡선 구간에서도 앞차가 빔 안에 남게
ACCEL_FILTER_S = 0.5
LATERAL = dict(K_P=1.95, K_I=0.05, K_D=0.2, dt=STEP_S)
MAX_STEER = 0.8


TAU_S = 0.6  # 차량 종방향 응답: 기능 명령 속도를 1차 지연으로 따른다(FF_IMP 차량 모델·이전 기준 루프와 같음)


class Longitudinal:
    """차량 종방향 — 명령 속도 → 1차 지연 기준 속도(τ 0.6 s, −9..4 m/s²) → PI 추종 + 앞먹임.
    출력 > 0 가속 페달, < 0 제동(적분은 포화 범위 안에서만 쌓는다)."""

    def __init__(self, kp=0.30, ki=0.06, kff=0.12, max_throttle=0.75, max_brake=0.6):
        self.kp, self.ki, self.kff, self.mt, self.mb = kp, ki, kff, max_throttle, max_brake
        self.i = 0.0
        self.ref = None

    def control(self, cmd_mps: float, v: float, steer: float):
        if self.ref is None:
            self.ref = v
        a_ref = max(-9.0, min(4.0, (cmd_mps - self.ref) / TAU_S))
        self.ref = max(0.0, self.ref + a_ref * STEP_S)
        target_mps = self.ref
        e = target_mps - v
        ff = a_ref
        u = self.kp * e + self.ki * self.i + self.kff * ff
        if -self.mb < u < self.mt:
            self.i = max(-20.0, min(20.0, self.i + e * STEP_S))
        c = carla.VehicleControl(steer=steer)
        if u >= 0:
            c.throttle, c.brake = min(u, self.mt), 0.0
        else:
            c.throttle, c.brake = 0.0, min(-u, self.mb)
        return c


class NotDedicated(RuntimeError):
    """FF 검증 전용 서버가 아니다 — 다른 클라이언트의 차량이 있다."""


def connect(host: str, port: int, timeout: float = 30.0):
    # 포트가 닫혀 있으면 carla.Client는 timeout 끝까지 기다린다 — TCP로 먼저 1초 안에 확인한다
    try:
        socket.create_connection((host, port), 1.0).close()
    except OSError as e:
        raise RuntimeError(f'{host}:{port}에 연결할 수 없습니다 ({e.strerror or e})') from e
    c = carla.Client(host, port)
    c.set_timeout(timeout)
    return c, c.get_server_version()


def probe(client) -> dict:
    w = client.get_world()
    vs = list(w.get_actors().filter('vehicle.*'))
    return dict(server=client.get_server_version(), client=client.get_client_version(), map=w.get_map().name.split('/')[-1],
                synchronous=w.get_settings().synchronous_mode, vehicles=len(vs),
                foreignVehicles=sum(1 for v in vs if not v.attributes.get('role_name', '').startswith('ff-')))


def _heading(a, b) -> float:
    return abs((a.transform.rotation.yaw - b.transform.rotation.yaw + 180) % 360 - 180)


@dataclass
class Route:
    points: list  # carla.Location, 1 m 간격
    cum: list     # 누적 거리 (m)
    wps: list     # carla.Waypoint
    start: object

    def project(self, loc, hint: int) -> tuple[int, float]:
        """경로 위 진행 거리 — hint 근처 선분에 수직 투영."""
        best_i, best_d = hint, 1e18
        lo, hi = max(0, hint - 10), min(len(self.points) - 1, hint + 60)
        for i in range(lo, hi):
            d = self.points[i].distance(loc)
            if d < best_d:
                best_i, best_d = i, d
        i = min(best_i, len(self.points) - 2)
        a, b = self.points[i], self.points[i + 1]
        ab = carla.Vector3D(b.x - a.x, b.y - a.y, 0)
        n = math.hypot(ab.x, ab.y) or 1.0
        u = ((loc.x - a.x) * ab.x + (loc.y - a.y) * ab.y) / n
        return best_i, self.cum[i] + max(0.0, min(n, u))


def build_route(world, need_m: float) -> Route:
    m = world.get_map()
    best = None
    for i, sp in enumerate(m.get_spawn_points()):
        wp = m.get_waypoint(sp.location)
        path = [wp]
        for _ in range(int(need_m * 1.5) + 200):
            nx = wp.next(1.0)
            if not nx:
                break
            nxt = min(nx, key=lambda n: _heading(n, wp))  # 갈림길에서는 가장 곧게 이어지는 차선
            if _heading(nxt, wp) > 4:
                break
            wp = nxt
            path.append(wp)
        if best is None or len(path) > len(best[1]):
            best = (sp, path)
    sp, path = best
    if len(path) < need_m:
        raise RuntimeError(f'{MAP}에서 {need_m:.0f} m 경로를 찾지 못했습니다 (최장 {len(path)} m)')
    pts = [p.transform.location for p in path]
    cum = [0.0]
    for a, b in zip(pts, pts[1:]):
        cum.append(cum[-1] + a.distance(b))
    return Route(points=pts, cum=cum, wps=path, start=sp.location)


class World:
    """한 서버 연결 동안 유지 — 맵·경로는 한 번만 만든다."""

    TAU_S = TAU_S
    ACCEL_FILTER_S = ACCEL_FILTER_S

    def __init__(self, client, need_m: float):
        self.client = client
        w = client.get_world()
        if not w.get_map().name.endswith(MAP):
            w = client.load_world(MAP)
        self.world = w
        foreign = [v for v in w.get_actors().filter('vehicle.*') if not v.attributes.get('role_name', '').startswith('ff-')]
        if foreign:
            raise NotDedicated(f'FF가 만들지 않은 차량 {len(foreign)}대가 있는 월드입니다 — 검증 전용 서버(CARLA_PORT)를 쓰세요')
        self.cleanup()
        self._sync(True)
        self.route = build_route(w, need_m)

    def _sync(self, on: bool):
        s = self.world.get_settings()
        s.synchronous_mode = on
        s.fixed_delta_seconds = STEP_S if on else None
        s.no_rendering_mode = on
        s.substepping = True
        s.max_substep_delta_time = 0.01
        s.max_substeps = 10
        self.world.apply_settings(s)

    def cleanup(self):
        for a in list(self.world.get_actors().filter('sensor.*')) + list(self.world.get_actors().filter('vehicle.*')):
            if a.type_id.startswith('sensor.') or a.attributes.get('role_name', '').startswith('ff-'):
                a.destroy()

    def close(self):
        self.cleanup()
        self._sync(False)

    def drive(self, run, recorder_path: str | None, seed: int = 0) -> dict:
        """시나리오 한 건 — run.step을 20 Hz로 부른다. 반환: 시작 상태·경로 정보."""
        w, R, sc = self.world, self.route, run.sc
        bp = w.get_blueprint_library()
        lead_v = sc['lead_kph'] / 3.6

        def spawn(name, role, idx):
            b = bp.find(name)
            b.set_attribute('role_name', role)
            tf = R.wps[idx].transform
            return w.spawn_actor(b, carla.Transform(tf.location + carla.Location(z=0.5), tf.rotation))

        ego = spawn(EGO_BP, ROLE_EGO, 5)
        ext_e = ego.bounding_box.extent.x
        lead = spawn(LEAD_BP, ROLE_LEAD, 5 + int(round(sc['target_gap_m'] + ext_e + 2.5)))
        ext_l = lead.bounding_box.extent.x
        rb = bp.find('sensor.other.radar')
        for k, v in (('horizontal_fov', str(2 * RADAR_AZ_DEG + 4)), ('vertical_fov', '4'), ('range', '150'), ('points_per_second', '4000')):
            rb.set_attribute(k, v)
        mount = 0.3
        radar = w.spawn_actor(rb, carla.Transform(carla.Location(x=ext_e + mount, z=0.7)), attach_to=ego)
        last = {'ref': None, 'frame': -1}
        ego_speed = {'v': 0.0}

        def on_radar(d):
            # 정지물(노면·가드레일)은 상대 속도 ≈ −자차 속도 — 움직이는 물체의 반사만 앞차로 본다
            cand = [x.depth for x in d if abs(math.degrees(x.azimuth)) < RADAR_AZ_DEG and abs(x.velocity + ego_speed['v']) > 2.0]
            last['ref'] = (min(cand) + mount) if cand else None
            last['frame'] = d.frame

        radar.listen(on_radar)
        le, ll = PIDLateralController(ego, offset=0, **LATERAL), PIDLateralController(lead, offset=0, **LATERAL)
        ge, gl = Longitudinal(), Longitudinal()

        def ctl(actor, lat, lon, target_mps, v, wp):
            steer = max(-MAX_STEER, min(MAX_STEER, lat.run_step(wp)))
            actor.apply_control(lon.control(target_mps, v, steer))

        ie = il = 0
        fwd = lambda a: a.get_transform().get_forward_vector()
        speed = lambda a: max(0.0, a.get_velocity().dot(fwd(a)))

        def target(i, v):
            return R.wps[min(i + max(8, int(v * 0.6)), len(R.wps) - 1)]

        try:
            w.tick()
            for a in (ego, lead):
                a.set_target_velocity(fwd(a) * lead_v)
            # 준비 주행 — 선행차 정속, 자차는 목표 간격으로 모이는 속도(판정 밖)
            for _ in range(int(PREROLL_S / STEP_S)):
                ie, se = R.project(ego.get_location(), ie)
                il, sl = R.project(lead.get_location(), il)
                gap0 = sl - se - ext_e - ext_l
                ve, vl = speed(ego), speed(lead)
                ctl(ego, le, ge, lead_v + max(-2.0, min(2.0, 0.3 * (gap0 - sc['target_gap_m']))), ve, target(ie, ve))
                ctl(lead, ll, gl, lead_v, vl, target(il, vl))
                w.tick()
            if recorder_path:
                self.client.start_recorder(recorder_path, True)
            v_prev = speed(ego)
            hist = []
            ie, se = R.project(ego.get_location(), ie)
            il, sl = R.project(lead.get_location(), il)
            start = dict(gap_m=round(sl - se - ext_e - ext_l, 2), ego_kph=round(v_prev * 3.6, 2), lead_kph=round(speed(lead) * 3.6, 2))
            lat_max = 0.0
            while not run.done:
                ie, se = R.project(ego.get_location(), ie)
                il, sl = R.project(lead.get_location(), il)
                if il >= len(R.wps) - 70:
                    raise RuntimeError('경로 끝에 닿았습니다 — 시나리오가 경로보다 깁니다')
                ve, vl = speed(ego), speed(lead)
                ego_speed['v'] = ve
                hist.append((ve - v_prev) / STEP_S)
                hist = hist[-int(round(ACCEL_FILTER_S / STEP_S)):]
                a = sum(hist) / len(hist)
                v_prev = ve
                gap = sl - se - ext_e - ext_l
                cmd = run.step(STEP_S, gap, ve, vl, a, last['ref'])
                ctl(ego, le, ge, cmd, ve, target(ie, ve))
                ctl(lead, ll, gl, lead_v, vl, target(il, vl))
                lat_max = max(lat_max, ego.get_location().distance(R.wps[ie].transform.location) - 0.5)
                w.tick()
            return dict(start=start, map=MAP, routeStart=dict(x=round(R.start.x, 2), y=round(R.start.y, 2)), routeLengthM=round(R.cum[-1]),
                        egoBlueprint=EGO_BP, leadBlueprint=LEAD_BP, stepS=STEP_S, prerollS=PREROLL_S, accelFilterS=ACCEL_FILTER_S, seed=seed, maxLateralDevM=round(max(0.0, lat_max), 2))
        finally:
            if recorder_path:
                self.client.stop_recorder()
            radar.stop()
            for a in (radar, ego, lead):
                if a.is_alive:
                    a.destroy()
            w.tick()
