# 섬개미 증시 브리핑 (AntBrief)

하루 네 번(08:00 · 14:00 · 16:30 · 23:00 KST) 국내외 증시 흐름을 정리해 올리는 정적 사이트입니다.

- 사이트: https://antbrief.vercel.app (antbrief.kro.kr 은 여기로 301 이동)
- 정보 제공 목적이며 투자 권유가 아닙니다.

## 저장소 구조

| 경로 | 내용 |
|---|---|
| `index.html` | 최신 브리핑. `<script id="briefing-data">` 안의 JSON 데이터를 `app.js`가 화면으로 그림 |
| `app.js` | 브리핑 JSON → 표·뉴스·시나리오 렌더링, 광고 슬롯 |
| `style.css` | 사이트 스타일 |
| `archive/` | 지난 브리핑 (`YYYYMMDD-HHMM.html`). 같은 날 같은 회차는 같은 파일을 덮어씀 |
| `about.html` · `contact.html` · `privacy.html` | 소개 · 문의 · 개인정보처리방침 |
| `sitemap.xml` · `robots.txt` · `ads.txt` | 검색·광고 설정 |
| `vercel.json` | kro.kr → vercel.app 301 리디렉션 |

| `apps-script/Code.gs` | Google Apps Script 원본. 페이지 HTML을 만들어 이 저장소에 커밋 (사이트에는 올라가지 않음) |
| `apps-script/gemini-prompt.md` | Gemini Spark 예약에 넣는 브리핑 작성 프롬프트 |
| `.github/` | 이슈 양식(버그 신고 · 수정 요청), PR 양식 |

## 무엇을 고치려면 어디를 보나

페이지 대부분은 Apps Script가 **생성**합니다. 생성된 파일을 손으로 고치면 다음 배포 때 덮어써지므로, 원본을 고쳐야 합니다.

| 고치고 싶은 것 | 고칠 곳 | 반영 방법 |
|---|---|---|
| 화면 동작·표·카드·배지·차트 | `app.js` | PR 머지 → 자동 배포 |
| 색·글꼴·레이아웃 | `style.css` | PR 머지 → 자동 배포 |
| 지난 브리핑 목록·검색 | `archive.js` | PR 머지 → 자동 배포 |
| 문의 페이지, 리디렉션, 아이콘 | `contact.html` · `vercel.json` · 이미지 | PR 머지 → 자동 배포 |
| 페이지 틀(head·메타태그), 소개·개인정보·용어사전·일정 페이지, sitemap·RSS, `regime.json` | `apps-script/Code.gs` | PR 머지 → Apps Script 편집기에 전체 붙여 넣기 |
| 금지어(투자 권유 표현) | `apps-script/Code.gs`의 `BANNED` | 위와 같음 |
| 브리핑 내용·형식(뉴스, 시나리오, 종목 태그 등) | `apps-script/gemini-prompt.md` | PR 머지 → Gemini Spark 예약 프롬프트 교체 |

생성되는 파일(손대지 말 것): `index.html`, `archive/`, `calendar.html`, `about.html`, `privacy.html`, `glossary.html`, `glossary/`, `sitemap.xml`, `feed.xml`, `regime.json`

## 버그·수정 요청 처리 순서

1. **접수**: 독자 제보는 문의 메일로 옵니다. 받으면 GitHub Issues → New issue에서 `버그 신고` 또는 `수정·기능 요청` 양식으로 옮겨 적습니다(주소·스크린샷 필수).
2. **작업**: 이슈 하나에 브랜치 하나. 위 표에서 고칠 곳을 찾아 수정합니다.
3. **PR**: PR 양식을 채우고 본문에 `Closes #이슈번호`를 적으면 머지할 때 이슈가 자동으로 닫힙니다. Vercel이 PR마다 미리보기 주소를 달아 주니 휴대폰으로 확인합니다.
4. **반영**: 머지하면 사이트는 자동 배포. `apps-script/` 파일을 바꿨다면 PR 양식의 체크대로 Apps Script·Gemini에 붙여 넣습니다.

Apps Script에서 직접 고쳤다면 같은 날 `apps-script/Code.gs`에도 반영해 두어야 다음 수정 때 옛 버전으로 덮어쓰는 일이 없습니다. 토큰은 스크립트 속성에만 두고 파일의 `GITHUB_TOKEN` 줄은 항상 비워 둡니다.

## 배포 파이프라인

```
Gemini Spark 예약 (매시 :45)
  ├─ 브리핑 시간대 → Drive MarketBrief 폴더에 Briefing_YYYY-MM-DD_HHMM 작성
  └─ 그 외 시간   → MarketBrief_… (수집용)
        ↓
Apps Script publish() (10분마다)
  Briefing_ 읽기 → 금지어(투자 권유 표현) 검사 → HTML 생성 → 이 저장소에 1커밋
  성공 시 파일명 앞에 [배포완료], 실패 시 [오류] + 알림 메일
        ↓
Vercel 자동 배포 → antbrief.vercel.app
```

브리핑 시간대: 07:00~08:59, 13:00~14:59, 16:00~17:29, 22:00~23:59 (KST)

## 장애 확인 순서

1. 사이트 갱신 시각 (캐시 우회):
   ```sh
   curl -s "https://antbrief.vercel.app/?nc=$(date +%s)" | grep -o '"stamp":"[^"]*"'
   ```
2. Drive MarketBrief 폴더: 최근 `Briefing_` 파일이 있는지, `[배포완료]` / `[오류]` 표시 확인
3. "브리핑 배포 실패" 메일로 원인 확인. 고친 뒤 파일명에서 `[오류] `를 지우면 다음 실행 때 재시도
4. 이 저장소 최근 커밋 → Vercel 배포가 READY인지 확인

자주 있었던 원인

- Gemini가 브리핑 시간대에 파일을 못 만듦 → Spark 예약 시간대 확인
- 금지어 오탐(사실 서술을 권유로 판단) → Apps Script `BANNED` 정규식 조정
- 감시 도구가 옛 페이지 캐시를 읽음 → 위 `?nc=` 캐시 우회로 재확인
