# 원소 저글러 (가제)

원소 4개(불·물·바람·번개)를 실시간으로 바꿔 끼우며 반응을 꽂는 탑다운 픽셀아트 액션 로그라이트.
기획서: [`docs/design.md`](docs/design.md)

> 현재 단계: **처음부터 다시 시작** — 빈 공간 가운데에 허수아비 하나만 있어요.
> 이전 버전(지역 1 + 보스 + 성소까지 만든 것)은 커밋 `d47a69a`에 남아 있어요.

## 실행

### 그냥 해보기 (설치 필요 없음)

**`play.html`을 더블클릭**해서 브라우저(크롬·엣지 권장)로 열면 바로 시작돼요.

> `index.html`은 개발 서버용이라 더블클릭으로는 안 켜져요 (브라우저 보안 정책).

### 개발 모드

[Node.js](https://nodejs.org) 설치 후:

```bash
npm install
```

```bash
npm run dev
```

브라우저에서 `http://localhost:5173` 열기. 코드를 고치면 바로 반영돼요.

### 빌드

- `npm run build:play` → `play.html` 다시 만들기 (코드 고친 뒤 실행)
- `npm run build` → 웹 배포용 `dist/`

## 구조

```
src/
  main.ts              게임 설정 (480×270, 창 크기에 맞춰 정수배 확대)
  config.ts            해상도·색
  scenes/PlayScene.ts  빈 공간 + 허수아비
  art/dummy.ts         허수아비 픽셀 그림 (글자 하나 = 픽셀 하나)
art/                   이전 버전 주인공 그림 (지금 코드에선 안 씀)
```
