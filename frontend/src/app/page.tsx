"use client";

import { useState } from "react";
import { useSSE, Citation, BlockItem, UIBlock } from "@/hooks/useSSE";

const SAMPLE_QUESTIONS = [
  "장석찬님이 통원 치료 시 의원급에서 12만원 지출했는데 보상 얼마 되나요?",
  "장석찬님이 식중독으로 5일간 입원한 경우 지급받을 수 있는 총 보험금은 얼마인가요?",
  "갑상선암 진단 시 받을 수 있는 혜택이 뭐야?",
  "장석찬님이 재해골절로 통원 치료 시 받을 수 있는 보험금은 얼마인가요?",
];

export default function Home() {
  const [query, setQuery] = useState("");
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);

  const { data, blocks, isLoading, isCompleted, error, sessionId, startStream, sendSlotFill, resetStream } = useSSE();

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
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-4 md:p-8 font-sans relative">
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
        {!data && blocks.length === 0 && !isLoading && (
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

        {/* Response Container */}
        {(data || blocks.length > 0 || isLoading || error) && (
          <div className="w-full bg-slate-900/80 backdrop-blur border border-slate-800 rounded-2xl p-6 shadow-xl mb-6 min-h-[250px] flex flex-col">
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-800">
              <span className="text-xs font-semibold text-blue-400 uppercase tracking-wider flex items-center gap-2">
                🤖 AI 손해사정 정밀 검증 대시보드
              </span>
              {isLoading && (
                <span className="text-xs text-indigo-400 animate-pulse flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping"></span>
                  실시간 약관 탐색 & RAG 분석 중...
                </span>
              )}
              {isCompleted && (
                <span className="text-xs text-emerald-400 font-medium">✓ 검증 완료</span>
              )}
            </div>

            {error && (
              <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-sm mb-4">
                ⚠️ {error}
              </div>
            )}

            {/* Plain Answer Text Stream */}
            <div className="prose prose-invert max-w-none text-slate-200 text-sm leading-relaxed whitespace-pre-wrap mb-4">
              {data || (isLoading && "약관 데이터베이스 검색 및 분석을 진행하고 있습니다...")}
            </div>

            {/* Structured UI Blocks */}
            {blocks.length > 0 && (
              <div className="space-y-4 pt-4 border-t border-slate-800/80">
                {blocks.map((block, bIdx) => {
                  if (block.block_type === "CONTEXT") {
                    return (
                      <div key={bIdx} className="p-3 bg-slate-800/60 border border-slate-700/50 rounded-xl">
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">
                          📌 {block.title || "상황 파악"}
                        </span>
                        <p className="text-xs text-slate-300">{block.content}</p>
                      </div>
                    );
                  }

                  if (block.block_type === "RETRIEVAL_RESULT") {
                    return (
                      <div key={bIdx} className="p-4 bg-blue-950/30 border border-blue-800/40 rounded-xl">
                        <h3 className="text-sm font-bold text-blue-300 mb-2 flex items-center gap-2">
                          🔍 {block.title || "약관 검색 결과 및 보장 내역"}
                        </h3>
                        <ul className="space-y-2">
                          {block.items?.map((item, iIdx) => {
                            if (typeof item === "string") {
                              return <li key={iIdx} className="text-xs text-slate-200">• {item}</li>;
                            }
                            const blockItem = item as BlockItem;
                            return (
                              <li key={iIdx} className="text-xs text-slate-200 flex flex-wrap items-center gap-1.5">
                                <span>• {blockItem.text}</span>
                                {blockItem.citations?.map((c, cIdx) => (
                                  <button
                                    key={cIdx}
                                    onClick={() => setActiveCitation(c)}
                                    className="px-1.5 py-0.5 rounded bg-blue-600/30 hover:bg-blue-600/60 border border-blue-400/40 text-[10px] font-semibold text-blue-300 hover:text-white transition-all cursor-pointer"
                                    title="나무위키 각주: 클릭 시 약관 원문 팝업"
                                  >
                                    [{c.id || cIdx + 1}]
                                  </button>
                                ))}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  }

                  if (block.block_type === "CAUTION") {
                    return (
                      <div key={bIdx} className="p-4 bg-amber-950/40 border border-amber-500/40 rounded-xl text-amber-200">
                        <h3 className="text-sm font-bold text-amber-400 mb-1 flex items-center gap-2">
                          ⚠️ {block.title || "상담 유의사항"}
                        </h3>
                        <p className="text-xs leading-relaxed">{block.content}</p>
                      </div>
                    );
                  }

                  if (block.block_type === "DELIVER") {
                    return (
                      <div key={bIdx} className="p-4 bg-slate-900 border border-slate-800 rounded-xl">
                        <h3 className="text-sm font-bold text-indigo-300 mb-2">
                          📋 {block.title || "고객 전달 안내 서류"}
                        </h3>
                        <ul className="space-y-1">
                          {block.items?.map((item, iIdx) => (
                            <li key={iIdx} className="text-xs text-slate-300">
                              {typeof item === "string" ? item : item.text}
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  }

                  return null;
                })}
              </div>
            )}

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

      {/* 나무위키 스타일 모달 팝업 Modal Popup for Citations */}
      {activeCitation && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-slate-900 border border-blue-500/40 rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <span className="text-xs font-bold text-blue-400 flex items-center gap-1.5">
                📖 약관 원문 각주 [{activeCitation.id}]
              </span>
              <button
                onClick={() => setActiveCitation(null)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <div>
              <h4 className="text-sm font-bold text-slate-100">{activeCitation.section_title}</h4>
              <p className="text-xs text-slate-400">약관 위치: {activeCitation.page}페이지</p>
            </div>

            <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-300 leading-relaxed max-h-60 overflow-y-auto">
              "{activeCitation.snippet}"
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setActiveCitation(null)}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs rounded-lg transition-all"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

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
          Shift + Enter 키로 줄바꿈 | 나무위키 모달 각주 &amp; SSE 스트리밍 지원
        </p>
      </footer>
    </main>
  );
}
