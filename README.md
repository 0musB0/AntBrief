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

`index.html`과 `archive/`는 아래 파이프라인이 자동으로 커밋합니다. 손으로 고치면 다음 배포 때 덮어써집니다.

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
