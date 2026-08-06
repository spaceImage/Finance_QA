"use client";

import React, { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { useSSE, UIBlock, Citation, NodeLog } from "@/hooks/useSSE";

// pdf.js는 브라우저 전용(canvas/DOMMatrix) API에 의존하므로, 서버 사이드 프리렌더 시
// 빌드가 깨지지 않도록 클라이언트에서만 동적으로 로드합니다.
const PdfHighlightViewer = dynamic(() => import("@/components/PdfHighlightViewer"), {
  ssr: false,
  loading: () => (
    <div className="h-full flex items-center justify-center text-xs text-slate-400 font-semibold animate-pulse">
      PDF 뷰어를 불러오는 중입니다...
    </div>
  ),
});

interface CustomerProfile {
  name: string;
  policyNo: string;
  policyName: string;
  birthDate: string;
  phone: string;
}

const DEFAULT_CUSTOMER: CustomerProfile = {
  name: "장석찬",
  policyNo: "AIQ-2024-99812",
  policyName: "AIQ (무)재해치료비보장특약",
  birthDate: "1997.11.11.",
  phone: "010-0000-0000",
};

interface ChatMessage {
  id: string;
  sender: "counselor" | "assistant";
  text: string;
  blocks?: UIBlock[];
  isSlotAsking?: boolean;
  timestamp: string;
  elapsedSec?: number;
  intent?: string;
  tasks?: string[];
  llmCalls?: number;
  nodeLogs?: NodeLog[];
}

function parseInlineMarkdown(text: string): React.ReactNode {
  if (!text) return text;
  const regex = /(\*\*.*?\*\*|\[출처:\s*.*?\])/g;
  const parts = text.split(regex);

  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      return (
        <strong key={i} className="font-extrabold text-slate-900 bg-amber-100/60 px-1 py-0.2 rounded border border-amber-200/60 mx-0.5">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("[출처:") && part.endsWith("]")) {
      return (
        <span key={i} className="inline-flex items-center gap-1 px-1.5 py-0.2 bg-indigo-100/90 text-indigo-900 text-[10px] font-mono font-bold rounded border border-indigo-200 mx-1">
          <span>📖</span>
          <span>{part.slice(1, -1)}</span>
        </span>
      );
    }
    return part;
  });
}

function renderFormattedMarkdown(mdText: string) {
  if (!mdText) return null;

  const lines = mdText.split("\n");
  const elements: React.ReactNode[] = [];
  let tableRows: string[][] = [];
  let quoteBuffer: { line: string; idx: number }[] = [];

  const flushTable = (key: string) => {
    if (tableRows.length === 0) return;
    const header = tableRows[0];
    const body = tableRows.slice(1);
    elements.push(
      <div key={key} className="my-3 overflow-x-auto border border-slate-200 rounded-xl shadow-2xs bg-white">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-slate-100/90 border-b border-slate-200 text-slate-800 font-bold">
              {header.map((h, hIdx) => (
                <th key={hIdx} className="p-2.5 border-r border-slate-200 last:border-r-0 font-semibold">
                  {parseInlineMarkdown(h.trim())}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {body.map((row, rIdx) => (
              <tr key={rIdx} className="hover:bg-slate-50/70 transition-colors">
                {row.map((cell, cIdx) => (
                  <td key={cIdx} className="p-2.5 border-r border-slate-200 last:border-r-0 font-sans">
                    {parseInlineMarkdown(cell.trim())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    tableRows = [];
  };

  const flushQuote = (key: string) => {
    if (quoteBuffer.length === 0) return;
    const fullText = quoteBuffer.map((q) => q.line.slice(2)).join("\n");
    const isCaution = fullText.includes("⚠️") || fullText.includes("유의사항");
    const isDeliver = fullText.includes("✅") || fullText.includes("전달 가이드");
    const isPayout = fullText.includes("🛡️") || fullText.includes("💰") || fullText.includes("보장 기준");
    const isEvidence = fullText.includes("📚") || fullText.includes("약관 근거");

    const blockStyle = isCaution
      ? "p-3.5 bg-amber-50/90 border-l-4 border-amber-500 rounded-r-xl text-xs text-amber-950 font-sans my-2.5 leading-relaxed shadow-2xs space-y-1"
      : isDeliver
      ? "p-3.5 bg-emerald-50/90 border-l-4 border-emerald-500 rounded-r-xl text-xs text-emerald-950 font-sans my-2.5 leading-relaxed shadow-2xs space-y-1"
      : isPayout
      ? "p-3.5 bg-gradient-to-r from-indigo-50 to-blue-50 border-l-4 border-indigo-600 rounded-r-xl text-xs text-indigo-950 font-sans my-2.5 leading-relaxed shadow-2xs space-y-1 font-semibold"
      : isEvidence
      ? "p-3.5 bg-slate-100/80 border-l-4 border-slate-600 rounded-r-xl text-xs text-slate-900 font-sans my-2.5 leading-relaxed shadow-2xs space-y-1"
      : "p-3.5 bg-indigo-50/70 border-l-4 border-indigo-600 rounded-r-xl text-xs text-indigo-950 font-sans my-2 leading-relaxed space-y-1";

    elements.push(
      <blockquote key={key} className={blockStyle}>
        {quoteBuffer.map((q, qIdx) => {
          const content = q.line.slice(2).trim();
          if (content.startsWith("- ") || content.startsWith("* ")) {
            return (
              <div key={qIdx} className="ml-2 flex items-start gap-1.5 my-0.5">
                <span className="text-slate-500 font-bold">•</span>
                <span>{parseInlineMarkdown(content.slice(2))}</span>
              </div>
            );
          }
          if (/^\d+[\.\)]\s*/.test(content)) {
            return (
              <div key={qIdx} className="ml-2 flex items-start gap-1.5 my-0.5 font-medium">
                <span>{parseInlineMarkdown(content)}</span>
              </div>
            );
          }
          return (
            <div key={qIdx} className="my-0.5">
              {parseInlineMarkdown(content)}
            </div>
          );
        })}
      </blockquote>
    );
    quoteBuffer = [];
  };

  lines.forEach((line, idx) => {
    const trimmed = line.trim();

    if (trimmed.startsWith("> ")) {
      flushTable(`table-${idx}`);
      quoteBuffer.push({ line: trimmed, idx });
      return;
    } else {
      flushQuote(`quote-${idx}`);
    }

    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const cells = trimmed
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim());
      if (cells.every((c) => /^:?-+:?$/.test(c))) {
        return;
      }
      tableRows.push(cells);
      return;
    } else {
      flushTable(`table-${idx}`);
    }

    if (trimmed.startsWith("# ")) {
      elements.push(
        <h1 key={idx} className="text-base font-extrabold text-slate-900 mt-4 mb-2 pb-1 border-b border-slate-200 flex items-center gap-1.5">
          {parseInlineMarkdown(trimmed.slice(2))}
        </h1>
      );
    } else if (trimmed.startsWith("## ")) {
      elements.push(
        <h2 key={idx} className="text-sm font-bold text-slate-800 mt-3 mb-1.5 flex items-center gap-1.5">
          {parseInlineMarkdown(trimmed.slice(3))}
        </h2>
      );
    } else if (trimmed.startsWith("### ")) {
      elements.push(
        <h3 key={idx} className="text-xs font-bold text-indigo-900 mt-2.5 mb-1 flex items-center gap-1.5">
          {parseInlineMarkdown(trimmed.slice(4))}
        </h3>
      );
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      elements.push(
        <li key={idx} className="ml-4 list-disc text-slate-700 my-1 leading-relaxed text-xs">
          {parseInlineMarkdown(trimmed.slice(2))}
        </li>
      );
    } else if (/^\d+[\.\)]\s*/.test(trimmed)) {
      elements.push(
        <li key={idx} className="ml-4 list-decimal text-slate-700 my-1 leading-relaxed text-xs">
          {parseInlineMarkdown(trimmed.replace(/^\d+[\.\)]\s*/, ""))}
        </li>
      );
    } else if (trimmed === "") {
      elements.push(<div key={idx} className="h-1" />);
    } else {
      elements.push(
        <p key={idx} className="my-1 leading-relaxed text-xs text-slate-800">
          {parseInlineMarkdown(trimmed)}
        </p>
      );
    }
  });

  flushQuote("quote-final");
  flushTable("table-final");
  return elements;
}

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeCustomer] = useState<CustomerProfile>(DEFAULT_CUSTOMER);
  const [feedbackMap, setFeedbackMap] = useState<Record<string, "up" | "down">>({});
  const [showPolicyModal, setShowPolicyModal] = useState(false);
  const [policyContent, setPolicyContent] = useState<string>("");
  const [isPolicyLoading, setIsPolicyLoading] = useState(false);
  const [showPdfModal, setShowPdfModal] = useState(false);
  const [showJsonRaw, setShowJsonRaw] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);

  const {
    data,
    blocks,
    status,
    isLoading,
    isCompleted,
    progress,
    currentStepLabel,
    stepLogs,
    nodeLogs,
    tasks,
    intent,
    llmCalls,
    loopCount,
    error,
    sessionId,
    startStream,
    sendSlotFill,
    approveTaskPlan,
    resetStream,
  } = useSSE();

  const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  const handleOpenPolicyModal = async () => {
    setShowPolicyModal(true);
    if (!policyContent) {
      setIsPolicyLoading(true);
      try {
        const targetTask = "jang";
        const res = await fetch(`${baseUrl}/api/v1/policy/${targetTask}`);
        const resData = await res.json();
        if (resData.policy_md) {
          setPolicyContent(resData.policy_md);
        }
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

  // 실시간 타이머 (시작부터 종료/오류/중단 완료까지 끊김 없이 카운트)
  useEffect(() => {
    if (isLoading) {
      if (!startTimeRef.current) {
        startTimeRef.current = Date.now();
      }
      timerRef.current = setInterval(() => {
        if (startTimeRef.current) {
          setLiveElapsedSec(parseFloat(((Date.now() - startTimeRef.current) / 1000).toFixed(1)));
        }
      }, 100);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (startTimeRef.current) {
        const finalSec = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
        setMessages((prev) => {
          if (prev.length === 0) return prev;
          const lastMsg = prev[prev.length - 1];
          if (lastMsg.sender === "assistant") {
            return [...prev.slice(0, -1), { ...lastMsg, elapsedSec: lastMsg.elapsedSec || finalSec }];
          }
          return prev;
        });
        startTimeRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isLoading]);

  // 자동 스크롤
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, data, blocks]);

  // 실시간 스트리밍 업데이트를 messages 마지막 AI 메세지에 반영
  useEffect(() => {
    if (!isLoading && !data && blocks.length === 0) return;

    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const lastMsg = prev[prev.length - 1];

      if (lastMsg.sender === "assistant") {
        const isSlotAsking = data.includes("입원 일수") || data.includes("Slot Filling") || data.includes("추가 정보");
        const currentElapsed = startTimeRef.current
          ? Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000))
          : (lastMsg.elapsedSec || (liveElapsedSec > 0 ? Math.round(liveElapsedSec) : undefined));

        const updatedMsg: ChatMessage = {
          ...lastMsg,
          text: data || lastMsg.text || "",
          blocks: blocks.length > 0 ? blocks : lastMsg.blocks,
          isSlotAsking,
          elapsedSec: currentElapsed,
          intent: intent || lastMsg.intent,
          tasks: tasks && tasks.length > 0 ? tasks : lastMsg.tasks,
          llmCalls: llmCalls > 0 ? llmCalls : lastMsg.llmCalls,
          nodeLogs: nodeLogs && nodeLogs.length > 0 ? nodeLogs : lastMsg.nodeLogs,
        };
        return [...prev.slice(0, -1), updatedMsg];
      }
      return prev;
    });
  }, [data, blocks, isLoading, liveElapsedSec, intent, tasks, llmCalls, nodeLogs]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const queryInput = (e.target as any).elements.queryInput;
    const query = queryInput.value.trim();
    if (!query || isLoading) return;

    startTimeRef.current = Date.now();
    setLiveElapsedSec(0);

    const userMsg: ChatMessage = {
      id: `usr-${Date.now()}`,
      sender: "counselor",
      text: query,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    const initialAiMsg: ChatMessage = {
      id: `ai-${Date.now()}`,
      sender: "assistant",
      text: "",
      blocks: [],
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMsg, initialAiMsg]);
    queryInput.value = "";

    startStream(query, "jang");
  };

  const handlePresetClick = (presetQuery: string) => {
    if (isLoading) return;
    startTimeRef.current = Date.now();
    setLiveElapsedSec(0);

    const userMsg: ChatMessage = {
      id: `usr-${Date.now()}`,
      sender: "counselor",
      text: presetQuery,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    const initialAiMsg: ChatMessage = {
      id: `ai-${Date.now()}`,
      sender: "assistant",
      text: "",
      blocks: [],
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMsg, initialAiMsg]);
    startStream(presetQuery, "jang");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/20 to-indigo-50/30 text-slate-800 font-sans flex flex-col">
      {/* Light Theme Header */}
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-200/80 sticky top-0 z-40 px-4 py-3 shadow-2xs">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-blue-600 flex items-center justify-center font-bold text-white shadow-md shadow-indigo-500/20 text-base">
              🛡️
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-extrabold bg-gradient-to-r from-blue-700 via-indigo-700 to-indigo-900 bg-clip-text text-transparent">
                  AIQ 손해사정 보상 가이드 시스템
                </h1>
                <span className="px-2 py-0.5 bg-indigo-100 text-indigo-800 border border-indigo-200 text-[10px] font-mono font-bold rounded-full">
                  LangGraph v2.0
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                약관 기반 멀티홉 추론 및 구조화 UI 보상 가이드 시스템
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Direct Debugger Link Button */}
            <a
              href="/debug"
              className="px-3.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold rounded-xl border border-indigo-200 transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
            >
              <span>⚡</span>
              <span>LangGraph 관제 패널 (/debug)</span>
            </a>

            <button
              onClick={() => setShowPdfModal(true)}
              className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 text-xs font-medium rounded-xl border border-slate-300 shadow-2xs transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <span>📄</span>
              <span>약관 PDF 보기</span>
            </button>
            <button
              onClick={handleOpenPolicyModal}
              className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 text-xs font-medium rounded-xl border border-slate-300 shadow-2xs transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <span>📋</span>
              <span>증권 MD 보기</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Body */}
      <div className="max-w-6xl mx-auto w-full flex-1 grid grid-cols-1 md:grid-cols-4 gap-5 p-4 md:p-6">
        {/* Left Sidebar: Customer Profile & Preset Queries */}
        <aside className="md:col-span-1 space-y-4">
          <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <span className="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
                <span>👤</span> 피보험자 정보
              </span>
              <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold rounded-full">
                정상 계약
              </span>
            </div>
            <div className="space-y-1.5 text-xs text-slate-700 font-mono">
              <div className="flex justify-between">
                <span className="text-slate-400">성명:</span>
                <span className="font-bold text-slate-900">{activeCustomer.name} 님</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">생년월일:</span>
                <span>{activeCustomer.birthDate}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">증권번호:</span>
                <span className="text-[11px] text-indigo-600 font-bold">{activeCustomer.policyNo}</span>
              </div>
            </div>
            <div className="pt-2 border-t border-slate-100 text-[11px] text-slate-500">
              <div className="font-bold text-slate-700 mb-0.5">주요 가입 특약:</div>
              <div className="bg-slate-50 p-2 rounded-lg border border-slate-200/80 leading-relaxed font-mono">
                • (무)재해치료비보장특약
                <br />• 재해골절 보장 (20만원/회)
                <br />• 암진단/입원비 특약 (1,000만원)
              </div>
            </div>
          </div>

          {/* Quick Presets */}
          <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs space-y-2.5">
            <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <span>💡</span> 빠른 보상 상담 질문
            </span>
            <div className="space-y-1.5">
              {[
                "재해골절 시 얼마 나오나요?",
                "갑상선암 진단 시 보장 금액은?",
                "대장점막내암 진단 후 10일 입원 시 보상금은?",
                "AIQ는 왜 보험료가 비싼가요?",
              ].map((q, idx) => (
                <button
                  key={idx}
                  onClick={() => handlePresetClick(q)}
                  disabled={isLoading}
                  className="w-full text-left p-2.5 bg-slate-50 hover:bg-indigo-50/60 hover:border-indigo-200 text-slate-700 hover:text-indigo-900 text-xs font-medium rounded-xl border border-slate-200 transition-all cursor-pointer disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* Right Main Chat Container */}
        <section className="md:col-span-3 bg-white border border-slate-200/90 rounded-2xl shadow-sm flex flex-col h-[75vh] md:h-[82vh] overflow-hidden">
          {/* Chat Messages Log */}
          <div className="flex-1 p-4 md:p-6 overflow-y-auto space-y-6">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center space-y-3 text-slate-400">
                <div className="w-14 h-14 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-2xl">
                  💬
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-700">손해사정 보상 상담을 시작하세요</h3>
                  <p className="text-xs text-slate-400 mt-1 max-w-sm">
                    좌측의 샘플 질문을 클릭하시거나, 하단에 보상 관련 질의를 입력하시면 약관 기반으로 정밀 안내해 드립니다.
                  </p>
                </div>
              </div>
            ) : (
              messages.map((msg, index) => (
                <div key={msg.id || index} className="space-y-3">
                  {/* Counselor Question */}
                  {msg.sender === "counselor" ? (
                    <div className="flex justify-end">
                      <div className="max-w-xl bg-gradient-to-r from-indigo-600 to-blue-600 text-white rounded-2xl px-4 py-3 shadow-xs text-xs leading-relaxed">
                        <span className="text-[10px] text-indigo-100 font-bold uppercase block mb-1">👩‍💼 상담사 질의</span>
                        <p className="whitespace-pre-wrap font-sans">{msg.text}</p>
                        <span className="text-[10px] text-indigo-200 block text-right mt-1 opacity-80">{msg.timestamp}</span>
                      </div>
                    </div>
                  ) : (
                    /* Assistant Response Card */
                    <div className="w-full bg-slate-50/70 border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
                      {/* Header */}
                      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200/80">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-extrabold text-indigo-900 uppercase tracking-wider flex items-center gap-1.5">
                            🤖 AI 손해사정 가이드
                          </span>
                          {msg.intent && (
                            <span className="px-2 py-0.5 bg-indigo-100 text-indigo-800 text-[10px] font-mono font-bold rounded-md border border-indigo-200">
                              의도: {msg.intent}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          {isLoading && index === messages.length - 1 ? (
                            <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 text-[10px] font-mono font-extrabold border border-blue-300 flex items-center gap-1 animate-pulse">
                              <span>⏱️</span>
                              <span>{liveElapsedSec.toFixed(1)}s (진행 중...)</span>
                            </span>
                          ) : (msg.elapsedSec !== undefined && msg.elapsedSec !== null) ? (
                            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[10px] font-mono font-bold border border-slate-300 flex items-center gap-1">
                              <span>⏱️</span>
                              <span>{Math.max(1, msg.elapsedSec)}초 소요</span>
                            </span>
                          ) : null}
                          {msg.llmCalls && (
                            <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 text-[10px] font-mono font-bold border border-purple-200">
                              API 호출 {msg.llmCalls}회
                            </span>
                          )}
                          <a
                            href="/debug"
                            className="px-2 py-0.5 text-xs bg-white hover:bg-slate-100 text-slate-600 rounded-lg border border-slate-300 transition-all flex items-center gap-1 cursor-pointer font-bold"
                            title="LangGraph 관제 패널로 이동"
                          >
                            <span>⚡</span> <span>관제 패널</span>
                          </a>
                        </div>
                      </div>

                      {/* Real-time Stepper Progress Bar (수행 중: 파랑, 완결: 초록, 중단/오류: 빨강 경고바 유지) */}
                      {(() => {
                        const isActive = index === messages.length - 1;
                        const isRunning = isActive && (!isCompleted || isLoading);
                        const logs = isActive ? (nodeLogs && nodeLogs.length > 0 ? nodeLogs : (msg.nodeLogs || [])) : (msg.nodeLogs || []);
                        const completedNodes = new Set(logs.map((l: any) => l.node));

                        const isOutOfScope = logs.some((l: any) => l.is_valid === false || l.node === "out_of_scope_response") ||
                          msg.text.includes("범위 밖") || msg.text.includes("중단") || msg.text.includes("오류") ||
                          (isActive && status === "OUT_OF_SCOPE");

                        let pct = 15;
                        if (!isRunning) {
                          pct = isOutOfScope ? Math.max(15, Math.round((logs.length / 6) * 100)) : 100;
                        } else {
                          if (completedNodes.has("generate")) pct = 90;
                          else if (completedNodes.has("multi_hop_reasoning")) pct = 80;
                          else if (completedNodes.has("parallel_context_builder")) pct = 60;
                          else if (completedNodes.has("intent_router")) pct = 45;
                          else if (completedNodes.has("task_planner")) pct = 30;
                          else if (completedNodes.has("query_validation")) pct = 15;
                        }

                        const isErrorStyle = isOutOfScope && !isRunning;
                        const isCompleteStyle = !isRunning && !isOutOfScope;

                        const containerStyle = isErrorStyle
                          ? "p-3 bg-rose-50 border border-rose-300 rounded-xl space-y-2 animate-fade-in shadow-2xs"
                          : isCompleteStyle
                          ? "p-3 bg-emerald-50/70 border border-emerald-200 rounded-xl space-y-2 shadow-2xs"
                          : "p-3 bg-blue-50/90 border border-blue-200 rounded-xl space-y-2 animate-fade-in shadow-2xs";

                        const barStyle = isErrorStyle
                          ? "bg-rose-500 h-full rounded-full transition-all duration-300"
                          : isCompleteStyle
                          ? "bg-emerald-500 h-full rounded-full transition-all duration-300"
                          : "bg-gradient-to-r from-blue-600 to-indigo-600 h-full transition-all duration-300 rounded-full";

                        const badgeStyle = isErrorStyle
                          ? "font-mono text-[11px] text-rose-800 bg-white px-2 py-0.5 rounded border border-rose-300 font-extrabold"
                          : isCompleteStyle
                          ? "font-mono text-[11px] text-emerald-800 bg-white px-2 py-0.5 rounded border border-emerald-300 font-bold"
                          : "font-mono text-[11px] text-blue-700 bg-white px-2 py-0.5 rounded border border-blue-200 font-extrabold";

                        return (
                          <div className={containerStyle}>
                            <div className="flex items-center justify-between text-xs font-bold">
                              <span className={`flex items-center gap-1.5 ${isErrorStyle ? "text-rose-950" : isCompleteStyle ? "text-emerald-950" : "text-blue-950"}`}>
                                {isRunning ? (
                                  <span className="animate-spin text-blue-600">⚡</span>
                                ) : isErrorStyle ? (
                                  <span className="text-rose-600 font-extrabold text-sm">⚠️</span>
                                ) : (
                                  <span className="text-emerald-600 font-extrabold text-sm">✓</span>
                                )}
                                <span>
                                  {isRunning
                                    ? "실시간 LangGraph 파이프라인 수행 진행률"
                                    : isErrorStyle
                                    ? "파이프라인 수행 중단 / 범위 밖 검증 차단"
                                    : "파이프라인 수행 완결"}
                                </span>
                              </span>
                              <span className={badgeStyle}>
                                {isRunning
                                  ? `${pct}% 수행 중...`
                                  : isErrorStyle
                                  ? `수행 중단 (${pct}%)`
                                  : `100% 완료 (${msg.elapsedSec ? `${msg.elapsedSec}초 소요` : "완료"})`}
                              </span>
                            </div>

                            {/* Progress Track */}
                            <div className={`w-full h-2 rounded-full overflow-hidden ${isErrorStyle ? "bg-rose-200" : isCompleteStyle ? "bg-emerald-200" : "bg-blue-200/80"}`}>
                              <div className={barStyle} style={{ width: `${Math.min(100, Math.max(10, pct))}%` }} />
                            </div>

                            {/* Step Labels */}
                            <div className={`flex justify-between text-[10px] font-mono pt-0.5 font-medium ${isErrorStyle ? "text-rose-800" : isCompleteStyle ? "text-slate-600" : "text-blue-800"}`}>
                              <span className={completedNodes.has("query_validation") ? "font-extrabold underline" : "opacity-50"}>1.범위검증</span>
                              <span className={completedNodes.has("task_planner") ? "font-extrabold underline" : "opacity-50"}>2.작업기획</span>
                              <span className={completedNodes.has("intent_router") ? "font-extrabold underline" : "opacity-50"}>3.의도분류</span>
                              <span className={completedNodes.has("parallel_context_builder") ? "font-extrabold underline" : "opacity-50"}>4.약관수집</span>
                              <span className={completedNodes.has("multi_hop_reasoning") ? "font-extrabold underline" : "opacity-50"}>5.보상추론</span>
                              <span className={completedNodes.has("generate") ? "font-extrabold underline" : "opacity-50"}>6.답변생성</span>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Out-of-Scope / Execution Warning Banner */}
                      {(msg.nodeLogs?.some((l: any) => l.is_valid === false || l.node === "out_of_scope_response") || status === "OUT_OF_SCOPE") && (
                        <div className="p-3.5 bg-rose-50 border border-rose-300 rounded-xl space-y-1 text-xs text-rose-900 font-sans shadow-2xs animate-fade-in">
                          <div className="font-extrabold flex items-center gap-1.5 text-rose-950">
                            <span className="text-sm">🚫</span>
                            <span>[보장 범위 검증 차단] 안내</span>
                          </div>
                          <p className="text-[11px] leading-relaxed text-rose-800 font-medium">
                            문의하신 질의는 손해사정 약관/증권 보장 범위를 벗어났거나 지원되지 않는 요청으로 판명되어 파이프라인 수행이 차단되었습니다.
                          </p>
                        </div>
                      )}

                      {/* Markdown Formatted Answer Body (진행률 아래 배치) */}
                      {msg.text && (
                        <div className="text-xs text-slate-800 leading-relaxed font-sans space-y-2 pt-1">
                          {renderFormattedMarkdown(msg.text)}
                        </div>
                      )}

                      {/* Human-in-the-Loop Interactive User Approval & Confirmation UI Card */}
                      {(msg.isSlotAsking || status === "SLOT_FILLING" || (index === messages.length - 1 && isCompleted && msg.text.includes("추가 정보"))) && (
                        <div className="p-4 bg-indigo-50/90 border border-indigo-300 rounded-xl space-y-3 shadow-xs animate-fade-in">
                          <div className="flex items-center justify-between border-b border-indigo-200/80 pb-2">
                            <span className="text-xs font-extrabold text-indigo-950 flex items-center gap-2">
                              <span>🛡️</span> [Human-in-the-Loop] 사용자 승인 및 필수 조건 확인
                            </span>
                            <span className="px-2 py-0.5 bg-indigo-200 text-indigo-900 text-[10px] font-mono font-bold rounded-full">
                              승인 대기 중
                            </span>
                          </div>

                          <p className="text-xs text-indigo-900 leading-relaxed font-sans font-medium">
                            손해사정 보상금 정밀 산출을 진행하기 위해 아래 조건 입력 또는 실행 승인이 필요합니다. 계속 진행하시겠습니까?
                          </p>

                          {/* Approval Form & Action Buttons */}
                          <div className="space-y-2 pt-1">
                            <div className="flex flex-col sm:flex-row gap-2">
                              <input
                                type="text"
                                id={`slot-input-${msg.id}`}
                                placeholder="예: 입원 10일, 골절 진단 코드 등 보완 정보 입력"
                                className="flex-1 bg-white border border-indigo-300 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-sans"
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    const val = (e.target as HTMLInputElement).value;
                                    if (val) sendSlotFill("user_input", val, "jang");
                                  }
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const inputEl = document.getElementById(`slot-input-${msg.id}`) as HTMLInputElement;
                                  const val = inputEl?.value || "보상금 산출 승인";
                                  sendSlotFill("user_approval", val, "jang");
                                }}
                                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all cursor-pointer shrink-0 flex items-center justify-center gap-1.5"
                              >
                                <span>✅ 승인 및 계속 진행 (Proceed)</span>
                              </button>
                            </div>

                            <div className="flex items-center justify-between pt-1 text-[11px]">
                              <button
                                type="button"
                                onClick={() => {
                                  resetStream();
                                }}
                                className="text-rose-600 hover:text-rose-800 font-semibold cursor-pointer underline flex items-center gap-1"
                              >
                                <span>✕</span> <span>승인 거절 및 취소 (Reject)</span>
                              </button>
                              <span className="text-slate-400 font-mono">LangGraph Human-in-the-Loop Node</span>
                            </div>
                          </div>
                        </div>
                      )}


                    </div>
                  )}
                </div>
              ))
            )}
            <div ref={chatEndRef} />
          </div>

          {/* User Chat Input Bar */}
          <form onSubmit={handleSubmit} className="p-3.5 bg-slate-50 border-t border-slate-200 shrink-0">
            <div className="flex items-center gap-2">
              <input
                type="text"
                name="queryInput"
                placeholder="보험금 보상 관련 궁금한 내용을 입력하세요 (예: 재해골절 시 얼마 나오나요?)"
                disabled={isLoading}
                className="flex-1 bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all font-sans disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={isLoading}
                className="px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-bold text-xs rounded-xl shadow-md transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              >
                <span>전송</span>
                <span>➔</span>
              </button>
            </div>
          </form>
        </section>
      </div>

      {/* 증권 MD 보기 모달 */}
      {showPolicyModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
          onClick={() => setShowPolicyModal(false)}
        >
          <div
            className="w-full max-w-3xl h-[85vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 shrink-0">
              <span className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <span>📋</span> {activeCustomer.name}님 보험증권 요약 (증권 MD)
              </span>
              <button
                type="button"
                onClick={() => setShowPolicyModal(false)}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all cursor-pointer"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {isPolicyLoading ? (
                <div className="h-full flex items-center justify-center text-xs text-slate-400 font-semibold animate-pulse">
                  보험증권 정보를 불러오는 중입니다...
                </div>
              ) : policyContent ? (
                <div className="text-xs text-slate-800 leading-relaxed space-y-2">
                  {renderFormattedMarkdown(policyContent)}
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-xs text-rose-500 font-semibold">
                  보험증권 정보를 불러오지 못했습니다. 백엔드 서버(/api/v1/policy/jang)가 실행 중인지 확인해주세요.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 약관 PDF 보기 모달 */}
      {showPdfModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
          onClick={() => setShowPdfModal(false)}
        >
          <div
            className="w-full max-w-4xl h-[88vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 shrink-0">
              <span className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <span>📄</span> {activeCustomer.policyName} 약관 원문
              </span>
              <button
                type="button"
                onClick={() => setShowPdfModal(false)}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all cursor-pointer"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 min-h-0">
              <PdfHighlightViewer
                pdfUrl={`${baseUrl}/api/v1/policy-pdf/jang`}
                initialPage={1}
                onClose={() => setShowPdfModal(false)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
