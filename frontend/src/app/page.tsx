"use client";

import { useState } from "react";
import { useSSE } from "@/hooks/useSSE";

const SAMPLE_QUESTIONS = [
  "나 장염 걸려서 수액 맞았는데 10만원 나왔어 보상 얼마 돼?",
  "갑상선암 진단 시 받을 수 있는 혜택이 뭐야?",
  "뇌졸중 수술 시 수술비 지급 기준 알려줘",
  "재해골절 시 몇 만원 보상돼?",
];

export default function Home() {
  const [query, setQuery] = useState("");
  const { data, isLoading, isCompleted, error, sessionId, startStream, sendSlotFill, resetStream } = useSSE();

  const isSlotAsking = data.includes("입원 일수") || data.includes("Slot Filling") || data.includes("추가 정보");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || isLoading) return;

    const currentInput = query;
    setQuery("");

    if (isSlotAsking && sessionId) {
      // 되묻기 상황인 경우 방법 1 (POST /api/v1/chat/slot-fill API) 호출
      sendSlotFill("hospital_days", currentInput);
    } else {
      // 일반 첫 질문인 경우 스트리밍 구동
      startStream(currentInput);
    }
  };

  const handleSampleClick = (sample: string) => {
    setQuery(sample);
    startStream(sample);
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-4 md:p-8 font-sans">
      {/* Header */}
      <header className="max-w-4xl mx-auto w-full flex items-center justify-between pb-6 border-b border-slate-800">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center font-bold text-white shadow-lg shadow-blue-500/20">
            QA
          </div>
          <div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-indigo-300 bg-clip-text text-transparent">
              AI 보험 약관 손해사정 Q&A
            </h1>
            <p className="text-xs text-slate-400">장석찬님 증권(jang.md) 기반 정밀 약관 검증</p>
          </div>
        </div>
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          ● Agentic SSE Live
        </span>
      </header>

      {/* Main Content Area */}
      <section className="max-w-4xl mx-auto w-full my-6 flex-1 flex flex-col justify-center">
        {/* Sample Questions Chips */}
        {!data && !isLoading && (
          <div className="mb-8">
            <p className="text-sm font-medium text-slate-400 mb-3">💡 자주 묻는 질문 선택</p>
            <div className="flex flex-wrap gap-2">
              {SAMPLE_QUESTIONS.map((sample, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSampleClick(sample)}
                  className="px-3.5 py-2 rounded-lg bg-slate-900 border border-slate-800 hover:border-blue-500/50 hover:bg-slate-850 text-xs text-slate-300 hover:text-white transition-all text-left"
                >
                  {sample}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Response Card */}
        {(data || isLoading || error) && (
          <div className="w-full bg-slate-900/80 backdrop-blur border border-slate-800 rounded-2xl p-6 shadow-xl mb-6 min-h-[250px] flex flex-col">
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-800">
              <span className="text-xs font-semibold text-blue-400 uppercase tracking-wider flex items-center gap-2">
                🤖 AI 손해사정 정밀 검증 답변
              </span>
              {isLoading && (
                <span className="text-xs text-indigo-400 animate-pulse flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping"></span>
                  실시간 약관 탐색 & 스트리밍 중...
                </span>
              )}
              {isCompleted && (
                <span className="text-xs text-emerald-400 font-medium">✓ 검증 완료</span>
              )}
            </div>

            {error && (
              <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-sm">
                ⚠️ {error}
              </div>
            )}

            {/* SSE Stream Text Output */}
            <div className="prose prose-invert max-w-none text-slate-200 text-sm leading-relaxed whitespace-pre-wrap flex-1">
              {data || (isLoading && "약관 데이터베이스 검색 및 분석을 시작합니다...")}
            </div>

            {data && (
              <div className="pt-4 mt-4 border-t border-slate-800/60 flex justify-end">
                <button
                  onClick={resetStream}
                  className="text-xs text-slate-400 hover:text-slate-200 transition-colors"
                >
                  답변 초기화
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Input Form Footer */}
      <footer className="max-w-4xl mx-auto w-full">
        <form onSubmit={handleSubmit} className="relative">
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            placeholder="보험 약관 및 보상에 대해 궁금한 점을 질문하세요... (Enter로 전송)"
            rows={2}
            className="w-full bg-slate-900 border border-slate-800 rounded-xl py-3.5 pl-4 pr-24 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all resize-none"
          />
          <button
            type="submit"
            disabled={isLoading || !query.trim()}
            className="absolute right-3 top-3 bottom-3 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-xs rounded-lg transition-all shadow-md shadow-blue-500/20 flex items-center justify-center"
          >
            {isLoading ? "탐색 중..." : "질문 전송"}
          </button>
        </form>
        <p className="text-[11px] text-center text-slate-500 mt-2">
          Shift + Enter 키로 줄바꿈 | SSE Server-Sent Events 지원
        </p>
      </footer>
    </main>
  );
}
