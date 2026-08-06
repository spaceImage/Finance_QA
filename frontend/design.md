# Finance QA 프론트엔드 — 현재 UI 디자인 문서

> 대상 파일: [src/app/page.tsx](src/app/page.tsx), [src/app/debug/page.tsx](src/app/debug/page.tsx), [src/hooks/useSSE.ts](src/hooks/useSSE.ts)
> 이 문서는 "지금 코드에 실제로 있는 디자인"을 그대로 기록한 것입니다. 새 화면/컴포넌트를 추가할 때 톤을 맞추기 위한 참고용이며, 코드가 바뀌면 이 문서도 같이 갱신해주세요.

---

## 1. 개요

보험사 CS/CX 상담사가 고객 상담 중 옆에 띄워두고 쓰는 **인바운드 보조 화면**입니다. 라우트는 두 개뿐입니다.

- `/` — 상담사가 실제로 쓰는 메인 화면: 좌측 고객/빠른 질문 사이드바 + 우측 채팅. 탭 UI는 없고 "증권 MD 보기"·"약관 PDF 보기" 버튼을 누르면 모달로 뜹니다.
- `/debug` — LangGraph 노드 실행 과정을 실시간으로 관찰하는 개발자용 관제 대시보드. `/`의 각 답변 카드에 있는 "관제 패널" 링크로도 이동할 수 있습니다.

---

## 2. 레이아웃 구조 — `/` 메인 화면

```
┌──────────────────────────────────────────────────────────────────┐
│ 🛡️ AIQ 손해사정 보상 가이드 시스템 [LangGraph v2.0]                │
│    약관 기반 멀티홉 추론 및 구조화 UI 보상 가이드 시스템             │
│                          [⚡관제패널] [📄약관PDF] [📋증권MD]        │
├───────────────────────┬──────────────────────────────────────────┤
│ 좌측 (1/4)             │ 우측 (3/4)                                │
│ ┌ 피보험자 정보 ─────┐ │ ┌──────────────────────────────────────┐│
│ │ 👤            [정상]│ │ │  채팅 메시지 목록 (스크롤)             ││
│ │ 성명/생년월일/증권번호│ │ │  - 빈 상태: 💬 안내 문구               ││
│ │ 주요 가입 특약 (고정)│ │ │  - 상담사 질문(우측 그라디언트 버블)   ││
│ └────────────────────┘ │ │  - AI 답변 카드(진행률바+답변+승인 UI) ││
│ ┌ 빠른 보상 상담 질문 ┐ │ │                                      ││
│ │ 프리셋 질문 4개      │ │ ├──────────────────────────────────────┤│
│ │ (클릭 시 즉시 실행)  │ │ │ [입력창................] [전송➔]     ││
│ └────────────────────┘ │ └──────────────────────────────────────┘│
└───────────────────────┴──────────────────────────────────────────┘

(버튼 클릭 시 전체화면 중앙 모달로 오버레이)
┌─ 증권 MD 보기 모달 ──────────┐   ┌─ 약관 PDF 보기 모달 ─────────┐
│ 📋 {고객명}님 보험증권 요약 ✕│   │ 📄 {상품명} 약관 원문      ✕│
│ certificate.md → 마크다운 렌더│   │ PdfHighlightViewer(검색/페이지/줌)│
└──────────────────────────────┘   └──────────────────────────────┘
```

- 브레이크포인트 `md` 미만에서는 `grid-cols-1`로 1열로 쌓임(`grid-cols-1 md:grid-cols-4`).
- 우측 채팅 섹션은 `h-[75vh] md:h-[82vh]`로 고정, 내부에서만 스크롤.
- 전체 폭은 `max-w-6xl` 중앙 정렬.
- 모달 2종은 `fixed inset-0` 오버레이 위에 카드가 뜨는 방식으로, 탭이 아니라 **버튼을 눌렀을 때만 나타나는 오버레이**입니다.

---

## 3. 디자인 토큰

별도 테마 파일(`tailwind.config` 커스텀 팔레트) 없이 **Tailwind 기본 팔레트를 의미별로 규칙적으로 사용**합니다.

### 색상 — 의미별 매핑

| 의미 | 색상 | 대표 사용처 |
|---|---|---|
| 브랜드/주요 액션 | `indigo-600` → `blue-600` 그라디언트 | 로고 배지, 상담사 말풍선, 전송 버튼, 진행 중 진행률바 |
| 배경 | `slate-50` → `blue-50/20` → `indigo-50/30` 그라디언트 (`bg-gradient-to-br`) | `<main>` 전체 배경 |
| 카드/패널 | `white` bg + `border-slate-200` | 사이드바 카드, 답변 카드, 모달 |
| 본문 텍스트 | `slate-800`/`slate-900`(강조) / `slate-500`(보조) / `slate-400`(placeholder) | 전반 |
| 성공/완료 | `emerald-50/600/700` | "정상 계약" 배지, 파이프라인 완료 진행률바 |
| 경고/주의 | `amber-50/800/900` | 답변 본문 내 `> ⚠️ 유의사항` 인용구, 처리 중 표시 |
| 위험/중단 | `rose-50/300/600/800` | Out-of-Scope 배너, 파이프라인 중단 진행률바 |
| 보상금/근거 강조 | `indigo-50→blue-50` 그라디언트 / `slate-100` | 답변 본문 내 `> 🛡️💰 보장 기준` / `> 📚 약관 근거` 인용구 |
| 승인 대기(Human-in-the-Loop) | `indigo-50/300/900` | 슬롯 보완 요청 카드 |

> 팔레트 원칙: **indigo/blue = AI·브랜드, slate = 중립/구조, emerald = 정상/완료, amber = 주의, rose = 위험/중단.** 새 컴포넌트 추가 시 이 매핑을 따르면 톤이 깨지지 않습니다.

### 타이포그래피

- 거의 전 영역이 `text-xs`(12px) 기준. 보조 텍스트는 임의값 `text-[10px]` / `text-[11px]`.
- 섹션 제목: `text-xs font-bold`
- 헤더 타이틀: `text-sm font-extrabold` + indigo/blue 그라디언트 텍스트(`bg-clip-text text-transparent`)
- 폰트는 `layout.tsx`에서 로드하는 `Inter` + `Noto Sans KR`(`--font-inter`, `--font-noto-kr`), 별도 웹폰트 추가 로드 없음.

### 여백 · 모서리 · 그림자

- 카드/패널 라운드: `rounded-2xl`(큰 컨테이너), `rounded-xl`(중첩 카드), `rounded-lg`(버튼/뱃지)
- 카드 내부 패딩: `p-4` ~ `p-5`
- 카드 간 간격: `space-y-3` ~ `space-y-6`, 그리드 갭 `gap-5`
- 그림자: `shadow-2xs`(기본 카드), `shadow-xs`/`shadow-sm`(버튼), `shadow-md`/`shadow-2xl`(모달)
- 배지(badge): `rounded-full px-2 py-0.5 text-[10px] font-semibold` + 의미색 조합

### 아이콘

별도 아이콘 라이브러리 없이 **이모지를 아이콘처럼 사용**(🛡️ 로고, 👤 고객, 🤖 AI 응답, ⚡ 관제 패널, 📄 PDF, 📋 증권, ⏱️ 소요시간, 🚫 범위 밖 등). SVG는 `PdfHighlightViewer`의 검색/줌 아이콘 정도에만 인라인으로 직접 그림.

---

## 4. 컴포넌트 인벤토리 — `/` 메인 화면 (`page.tsx`)

### 4.1 Header
로고 배지(그라디언트 사각형, 🛡️) + 타이틀 "AIQ 손해사정 보상 가이드 시스템" + "LangGraph v2.0" 필(pill) 배지 + 서브타이틀. 우측엔 버튼 3개: `/debug`로 이동하는 "LangGraph 관제 패널" 링크, "약관 PDF 보기"(모달), "증권 MD 보기"(모달).

### 4.2 사이드바 카드 — 피보험자 정보
"👤 피보험자 정보" 헤더 + 우상단 "정상 계약" 배지 + 성명/생년월일/증권번호(모노스페이스) + "주요 가입 특약" 3줄 고정 텍스트. **전부 하드코딩된 단일 고객(`DEFAULT_CUSTOMER`, task_name="jang")**이며, API로 조회하지 않습니다.

### 4.3 사이드바 카드 — 빠른 보상 상담 질문
프리셋 질문 4개(정상 RAG 예시 3개 + Out-of-Scope 예시 1개) 버튼. 클릭하면 바로 `startStream()`을 호출해 질문을 실행합니다(입력창에 타이핑할 필요 없음).

### 4.4 메인 채팅 영역
- **빈 상태**: 중앙에 💬 아이콘 + "손해사정 보상 상담을 시작하세요" 안내 문구.
- **상담사 메시지**: 우측 정렬, indigo→blue 그라디언트 버블, 흰 텍스트.
- **AI 답변 카드**: 좌측 정렬(전체 폭), `slate-50/70` 배경 카드.
  - 헤더: "🤖 AI 손해사정 가이드" + 의도(intent) 배지 + 소요시간 배지(진행 중엔 펄스 애니메이션 실시간 초시계, 완료 후엔 고정값) + API 호출 횟수 배지 + `/debug`로 이동하는 "관제 패널" 링크
  - **6단계 실시간 진행률 바**: `node_logs`에 찍힌 노드 이름을 보고 `1.범위검증 → 2.작업기획 → 3.의도분류 → 4.약관수집 → 5.보상추론 → 6.답변생성` 라벨을 순서대로 강조. 진행 중(blue)/완료(emerald)/중단·범위밖(rose) 3가지 색상 상태를 자체 로직으로 계산.
  - Out-of-Scope일 때만 뜨는 rose 경고 배너
  - `renderFormattedMarkdown()`으로 렌더링되는 답변 본문(마크다운 헤딩/리스트/표 + 인용구 4변형: `⚠️`=주의(amber), `✅`=고객전달(emerald), `🛡️💰`=보장기준(indigo 그라디언트), `📚`=약관근거(slate))
  - **Human-in-the-Loop 승인 카드**(슬롯 보완 필요 시): 텍스트 입력 + "승인 및 계속 진행"(`sendSlotFill`) + "승인 거절 및 취소"(`resetStream`)
- **입력창**: 하단 고정, 단일 `input`(Enter 전송) + 그라디언트 원형이 아닌 필(pill) 전송 버튼.

### 4.5 모달 2종
- **증권 MD 모달** (`showPolicyModal`): 헤더("📋 {고객명}님 보험증권 요약") + 닫기(✕) + `/api/v1/policy/jang`에서 받아온 `certificate.md` 내용을 `renderFormattedMarkdown()`으로 렌더링. 로딩 중엔 펄스 안내, 실패 시 에러 문구.
- **약관 PDF 모달** (`showPdfModal`): 헤더("📄 {상품명} 약관 원문") + 닫기(✕) + `PdfHighlightViewer` 컴포넌트를 `/api/v1/policy-pdf/jang`에 연결해 렌더링(페이지 이동/확대축소/텍스트 검색·하이라이트 지원). `pdf.js`가 브라우저 전용 API(`DOMMatrix`)에 의존해 SSR 빌드가 깨지므로 `next/dynamic(ssr:false)`으로 클라이언트 전용 로드합니다.

---

## 5. `/debug` — LangGraph 관제 대시보드 (`debug/page.tsx`)

개발자/QA용 화면으로, 메인 화면과 별도 톤(`text-lg` 타이틀, 카드 그리드형 대시보드)입니다.

- **상단 세션 바**: 활성 `session_id` 표시 + 테스트 질문 입력창 + 프리셋 질의 4개(메인 화면과 같은 질문 세트)
- **메트릭 카드 5개**: Detected Intent / Status(`OUT_OF_SCOPE`·`SLOT_FILLING`·정상 색상 구분) / API 호출 횟수 / Multi-hop 루프 횟수 / 소요 시간(진행 중엔 `● LIVE` 실시간)
- **탭 4개**:
  1. **Live Sprouting Flowchart**: `node_logs`가 쌓일 때마다 노드 카드가 세로로 하나씩 동적 생성되는(sprouting) 플로우차트. 노드 종류별(task_planner/query_validation/out_of_scope_response/intent_router/parallel_context_builder/multi_hop_reasoning/generate)로 전용 카드 UI가 있고, 클릭하면 해당 노드의 Raw 상태를 보여주는 Inspector 모달이 뜸.
  2. **Node Execution & Audit Logs**: 노드별 소요시간 리스트 + `/api/v1/session/{id}/logs`로 가져온 DB/파일 감사 로그
  3. **Model Orchestration Strategy**: `AGENT.MD` 기준 Node별 할당 모델 표(정적 표, `config.py`와 별개로 하드코딩됨 — 값이 바뀌면 여기도 같이 고쳐야 함)
  4. **Raw JSON Inspector**: 현재 세션의 전체 상태(`sessionId`/`status`/`intent`/`tasks`/`blocks`/`nodeLogs`/`auditLogs`/`answer`)를 JSON으로 그대로 출력
- **로그 JSON 다운로드** 버튼: 현재 세션 상태를 `rag_workflow_log_{sessionId}.json`으로 다운로드

---

## 6. 상태 & 인터랙션 요약

| 상태 | 트리거 | 표현 |
|---|---|---|
| 빈 채팅 | 메시지 0개 | 💬 안내 문구 |
| 스트리밍 중 | `isLoading=true` | 6단계 진행률 바(blue) + 실시간 초시계 배지 |
| 되묻기(slot filling) | `status==="SLOT_FILLING"` 또는 응답에 "추가 정보" 포함 | Human-in-the-Loop 승인 카드로 전환, `sendSlotFill()`로 응답 |
| Out-of-Scope | `status==="OUT_OF_SCOPE"` 또는 `node_logs`에 `out_of_scope_response` 포함 | 진행률 바/배지가 rose로 전환 + 경고 배너 |
| 증권/약관 모달 열기 | 헤더의 "증권 MD 보기"/"약관 PDF 보기" 클릭 | `fixed inset-0` 오버레이 모달, 배경 클릭 시 닫힘 |
| `/debug` 이동 | 헤더 또는 답변 카드의 "관제 패널" 링크 | 같은 `useSSE` 훅을 새로 마운트하므로 세션 상태는 공유되지 않음(별도 페이지) |

---

## 7. 알려진 한계 (다음에 손볼 지점)

- **다중 고객 미지원**: 고객 정보·특약 목록이 전부 `jang` 한 명 기준 하드코딩(`DEFAULT_CUSTOMER`). `startStream(query, "jang")`처럼 `task_name="jang"`이 여러 곳에 직접 박혀 있어, 여러 고객을 다루려면 이 부분을 상태/API 연동으로 바꿔야 함.
- **죽은 코드(선언만 되고 안 쓰임)**: `feedbackMap`/`handleFeedback`(👍👎 피드백 UI 자체가 화면에 없음), `showJsonRaw`(Raw JSON 토글 UI 없음 — `/debug`의 JSON 탭과는 별개), `useSSE`가 제공하는 `progress`/`currentStepLabel`/`stepLogs`/`loopCount`/`error`/`approveTaskPlan`도 구조분해만 되어 있고 화면에서 실제로 쓰이지 않음(진행률 표시는 `nodeLogs` 기반 자체 계산 로직으로 대체됨). 코드 정리 시 참고.
- **`/debug`의 Model Orchestration 표는 정적 하드코딩**: `config.py`의 `DEFAULT_MODEL_CONFIG`를 API로 노출해서 읽어오는 게 아니라 화면에 표 자체가 그대로 박혀 있음 → `config.py` 값이 바뀌면 이 표도 수동으로 같이 고쳐야 함.
- **마크다운 렌더러**: 라이브러리 없이 직접 파싱하는 미니 파서(`renderFormattedMarkdown`)라 표준 마크다운(중첩 리스트, 코드블록, 링크 등) 미지원.
- **세션 미공유**: `/`와 `/debug`가 각각 독립적으로 `useSSE()`를 호출하므로, `/`에서 진행한 상담 세션 상태가 `/debug`로 넘어가지 않음(같은 브라우저에서도 세션이 분리됨).
