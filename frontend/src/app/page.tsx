"use client";

import React, { useState, useEffect, useRef } from "react";
import { useSSE, UIBlock, BlockItem, Citation, StepLog, PlanResult, AnalysisResult } from "@/hooks/useSSE";

// ==========================================
// Types
// ==========================================
interface CustomerProfile {
  id: string;
  name: string;
  policyName: string;
  status: string;
  birthDate: string;
  phone: string;
}

const DEFAULT_CUSTOMER: CustomerProfile = {
  id: "c7e2b1f0-4a89-4e1d-8b3c-91a0c2d3e4f5",
  name: "장석찬",
  policyName: "Top클래스변액유니버설CI종신보험2.0(무배당)",
  status: "유지 (정상 가입)",
  birthDate: "1997.11.11.",
  phone: "010-0000-0000",
};

interface ChatMessage {
  id: string;
  sender: "counselor" | "assistant";
  text: string;
  // Phase 1: AWAITING_CONFIRMATION
  planResult?: PlanResult;
  // Phase 2: SUCCESS / OUT_OF_SCOPE / NEED_MORE_INFO
  analysisResult?: AnalysisResult;
  isSlotAsking?: boolean;
  timestamp: string;
  elapsedSec?: number;
}

// ==========================================
// Helper: Markdown → React
// ==========================================
function parseBold(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) {
      return <strong key={i} className="font-extrabold text-indigo-950 bg-indigo-100/90 px-0.5 rounded">{p.slice(2, -2)}</strong>;
    }
    return <span key={i}>{p}</span>;
  });
}

function renderMd(mdText: string): React.ReactNode {
  if (!mdText) return null;
  const lines = mdText.split("\n");
  return (
    <div className="space-y-1">
      {lines.map((line, idx) => {
        const t = line.trim();
        if (!t || t.startsWith("<!--")) return null;
        if (t.startsWith("# "))  return <h2 key={idx} className="text-sm font-bold text-slate-900 mt-2 mb-1 border-b border-slate-200 pb-1">{t.slice(2)}</h2>;
        if (t.startsWith("## ")) return <h3 key={idx} className="text-xs font-bold text-slate-800 mt-2 mb-0.5">{t.slice(3)}</h3>;
        if (t.startsWith("• ") || t.startsWith("- ") || t.startsWith("* ")) {
          const content = t.replace(/^[•\-\*]\s+/, "");
          return (
            <div key={idx} className="flex items-start gap-1.5 pl-1">
              <span className="text-indigo-500 font-bold mt-0.5 shrink-0">•</span>
              <span className="text-xs text-slate-800 leading-relaxed">{parseBold(content)}</span>
            </div>
          );
        }
        return <p key={idx} className="text-xs text-slate-800 leading-relaxed">{parseBold(t)}</p>;
      })}
    </div>
  );
}

// ==========================================
// Citation badge + grounding inline component
// ==========================================
function ResultItem({ item, onCite }: { item: BlockItem; onCite: (c: Citation) => void }) {
  const g = item.grounding;
  return (
    <li className="bg-white border border-slate-200 rounded-xl p-3 shadow-2xs space-y-2 text-xs">
      <div className="font-semibold text-slate-900 leading-relaxed flex items-start gap-1 flex-wrap">
        <span className="text-indigo-500 font-bold shrink-0">•</span>
        <span className="flex-1">{parseBold(item.text)}</span>
        {item.citations?.map((c, ci) => (
          <button
            key={ci}
            type="button"
            onClick={() => onCite(c)}
            className="text-[10px] font-extrabold text-indigo-700 hover:text-white bg-indigo-100 hover:bg-indigo-600 px-1.5 py-0.5 rounded border border-indigo-300 transition-all cursor-pointer -translate-y-0.5 inline-flex"
            title={`${c.section_title} p.${c.page}`}
          >
            <sup>[출처 {ci + 1}]</sup>
          </button>
        ))}
      </div>
      {g && (
        <div className="pt-2 border-t border-slate-100 space-y-1.5 bg-slate-50/70 p-2.5 rounded-lg text-[11px]">
          {g.excerpt && (
            <p className="text-slate-700 italic leading-relaxed">
              <span className="font-bold not-italic text-slate-800 mr-1">📜 약관 조항:</span>
              &ldquo;{g.excerpt}&rdquo;
            </p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
            {g.condition && (
              <div className="bg-white p-2 rounded border border-slate-200 text-slate-800">
                <span className="font-bold text-slate-600 block text-[10px] mb-0.5">📑 가입 조건</span>
                {g.condition}
              </div>
            )}
            {g.formula && (
              <div className="bg-indigo-50 p-2 rounded border border-indigo-200 font-mono text-indigo-950">
                <span className="font-bold text-indigo-700 block text-[10px] font-sans mb-0.5">🧮 산출 수식</span>
                {g.formula}
              </div>
            )}
          </div>
          {g.reasoning && (
            <p className="text-slate-700 bg-white p-2 rounded border border-slate-200">
              <span className="font-bold text-slate-800 mr-1">💡 판단 근거:</span>
              {g.reasoning}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

// ==========================================
// HITL: AWAITING_CONFIRMATION 카드
// ==========================================
function PlanCard({
  planResult,
  onConfirm,
}: {
  planResult: PlanResult;
  onConfirm: () => void;
}) {
  return (
    <div className="p-4 bg-gradient-to-br from-indigo-50 to-blue-50/80 border-2 border-indigo-300 rounded-2xl shadow-sm space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between text-xs font-bold text-indigo-950 border-b border-indigo-200 pb-2">
        <span className="flex items-center gap-1.5 text-sm">
          <span>📋</span>
          <span>고객 질의 및 입력 정보 확인</span>
        </span>
        <span className="bg-amber-100 text-amber-800 text-[10px] font-black px-2 py-0.5 rounded-full border border-amber-300 animate-pulse">
          상담사 승인 대기
        </span>
      </div>

      {/* Task Plan */}
      {planResult.taskPlan && planResult.taskPlan.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-bold text-slate-700">📌 약관 조회 항목:</div>
          <ul className="bg-white/90 border border-indigo-100 rounded-xl p-3 space-y-1">
            {planResult.taskPlan.map((item, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-slate-700 font-medium">
                <span className="text-indigo-500 font-bold shrink-0">•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-slate-600 font-medium">
        입력된 상담 내용과 조회 항목을 확인하셨습니까? 아래 버튼을 누르시면 약관 DB 정밀 조회를 진행합니다.
      </p>

      <button
        type="button"
        onClick={onConfirm}
        className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-black text-sm rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
      >
        <span>▶️</span>
        <span>약관 DB 조회 및 분석 시작</span>
      </button>
    </div>
  );
}

// ==========================================
// AnalysisResult 블록 렌더러
// ==========================================
function AnalysisCard({
  analysisResult,
  onCite,
}: {
  analysisResult: AnalysisResult;
  onCite: (c: Citation) => void;
}) {
  const { status, answer, blocks } = analysisResult;

  if (status === "OUT_OF_SCOPE") {
    return (
      <div className="p-4 bg-slate-100 border border-slate-300 rounded-xl text-sm text-slate-700 font-medium">
        <span className="text-slate-500 font-bold block text-xs mb-1">🛡️ 답변 불가</span>
        {answer}
      </div>
    );
  }

  if (status === "NEED_MORE_INFO") {
    return (
      <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl space-y-2">
        <span className="text-xs font-bold text-amber-800 flex items-center gap-1.5">❓ 추가 정보 필요</span>
        <p className="text-sm text-amber-900 font-medium">{answer}</p>
      </div>
    );
  }

  // SUCCESS
  return (
    <div className="space-y-4">
      {/* Answer Summary */}
      {answer && (
        <div className="p-4 bg-gradient-to-br from-indigo-50/90 to-blue-50/60 border-2 border-indigo-200/90 rounded-2xl shadow-xs">
          <div className="text-[11px] font-black text-indigo-900 uppercase tracking-wide flex items-center gap-1.5 pb-1.5 border-b border-indigo-200/60 mb-2.5">
            <span className="w-2 h-2 rounded-full bg-indigo-600" />
            <span>보장 분석 결론</span>
            <span className="ml-auto text-[10px] font-medium text-indigo-500 normal-case tracking-normal">손해사정 전 참고용</span>
          </div>
          <div className="text-sm font-semibold leading-relaxed text-indigo-950">
            {renderMd(answer)}
          </div>
        </div>
      )}

      {/* Structured Blocks */}
      {blocks && blocks.length > 0 && (
        <div className="space-y-3">
          {[...blocks].sort((a, b) => {
            const p: Record<string, number> = { DELIVER: 1, CAUTION: 2, RETRIEVAL_RESULT: 3, CONTEXT: 4 };
            return (p[a.block_type] || 9) - (p[b.block_type] || 9);
          }).map((block, bIdx) => {
            if (block.block_type === "DELIVER") {
              return (
                <div key={bIdx} className="p-4 bg-indigo-50/70 border border-indigo-200 rounded-xl">
                  <h3 className="text-xs font-bold text-indigo-900 mb-2 flex items-center gap-1.5">
                    <span>📋</span>
                    <span>{block.title || "고객 전달 사항"}</span>
                  </h3>
                  <ul className="space-y-1.5">
                    {block.items?.map((item, iIdx) => (
                      <li key={iIdx} className="text-xs text-indigo-950 font-medium flex items-start gap-1.5">
                        <span className="text-indigo-400 shrink-0">•</span>
                        <span>{typeof item === "string" ? item : item.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            }

            if (block.block_type === "CAUTION") {
              return (
                <div key={bIdx} className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
                  <h3 className="text-xs font-bold text-amber-800 mb-2 flex items-center gap-1.5">
                    <span>⚠️</span>
                    <span>{block.title || "주의사항"}</span>
                  </h3>
                  {block.content && <p className="text-xs text-amber-900 leading-relaxed">{block.content}</p>}
                  {block.items && (
                    <ul className="space-y-1.5 mt-1">
                      {block.items.map((item, iIdx) => (
                        <li key={iIdx} className="text-xs text-amber-900 flex items-start gap-1.5">
                          <span className="shrink-0">•</span>
                          <span>{typeof item === "string" ? item : item.text}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            }

            if (block.block_type === "RETRIEVAL_RESULT") {
              return (
                <div key={bIdx} className="p-4 bg-blue-50/70 border border-blue-200 rounded-xl">
                  <h3 className="text-xs font-bold text-blue-900 mb-2 flex items-center gap-1.5">
                    <span>📜</span>
                    <span>{block.title || "답변 근거"}</span>
                  </h3>
                  <ul className="space-y-2">
                    {block.items?.map((item, iIdx) => {
                      if (typeof item === "string") {
                        return <li key={iIdx} className="text-xs text-slate-800">• {item}</li>;
                      }
                      return <ResultItem key={iIdx} item={item as BlockItem} onCite={onCite} />;
                    })}
                  </ul>
                </div>
              );
            }

            if (block.block_type === "CONTEXT") {
              return (
                <div key={bIdx} className="p-3.5 bg-white border border-slate-200 rounded-xl">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wide block mb-1">📌 {block.title}</span>
                  <p className="text-xs text-slate-700">{block.content}</p>
                </div>
              );
            }

            return null;
          })}
        </div>
      )}
    </div>
  );
}

// ==========================================
// Main Page
// ==========================================
export default function Home() {
  const [query, setQuery] = useState("");
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
  const [showDebugModal, setShowDebugModal] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const [activeCustomer] = useState<CustomerProfile>(DEFAULT_CUSTOMER);
  const [feedbackMap, setFeedbackMap] = useState<Record<string, "up" | "down">>({});
  const [showPolicyModal, setShowPolicyModal] = useState(false);
  const [policyContent, setPolicyContent] = useState<string>("");
  const [isPolicyLoading, setIsPolicyLoading] = useState(false);
  const [showPdfModal, setShowPdfModal] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const {
    planResult,
    analysisResult,
    isLoading,
    isCompleted,
    progress,
    currentStepLabel,
    stepLogs,
    error,
    startStream,
    confirmStream,
    sendSlotFill,
    resetStream,
  } = useSSE();

  const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(Math.max(textareaRef.current.scrollHeight, 80), 200)}px`;
    }
  }, [query]);

  const handleOpenPolicyModal = async () => {
    setShowPolicyModal(true);
    if (!policyContent) {
      setIsPolicyLoading(true);
      try {
        const res = await fetch(`${baseUrl}/api/v1/policy/jang`);
        const d = await res.json();
        if (d.policy_md) setPolicyContent(d.policy_md);
      } catch (e) {
        console.error("보험증권 로드 실패:", e);
      } finally {
        setIsPolicyLoading(false);
      }
    }
  };

  const handleFeedback = (msgId: string, type: "up" | "down") => {
    setFeedbackMap((prev) => ({
      ...prev,
      [msgId]: prev[msgId] === type ? (undefined as any) : type,
    }));
  };

  const [liveElapsedSec, setLiveElapsedSec] = useState<number>(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (isLoading) {
      if (!startTimeRef.current) startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        if (startTimeRef.current) {
          setLiveElapsedSec(parseFloat(((Date.now() - startTimeRef.current) / 1000).toFixed(1)));
        }
      }, 100);
    } else {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      startTimeRef.current = null;
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isLoading]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Phase 1: planResult → 마지막 assistant 메시지에 저장
  useEffect(() => {
    if (!planResult) return;
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last.sender !== "assistant") return prev;
      const updated: ChatMessage = {
        ...last,
        text: planResult.answer,
        planResult,
        analysisResult: undefined, // 이전 분석 결과 초기화
        elapsedSec: liveElapsedSec > 0 ? liveElapsedSec : last.elapsedSec,
      };
      return [...prev.slice(0, -1), updated];
    });
  }, [planResult, liveElapsedSec]);

  // Phase 2: analysisResult → 마지막 assistant 메시지에 저장
  useEffect(() => {
    if (!analysisResult) return;
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last.sender !== "assistant") return prev;
      const isSlotAsking = analysisResult.status === "NEED_MORE_INFO";
      const updated: ChatMessage = {
        ...last,
        text: analysisResult.answer,
        analysisResult,
        isSlotAsking,
        elapsedSec: liveElapsedSec > 0 ? liveElapsedSec : last.elapsedSec,
      };
      return [...prev.slice(0, -1), updated];
    });
  }, [analysisResult, liveElapsedSec]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || isLoading) return;

    const currentInput = query.trim();
    const timestamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    const userMsg: ChatMessage = { id: `user-${Date.now()}`, sender: "counselor", text: currentInput, timestamp };
    const isSlotResponse = messages.length > 0 && messages[messages.length - 1].isSlotAsking;
    const assistantMsg: ChatMessage = {
      id: `assistant-${Date.now()}`,
      sender: "assistant",
      text: "",
      timestamp,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setQuery("");

    if (isSlotResponse) {
      sendSlotFill("hospital_days", currentInput);
    } else {
      startStream(currentInput);
    }
  };

  // HITL 승인: 새 assistant 슬롯을 추가하고 confirmStream 호출
  const handleConfirm = (originalQuery: string) => {
    const timestamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const confirmMsg: ChatMessage = {
      id: `assistant-confirm-${Date.now()}`,
      sender: "assistant",
      text: "",
      timestamp,
    };
    setMessages((prev) => [...prev, confirmMsg]);
    confirmStream(originalQuery);
  };

  const handleClearChat = () => {
    setMessages([]);
    resetStream();
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/20 to-indigo-50/30 text-slate-800 p-4 md:p-6 font-sans relative flex flex-col">

      {/* Header */}
      <header className="max-w-7xl mx-auto w-full flex items-center justify-between pb-3 border-b border-slate-200 mb-4 shrink-0">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-blue-600 flex items-center justify-center font-bold text-white shadow-md shadow-indigo-500/20">
            👩‍💼
          </div>
          <div>
            <h1 className="text-lg font-bold bg-gradient-to-r from-blue-700 via-indigo-700 to-indigo-900 bg-clip-text text-transparent">
              AIQ — 상담사 보조 약관 조회 시스템
            </h1>
            <p className="text-[10px] text-slate-400 font-medium">손해사정 이전 단계 • 약관 DB 기반 보장 범위 참고용</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {messages.length > 0 && (
            <button
              onClick={handleClearChat}
              className="px-3 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-200 text-xs font-medium text-rose-700 transition-all cursor-pointer"
            >
              대화 초기화
            </button>
          )}
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-indigo-100/80 text-indigo-800 border border-indigo-200">
            ● 상담사 인바운드 모드
          </span>
        </div>
      </header>

      {/* 2-Column Body */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 flex-1 items-start max-w-7xl mx-auto w-full">

        {/* Right: Profile + Input */}
        <div className="lg:col-span-4 lg:order-2 space-y-4">

          {/* Customer Profile */}
          <section className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-2">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-blue-600 via-indigo-600 to-indigo-700 flex items-center justify-center text-white font-bold text-base shadow-sm shrink-0">
                {activeCustomer.name.slice(0, 1)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-slate-900 truncate">{activeCustomer.name} 님</span>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-semibold border border-emerald-200 shrink-0">
                    {activeCustomer.status}
                  </span>
                </div>
                <p className="text-xs text-slate-500 font-medium">{activeCustomer.birthDate} | {activeCustomer.phone}</p>
              </div>
            </div>
            <div className="pt-2 border-t border-slate-100 text-xs text-slate-600">
              <div className="flex items-center justify-between">
                <span className="truncate">가입 상품: <span className="font-semibold text-slate-900">{activeCustomer.policyName}</span></span>
                <div className="flex items-center gap-1 shrink-0 ml-2">
                  <button
                    type="button"
                    onClick={handleOpenPolicyModal}
                    className="text-[10px] px-1.5 py-0.5 rounded border border-slate-300 bg-slate-100 hover:bg-slate-200 text-slate-600 font-medium transition-all cursor-pointer"
                    title="보험증권 열기"
                  >
                    증권
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowPdfModal(true)}
                    className="text-[10px] px-1.5 py-0.5 rounded border border-slate-300 bg-slate-100 hover:bg-slate-200 text-slate-600 font-medium transition-all cursor-pointer"
                    title="약관 PDF 열기"
                  >
                    약관
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* Input Form */}
          <section className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
            <form onSubmit={handleSubmit} className="space-y-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">
                상담 내용 입력
              </label>
              <textarea
                ref={textareaRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e);
                  }
                }}
                placeholder={
                  messages.length > 0 && messages[messages.length - 1].isSlotAsking
                    ? "추가 정보(예: 5일 입원)를 입력하고 Enter..."
                    : "고객 질의 및 상담 내용을 입력하세요...\n예) 장석찬 / 재해골절(늑골) / 5일 입원 / 보장 조회"
                }
                rows={4}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all resize-none"
              />
              <button
                type="submit"
                disabled={isLoading || !query.trim()}
                className={`w-full py-2.5 rounded-full text-xs font-semibold transition-all flex items-center justify-center gap-2 ${
                  query.trim() && !isLoading
                    ? "bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm cursor-pointer"
                    : "bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200"
                }`}
              >
                {isLoading ? (
                  <>
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                    처리 중... ({progress}%)
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6"/>
                    </svg>
                    전송
                  </>
                )}
              </button>
            </form>

            {/* Current step label */}
            {isLoading && currentStepLabel && (
              <div className="mt-2 text-[10px] text-indigo-600 font-medium animate-pulse flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping" />
                {currentStepLabel}
              </div>
            )}
          </section>
        </div>

        {/* Left: Chat Area */}
        <div className="lg:col-span-8 lg:order-1 flex flex-col h-[calc(100vh-120px)] min-h-[500px] bg-white border border-slate-200 rounded-2xl p-5 shadow-xs overflow-y-auto space-y-5">

          {/* Empty state */}
          {messages.length === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center select-none pointer-events-none">
              <div className="text-center opacity-[0.07] space-y-2">
                <div className="text-7xl font-black text-slate-800 tracking-tight">AIQ</div>
                <div className="text-sm font-semibold text-slate-600 tracking-widest uppercase">Insurance Counseling</div>
              </div>
              <div className="mt-8 opacity-[0.3] text-center space-y-1">
                <p className="text-[11px] text-slate-500">우측 입력창에 상담 내용을 입력하세요.</p>
                <p className="text-[11px] text-slate-400">약관 DB 조회 전 상담사 승인(HITL)이 필요합니다.</p>
              </div>
            </div>
          )}

          {/* Messages */}
          {messages.map((msg, index) => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.sender === "counselor" ? "items-end" : "items-start"}`}
            >
              {/* Counselor bubble */}
              {msg.sender === "counselor" ? (
                <div className="max-w-xl bg-gradient-to-r from-indigo-600 to-blue-600 text-white rounded-2xl px-4 py-3 shadow-sm text-xs leading-relaxed">
                  <span className="text-[10px] text-indigo-100 font-bold uppercase block mb-1">👩‍💼 상담사 질의</span>
                  <p className="whitespace-pre-wrap">{msg.text}</p>
                  <span className="text-[10px] text-indigo-200 block text-right mt-1 opacity-80">{msg.timestamp}</span>
                </div>
              ) : (
                /* AI Response Card */
                <div className="w-full bg-slate-50/60 border border-slate-200/90 rounded-2xl p-5 shadow-xs space-y-4">
                  {/* Card header */}
                  <div className="flex items-center justify-between pb-2 border-b border-slate-200/80">
                    <span className="text-xs font-bold text-indigo-700 uppercase tracking-wider flex items-center gap-2">
                      🤖 AIQ 약관 분석
                    </span>
                    <div className="flex items-center gap-2">
                      {msg.elapsedSec && (
                        <span className="px-2 py-0.5 rounded-full bg-slate-200/80 text-slate-700 text-[10px] font-mono font-medium border border-slate-300/70">
                          ⏱️ {msg.elapsedSec}초
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => setShowDebugModal(true)}
                        className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-slate-200/60 rounded transition-all cursor-pointer text-xs"
                        title="파이프라인 로그"
                      >
                        🐛
                      </button>
                      <span className="text-[11px] text-slate-400">{msg.timestamp}</span>
                    </div>
                  </div>

                  {/* Loading indicator */}
                  {isLoading && index === messages.length - 1 && (
                    <div className="p-4 bg-indigo-50/80 border border-indigo-200/90 rounded-xl flex items-center gap-4 text-xs shadow-2xs">
                      <div className="relative w-10 h-10 flex items-center justify-center shrink-0">
                        <svg className="w-10 h-10 transform -rotate-90">
                          <circle cx="20" cy="20" r="16" stroke="currentColor" strokeWidth="3" className="text-indigo-200/70" fill="transparent"/>
                          <circle cx="20" cy="20" r="16" stroke="currentColor" strokeWidth="3" className="text-indigo-600 transition-all duration-300" fill="transparent"
                            strokeDasharray={100.5} strokeDashoffset={100.5 - (100.5 * progress) / 100} strokeLinecap="round"/>
                        </svg>
                        <span className="absolute text-[10px] font-bold font-mono text-indigo-800">{progress}%</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between font-bold text-indigo-900 mb-0.5">
                          <span className="text-xs text-indigo-950 font-semibold animate-pulse">
                            {currentStepLabel || "AI 약관 분석 중..."}
                          </span>
                          <span className="font-mono text-indigo-700 text-xs font-bold">⏱️ {liveElapsedSec.toFixed(1)}s</span>
                        </div>
                        <p className="text-[11px] text-indigo-600">약관 DB 탐색 및 보장 조항 대조 중입니다.</p>
                      </div>
                    </div>
                  )}

                  {/* Phase 1: AWAITING_CONFIRMATION → PlanCard */}
                  {msg.planResult && !msg.analysisResult && (
                    <PlanCard
                      planResult={msg.planResult}
                      onConfirm={() => {
                        // 이전 counselor 메시지에서 원본 쿼리 찾기
                        const counselorMsgs = messages.filter((m) => m.sender === "counselor");
                        const lastQuery = counselorMsgs[counselorMsgs.length - 1]?.text || "";
                        handleConfirm(lastQuery);
                      }}
                    />
                  )}

                  {/* Phase 2: analysisResult → AnalysisCard */}
                  {msg.analysisResult && (
                    <AnalysisCard
                      analysisResult={msg.analysisResult}
                      onCite={(c) => setActiveCitation(c)}
                    />
                  )}

                  {/* Feedback */}
                  {(msg.analysisResult || msg.planResult) && (
                    <div className="pt-2 flex items-center justify-between border-t border-slate-200/60 text-[11px] text-slate-400">
                      <span className="text-[10px]">답변 만족도 평가</span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleFeedback(msg.id, "up")}
                          className={`p-1 px-1.5 rounded hover:bg-slate-200/60 transition-all flex items-center gap-1 cursor-pointer ${
                            feedbackMap[msg.id] === "up" ? "bg-blue-50 text-blue-600 font-bold border border-blue-200" : "text-slate-400"
                          }`}
                        >
                          👍 <span className="text-[10px]">{feedbackMap[msg.id] === "up" ? "도움됨" : ""}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleFeedback(msg.id, "down")}
                          className={`p-1 px-1.5 rounded hover:bg-slate-200/60 transition-all flex items-center gap-1 cursor-pointer ${
                            feedbackMap[msg.id] === "down" ? "bg-rose-50 text-rose-600 font-bold border border-rose-200" : "text-slate-400"
                          }`}
                        >
                          👎 <span className="text-[10px]">{feedbackMap[msg.id] === "down" ? "의견제출" : ""}</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>
      </div>

      {/* Citation Modal */}
      {activeCitation && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-slate-300 rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <span className="text-xs font-bold text-blue-700 flex items-center gap-1.5">📄🔍 약관 원문 발췌</span>
              <button onClick={() => setActiveCitation(null)} className="text-slate-400 hover:text-slate-700 font-bold p-1 rounded hover:bg-slate-100 transition-all cursor-pointer">✕</button>
            </div>
            <div>
              <h4 className="text-sm font-bold text-slate-900">{activeCitation.section_title}</h4>
              <p className="text-xs text-slate-500 mt-0.5">위치: <span className="font-semibold text-slate-700">{activeCitation.page}페이지</span></p>
            </div>
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 leading-relaxed max-h-60 overflow-y-auto font-mono">
              &ldquo;{activeCitation.snippet}&rdquo;
            </div>
            <div className="flex justify-end">
              <button onClick={() => setActiveCitation(null)} className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-xl shadow-md transition-all cursor-pointer">닫기</button>
            </div>
          </div>
        </div>
      )}

      {/* Policy Modal */}
      {showPolicyModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-slate-300 rounded-2xl p-6 max-w-3xl w-full shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 shrink-0">
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-sm">📋</span>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">{activeCustomer.name} 님 개인 보험증권</h3>
                  <p className="text-[11px] text-slate-500">{activeCustomer.policyName}</p>
                </div>
              </div>
              <button onClick={() => setShowPolicyModal(false)} className="text-slate-400 hover:text-slate-700 font-bold p-1 rounded hover:bg-slate-100 transition-all cursor-pointer">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 bg-slate-50/70 border border-slate-200/80 rounded-xl text-xs text-slate-800 leading-relaxed">
              {isPolicyLoading ? (
                <div className="py-12 text-center text-slate-500 animate-pulse">📋 불러오는 중...</div>
              ) : (
                renderMd(policyContent) || "보험증권 데이터를 찾을 수 없습니다."
              )}
            </div>
            <div className="flex justify-end pt-2 border-t border-slate-200 shrink-0">
              <button onClick={() => setShowPolicyModal(false)} className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-xl shadow-md transition-all cursor-pointer">닫기</button>
            </div>
          </div>
        </div>
      )}

      {/* Debug Modal */}
      {showDebugModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-slate-300 rounded-2xl p-6 max-w-xl w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2 text-indigo-700 font-bold text-sm"><span>🐛</span><span>파이프라인 디버그 로그</span></div>
              <button onClick={() => setShowDebugModal(false)} className="text-slate-400 hover:text-slate-700 font-bold p-1 rounded hover:bg-slate-100 transition-all cursor-pointer">✕</button>
            </div>
            <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl font-mono text-xs text-emerald-400 space-y-2 max-h-80 overflow-y-auto">
              <div className="text-slate-400 pb-1 border-b border-slate-800 text-[11px]">⏱️ 단계별 처리 기록</div>
              {stepLogs.length === 0 ? (
                <div className="text-slate-500 py-4 text-center">기록 없음. 질문을 전송하세요.</div>
              ) : (
                stepLogs.map((log: StepLog, idx: number) => (
                  <div key={idx} className="flex items-start gap-2 py-1 border-b border-slate-800/60 last:border-b-0">
                    <span className="text-slate-500 text-[10px] shrink-0">[{log.timestamp}]</span>
                    <span className="text-emerald-300">{log.label}</span>
                  </div>
                ))
              )}
            </div>
            <div className="flex justify-end">
              <button onClick={() => setShowDebugModal(false)} className="px-4 py-1.5 bg-slate-800 hover:bg-slate-900 text-white font-semibold text-xs rounded-xl transition-all cursor-pointer">닫기</button>
            </div>
          </div>
        </div>
      )}

      {/* PDF Modal */}
      {showPdfModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-slate-300 rounded-2xl shadow-2xl flex flex-col w-full max-w-4xl h-[90vh]">
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 shrink-0">
              <span className="text-xs font-bold text-slate-700">{activeCustomer.name} 님 보험약관 PDF</span>
              <button onClick={() => setShowPdfModal(false)} className="text-slate-400 hover:text-slate-700 font-bold p-1 rounded hover:bg-slate-100 transition-all cursor-pointer">✕</button>
            </div>
            <iframe
              src={`${baseUrl}/api/v1/policy-pdf/jang`}
              className="flex-1 w-full rounded-b-2xl"
              title="보험약관 PDF"
            />
          </div>
        </div>
      )}
    </main>
  );
}
