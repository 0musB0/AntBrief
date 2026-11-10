# AntBrief (AGENTS.md)

## 구조 지도
한 줄 개요: 국내외 증시 지표와 뉴스를 하루 4번 요약·해설하는 정적 브리핑 웹사이트.
스택: HTML5, Vanilla JS, CSS3, Google Apps Script, Gemini Spark, Claude, Vercel
실행/검증: 빌드·테스트 도구 없음(정적 웹). 로컬 브라우저로 확인하며 Git 푸시 시 Vercel 자동 배포.

파일 지도:
경로                                                        역할 (한 줄)
app.js                                                      브리핑 JSON 파싱, 지표·뉴스·시나리오 표 렌더링 및 광고 슬롯 처리
archive.js                                                  지난 브리핑 아카이브 검색 필터링 및 관심 종목 고정/해제 로직
style.css                                                   다크 모드 기반 사이트 전반 스타일, 타이포그래피, 반응형 레이아웃
contact.html                                                독자 제보 및 문의 안내 정적 페이지 (수동 관리)
vercel.json                                                 kro.kr 도메인 301 리디렉션 설정
apps-script/Code.gs                                         Drive 브리핑 수신, 금지어 검증, 정적 HTML 생성 및 GitHub 자동 커밋
apps-script/gemini-prompt.md                                Gemini Spark용 증시 수집·작성 지침 및 JSON 스키마 프롬프트
archive/, weekly/, glossary/, icon-512.png, og.png, favicon.* 등    생성물·자산

데이터 흐름:
1. 입력: 하루 4번(08:00·14:00·16:30·23:00 KST) 회차마다 Gemini Spark(Drive MarketBrief)와 Claude(AntBrief_Analysis)가 생성한 브리핑 JSON 저장
2. 처리: Google Apps Script(Code.gs)가 10분마다 감지 → 두 파일 병합·금지어 검사 → HTML/피드 생성
3. 출력: GitHub 저장소로 자동 커밋·푸시 → Vercel이 antbrief.vercel.app 정적 사이트로 자동 배포

자주 고치는 곳:
- 브리핑 화면 동작·표·카드·광고: app.js
- 디자인·색상·글꼴·레이아웃: style.css
- 페이지 생성 틀·메타태그·금지어 규칙: apps-script/Code.gs (수정 후 Apps Script 편집기에 반영)
- AI 수집 내용·형식·프롬프트: apps-script/gemini-prompt.md (수정 후 Gemini Spark 예약에 반영)
- 문의 안내 및 리디렉션: contact.html, vercel.json

건드리지 말 것:
- 자동 생성 파일: index.html, archive/, weekly/, glossary.html, glossary/, calendar.html, compare.html, regime.*, about.html, privacy.html, sitemap.xml, feed.xml (배포 때 덮어씀)
- 100KB 이상 파일: icon-512.png(142KB), og.png(135KB) (head로 일부만 볼 것, 바이너리이므로 통째로 읽지 말 것)
- 비밀 키 위치: Google Apps Script 스크립트 속성(PropertiesService의 GITHUB_TOKEN). Code.gs 내 변수는 항상 비워 둘 것
