"use client";

import React, { useState, useEffect, useRef } from "react";
import { useSSE, UIBlock, BlockItem, Citation, StepLog } from "@/hooks/useSSE";

interface CustomerProfile {
  id: string;
  displayId: string;
  name: string;
  policyName: string;
  status: string;
  birthDate: string;
  phone: string;
  joinDate: string;
}

const DEFAULT_CUSTOMER: CustomerProfile = {
  id: "c7e2b1f0-4a89-4e1d-8b3c-91a0c2d3e4f5",
  displayId: "20140520-09823",
  name: "장석찬",
  policyName: "Top클래스변액유니버설CI종신보험2.0(무배당)",
  status: "정상",
  birthDate: "1997.11.11.",
  phone: "010-0000-0000",
  joinDate: "2014.05.20",
};

// ⭐ tasks/jang/enrolled_sections.json 의 실제 가입 특약 allowlist를 그대로 표시용으로 재사용.
// "[부록] ..." 항목은 실제 특약이 아니라 인용 법령 섹션이라 사이드바 목록에서는 제외합니다.
const ENROLLED_SECTIONS = [
  "Top클래스변액유니버설CI종신보험2.0(무배당)[보장형계약]",
  "Top클래스변액유니버설CI종신보험2.0(무배당)[적립형계약]",
  "CI두번보장특약(갱신형,무배당)",
  "리빙케어보장특약(갱신형,무배당)[최대 80세 갱신형]",
  "리빙케어보장특약(갱신형,무배당)[최대 100세 갱신형]",
  "재해장해특약(무배당)",
  "기초응급자금특약(무배당)",
  "재해치료비보장특약(갱신형,무배당)",
  "신입원특약(갱신형,무배당)",
  "특정질병입원특약(갱신형,무배당)",
  "실손의료비보장특약(갱신형,무배당)",
];

interface ChatMessage {
  id: string;
  sender: "counselor" | "assistant";
  text: string;
  blocks?: UIBlock[];
  isSlotAsking?: boolean;
  timestamp: string;
  elapsedSec?: number;
}

function renderFormattedMarkdown(mdText: string) {
  if (!mdText) return null;

  const lines = mdText.split("\n");
  const elements: React.ReactNode[] = [];
  let tableRows: string[][] = [];

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
                <th key={hIdx} className="p-2.5 px-3 border-r border-slate-200 last:border-r-0 whitespace-nowrap">
                  {h.replace(/\*\*/g, "")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, rIdx) => (
              <tr key={rIdx} className="border-b border-slate-100 hover:bg-slate-50/80 last:border-b-0">
                {row.map((cell, cIdx) => (
                  <td key={cIdx} className="p-2.5 px-3 border-r border-slate-100 last:border-r-0 text-slate-700 font-medium">
                    {cell.replace(/\*\*/g, "")}
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

  lines.forEach((line, idx) => {
    const trimmed = line.trim();

    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      if (trimmed.includes("---") || trimmed.includes(":---")) {
        return;
      }
      const cells = trimmed.split("|").slice(1, -1).map((c) => c.trim());
      tableRows.push(cells);
      return;
    } else {
      flushTable(`table-${idx}`);
    }

    if (trimmed.startsWith("# ")) {
      elements.push(<h2 key={idx} className="text-base font-bold text-indigo-950 mt-4 mb-2 pb-1 border-b border-indigo-200 flex items-center gap-2">📋 {trimmed.replace("# ", "")}</h2>);
    } else if (trimmed.startsWith("## ")) {
      elements.push(<h3 key={idx} className="text-sm font-bold text-slate-800 mt-3.5 mb-1.5 flex items-center gap-1.5">📌 {trimmed.replace("## ", "")}</h3>);
    } else if (trimmed.startsWith("### ")) {
      elements.push(<h4 key={idx} className="text-xs font-bold text-slate-700 mt-2 mb-1">{trimmed.replace("### ", "")}</h4>);
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      const text = trimmed.replace(/^[-*]\s+/, "");
      elements.push(
        <div key={idx} className="text-xs text-slate-700 my-1 flex items-start gap-1.5 pl-1">
          <span className="text-indigo-500 font-bold">•</span>
          <span>{text.replace(/\*\*(.*?)\*\*/g, "$1")}</span>
        </div>
      );
    } else if (trimmed === "---") {
      elements.push(<hr key={idx} className="my-3 border-slate-200" />);
    } else if (trimmed.length > 0 && !trimmed.startsWith("<!--")) {
      elements.push(<p key={idx} className="text-xs text-slate-700 my-1 leading-relaxed">{trimmed.replace(/\*\*(.*?)\*\*/g, "$1")}</p>);
    }
  });

  flushTable("table-end");

  return elements;
}

type MainTab = "aiq" | "doc";

export default function Home() {
  const [query, setQuery] = useState("");
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
  const [showJsonRaw, setShowJsonRaw] = useState(false);
  const [showDebugModal, setShowDebugModal] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const [activeCustomer] = useState<CustomerProfile>(DEFAULT_CUSTOMER);
  const [feedbackMap, setFeedbackMap] = useState<Record<string, "up" | "down">>({});

  // 상단 탭: AIQ(채팅) / 문서(보험증권)
  const [mainTab, setMainTab] = useState<MainTab>("aiq");
  const [policyContent, setPolicyContent] = useState<string>("");
  const [isPolicyLoading, setIsPolicyLoading] = useState(false);
  const [showPdfModal, setShowPdfModal] = useState(false);

  // ⭐ 유저 모드 토글: 현재는 화면 표기만 바꾸는 시각적 스위치입니다 (백엔드 연결 없음).
  const [isUserMode, setIsUserMode] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);

  const { data, blocks, isLoading, progress, stepLogs, sessionId, startStream, sendSlotFill, resetStream } = useSSE();

  const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  const loadPolicyDoc = async () => {
    if (policyContent || isPolicyLoading) return;
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
  };

  const handleOpenDocTab = () => {
    setMainTab("doc");
    loadPolicyDoc();
  };

  useEffect(() => {
    if (mainTab === "doc") {
      loadPolicyDoc();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainTab]);

  const handleFeedback = (msgId: string, type: "up" | "down") => {
    setFeedbackMap((prev) => ({
      ...prev,
      [msgId]: prev[msgId] === type ? (undefined as any) : type,
    }));
  };

  const [liveElapsedSec, setLiveElapsedSec] = useState<number>(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number | null>(null);

  // 실시간 타이머 (소요시간 측정)
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
      startTimeRef.current = null;
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
        const updatedMsg: ChatMessage = {
          ...lastMsg,
          text: data || (isLoading ? "고객 약관 데이터베이스 탐색 및 손해사정 산출 중..." : lastMsg.text),
          blocks: blocks.length > 0 ? blocks : lastMsg.blocks,
          isSlotAsking,
          elapsedSec: liveElapsedSec > 0 ? liveElapsedSec : lastMsg.elapsedSec,
        };
        return [...prev.slice(0, -1), updatedMsg];
      }
      return prev;
    });
  }, [data, blocks, isLoading, liveElapsedSec]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || isLoading) return;

    const currentInput = query.trim();
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: "counselor",
      text: currentInput,
      timestamp,
    };

    const isSlotResponse = messages.length > 0 && messages[messages.length - 1].isSlotAsking;

    const assistantMessage: ChatMessage = {
      id: `assistant-${Date.now()}`,
      sender: "assistant",
      text: "AI 파이프라인 분석 중...",
      blocks: [],
      timestamp,
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setQuery("");

    if (isSlotResponse) {
      sendSlotFill("hospital_days", currentInput);
    } else {
      startStream(currentInput);
    }
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
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-blue-600 flex items-center justify-center font-bold text-white shadow-md shadow-indigo-500/20 text-xs">
            삼성
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-slate-900">삼성생명</h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-100/80 text-indigo-800 border border-indigo-200">
                인바운드
              </span>
            </div>
            <p className="text-[11px] text-slate-500">CS/CX 인바운드 상담 지원 시스템</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-600 font-medium">유저 모드</span>
          <button
            type="button"
            onClick={() => setIsUserMode((v) => !v)}
            className={`relative w-10 h-5.5 rounded-full transition-all cursor-pointer ${isUserMode ? "bg-indigo-600" : "bg-slate-300"}`}
            title="화면 표기 전용 스위치 (백엔드 미연동)"
          >
            <span
              className={`absolute top-0.5 w-4.5 h-4.5 bg-white rounded-full shadow transition-all ${isUserMode ? "left-5" : "left-0.5"}`}
            />
          </button>
        </div>
      </header>

      {/* 2-Column Body Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 flex-1 items-start max-w-7xl mx-auto w-full">

        {/* 좌측 사이드바: 고객 정보 / 가입 상품 정보 */}
        <div className="lg:col-span-4 space-y-4 flex flex-col">
          {/* 고객 정보 */}
          <section className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900">고객 정보</h2>
              <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-semibold border border-emerald-200">
                정상
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-blue-600 via-indigo-600 to-indigo-700 flex items-center justify-center text-white font-bold text-base shadow-sm shrink-0">
                {activeCustomer.name.slice(0, 1)}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-slate-900 truncate">{activeCustomer.name} 님</span>
                  <span className="text-[11px] text-slate-400 font-mono">{activeCustomer.displayId}</span>
                </div>
                <p className="text-xs text-slate-500 font-medium">{activeCustomer.birthDate} | {activeCustomer.phone}</p>
              </div>
            </div>
          </section>

          {/* 가입 상품 정보 */}
          <section className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900">가입 상품 정보</h2>
              <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-semibold border border-slate-200">
                총 1건
              </span>
            </div>

            <div className="border border-slate-200 rounded-xl p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-white text-[10px] font-bold">계약 1</span>
                  <span className="inline-flex items-center gap-1 text-emerald-600 text-[10px] font-semibold">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> 정상
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleOpenDocTab}
                  className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-500 transition-all cursor-pointer"
                  title="보험증권 문서 보기"
                >
                  📄
                </button>
              </div>

              <div>
                <p className="text-xs font-bold text-slate-900 leading-snug">{activeCustomer.policyName}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">가입일 {activeCustomer.joinDate}</p>
              </div>

              <div className="pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-semibold text-slate-600">계약 요약 ({ENROLLED_SECTIONS.length}건)</span>
                </div>
                <div className="max-h-44 overflow-y-auto space-y-1.5 pr-1">
                  {ENROLLED_SECTIONS.map((section, idx) => (
                    <div key={idx} className="text-[11px] text-slate-700 bg-slate-50 border border-slate-100 rounded-lg px-2.5 py-1.5">
                      • {section}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* 우측: 상단 탭 + AIQ 채팅 / 문서 뷰어 */}
        <div className="lg:col-span-8 flex flex-col h-[calc(100vh-120px)] min-h-[500px]">
          {/* 탭 바 */}
          <div className="flex items-center justify-between bg-white border border-slate-200 rounded-t-2xl px-3 pt-2.5 shadow-xs shrink-0">
            <div className="flex items-end gap-1.5">
              <button
                type="button"
                onClick={() => setMainTab("aiq")}
                className={`px-3 py-2 rounded-t-lg text-xs font-bold transition-all cursor-pointer ${
                  mainTab === "aiq" ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-100"
                }`}
              >
                AIQ
              </button>
              {mainTab === "aiq" && (
                <span className="px-3 py-1.5 rounded-t-lg text-xs font-semibold bg-slate-100 text-slate-700 border border-b-0 border-slate-200 flex items-center gap-2">
                  세션 1
                  <button
                    type="button"
                    title="새 세션 (준비 중)"
                    className="text-slate-400 hover:text-slate-600 cursor-not-allowed"
                    disabled
                  >
                    +
                  </button>
                </span>
              )}
            </div>

            <div className="flex items-end gap-1.5">
              {mainTab === "doc" && (
                <span className="px-3 py-1.5 rounded-t-lg text-xs font-semibold bg-slate-100 text-slate-700 border border-b-0 border-slate-200 flex items-center gap-2">
                  보험증권
                  <button
                    type="button"
                    onClick={() => setMainTab("aiq")}
                    className="text-slate-400 hover:text-slate-600 cursor-pointer"
                    title="문서 탭 닫기"
                  >
                    ✕
                  </button>
                </span>
              )}
              <button
                type="button"
                onClick={handleOpenDocTab}
                className={`px-3 py-2 rounded-t-lg text-xs font-bold transition-all cursor-pointer ${
                  mainTab === "doc" ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-100"
                }`}
              >
                문서
              </button>
            </div>
          </div>

          {/* 탭 컨텐츠 */}
          {mainTab === "aiq" ? (
            <div className="flex-1 flex flex-col bg-white border border-t-0 border-slate-200 rounded-b-2xl shadow-xs overflow-hidden">
              {/* AIQ 상단 툴바 */}
              <div className="flex items-center justify-end gap-2 px-4 py-2 border-b border-slate-100 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowJsonRaw(!showJsonRaw)}
                  className="px-3 py-1.5 rounded-lg bg-white hover:bg-slate-100 border border-slate-300 shadow-xs text-xs font-semibold text-slate-700 transition-all cursor-pointer"
                >
                  {showJsonRaw ? "🎨 UI 블록 뷰" : "📄 Raw JSON 뷰"}
                </button>
                {messages.length > 0 && (
                  <button
                    onClick={handleClearChat}
                    className="px-3 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-200 text-xs font-medium text-rose-700 transition-all cursor-pointer"
                  >
                    대화 초기화
                  </button>
                )}
              </div>

              {/* 메시지 목록 */}
              <div className="flex-1 overflow-y-auto p-5 space-y-5">
                {messages.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center select-none pointer-events-none">
                    <div className="text-center opacity-[0.07] space-y-2">
                      <div className="text-7xl font-black text-slate-800 tracking-tight">AI</div>
                      <div className="text-sm font-semibold text-slate-600 tracking-widest uppercase">Insurance Adjuster</div>
                    </div>
                    <div className="mt-8 space-y-1 opacity-[0.22] text-center">
                      <p className="text-[11px] text-slate-500">하단 입력창에 상담 내용을 입력하면 AI가 약관 검색 후 보상금을 산출합니다.</p>
                    </div>
                  </div>
                )}

                {messages.map((msg, index) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${msg.sender === "counselor" ? "items-end" : "items-start"}`}
                  >
                    {msg.sender === "counselor" ? (
                      <div className="max-w-xl bg-gradient-to-r from-indigo-600 to-blue-600 text-white rounded-2xl px-4 py-3 shadow-sm text-xs leading-relaxed">
                        <span className="text-[10px] text-indigo-100 font-bold uppercase block mb-1">👩‍💼 상담사 질의</span>
                        <p className="whitespace-pre-wrap">{msg.text}</p>
                        <span className="text-[10px] text-indigo-200 block text-right mt-1 opacity-80">{msg.timestamp}</span>
                      </div>
                    ) : (
                      <div className="w-full bg-slate-50/60 border border-slate-200/90 rounded-2xl p-5 shadow-xs space-y-4">
                        <div className="flex items-center justify-between pb-3 border-b border-slate-200/80">
                          <span className="text-xs font-bold text-indigo-700 uppercase tracking-wider flex items-center gap-2">
                            🤖 AI 손해사정 가이드
                          </span>
                          <div className="flex items-center gap-2">
                            {msg.elapsedSec && (
                              <span className="px-2 py-0.5 rounded-full bg-slate-200/80 text-slate-700 text-[10px] font-mono font-medium border border-slate-300/70">
                                ⏱️ {msg.elapsedSec}초 소요
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => setShowDebugModal(true)}
                              className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-slate-200/60 rounded transition-all cursor-pointer text-xs"
                              title="AI 파이프라인 단계별 디버깅 로그 보기"
                            >
                              🐛
                            </button>
                            <span className="text-[11px] text-slate-400">{msg.timestamp}</span>
                          </div>
                        </div>

                        {isLoading && index === messages.length - 1 && (
                          <div className="p-4 bg-indigo-50/80 border border-indigo-200/90 rounded-xl flex items-center gap-4 text-xs shadow-2xs">
                            <div className="relative w-10 h-10 flex items-center justify-center shrink-0">
                              <svg className="w-10 h-10 transform -rotate-90">
                                <circle cx="20" cy="20" r="16" stroke="currentColor" strokeWidth="3" className="text-indigo-200/70" fill="transparent" />
                                <circle
                                  cx="20" cy="20" r="16" stroke="currentColor" strokeWidth="3"
                                  className="text-indigo-600 transition-all duration-300 ease-out"
                                  fill="transparent"
                                  strokeDasharray={100.5}
                                  strokeDashoffset={100.5 - (100.5 * progress) / 100}
                                  strokeLinecap="round"
                                />
                              </svg>
                              <span className="absolute text-[10px] font-bold font-mono text-indigo-800">{progress}%</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between font-bold text-indigo-900 mb-0.5">
                                <span className="text-xs text-indigo-950 font-semibold animate-pulse">
                                  AI 손해사정 보상금 산출 및 약관 분석 중...
                                </span>
                                <span className="font-mono text-indigo-700 text-xs font-bold">⏱️ {liveElapsedSec.toFixed(1)}s</span>
                              </div>
                              <p className="text-[11px] text-indigo-600">실시간 약관 데이터베이스 탐색 처리 진행 중입니다.</p>
                            </div>
                          </div>
                        )}

                        {showJsonRaw ? (
                          <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl text-xs font-mono text-emerald-400 leading-relaxed overflow-x-auto whitespace-pre">
                            {JSON.stringify({ status: "SUCCESS", answer: msg.text, blocks: msg.blocks || [] }, null, 2)}
                          </div>
                        ) : (
                          <>
                            <div className="prose prose-slate max-w-none text-slate-800 text-xs leading-relaxed whitespace-pre-wrap font-sans">
                              {msg.text}
                            </div>

                            {msg.blocks && msg.blocks.length > 0 && (
                              <div className="space-y-3.5 pt-4 border-t border-slate-200/80">
                                {msg.blocks.map((block, bIdx) => {
                                  if (block.block_type === "CONTEXT") {
                                    return (
                                      <div key={bIdx} className="p-3.5 bg-white border border-slate-200 rounded-xl">
                                        <span className="text-xs font-bold text-slate-600 uppercase tracking-wider block mb-1">
                                          📌 {block.title || "상황 파악 및 질의 맥락"}
                                        </span>
                                        <p className="text-xs text-slate-700 leading-relaxed">{block.content}</p>
                                      </div>
                                    );
                                  }
                                  if (block.block_type === "RETRIEVAL_RESULT") {
                                    return (
                                      <div key={bIdx} className="p-4 bg-blue-50/70 border border-blue-200 rounded-xl">
                                        <h3 className="text-xs font-bold text-blue-900 mb-2 flex items-center gap-2">
                                          🔍 {block.title || "약관 검색 결과 및 보장 산출 내역"}
                                        </h3>
                                        <ul className="space-y-2">
                                          {block.items?.map((item, iIdx) => {
                                            if (typeof item === "string") {
                                              return <li key={iIdx} className="text-xs text-slate-800 font-medium">• {item}</li>;
                                            }
                                            const blockItem = item as BlockItem;
                                            return (
                                              <li key={iIdx} className="text-xs text-slate-800 font-medium flex flex-wrap items-center gap-1.5">
                                                <span>• {blockItem.text}</span>
                                                {blockItem.citations?.map((c, cIdx) => (
                                                  <button
                                                    key={cIdx}
                                                    onClick={() => setActiveCitation(c)}
                                                    className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-full bg-blue-100 hover:bg-blue-200 border border-blue-300 text-blue-700 text-[10px] font-bold shadow-2xs transition-all cursor-pointer -translate-y-1 hover:scale-110 ml-0.5"
                                                    title="약관 원문 팝업 보기"
                                                  >
                                                    🔍
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
                                      <div key={bIdx} className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-900">
                                        <h3 className="text-xs font-bold text-amber-800 mb-1 flex items-center gap-2">
                                          ⚠️ {block.title || "상담사 안내 유의사항 및 면책 조항"}
                                        </h3>
                                        <p className="text-xs leading-relaxed text-amber-900">{block.content}</p>
                                      </div>
                                    );
                                  }
                                  if (block.block_type === "DELIVER") {
                                    return (
                                      <div key={bIdx} className="p-3.5 bg-indigo-50/70 border border-indigo-200 rounded-xl">
                                        <h3 className="text-xs font-bold text-indigo-900 mb-2">
                                          📋 {block.title || "고객 구두 설명 및 필요 전달 서류"}
                                        </h3>
                                        <ul className="space-y-1">
                                          {block.items?.map((item, iIdx) => (
                                            <li key={iIdx} className="text-xs text-indigo-950 font-medium">
                                              • {typeof item === "string" ? item : item.text}
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
                          </>
                        )}

                        <div className="pt-2 flex items-center justify-between border-t border-slate-200/60 text-[11px] text-slate-400">
                          <span className="text-[10px]">답변 만족도 평가</span>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleFeedback(msg.id, "up")}
                              className={`p-1 px-1.5 rounded hover:bg-slate-200/60 transition-all flex items-center gap-1 cursor-pointer ${
                                feedbackMap[msg.id] === "up" ? "bg-blue-50 text-blue-600 font-bold border border-blue-200" : "text-slate-400"
                              }`}
                              title="도움이 됨 (따봉)"
                            >
                              👍 <span className="text-[10px]">{feedbackMap[msg.id] === "up" ? "도움됨" : ""}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleFeedback(msg.id, "down")}
                              className={`p-1 px-1.5 rounded hover:bg-slate-200/60 transition-all flex items-center gap-1 cursor-pointer ${
                                feedbackMap[msg.id] === "down" ? "bg-rose-50 text-rose-600 font-bold border border-rose-200" : "text-slate-400"
                              }`}
                              title="개선 필요 (붐따)"
                            >
                              👎 <span className="text-[10px]">{feedbackMap[msg.id] === "down" ? "의견제출" : ""}</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>

              {/* 입력창 (탭 하단 고정) */}
              <form onSubmit={handleSubmit} className="shrink-0 border-t border-slate-200 p-3 flex items-end gap-2 bg-slate-50/60">
                <textarea
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
                      ? "고객에게 확인받은 보완 정보(예: 5일 입원)를 입력하고 Enter를 누르세요..."
                      : "답변을 생성할 상담 내용을 입력하세요..."
                  }
                  rows={2}
                  className="flex-1 bg-white border border-slate-300 rounded-xl p-3 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 transition-all resize-none"
                />
                <button
                  type="submit"
                  disabled={isLoading || !query.trim()}
                  className={`h-9 px-4 rounded-full text-xs font-semibold transition-all flex items-center justify-center gap-2 shrink-0 ${
                    query.trim() && !isLoading
                      ? "bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm shadow-indigo-400/30 cursor-pointer"
                      : "bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200"
                  }`}
                >
                  {isLoading ? (
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                  ) : (
                    "전송"
                  )}
                </button>
              </form>
            </div>
          ) : (
            /* 문서 탭: 보험증권 요약 */
            <div className="flex-1 flex flex-col bg-white border border-t-0 border-slate-200 rounded-b-2xl shadow-xs overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 shrink-0">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">{activeCustomer.name} 님의 보험증권 요약 (certificate.md)</h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">가입 상품: {activeCustomer.policyName}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowPdfModal(true)}
                  className="text-[11px] px-2.5 py-1.5 rounded-lg border border-slate-300 bg-slate-100 hover:bg-slate-200 text-slate-600 font-medium transition-all cursor-pointer"
                  title="보험약관 PDF 원문 열기"
                >
                  📄 약관 PDF 보기
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-5">
                {isPolicyLoading ? (
                  <div className="py-12 text-center text-slate-500 animate-pulse text-xs">
                    📋 고객의 개인 보험증권 MD 데이터(certificate.md)를 불러오는 중입니다...
                  </div>
                ) : (
                  renderFormattedMarkdown(policyContent) || (
                    <p className="text-xs text-slate-400 text-center py-12">보험증권 데이터를 찾을 수 없습니다.</p>
                  )
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Citation Modal Popup */}
      {activeCitation && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white border border-slate-300 rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-4 text-slate-900">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <span className="text-xs font-bold text-blue-700 flex items-center gap-1.5">
                📄🔍 약관 원문 팝업
              </span>
              <button
                onClick={() => setActiveCitation(null)}
                className="text-slate-400 hover:text-slate-700 text-sm font-bold p-1 rounded hover:bg-slate-100 transition-all cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div>
              <h4 className="text-sm font-bold text-slate-900">{activeCitation.section_title}</h4>
              <p className="text-xs text-slate-500 mt-0.5">약관 위치: <span className="font-semibold text-slate-700">{activeCitation.page}페이지</span></p>
            </div>

            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 leading-relaxed max-h-60 overflow-y-auto font-mono">
              "{activeCitation.snippet}"
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setActiveCitation(null)}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-xl shadow-md transition-all cursor-pointer"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Debug Logs Modal Popup */}
      {showDebugModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white border border-slate-300 rounded-2xl p-6 max-w-xl w-full shadow-2xl space-y-4 text-slate-900">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2 text-indigo-700 font-bold text-sm">
                <span>🐛</span>
                <span>AI 손해사정 파이프라인 디버깅 로그</span>
              </div>
              <button
                onClick={() => setShowDebugModal(false)}
                className="text-slate-400 hover:text-slate-700 text-sm font-bold p-1 rounded hover:bg-slate-100 transition-all cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl font-mono text-xs text-emerald-400 space-y-2 max-h-80 overflow-y-auto">
              <div className="text-slate-400 pb-1 border-b border-slate-800 text-[11px]">
                ⏱️ 파이프라인 단계별 처리 시간 및 추론 기록{sessionId ? ` (세션: ${sessionId.slice(0, 8)}…)` : ""}
              </div>
              {stepLogs.length === 0 ? (
                <div className="text-slate-500 py-4 text-center">디버깅 기록이 없습니다. 질문을 전송하세요.</div>
              ) : (
                stepLogs.map((log, idx) => (
                  <div key={idx} className="flex items-start gap-2 py-1 border-b border-slate-800/60 last:border-b-0">
                    <span className="text-slate-500 text-[10px]">[{log.timestamp}]</span>
                    <span className="font-semibold text-emerald-300">{log.label}</span>
                  </div>
                ))
              )}
            </div>

            <div className="flex justify-end pt-1">
              <button
                onClick={() => setShowDebugModal(false)}
                className="px-4 py-1.5 bg-slate-800 hover:bg-slate-900 text-white font-semibold text-xs rounded-xl shadow-md transition-all cursor-pointer"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 약관 PDF Viewer Modal */}
      {showPdfModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-slate-300 rounded-2xl shadow-2xl flex flex-col w-full max-w-4xl h-[90vh]">
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-700">{activeCustomer.name} 님 보험약관 PDF</span>
                <span className="text-[10px] text-slate-400 font-mono">장석찬_삼성생명_보험약관.pdf</span>
              </div>
              <button
                onClick={() => setShowPdfModal(false)}
                className="text-slate-400 hover:text-slate-700 text-sm font-bold p-1 rounded hover:bg-slate-100 transition-all cursor-pointer"
              >
                ✕
              </button>
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
