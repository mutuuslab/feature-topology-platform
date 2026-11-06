---
id: ARC-CLOUD-VM
type: architecture
title: "클라우드 VM 공개 시연 배포 / Cloud VM Public Demo"
status: draft
version: 0.2.0
owner: operations-sre
cycle: 0
standards: [OpenFeature]
traces:
  depends_on: [ARC-UNLEASH-LIVE]
last_updated: 2026-11-06
---

# 클라우드 VM 공개 시연 배포

외부 사람이 브라우저로 들어와 실제 동작(승인·긴급 차단·정책 배포·Unleash 동기화·차량 회신)까지 써 보는 공개 시연 서버다. 2026-11-06 사용자 결정: **클라우드 VM 한 대 + Docker**, 로컬 PC에는 아무것도 설치하지 않는다, 업체는 미정이라 업체 중립으로 준비한다.

고객 운영 설치(한 설치 = 한 고객, OIDC, `FF_SEED=none`)는 [20-91 설치 안내서](20-91-install-guide.md)다. 이 문서는 같은 이미지·같은 공식 Unleash 구성을 **시연 데이터와 공개 데모 게이트**로 띄우는 별도 설치다. 정적 조회용 Cloudflare 데모(쓰기 불가)와도 다르다.

| 산출물 | 위치 |
|---|---|
| 배포 키트 | `FF/deploy/cloud-vm/` — `docker-compose.yml`(기존 `docker/unleash` 구성을 `extends`), `caddy/Caddyfile`, `.env.example`, `cloud-init.yaml`, `scripts/`, `systemd/`, `test/` |
| 서버 게이트 | `FF/backend/src/kernel/auth/demo-gate.ts` · `actor.ts`(가드) · `auth.controller.ts`(`POST /api/auth/demo-login`) |
| 화면 | `FF/frontend/src/auth-demo.ts`(서버 게이트 우선 로그인) — 이미지 변형 `FF_WEB_AUTH=demo` |
| 이미지 게시 | `.github/workflows/app-image.yml` — `cloud-vm` 작업(구성·우회 시험), `publish` 작업(수동 실행 + 승인) |

## 1. 구성

```
 방문자 브라우저 ──https 443──▶ [caddy] 자동 인증서(Let's Encrypt/ZeroSSL)·HSTS·webhook/지표 차단·X-Client-Cert-Subject 제거
 차량(선택 mTLS) ──https 8443─▶    │
                                   ▼  front 네트워크
                               [app] FF 백엔드 + 데모 화면(같은 출처, 9101 — 호스트 포트 없음)
                                   │  FF_ENV=demo · FF_SEED v0.81 · FF_SHOWCASE=1 · FF_AUTH=demo + FF_DEMO_GATE=on · FF_VEHICLE_AUTH=required
                                   ▼  backend 네트워크(internal — 인터넷과 끊김)
                 [db] PostgreSQL 18.3 ─ feature_platform(ff_app) · unleash(unleash_app)
                 [web] 공식 Unleash 8.3.1 ◀── [edge] OSS Edge 20.6.0
```

- 바깥에 여는 포트는 Caddy의 80(인증서 발급·https 이동)과 443뿐이다. DB·Unleash·Edge·FF는 호스트 포트가 없고, DB·Unleash·Edge는 `internal` 네트워크에만 있어 인터넷으로 나가지도 못한다. 차량 mTLS를 켜면 8443이 추가된다(§8.3).
- `db`·`web`·`edge`·`app`은 `docker/unleash/docker-compose.yml`의 서비스를 `extends`로 가져온다 — 고정 이미지 다이제스트·초기화 스크립트·비밀 이름이 그대로다. 공개에 필요한 것만 바꾼다(`ports: !reset []`, 네트워크, 시연 설정). Caddy도 다이제스트로 고정한다.
- FF 컨테이너에는 필요한 값만 넘긴다. PostgreSQL 관리자·Unleash 관리 화면 비밀번호는 넘기지 않는다(`test/compose.test.mjs`가 확인).
- 이미지: `ghcr.io/mutuuslab/feature-platform:<판>-demo`(데모 로그인 화면) — 고객 설치용 `<판>`(OIDC 화면)과 같은 Dockerfile에서 `FF_WEB_AUTH`만 다르다.

## 2. 인증 — 공개 데모 게이트

### 2.1 문제

데모 인증(`FF_AUTH=demo`)은 요청 머리글 `X-Actor-Id`·`X-Actor-Role`을 그대로 믿는다. 화면의 ff/ff 로그인은 브라우저 안의 화면 게이트일 뿐 서버 인증이 아니다. 그대로 인터넷에 열면 **로그인 없이 curl 한 줄로 운영 리더·안전 담당 역할을 주장해 승인·긴급 차단을 쓸 수 있다**(`backend/test/kernel/demo-gate.spec.ts`의 기준 시험이 재현). 운영 모드의 OIDC는 고객 IdP가 있어야 해 외부 방문자 시연에 맞지 않는다.

### 2.2 설계 — 서버 세션 + 데모 계정 표

`FF_DEMO_GATE=on`이면 데모 인증 위에 서버 쪽 관문을 하나 더 둔다.

| 위협 | 막는 방법 |
|---|---|
| 로그인 없이 머리글로 역할 주장 | 모든 API(상태 점검·`/api/auth/*`·조회 전용 OpenFeature 평가 `/ofrep/v1/*` 제외)는 **서버 세션**이 있어야 한다. 세션은 `POST /api/auth/demo-login`(데모 ID·비밀번호, 상수 시간 비교)으로만 생기고, 기존 OIDC와 같은 `auth_session` 표·httpOnly·Secure·SameSite=Lax 서명 쿠키를 쓴다. 없으면 401 |
| 로그인한 사람이 표 밖 신원 주장(SYSTEM·VEHICLE·임의 ID, 계정이 맡지 않은 역할) | 머리글은 **데모 계정 표**(`contracts` `DEMO_PERSONAS`, 행위자 ID `usr-<계정>`) 안의 조합만 받는다. 아니면 403이고 감사 이력에 DENIED로 남는다 |
| 다른 사이트가 방문자 쿠키로 쓰기 요청(CSRF)·강제 로그인·강제 로그아웃 | 쿠키로 오는 변경 요청·로그인·로그아웃은 `Origin`이 `FF_PUBLIC_URL`과 **글자 그대로 같아야** 한다(아니면 403) — `null`·하위 도메인·접미 도메인·다른 포트·http·끝 빗금은 모두 다르다. `FF_CORS_ORIGINS`에 출처가 아닌 값(`null`·`*`·경로)이 있으면 시작하지 않는다. 쿠키는 SameSite=Lax |
| 세션 고정·재사용 | 로그인마다 새 무작위 세션 ID(그 브라우저의 이전 세션은 지운다), 유휴 120분·절대 480분 만료, 로그아웃은 서버 세션 행을 지운다 |
| 비밀번호 대입(비공개 시연으로 바꾼 경우) | 출처 IP별 10분 10회 실패 제한(429) + 전체 요청 한도 `FF_RATE_LIMIT`. Caddy만 믿도록 `FF_TRUST_PROXY=uniquelocal`(바깥 X-Forwarded-For는 Caddy가 버린다 — 바깥에서 값을 바꿔도 같은 출처로 센다). ID·비밀번호는 ASCII 대소문자만 무시한다(유니코드 대문자 변환 `ﬀ→FF`로 맞추지 않는다) |
| 공개 비밀번호로 세션·감사 이력 쌓기(저장소 채우기) | 출처 IP별 10분 창 로그인 성공 60회(`DEMO_LOGIN_LIMIT`)를 넘으면 429 — 한 사무실 NAT 뒤 시연 인원은 넉넉하다 |
| 머리글만으로 차량인 척 회신 | `FF_VEHICLE_AUTH=required` — 차량 CMAC 서명 또는 mTLS 주체가 있어야 한다(게이트 설정 검사가 강제). 시뮬레이터 차량은 설치별 `FF_HSM_VEHICLE_ROOT`로 서명한다 |
| mTLS 주체 머리글 위조 | Caddy 443 사이트가 바깥의 `X-Client-Cert-Subject`를 지운다. 8443 mTLS 사이트만 검증한 인증서 주체로 다시 쓴다 |
| 공개 저장소의 모의 webhook 비밀로 외부 시스템 사칭 | 게이트 설정 검사가 모의 값·빈 값을 거부한다(설치별 무작위). Caddy가 `/api/webhooks`·`/api/ota/v1/events`·`/api/health/metrics`와 그 하위·끝 빗금 경로를 닫는다(Caddy `path`는 정확 일치라 끝 빗금을 따로 적는다, 대소문자는 Caddy가 무시) |
| 지표로 내부 상태 엿보기 | 위의 Caddy 차단에 더해 앱도 게이트에서는 운영 모드처럼 `FF_METRICS_TOKEN`(Bearer)이 없으면 404 — 공개 비밀번호로 세션을 가진 방문자에게 내주지 않는다 |
| 게이트를 끈 채 공개 | 스크립트(`preflight`)가 compose와 같은 규칙(앞뒤 공백·따옴표 제거)으로 읽어 `FF_AUTH`가 정확히 `oidc`가 아니면(백엔드는 그 밖의 값 — `Demo`·`OIDC`·`"demo"` — 을 모두 데모 인증으로 본다) `FF_DEMO_GATE`가 켜져 있어야(on·1·true) 기동한다. `health.sh`는 설정 값과 관계없이 세션 없이 머리글을 붙인 요청이 401인지 매번 본다 |

데모 계정 사이의 역할 전환(작성자 → 승인자 등)은 시연의 기능이라 그대로 둔다 — 같은 비밀번호로 들어온 방문자는 열두 데모 계정 중 어느 것으로도 일할 수 있다. 게이트가 막는 것은 **로그인하지 않은 접근**과 **표 밖 신원**이다. 프록시에서 `X-Actor-*`를 지우는 방식은 화면이 데모 계정을 고르는 데 그 머리글을 쓰므로 택하지 않았고, 서버가 세션과 표로 다시 판정한다.

화면은 로그인할 때 먼저 서버 게이트에 묻는다(`auth-demo.ts` `loginWithServer`). 200이면 서버 판정을 따르고(서버 비밀번호를 바꿔도 동작), 404(게이트 없는 백엔드)·5xx·연결 실패면 지금처럼 브라우저 판정이다. 서버 세션이 끝나면(401) 게이트로 들어온 화면만 로그인 화면으로 돌아간다. 운영 빌드(OIDC)에는 이 모듈이 실리지 않는다(`tools/prod-bundle.test.ts` 통과).

### 2.3 선택 — 회사 계정(OIDC)

초대한 사람만 실명으로 쓰게 하려면 `.env`에서 `FF_AUTH=oidc`, `FF_DEMO_GATE=off`, `-demo`가 없는 이미지 태그, `OIDC_*`를 채운다(IdP 설정은 [20-91 §5](20-91-install-guide.md)). 시연 데이터는 그대로 쓴다. 이때 `FF_ENV=demo`라 세션 쿠키에 Secure가 붙지 않으므로 HSTS(Caddy·앱)로 https만 쓰게 한다 — §11 한계.

## 3. VM 고르기

| 항목 | 값 |
|---|---|
| OS | Ubuntu 24.04 LTS **x86_64**(게시 이미지는 amd64만 — arm64 VM은 쓰지 않는다) |
| 크기 | 최소 2 vCPU·4 GiB(+스왑 2 GiB) · 권장 4 vCPU·8 GiB. 디스크 40~64 GiB |
| 네트워크 | 고정 공인 IP(AWS Elastic IP·Azure Standard Public IP·Hetzner Primary IP·DO Reserved IP) |
| 방화벽(업체 쪽) | 22/tcp는 관리자 IP만, 80/tcp·443/tcp·443/udp는 전체. 그 밖은 닫는다 |
| 첫 부팅 | `FF/deploy/cloud-vm/cloud-init.yaml`을 user data(custom data)로 넣는다 — Docker·ufw(SSH는 `limit`)·자동 보안 업데이트·스왑·fail2ban(저널)·SSH 비밀번호 로그인 끔(`ssh_pwauth: false` + `00-ff-hardening.conf`). 일반 사용자를 docker 그룹에 넣지 않는다(root와 같은 권한 — 스크립트는 `sudo`) |

아래 명령은 각 업체 CLI 기준 요약이다(콘솔에서도 같은 값을 고른다). `<…>`는 바꿀 값이다.

**Azure**
```sh
az group create -n ff-demo -l koreacentral
az vm create -g ff-demo -n ff-demo --image Ubuntu2404 --size Standard_B2ms \
  --admin-username azureuser --ssh-key-values ~/.ssh/id_ed25519.pub \
  --custom-data cloud-init.yaml --public-ip-sku Standard --os-disk-size-gb 64
az vm open-port -g ff-demo -n ff-demo --port 80 --priority 900
az vm open-port -g ff-demo -n ff-demo --port 443 --priority 910
# NSG의 SSH 규칙 출처를 관리자 IP로 좁힌다(포털 → 네트워킹)
```

**AWS**
```sh
aws ec2 create-security-group --group-name ff-demo --description "FF demo"
aws ec2 authorize-security-group-ingress --group-name ff-demo --protocol tcp --port 22 --cidr <관리자IP>/32
aws ec2 authorize-security-group-ingress --group-name ff-demo --protocol tcp --port 80 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-name ff-demo --protocol tcp --port 443 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-name ff-demo --protocol udp --port 443 --cidr 0.0.0.0/0
aws ec2 run-instances --instance-type t3.large --key-name <키 이름> --security-groups ff-demo \
  --image-id resolve:ssm:/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id \
  --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=64,VolumeType=gp3}' \
  --user-data file://cloud-init.yaml
aws ec2 allocate-address   # → associate-address로 인스턴스에 고정 IP
```

**Hetzner Cloud**
```sh
hcloud firewall create --name ff-demo
hcloud firewall add-rule ff-demo --direction in --protocol tcp --port 22 --source-ips <관리자IP>/32
hcloud firewall add-rule ff-demo --direction in --protocol tcp --port 80 --source-ips 0.0.0.0/0 --source-ips ::/0
hcloud firewall add-rule ff-demo --direction in --protocol tcp --port 443 --source-ips 0.0.0.0/0 --source-ips ::/0
hcloud server create --name ff-demo --type <x86 4 vCPU·8 GB 유형> --image ubuntu-24.04 --location <fsn1|nbg1|hel1> \
  --ssh-key <키 이름> --firewall ff-demo --user-data-from-file cloud-init.yaml
```

**DigitalOcean**
```sh
doctl compute droplet create ff-demo --image ubuntu-24-04-x64 --size s-4vcpu-8gb --region sgp1 \
  --ssh-keys <키 ID> --user-data-file cloud-init.yaml --enable-monitoring --wait
doctl compute firewall create --name ff-demo --droplet-ids <드롭릿 ID> \
  --inbound-rules "protocol:tcp,ports:22,address:<관리자IP>/32 protocol:tcp,ports:80,address:0.0.0.0/0 protocol:tcp,ports:443,address:0.0.0.0/0" \
  --outbound-rules "protocol:tcp,ports:all,address:0.0.0.0/0 protocol:udp,ports:all,address:0.0.0.0/0"
```

첫 부팅이 끝났는지는 `ssh <사용자>@<IP> cloud-init status --wait`로 본다.

## 4. 설치 순서

0. **이름 정하기** — 도메인이 있으면 `ff.<도메인>`의 A 레코드를 VM 공인 IP로 둔다(설치 전에). 도메인이 없으면 `<IP의 .을 -로>.sslip.io`(예: `203-0-113-10.sslip.io`)를 쓴다 — DNS 설정 없이 그 IP로 풀리고 인증서도 받는다.
1. **키트 받기**(VM 안에서)
   ```sh
   sudo git clone --depth 1 --branch <배포할 브랜치·태그> https://github.com/mutuuslab/feature-topology-platform.git /opt/ff
   ```
   저장소가 비공개면 읽기 전용 fine-grained 토큰으로 받거나, 저장소가 있는 곳에서 키트만 묶어 올린다:
   `git archive --format=tar.gz -o ff-cloud-kit.tgz HEAD FF/deploy/cloud-vm FF/docker/unleash` → `scp` → `sudo tar -C /opt/ff -xzf ff-cloud-kit.tgz`.
2. **비밀 만들기**
   ```sh
   cd /opt/ff/FF/deploy/cloud-vm
   sudo bash scripts/gen-secrets.sh --domain ff.example.com --email ops@example.com   # 또는 --ip 203.0.113.10
   ```
   `.env`(권한 600)의 사본을 비밀 보관소에 따로 둔다(§5).
3. **이미지 접근** — ghcr 패키지가 비공개면 `read:packages` 토큰으로 `echo <토큰> | sudo docker login ghcr.io -u <GitHub 사용자> --password-stdin`. `.env`의 `FF_IMAGE`를 게시한 태그(예: `ghcr.io/mutuuslab/feature-platform:v0.1.0-demo`)로 맞춘다. 레지스트리 없이 하려면 `sudo FF_BUILD_LOCAL=1 bash scripts/install.sh`(VM에서 빌드, 전체 저장소 필요).
4. **설치** — `sudo bash scripts/install.sh`. 이미지 받기 → 기동 → 공개 주소 준비 점검(첫 기동은 시연 데이터 생성으로 수 분) → 부팅 서비스 `ff-platform`·일일 백업 타이머 `ff-backup.timer` 등록 → `health.sh`.
5. **바깥 사람처럼 시험** — `sudo FF_SMOKE_HOST=1 bash test/gate-smoke.sh https://ff.example.com`(52+6항목, §10 — 마지막의 실패 제한 시험 때문에 실행한 출처 IP는 10분 동안 데모 로그인이 막힌다. 내 PC에서 돌리면 `FF_SMOKE_THROTTLE=0`). 비밀번호를 바꿨으면 `FF_SMOKE_ID`·`FF_SMOKE_PW`.
6. 브라우저로 `https://ff.example.com` → ff/ff.

## 5. 비밀

`scripts/gen-secrets.sh`가 `.env.example`의 빈 값을 새 무작위 값으로 채운다. 이미 `.env`가 있으면 덮어쓰지 않고, 값을 화면에 찍지 않는다. user data(cloud-init)·저장소·채팅에 비밀을 넣지 않는다.

| 값 | 쓰임 | 잃으면 |
|---|---|---|
| `FF_KEK` | 서명 개인키·차량 루트를 DB 안에서 봉인 | 백업을 복원해도 봉인 키를 열 수 없다 — **DB 백업과 다른 곳**에 보관 |
| `FF_AUDIT_KEY` | 감사 체인 고정점 서명 | 이전 고정점 검증이 깨진다 |
| `FF_SESSION_SECRET` | 게이트 세션 쿠키 서명 | 모든 방문자 다시 로그인(바꾸면 즉시 전원 로그아웃) |
| `FF_HSM_VEHICLE_ROOT` | 시연 차량 CMAC 키 루트 | 시뮬레이터 차량 키가 바뀐다 |
| `PG_ADMIN_PASSWORD`·`FF_DB_PASSWORD`·`UNLEASH_DB_PASSWORD` | PostgreSQL 관리자·두 DB 로그인(64자 16진수) | DB 볼륨을 새로 만들 때만 쓰인다 — 볼륨과 짝 |
| `UNLEASH_ADMIN_TOKEN`·`UNLEASH_EDGE_*_TOKEN`·`UNLEASH_ADMIN_PASSWORD` | FF↔Unleash·Edge, Unleash 관리 화면 | Unleash DB 첫 생성 때 심는다 — 볼륨과 짝 |
| `*_WEBHOOK_*` | 내부 모의 연계 서명(공개 모의 값 금지) | 다시 만들면 된다 |
| `FF_DEMO_PASSWORD`(선택) | 비공개 시연 비밀번호 | 비우면 공개 데모 ff/ff |

## 6. 백업·복원

- `scripts/backup.sh` — `pg_dump`(custom 형식)로 `feature_platform`·`unleash` 두 DB, 역할 정의(비밀번호 제외), FF 파일 볼륨(증거·감사 고정점)을 `BACKUP_DIR/ff-cloud-<UTC 시각>/`에 쓰고 `SHA256SUMS`·`manifest.txt`(설치 식별·이미지)를 남긴다. `ff-backup.timer`가 매일 03:30(±15분) 실행, **보존 7일**(`BACKUP_KEEP_DAYS`).
- 권한·암호화 — 백업 폴더는 700, 파일은 600(root만). 덤프에는 감사 이력과 KEK로 봉인된 키가 들어 있다(KEK는 넣지 않는다).
- 바깥 저장소 — `BACKUP_RCLONE_REMOTE`를 주면 rclone으로 같은 폴더를 올리고 같은 일수로 정리한다. S3·Azure Blob·Backblaze B2·Hetzner Storage Box 등 rclone이 아는 곳이면 된다. **rclone crypt 원격(클라이언트 쪽 암호화)이어야 올린다** — `sudo rclone config`로 저장소 원격(예: `s3remote:ff-backups`)을 만들고, 그 위에 crypt 원격(예: `ffcrypt`, remote=`s3remote:ff-backups`, 비밀번호는 비밀 보관소에)을 만들어 `BACKUP_RCLONE_REMOTE=ffcrypt:`로 적는다. crypt가 아니면 `backup.sh`가 업로드를 거부한다(로컬 백업은 남는다). 업체 쪽 암호화·비공개 버킷을 따로 확인했으면 `BACKUP_RCLONE_PLAINTEXT=1`.
- `scripts/restore.sh <백업 폴더> --yes` — 체크섬·설치 식별을 확인하고, 지금 상태를 한 번 더 백업한 뒤, FF·Unleash·Edge를 멈추고 두 DB를 지웠다가 소유자(`ff_app`·`unleash_app`)로 복원하고 파일 볼륨을 되돌린 다음 다시 띄워 준비 점검·상태 점검을 한다. **같은 `.env`(같은 KEK)**여야 한다.
- 복원 훈련은 한 달에 한 번 — `restore.sh` 뒤 감사 체인(`GET /api/audit/chain`, 감사 조회 계정)이 `ok:true`인지 본다.

## 7. 업데이트·되돌리기·이미지

- 태그는 고정한다. `latest`는 스크립트가 거부한다. 다이제스트(`@sha256:`)도 받는다. `install.sh`·`update.sh`는 받은 태그를 **레지스트리 다이제스트로 묶어** `.env`에 적는다(`…:v0.1.0-demo@sha256:…`) — 같은 태그가 레지스트리에서 바뀌어도 이 설치·부팅 서비스·되돌리기는 같은 내용을 쓴다.
- 서명 — 게시 작업이 cosign keyless(이 워크플로의 GitHub OIDC 신원)로 다이제스트에 서명한다. VM에 cosign을 설치하고 `.env`에 `FF_IMAGE_SIGNER`(신원 정규식, 예: `https://github.com/mutuuslab/feature-topology-platform/.github/workflows/app-image.yml@refs/heads/.*`)를 적으면 `install.sh`·`update.sh`가 `cosign verify`를 통과한 이미지만 쓴다. 손으로 확인: `cosign verify --certificate-identity-regexp '<위 정규식>' --certificate-oidc-issuer https://token.actions.githubusercontent.com ghcr.io/mutuuslab/feature-platform@sha256:<다이제스트>`.
- `sudo bash scripts/update.sh ghcr.io/mutuuslab/feature-platform:v0.1.1-demo` — 업데이트 전 백업 → 새 이미지 받기 → FF만 교체 → 준비 점검·상태 점검. 실패하면 **이전 태그로 자동 복귀**한다. 준비 점검을 통과한 판만 `state/image-history`에 남는다.
- `sudo bash scripts/update.sh --rollback` — 기록에서 지금 판이 아닌 마지막 판으로. DB 마이그레이션은 앞으로만 가므로, 새 판이 DB를 바꾼 뒤라면 업데이트 전 백업으로 `restore.sh`가 필요할 수 있다.
- Unleash·Edge·PostgreSQL 판은 `docker/unleash/docker-compose.yml`의 다이제스트가 정한다(키트를 새 판으로 받고 `install.sh`).
- **게시** — GitHub Actions `App image`를 Actions 화면에서 수동 실행(`publish`=true, `version`=`v0.1.0`)한다. 빌드·운영 모드 준비 점검·클라우드 VM 구성 시험(인증 우회 포함)을 통과한 뒤 `publish` 작업이 환경 `image-publish`의 **승인자 승인**을 기다린다. 승인하면 `v0.1.0`(고객 설치·OIDC 화면)과 `v0.1.0-demo`(공개 시연) 두 태그와 `sha-<커밋>` 태그를 올리고, 같은 판 번호는 다시 올리지 않는다. 다이제스트는 실행 요약에 남는다. 푸시·PR에서는 올리지 않는다.

## 8. 운영

### 8.1 상태 점검
`scripts/health.sh` — 다섯 컨테이너 health, Unleash `/health`(내부), 공개 `/api/health/ready`, 게이트(세션 없이 머리글을 붙여도 401). 바깥 감시(업타임 서비스)는 `https://<이름>/api/health/ready`를 1~5분마다 부른다.

### 8.2 시연 초기화
방문자가 바꾼 데이터는 모두에게 보인다. `sudo bash scripts/reset-demo.sh --yes` — 백업을 남기고 DB·FF 볼륨을 지운 뒤 처음 시연 데이터로 다시 만든다(비밀·인증서 유지). 공개 행사 전후·주 1회를 권한다.

### 8.3 차량 mTLS(선택)
기본 차량 경로는 443의 CMAC 서명이다. 차량 인증서로 받으려면 차량 CA를 `caddy/vehicle-ca.pem`에 두고 `.env`에 `FF_COMPOSE_EXTRA=-f compose.vehicle-mtls.yml`을 적은 뒤 `sudo bash scripts/install.sh`를 다시 실행한다(부팅 서비스·update·health도 같은 구성). 8443을 업체 방화벽과 ufw(`sudo ufw allow 8443/tcp`)에서 연다. Caddy가 인증서를 검증하고 주체를 `X-Client-Cert-Subject`로 넘기며, 백엔드는 신뢰 프록시에서 온 이 머리글만 믿는다([80-40](../80-integration/80-40-vehicle-channel.md) §2.5).

### 8.4 Unleash 관리 화면
인터넷에 열지 않는다. 볼 때만 `compose.admin-tunnel.yml`(파일 머리 주석의 명령)로 VM 루프백 4242에 붙이고 내 PC에서 `ssh -L 4242:127.0.0.1:4242 <사용자>@<VM>` → `http://127.0.0.1:4242`(admin / `UNLEASH_ADMIN_PASSWORD`). 정책은 FF가 원천이라 Unleash에서 바꾸지 않는다([20-98](20-98-unleash-live-runtime.md)). 보고 나서 덧붙임 없이 `install.sh`로 다시 올린다.

## 9. 비용 대략

2026-11 기준 공개 가격표의 대략값이다(월, 세금·트래픽 초과 제외). 실제 금액은 업체 계산기로 확인한다.

| 업체 | 권장 크기 예 | 월 대략 |
|---|---|---|
| Hetzner Cloud | x86 4 vCPU·8 GB | €8~€16 |
| DigitalOcean | s-4vcpu-8gb(최소 s-2vcpu-4gb) | $48(최소 $24) |
| AWS(서울) | t3.large 2 vCPU·8 GB + gp3 64 GB + 고정 IP | $70~$90 |
| Azure(한국 중부) | Standard_B2ms 2 vCPU·8 GB + 디스크 + 고정 IP | $70~$90 |

도메인은 선택(연 $10~$20). sslip.io 이름과 인증서는 무료다. 바깥 백업 저장소는 수 GB라 월 $1 안팎이다.

## 10. 보안 점검표

| 확인 | 방법 |
|---|---|
| 업체 방화벽 — 22는 관리자 IP만, 80·443만 전체 | 업체 콘솔. VM 안 ufw는 cloud-init이 같은 규칙. Docker가 연 포트는 ufw를 거치지 않으므로 compose가 Caddy 말고는 호스트 포트를 열지 않는다 |
| SSH 키만, 비밀번호 로그인 끔, fail2ban | cloud-init(`ssh_pwauth: false`, `/etc/ssh/sshd_config.d/00-ff-hardening.conf` — sshd는 같은 키의 첫 값을 쓰므로 `50-cloud-init.conf`보다 앞 이름). 확인: `sudo sshd -T | grep -Ei 'passwordauth|permitroot'`, `sudo fail2ban-client status sshd` |
| 게이트 켜짐·우회 불가 | `test/gate-smoke.sh` 52항목 통과(세션 없음 401, 표 밖 신원·머리글 변형(중복·쉼표·대소문자·닮은 글자) 403, CSRF 출처 변형(null·하위·접미 도메인·포트·http·끝 빗금) 403, 쿠키 속성, 세션 고정, 차량·mTLS 사칭 401, webhook·OTA·지표(대소문자·끝 빗금) 404, 로그아웃 후 401, X-Forwarded-For 위조로 실패 제한 우회 불가, HSTS) |
| 내부 포트가 호스트에 없다 | `FF_SMOKE_HOST=1 test/gate-smoke.sh …` — 5432·5543·4242·3063·9101·9171 닫힘 |
| `.env` 600·사본은 비밀 보관소·KEK는 백업과 따로 | `ls -l .env`, 보관소 기록 |
| 이미지 태그 고정 | `.env`의 `FF_IMAGE`(스크립트가 `latest` 거부) |
| 자동 보안 업데이트 | `systemctl status unattended-upgrades`, 새벽 04:30 재부팅 허용 |
| 백업 동작·바깥 저장소·복원 훈련 | `systemctl list-timers ff-backup.timer`, `ls $BACKUP_DIR`, §6 |
| 인증서 유효·HSTS | 브라우저 자물쇠, `curl -sI https://<이름> | grep -i strict` |
| 실제 고객 데이터 금지 | 시연 설치(`FF_ENV=demo`)에는 시연 데이터만 넣는다 — 운영 모드 검사(KEK 필수·데모 데이터 거부 등)가 꺼져 있다 |
| 비공개 시연이면 비밀번호 바꾸기 | `FF_DEMO_PASSWORD`, 따로 알리기(실패 제한 10분 10회) |

## 11. 검증 기록과 한계

2026-11-06 로컬 Docker(Windows Docker Desktop 29.1.5)에서 한 번 띄워 확인하고 컨테이너·볼륨·시험 이미지를 지웠다(상시 서비스 아님).

- `docker compose config` — extends 결과: 호스트 포트는 Caddy만, DB·Unleash·Edge는 internal 망, 기존 고정 다이제스트 유지(`node --test deploy/cloud-vm/test/compose.test.mjs` 7/7 — 비밀 생성, 공개 전 확인이 게이트 끈 설정·`latest`를 거부함 포함).
- 2026-11-06 하네스 2판(적대적 리뷰, Docker 꺼진 상태): 실제 Caddy 2.10.2(Windows 바이너리, 체크섬 확인)를 로컬 백엔드(게이트 켬) 앞에 두고 `gate-smoke.sh` 51항목(http라 HSTS 제외) 중 50 통과 — 실패 1은 화면 번들 없이 띄운 로컬 백엔드의 `/`(404). 고치기 전 Caddy 정확 경로 `/api/health/metrics`는 끝 빗금 `/api/health/metrics/`를 앱으로 넘겼고, 앱은 로그인한 방문자에게 지표를 200으로 줬다(`demo-gate.spec.ts` 재현). `compose.test.mjs` 15/15, `demo-gate.spec.ts` 28/28.
- shellcheck(koalaman/shellcheck:stable) `-x scripts/*.sh test/*.sh` 경고 0.
- `install.sh`(`FF_BUILD_LOCAL=1`, `localhost:9178` 내부 CA) — 준비 점검 80초, health 8항목 정상. 시연 데이터: 차량 480대, Feature 170, Feature DB 1,052행, DEPLOYED 정책 5건, Unleash live 8.3.1 `OK`·drift 0, 마이그레이션 55개(PostgreSQL).
- `test/gate-smoke.sh` 25/25 통과. 브라우저(Playwright)로 /login → ff/ff → 홈, 세션 쿠키 httpOnly·Secure·SameSite=Lax, API 21건 중 401·403 없음.
- `backup.sh` → `restore.sh` → 감사 체인 `ok:true`(1,310건)·차량 480대·Unleash `OK`. `update.sh` 성공·고장 이미지 자동 복귀·`--rollback` 확인.
- 백엔드 `demo-gate.spec.ts` 18/18, 관련 기존 시험(oidc·production-mode·env-example 등 8묶음 77건) 통과, 프런트 `authDemoGate`·`screensLogin` 통과, 운영 번들 검사(`prod-bundle.test.ts`) 통과.

한계:
- 실제 클라우드 VM·인증서 발급(Let's Encrypt)·ghcr 게시·Actions의 `cloud-vm`/`publish` 작업(cosign 서명 포함)은 아직 실행하지 않았다(계정 없음). 첫 VM에서 §4·§10을 그대로 한 번 돌려 확인한다.
- 조회 전용 OpenFeature 평가(`/ofrep/v1/evaluate/*`)는 SDK 창구라 세션 없이 열려 있다(운영 OIDC 설치와 같다) — 시연 Feature의 평가 값이 공개된다.
- Docker가 IPv6 연결을 userland-proxy로 받으면 Caddy가 보는 출처가 docker 게이트웨이 주소 하나가 되어, IPv6 방문자끼리 로그인 실패 제한을 함께 쓴다. 첫 VM에서 `docker compose logs caddy`의 `remote_ip`로 확인한다.
- 세션 쿠키 이름은 `ff_session`(Domain 없음)이다. `__Host-` 접두어가 아니라, sslip.io처럼 남도 하위 이름을 쓰는 상위 도메인이 공개 접미사 목록(PSL)에 없으면 형제 이름이 상위 도메인 쿠키로 덮어쓸 수 있다(서명이 없으면 세션이 아니므로 사칭은 안 된다) — 도메인을 쓰면 없어진다.
- 시연 설치는 운영 모드가 아니다(`FF_ENV=demo`) — 운영 모드 전용 검사가 꺼져 있다. 공개 범위 방어는 게이트·프록시·네트워크가 맡는다. OIDC 선택(§2.3)은 쿠키 Secure가 없다(HSTS로 완화).
- 같은 비밀번호로 들어온 방문자는 열두 데모 계정 모두로 일할 수 있고 데이터를 서로 본다(시연 설계). 정기 초기화(§8.2)로 관리한다.
- VM 한 대 — 가용성 이중화가 없다. 바깥 백업 저장소를 설정하지 않으면 백업이 같은 VM에만 있다.
- 게시 이미지는 amd64만이다(arm64 VM 불가).
- 2 vCPU VM의 첫 기동 시간은 측정하지 않았다(로컬 개발 PC 80초). `FF_SYNTHETIC`를 키우면 크게 늘어난다(20-98).
