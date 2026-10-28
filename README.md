# 식자재 장부

산후조리원 식자재 유통 업무(주문 받기 → 프레시원 발주 → 외부 구매 → 명세서 → 정산)를 윈도우 PC에서 처리하는 프로그램.

## 구성

| 경로 | 내용 |
|---|---|
| `src/main.js` | Electron 메인: 창, 저장, 인쇄/PDF, 자동 업데이트, 로그 |
| `src/store.js` | 데이터 파일 저장(원자적 쓰기, 30일 자동 백업, 업데이트 전 백업, 깨진 파일 복구) |
| `src/freshone.js` | 프레시원 장바구니 자동 입력 (윈도우 기본 Edge 사용) |
| `src/preload.js` | 화면 ↔ 메인 연결 (보안 격리) |
| `renderer/` | 화면 (HTML/CSS/JS, 빌드 도구 없음) |
| `test/` | 저장소 테스트, 화면 스모크 테스트 |

데이터 위치: `%APPDATA%\식자재 장부\data.json`, 자동 백업은 같은 폴더의 `backups\`. 문제 기록은 `%APPDATA%\식자재 장부\logs\main.log`.

## 개발

```bash
nvm use            # Node 22
npm ci             # package-lock.json 그대로 설치
npm start          # 실행
npm test           # 문법 검사 + 테스트
```

## 새 버전 내보내기 (아버지 PC에 자동 업데이트)

```bash
npm version patch      # 0.1.0 → 0.1.1 (package.json + git 태그)
git push --follow-tags # GitHub Actions가 윈도우 설치파일을 만들어 Releases에 올림
```

설치된 프로그램은 켤 때와 4시간마다 새 버전을 확인하고, 뒤에서 받아 두었다가 **프로그램을 끌 때 설치**한다. 업데이트 직전 데이터는 `backups\before-v새버전-from-v옛버전.json`으로 자동 보관된다.

## 버전 문제 막는 규칙

1. **의존성은 정확한 버전으로 고정** (`.npmrc`의 `save-exact`). `^`, `~` 쓰지 않는다. 설치는 항상 `npm ci`.
2. **package-lock.json은 반드시 커밋.**
3. Node 버전은 `.nvmrc`(22)와 `engines`로 고정. CI도 같은 값을 읽는다.
4. **데이터 구조를 바꿀 때**는 `renderer/app.js`의 `SCHEMA`를 1 올리고 `MIGRATIONS`에 변환 함수를 추가한다. 예전 변환은 지우지 않는다. 더 새 버전이 만든 데이터를 옛 프로그램이 열면 읽기 전용이 되어 덮어쓰지 않는다.
5. 패키지를 올릴 땐 나온 지 2주 넘은 버전만 쓰고, `npm test` 통과 후 태그한다.
6. 브라우저 자동화는 Playwright가 브라우저를 내려받지 않고 윈도우 기본 **Edge**를 쓴다 → 크롬 버전 충돌 없음.

## 남은 일

- [ ] 프레시원 로그인/검색/장바구니 화면 요소 맞추기 (설정 › 프레시원 › 고급)
- [ ] 안드로이드 앱 + 클라우드 동기화
- [ ] 코드 서명 인증서 (없으면 첫 설치 때 Windows SmartScreen 경고 → "추가 정보 › 실행")
- [ ] Electron 43.8.x 이상으로 올리기 (eMudhra 인증서 보안 권고 GHSA-jr5w-w6x2-84p9 대응, 2주 경과 후)
