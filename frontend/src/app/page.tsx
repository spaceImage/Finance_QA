"use client";

import React, { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { useSSE, UIBlock, BlockItem, Citation, StepLog } from "@/hooks/useSSE";

const PdfHighlightViewer = dynamic(() => import("@/components/PdfHighlightViewer"), {
  ssr: false,
});

interface CustomerProfile {
  id: string;
  customerNo: string;
  name: string;
  policyName: string;
  status: string;
  birthDate: string;
  phone: string;
}

const DEFAULT_CUSTOMER: CustomerProfile = {
  id: "c7e2b1f0-4a89-4e1d-8b3c-91a0c2d3e4f5",
  customerNo: "20140520-09823",
  name: "장석찬",
  policyName: "Top클래스변액유니버설CI종신보험2.0(무배당)",
  status: "정상",
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
}

interface TabItem {
  id: string; // "session-1", "session-2", "policy", "pdf"
  title: string;
  type: "aiq" | "doc";
  badge: string;
  closable: boolean;
}

const INITIAL_TABS: TabItem[] = [
  { id: "session-1", title: "세션 1", type: "aiq", badge: "AIQ", closable: false },
];

interface ContractRider {
  name: string;
  type: string;
}

interface MainPolicyDetail {
  id: string;
  mainName: string;
  insurer: string;
  status: string;
  contractDate: string;
  riders: ContractRider[];
}

const CUSTOMER_POLICY_DETAIL: MainPolicyDetail = {
  id: "pol-jang-01",
  mainName: "Top클래스변액유니버설CI종신보험2.0(무배당)",
  insurer: "삼성생명보험주식회사",
  status: "정상",
  contractDate: "2014.05.20",
  riders: [
    { name: "CI두번보장특약(갱신형,무배당)", type: "갱신형 특약" },
    { name: "뉴CI보장특약(갱신형,무배당)", type: "갱신형 특약" },
    { name: "리빙케어보장특약(갱신형,무배당)", type: "80세/100세 갱신형" },
    { name: "정기특약(무배당)", type: "무배당 특약" },
    { name: "재해사망특약(무배당)", type: "무배당 특약" },
    { name: "고도장해보장특약(무배당)", type: "무배당 특약" },
    { name: "재해장해특약(무배당)", type: "무배당 특약" },
    { name: "재해치료비보장특약(갱신형,무배당)", type: "갱신형 특약" },
    { name: "특정질병수술보장특약(갱신형,무배당)", type: "갱신형 특약" },
    { name: "신입원특약(갱신형,무배당)", type: "갱신형 특약" },
    { name: "실손의료비보장특약(갱신형,무배당)", type: "실손 갱신형" },
    { name: "연금전환특약(무배당)", type: "제도성 특약" },
  ],
};

export interface QueryLog {
  id: string;
  dateTime: string;
  title: string;
  status: "활성" | "마감";
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
                  <td key={cIdx} className="p-2.5 px-3 border-r border-slate-100 last:border-r-0 font-mono text-[11px] text-slate-700">
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
    if (trimmed.startsWith("|")) {
      const row = trimmed
        .split("|")
        .map((c) => c.trim())
        .filter((c) => c !== "");
      if (row.length > 0 && !row[0].includes("---")) {
        tableRows.push(row);
      }
    } else {
      flushTable(`table-${idx}`);
      if (trimmed.startsWith("### ")) {
        elements.push(<h3 key={idx} className="text-xs font-bold text-indigo-900 mt-3 mb-1.5">{trimmed.replace("### ", "")}</h3>);
      } else if (trimmed.startsWith("## ")) {
        elements.push(<h2 key={idx} className="text-sm font-bold text-slate-900 mt-4 mb-2 pb-1 border-b border-slate-200">{trimmed.replace("## ", "")}</h2>);
      } else if (trimmed.startsWith("# ")) {
        elements.push(<h1 key={idx} className="text-base font-black text-slate-900 mt-4 mb-2">{trimmed.replace("# ", "")}</h1>);
      } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
        elements.push(<li key={idx} className="text-xs text-slate-700 ml-4 list-disc my-0.5">{trimmed.replace(/^[-*]\s+/, "").replace(/\*\*(.*?)\*\*/g, "$1")}</li>);
      } else if (trimmed.length > 0 && !trimmed.startsWith("<!--")) {
        elements.push(<p key={idx} className="text-xs text-slate-700 my-1 leading-relaxed">{trimmed.replace(/\*\*(.*?)\*\*/g, "$1")}</p>);
      }
    }
  });

  flushTable("table-end");
  return elements;
}

function ResultItemWithGrounding({
  item,
  onOpenCitation,
}: {
  item: BlockItem;
  onOpenCitation: (c: Citation) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const grounding = item.grounding;

  return (
    <li className="bg-white border border-blue-200/80 rounded-xl p-3 shadow-2xs space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 min-w-0 text-xs font-semibold text-slate-900">
          <span className="text-blue-600 font-bold">•</span>
          <span className="truncate">{item.text}</span>
          {item.citations?.map((c, cIdx) => (
            <button
              key={cIdx}
              onClick={() => onOpenCitation(c)}
              className="inline-flex items-center justify-center px-2 py-0.5 rounded-full bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 text-[10px] font-bold shadow-2xs transition-all cursor-pointer hover:scale-105 ml-1"
              title="근거 약관조항 원문 보기"
            >
              [약관 p.{c.page}]
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-[10px] px-2 py-1 rounded-md bg-slate-100 hover:bg-blue-50 text-blue-700 font-bold border border-slate-200 transition-all cursor-pointer shrink-0"
        >
          {isExpanded ? "보상 근거 닫기 🔼" : "보상 근거 보기 🔽"}
        </button>
      </div>

      {isExpanded && grounding && (
        <div className="pt-2.5 border-t border-slate-100 space-y-2 text-xs bg-slate-50/70 p-3 rounded-lg animate-fade-in">
          {grounding.excerpt && (
            <div className="text-slate-800 bg-white p-2.5 rounded-lg border border-slate-200/80 font-mono text-[11px] leading-relaxed">
              <span className="font-bold text-indigo-900 block mb-0.5 font-sans">[약관 조항 원문 발췌]:</span>
              "{grounding.excerpt}"
            </div>
          )}

          {grounding.condition && (
            <div className="text-slate-800 flex items-start gap-1.5 bg-white p-2.5 rounded-lg border border-slate-200/80 text-[11px]">
              <span className="font-bold text-slate-700 shrink-0">[가입 증권 조건]:</span>
              <span>{grounding.condition}</span>
            </div>
          )}

          {grounding.formula && (
            <div className="text-slate-900 flex items-center gap-1.5 bg-indigo-50/80 p-2.5 rounded-lg border border-indigo-200 font-bold font-mono text-xs">
              <span className="font-bold text-indigo-900 font-sans">[보상금 산출 수식]:</span>
              <span className="text-indigo-950 font-mono">{grounding.formula}</span>
            </div>
          )}

          {grounding.reasoning && (
            <div className="text-slate-700 leading-relaxed bg-white p-2.5 rounded-lg border border-slate-200/80 text-[11px]">
              <span className="font-bold text-slate-800 block mb-0.5 font-sans">[손해사정 판단 논리]:</span>
              {grounding.reasoning}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
  const [viewMode, setViewMode] = useState<"user" | "debug">("user");
  
  // Multi-Session Management (State persistence across session tabs)
  const [tabs, setTabs] = useState<TabItem[]>(INITIAL_TABS);
  const [activeTabId, setActiveTabId] = useState<string>("session-1");
  const [activeAiqSessionId, setActiveAiqSessionId] = useState<string>("session-1");

  // Multi-session message history persistence store
  const [sessions, setSessions] = useState<Record<string, ChatMessage[]>>({
    "session-1": [],
  });

  const [sessionSummaries, setSessionSummaries] = useState<Record<string, string>>({});
  const [sessionCounter, setSessionCounter] = useState<number>(1);

  const [isRiderAccordionOpen, setIsRiderAccordionOpen] = useState(true);
  const [showDocMenuPopover, setShowDocMenuPopover] = useState(false);

  const [showDrawer, setShowDrawer] = useState(false);
  const [showDebugModal, setShowDebugModal] = useState(false);
  const [queryLogs, setQueryLogs] = useState<QueryLog[]>([]);

  const [activeCustomer] = useState<CustomerProfile>(DEFAULT_CUSTOMER);
  const [policyDetail] = useState<MainPolicyDetail>(CUSTOMER_POLICY_DETAIL);
  const [feedbackMap, setFeedbackMap] = useState<Record<string, "up" | "down">>({});
  const [policyContent, setPolicyContent] = useState<string>("");
  const [isPolicyLoading, setIsPolicyLoading] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatScrollContainerRef = useRef<HTMLDivElement>(null);

  const { planResult, analysisResult, isLoading, isCompleted, progress, currentStepLabel, stepLogs, error, sessionId, startStream, confirmStream, sendSlotFill, resetStream } = useSSE();
  const data = analysisResult?.answer || planResult?.answer || "";
  const blocks = analysisResult?.blocks || [];
  const consultationSummary = analysisResult?.consultationSummary || "";

  const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  // Active messages getter for current active session
  const currentMessages = sessions[activeAiqSessionId] || [];

  const fetchPolicyContent = async () => {
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

  const openDocTab = (tabId: "policy" | "pdf") => {
    if (tabId === "policy") fetchPolicyContent();

    const title = tabId === "policy" ? "보험증권" : "보험약관";

    setTabs((prev) => {
      if (prev.some((t) => t.id === tabId)) return prev;
      const newTab: TabItem = {
        id: tabId,
        title,
        type: "doc",
        badge: "문서",
        closable: true,
      };
      return [...prev, newTab];
    });

    setActiveTabId(tabId);
  };

  const handleCreateNewAiqSession = () => {
    // Check if active current session is empty
    if (currentMessages.length === 0) {
      setActiveTabId(activeAiqSessionId);
      return;
    }

    const newCounter = sessionCounter + 1;
    const newSessionId = `session-${newCounter}`;

    setSessionCounter(newCounter);
    setSessions((prev) => ({ ...prev, [newSessionId]: [] }));

    setTabs((prev) => {
      const newTab: TabItem = {
        id: newSessionId,
        title: `세션 ${newCounter}`,
        type: "aiq",
        badge: "AIQ",
        closable: true,
      };
      return [...prev, newTab];
    });

    setActiveAiqSessionId(newSessionId);
    setActiveTabId(newSessionId);
    resetStream();
  };

  const handleTabClick = (tabId: string) => {
    setActiveTabId(tabId);
    if (tabId.startsWith("session-")) {
      setActiveAiqSessionId(tabId);
    }
  };

  useEffect(() => {
    if (consultationSummary && activeAiqSessionId) {
      const shortTitle = consultationSummary.length > 12
        ? consultationSummary.slice(0, 12) + "..."
        : consultationSummary;

      setSessionSummaries((prev) => {
        if (prev[activeAiqSessionId] === consultationSummary) return prev;
        return { ...prev, [activeAiqSessionId]: consultationSummary };
      });

      setTabs((prev) => {
        const target = prev.find((t) => t.id === activeAiqSessionId);
        if (target && target.title === shortTitle) return prev;
        return prev.map((t) => (t.id === activeAiqSessionId ? { ...t, title: shortTitle } : t));
      });
    }
  }, [consultationSummary, activeAiqSessionId]);

  const closeDocTab = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    setTabs((prev) => prev.filter((t) => t.id !== tabId));
    if (activeTabId === tabId) {
      setActiveTabId(activeAiqSessionId);
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

  // Smooth scroll strictly when current session messages length updates
  useEffect(() => {
    if (currentMessages.length > 0) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [currentMessages.length]);

  useEffect(() => {
    if (!isLoading && !data && blocks.length === 0) return;

    setSessions((prev) => {
      const activeMsgs = prev[activeAiqSessionId] || [];
      if (activeMsgs.length === 0) return prev;

      const lastMsg = activeMsgs[activeMsgs.length - 1];

      if (lastMsg.sender === "assistant") {
        const isSlotAsking = data.includes("입원 일수") || data.includes("Slot Filling") || data.includes("추가 정보");
        const newText = data || (isLoading ? "고객 약관 데이터베이스 탐색 및 손해사정 산출 중..." : lastMsg.text);
        const newBlocks = blocks.length > 0 ? blocks : lastMsg.blocks;
        const newElapsedSec = liveElapsedSec > 0 ? liveElapsedSec : lastMsg.elapsedSec;

        if (
          lastMsg.text === newText &&
          lastMsg.blocks === newBlocks &&
          lastMsg.isSlotAsking === isSlotAsking &&
          lastMsg.elapsedSec === newElapsedSec
        ) {
          return prev;
        }

        const updatedMsg: ChatMessage = {
          ...lastMsg,
          text: newText,
          blocks: newBlocks,
          isSlotAsking,
          elapsedSec: newElapsedSec,
        };
        return {
          ...prev,
          [activeAiqSessionId]: [...activeMsgs.slice(0, -1), updatedMsg],
        };
      }
      return prev;
    });
  }, [data, blocks, isLoading, liveElapsedSec, activeAiqSessionId]);

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

    const activeMsgs = sessions[activeAiqSessionId] || [];
    const isSlotResponse = activeMsgs.length > 0 && activeMsgs[activeMsgs.length - 1].isSlotAsking;

    const assistantMessage: ChatMessage = {
      id: `assistant-${Date.now()}`,
      sender: "assistant",
      text: "AI 파이프라인 분석 중...",
      blocks: [],
      timestamp,
    };

    setSessions((prev) => ({
      ...prev,
      [activeAiqSessionId]: [...(prev[activeAiqSessionId] || []), userMessage, assistantMessage],
    }));

    setQuery("");

    if (isSlotResponse) {
      sendSlotFill("hospital_days", currentInput);
    } else {
      startStream(currentInput);
    }
  };

  const handleClearChat = () => {
    setSessions((prev) => ({ ...prev, [activeAiqSessionId]: [] }));
    resetStream();
  };

  return (
    <main className="min-h-screen bg-slate-100 text-slate-800 p-4 md:p-6 font-sans relative flex flex-col">
      {/* Top Clean Samsung Life Header */}
      <header className="max-w-7xl mx-auto w-full flex items-center justify-between pb-3 border-b border-slate-200 mb-4 shrink-0">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-700 flex items-center justify-center font-bold text-white shadow-md text-xs tracking-tight">
            삼성
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-black tracking-tight text-slate-900">
                삼성생명
              </h1>
              <span className="text-xs font-bold px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                인바운드
              </span>
            </div>
            <p className="text-xs text-slate-500 font-medium">CS/CX 인바운드 상담 지원 시스템</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-300 shadow-2xs">
            <span className="text-xs font-bold text-slate-700 select-none">
              {viewMode === "debug" ? "디버깅 모드" : "유저 모드"}
            </span>
            <button
              type="button"
              onClick={() => setViewMode(viewMode === "user" ? "debug" : "user")}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                viewMode === "debug" ? "bg-indigo-600" : "bg-slate-300"
              }`}
              title="유저 모드 / 디버깅 모드 토글"
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                  viewMode === "debug" ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          {currentMessages.length > 0 && (
            <button
              onClick={handleClearChat}
              className="px-3 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-200 text-xs font-medium text-rose-700 transition-all cursor-pointer"
            >
              세션 초기화
            </button>
          )}
        </div>
      </header>

      {/* Main Dashboard Layout (Center 8 Columns + Right 4 Columns) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 flex-1 items-start max-w-7xl mx-auto w-full relative">
        
        {/* Right Main View (67% / col-span-8): Chrome Tab Grouping View */}
        <div className="lg:col-span-8 order-2 lg:order-2 flex flex-col h-[calc(100vh-120px)] min-h-[600px] bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
          
          {/* Top Chrome Tab Bar with Active Tab Front Layering Cover */}
          <div className="flex items-center justify-between px-3 pt-2.5 bg-slate-100/90 border-b border-slate-300/80 shrink-0 select-none">
            <div className="flex items-center gap-1 overflow-x-auto scrollbar-none pb-0">
              
              {/* Chrome Tab Group 1: AIQ Sessions Group */}
              <div className="flex items-center bg-indigo-100/40 p-1 rounded-t-xl border-t border-x border-indigo-200/80 mr-2">
                {/* Standalone AIQ Group Badge Header */}
                <span className="px-2 py-0.5 rounded-md bg-indigo-700 text-white text-[10px] font-black tracking-wider uppercase mr-2 shadow-2xs">
                  AIQ
                </span>

                {/* AIQ Session Tabs (Proper Active Front-Layer Overlapping) */}
                <div className="flex items-center">
                  {tabs.filter((t) => t.type === "aiq").map((tab, tIdx) => {
                    const isActive = activeTabId === tab.id;
                    return (
                      <div
                        key={tab.id}
                        onClick={() => handleTabClick(tab.id)}
                        className={`flex items-center gap-1.5 px-4 py-1.5 rounded-t-xl text-xs transition-all cursor-pointer border-t-2 border-x shrink-0 ${
                          tIdx > 0 ? "-ml-2.5" : ""
                        } ${
                          isActive
                            ? "bg-white text-indigo-950 border-t-indigo-600 border-x-slate-300 font-black -mb-px pb-2.5 z-30 shadow-md relative"
                            : "bg-slate-200/80 hover:bg-slate-200 hover:z-20 text-slate-600 border-t-transparent border-x-slate-300/60 font-bold z-10 relative"
                        }`}
                      >
                        <span className="max-w-[120px] truncate">{tab.title}</span>
                        {tab.closable && (
                          <button
                            type="button"
                            onClick={(e) => closeDocTab(e, tab.id)}
                            className="ml-1 p-0.5 rounded-full hover:bg-slate-200 hover:text-rose-600 text-slate-400 transition-all cursor-pointer leading-none text-[10px]"
                            title="세션 닫기"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    );
                  })}

                  {/* Chrome Round Capsule Plus Button */}
                  <button
                    type="button"
                    onClick={handleCreateNewAiqSession}
                    disabled={currentMessages.length === 0}
                    className={`-ml-1.5 z-30 w-6 h-6 rounded-full text-xs font-black transition-all flex items-center justify-center border shrink-0 ${
                      currentMessages.length === 0
                        ? "bg-slate-200/50 text-slate-400 border-slate-300/50 cursor-not-allowed opacity-50"
                        : "bg-white hover:bg-indigo-600 hover:text-white text-slate-700 border-slate-300 cursor-pointer shadow-2xs hover:scale-105 active:scale-95"
                    }`}
                    title={currentMessages.length === 0 ? "현재 세션에 질의 후 새 세션을 추가할 수 있습니다" : "새 세션 추가"}
                  >
                    <span className="text-sm font-black leading-none">+</span>
                  </button>
                </div>
              </div>

              {/* Chrome Tab Group 2: Document Tabs Group */}
              {tabs.some((t) => t.type === "doc") && (
                <div className="flex items-center bg-slate-200/50 p-1 rounded-t-xl border-t border-x border-slate-300 animate-fade-in">
                  {/* Standalone Document Group Badge Header */}
                  <span className="px-2 py-0.5 rounded-md bg-slate-700 text-white text-[10px] font-black tracking-wider uppercase mr-2 shadow-2xs">
                    문서
                  </span>

                  {/* Document Tabs (Proper Active Front-Layer Overlapping) */}
                  <div className="flex items-center">
                    {tabs.filter((t) => t.type === "doc").map((tab, dIdx) => {
                      const isActive = activeTabId === tab.id;
                      return (
                        <div
                          key={tab.id}
                          onClick={() => handleTabClick(tab.id)}
                          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-t-xl text-xs transition-all cursor-pointer border-t-2 border-x shrink-0 ${
                            dIdx > 0 ? "-ml-2.5" : ""
                          } ${
                            isActive
                              ? "bg-white text-slate-900 border-t-slate-800 border-x-slate-300 font-black -mb-px pb-2.5 z-30 shadow-md relative"
                              : "bg-slate-300/70 hover:bg-slate-300 hover:z-20 text-slate-700 border-t-transparent border-x-slate-300/80 font-bold z-10 relative"
                          }`}
                        >
                          <span className="max-w-[130px] truncate">{tab.title}</span>
                          <button
                            type="button"
                            onClick={(e) => closeDocTab(e, tab.id)}
                            className="ml-1 p-0.5 rounded-full hover:bg-slate-200 hover:text-rose-600 text-slate-400 transition-all cursor-pointer leading-none text-[10px]"
                            title="탭 닫기"
                          >
                            ✕
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* TAB 1: Main AI Chat View (Renders for any active AIQ session tab) */}
          {activeTabId.startsWith("session-") && (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
              
              {/* Scroll Minimap Dot Markers */}
              {currentMessages.length > 0 && (
                <div className="absolute right-1 top-2 bottom-20 w-1.5 z-20 pointer-events-none flex flex-col justify-between items-center opacity-40 hover:opacity-100 transition-opacity">
                  {currentMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`w-2 h-2 rounded-full transition-transform ${
                        msg.sender === "counselor" ? "bg-indigo-600 scale-110" : "bg-blue-400"
                      }`}
                      title={`${msg.sender === "counselor" ? "상담사 질문" : "AI 답변"} (${msg.timestamp})`}
                    />
                  ))}
                </div>
              )}

              {/* Messages Scroll View */}
              <div
                ref={chatScrollContainerRef}
                className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-slate-300 hover:scrollbar-thumb-slate-400 scrollbar-track-transparent"
              >
                {/* Faint watermark when empty */}
                {currentMessages.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center select-none pointer-events-none min-h-[350px]">
                    <div className="text-center opacity-[0.08] space-y-2">
                      <div className="text-8xl font-black text-slate-800 tracking-tight">AIQ</div>
                      <div className="text-sm font-semibold text-slate-600 tracking-widest uppercase">Insurance Adjuster Engine</div>
                    </div>
                    <div className="mt-8 space-y-1 opacity-[0.25] text-center">
                      <p className="text-xs text-slate-500 font-medium">아래 입력창에 상담 내용을 입력하면 AI가 약관 검색 후 보상금을 즉시 산출합니다.</p>
                    </div>
                  </div>
                )}

                {currentMessages.map((msg, index) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${msg.sender === "counselor" ? "items-end" : "items-start"}`}
                  >
                    {/* Counselor Message Bubble */}
                    {msg.sender === "counselor" ? (
                      <div className="max-w-xl bg-gradient-to-r from-indigo-600 to-blue-600 text-white rounded-2xl px-4 py-3 shadow-sm text-xs leading-relaxed">
                        <span className="text-[10px] text-indigo-100 font-bold uppercase block mb-1">상담사 질의</span>
                        <p className="whitespace-pre-wrap">{msg.text}</p>
                        <span className="text-[10px] text-indigo-200 block text-right mt-1 opacity-80">{msg.timestamp}</span>
                      </div>
                    ) : (
                      /* Assistant Response Card */
                      <div className="w-full bg-slate-50/60 border border-slate-200/90 rounded-2xl p-5 shadow-xs space-y-4">
                        <div className="flex items-center justify-between pb-3 border-b border-slate-200/80">
                          <span className="text-xs font-bold text-indigo-700 uppercase tracking-wider flex items-center gap-2">
                            AI 손해사정 가이드
                          </span>
                          <div className="flex items-center gap-2">
                            {msg.elapsedSec && (
                              <span className="px-2 py-0.5 rounded-full bg-slate-200/80 text-slate-700 text-[10px] font-mono font-medium border border-slate-300/70">
                                {msg.elapsedSec}초 소요
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => setShowDebugModal(true)}
                              className="px-2 py-0.5 text-slate-500 hover:text-indigo-600 hover:bg-slate-200/60 rounded text-[10px] font-mono border border-slate-300 transition-all cursor-pointer"
                              title="디버깅 로그"
                            >
                              DEBUG
                            </button>
                            <span className="text-[11px] text-slate-400">{msg.timestamp}</span>
                          </div>
                        </div>

                        {/* Surface Processing Loading View */}
                        {isLoading && index === currentMessages.length - 1 && (
                          <div className="p-4 bg-indigo-50/80 border border-indigo-200/90 rounded-xl flex items-center gap-4 text-xs shadow-2xs">
                            <div className="relative w-10 h-10 flex items-center justify-center shrink-0">
                              <svg className="w-10 h-10 transform -rotate-90">
                                <circle cx="20" cy="20" r="16" stroke="currentColor" strokeWidth="3" className="text-indigo-200/70" fill="transparent"/>
                                <circle cx="20" cy="20" r="16" stroke="currentColor" strokeWidth="3" className="text-indigo-600 transition-all duration-300 ease-out" fill="transparent" strokeDasharray={100.5} strokeDashoffset={100.5 - (100.5 * progress) / 100} strokeLinecap="round"/>
                              </svg>
                              <span className="absolute text-[10px] font-bold font-mono text-indigo-800">{progress}%</span>
                            </div>
                            <div className="space-y-1">
                              <div className="font-bold text-indigo-900 flex items-center gap-2">
                                <span>{currentStepLabel || "보험약관 분석 중..."}</span>
                              </div>
                              <p className="text-[11px] text-indigo-700/80">VectorDB 약관 임베딩 검색 및 손해사정 산출 진행 중...</p>
                            </div>
                          </div>
                        )}

                        {/* Text Output Render */}
                        {msg.text && (
                          <div className="text-xs leading-relaxed text-slate-800 whitespace-pre-wrap">
                            {renderFormattedMarkdown(msg.text)}
                          </div>
                        )}

                        {/* UI Blocks Render */}
                        {msg.blocks && msg.blocks.length > 0 && (
                          <div className="space-y-3 pt-2">
                            {msg.blocks.map((block, bIdx) => {
                              if (block.block_type === "RETRIEVAL_RESULT") {
                                return (
                                  <div key={bIdx} className="space-y-2 bg-blue-50/40 border border-blue-200/70 rounded-xl p-3.5">
                                    <h3 className="text-xs font-bold text-blue-900">
                                      {block.title || "손해사정 근거 조항 발췌"}
                                    </h3>
                                    {block.items && (
                                      <ul className="space-y-2">
                                        {block.items.map((item, iIdx) => {
                                          if (typeof item === "string") {
                                            return <li key={iIdx} className="text-xs text-slate-700">• {item}</li>;
                                          }
                                          return <ResultItemWithGrounding key={iIdx} item={item} onOpenCitation={(c) => setActiveCitation(c)} />;
                                        })}
                                      </ul>
                                    )}
                                  </div>
                                );
                              }

                              if (block.block_type === "CAUTION") {
                                return (
                                  <div key={bIdx} className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-1 text-xs">
                                    <h3 className="font-bold text-amber-900">
                                      {block.title || "손해사정 시 면책/유의사항"}
                                    </h3>
                                    {block.content && <p className="text-amber-800 leading-relaxed">{block.content}</p>}
                                    <ul className="space-y-1 pt-1">
                                      {block.items?.map((item, iIdx) => (
                                        <li key={iIdx} className="text-amber-800">• {typeof item === "string" ? item : item.text}</li>
                                      ))}
                                    </ul>
                                  </div>
                                );
                              }

                              if (block.block_type === "DELIVER") {
                                return (
                                  <div key={bIdx} className="p-3 bg-indigo-50/80 border border-indigo-200 rounded-xl space-y-1.5">
                                    <h3 className="text-xs font-bold text-indigo-900">
                                      {block.title || "고객 구두 설명 및 필요 서류 안내"}
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

                        {/* Feedback Buttons */}
                        <div className="pt-2 flex items-center justify-between border-t border-slate-200/60 text-[11px] text-slate-400">
                          <span className="text-[10px]">답변 만족도 평가</span>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleFeedback(msg.id, "up")}
                              className={`p-1 px-2 rounded hover:bg-slate-200/60 text-[10px] font-semibold transition-all cursor-pointer ${
                                feedbackMap[msg.id] === "up" ? "bg-blue-50 text-blue-600 border border-blue-200" : "text-slate-500"
                              }`}
                            >
                              도움됨
                            </button>
                            <button
                              type="button"
                              onClick={() => handleFeedback(msg.id, "down")}
                              className={`p-1 px-2 rounded hover:bg-slate-200/60 text-[10px] font-semibold transition-all cursor-pointer ${
                                feedbackMap[msg.id] === "down" ? "bg-rose-50 text-rose-600 border border-rose-200" : "text-slate-500"
                              }`}
                            >
                              의견제출
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>

              {/* Embedded Input Form */}
              <div className="shrink-0 p-3 bg-white border-t border-slate-100 space-y-2">
                {(currentMessages.length > 0 || sessionSummaries[activeAiqSessionId]) && (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-1 animate-fade-in shadow-2xs">
                    <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                      <span className="text-indigo-900 font-semibold">
                        고객 상담 요약 ({tabs.find(t=>t.id === activeAiqSessionId)?.title})
                      </span>
                    </div>
                    <p className="text-xs text-slate-700 leading-relaxed font-medium pt-0.5">
                      {sessionSummaries[activeAiqSessionId] || "상담 질의가 시작되면 누적 경과가 이곳에 요약 표기됩니다."}
                    </p>
                  </div>
                )}

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
                    placeholder="질의할 상담 내용을 입력하세요 (Enter 전송 / Shift+Enter 줄바꿈)..."
                    rows={3}
                    className="w-full bg-slate-50 hover:bg-white border border-slate-300 rounded-2xl p-3 pr-24 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/20 transition-all resize-none shadow-2xs"
                  />
                  <button
                    type="submit"
                    disabled={isLoading || !query.trim()}
                    className={`absolute right-3 bottom-3 px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                      query.trim() && !isLoading
                        ? "bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-500/20 cursor-pointer"
                        : "bg-slate-200 text-slate-400 cursor-not-allowed"
                    }`}
                  >
                    {isLoading ? "산출 중..." : "전송"}
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* TAB 2: Policy Summary Markdown Viewer */}
          {activeTabId === "policy" && (
            <div className="flex-1 flex flex-col min-h-0 p-4 overflow-hidden">
              <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                <span className="text-xs font-bold text-slate-800">
                  {activeCustomer.name} 님의 보험증권 요약 (certificate.md)
                </span>
              </div>
              <div className="flex-1 overflow-y-auto p-4 bg-slate-50/70 border border-slate-200 rounded-xl text-xs text-slate-800 leading-relaxed mt-3">
                {isPolicyLoading ? (
                  <div className="py-12 text-center text-slate-500 animate-pulse">
                    고객의 개인 보험증권 데이터(certificate.md)를 불러오는 중입니다...
                  </div>
                ) : (
                  renderFormattedMarkdown(policyContent) || "보험증권 데이터를 찾을 수 없습니다."
                )}
              </div>
            </div>
          )}

          {/* TAB 3: Policy PDF Original Viewer */}
          {activeTabId === "pdf" && (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <PdfHighlightViewer
                pdfUrl={`${baseUrl}/api/v1/policy-pdf/jang`}
                initialPage={1}
                snippet=""
                sectionTitle={`${activeCustomer.name} 님의 보험약관`}
                onClose={() => setActiveTabId(activeAiqSessionId)}
              />
            </div>
          )}
        </div>

        {/* Left Column (33% / col-span-4): Customer Profile & Sensible Policy Card */}
        <div className="lg:col-span-4 order-1 lg:order-1 space-y-4 flex flex-col">

          {/* 1) Customer Profile Card (Aligned with Policy Card design) */}
          <section className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <h3 className="text-xs font-black text-slate-900 tracking-tight">
                고객 정보
              </h3>
              {/* Status Badge: Grey for Normal, Red for Abnormal */}
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                  activeCustomer.status === "정상"
                    ? "bg-slate-100 text-slate-600 border-slate-200"
                    : "bg-rose-100 text-rose-700 border-rose-300 font-black"
                }`}
              >
                {activeCustomer.status}
              </span>
            </div>

            <div className="flex items-center space-x-3 pt-0.5">
              <div className="w-10 h-10 rounded-full bg-indigo-700 flex items-center justify-center text-white font-bold text-base shadow-sm shrink-0">
                {activeCustomer.name.slice(0, 1)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-sm font-bold text-slate-900">{activeCustomer.name} 님</span>
                  <span className="text-xs font-mono text-slate-400 font-semibold">{activeCustomer.customerNo}</span>
                </div>
                <p className="text-xs text-slate-500 font-medium pt-0.5">{activeCustomer.birthDate} | {activeCustomer.phone}</p>
              </div>
            </div>
          </section>

          {/* 2) Sensible Policy Card (`가입 상품 정보`) */}
          <section className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-3 relative">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <h3 className="text-xs font-black text-slate-900 tracking-tight">
                가입 상품 정보
              </h3>
              <span className="text-[10px] text-slate-600 font-bold bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                총 1건
              </span>
            </div>

            {/* Policy Main Details Block */}
            <div className="p-3.5 bg-slate-50/90 border border-slate-200 rounded-xl space-y-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  {/* Pills: Prominent [계약 1] Slate-800 Pill + [● 정상] Green Pill */}
                  <div className="flex items-center gap-1.5">
                    <span className="h-[22px] text-[10px] font-black text-white bg-slate-800 px-2.5 flex items-center justify-center rounded-md shadow-2xs border border-slate-900">
                      계약 1
                    </span>
                    <span className="h-[22px] text-[10px] font-bold text-emerald-800 bg-emerald-100 px-2 flex items-center justify-center gap-1 rounded border border-emerald-200">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                      <span>정상</span>
                    </span>
                  </div>

                  {/* Icon Only Document Button with Popover Menu */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowDocMenuPopover(!showDocMenuPopover)}
                      className="h-[22px] px-2 rounded-md bg-white hover:bg-indigo-50 hover:text-indigo-700 border border-slate-300 text-slate-700 transition-all cursor-pointer shadow-2xs flex items-center justify-center gap-1"
                      title="서류 열기 (보험증권 / 보험약관)"
                    >
                      <svg className="w-3.5 h-3.5 text-slate-700" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </button>

                    {/* Ultra-compact Popover Menu with Minimal Width */}
                    {showDocMenuPopover && (
                      <div className="absolute right-0 top-7 w-20 bg-white border border-slate-300 rounded-lg shadow-xl z-30 p-0.5 space-y-0.5 animate-fade-in text-[11px]">
                        <button
                          type="button"
                          onClick={() => {
                            openDocTab("policy");
                            setShowDocMenuPopover(false);
                          }}
                          className="w-full text-center py-1 rounded hover:bg-indigo-50 text-slate-800 font-bold hover:text-indigo-700 transition-all cursor-pointer block"
                        >
                          보험증권
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            openDocTab("pdf");
                            setShowDocMenuPopover(false);
                          }}
                          className="w-full text-center py-1 rounded hover:bg-indigo-50 text-slate-800 font-bold hover:text-indigo-700 transition-all cursor-pointer border-t border-slate-100 block"
                        >
                          보험약관
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                
                <h4 className="text-xs font-bold text-slate-900 leading-snug pt-1">
                  {policyDetail.mainName}
                </h4>

                {/* Contract Date Gray Text (No Box) */}
                <div className="flex justify-end pt-0.5">
                  <span className="text-[11px] font-mono text-slate-500 font-medium">
                    가입일 {policyDetail.contractDate}
                  </span>
                </div>
              </div>

              {/* 계약 요약 (with small gray count text, e.g. 12건) */}
              <div className="pt-2.5 border-t border-slate-200/80 space-y-2">
                <button
                  type="button"
                  onClick={() => setIsRiderAccordionOpen(!isRiderAccordionOpen)}
                  className="w-full flex items-center justify-between text-xs font-bold text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="tracking-tight font-bold text-slate-700">계약 요약</span>
                    <span className="text-[10px] text-slate-400 font-mono font-medium">
                      ({policyDetail.riders.length}건)
                    </span>
                  </div>
                  <svg
                    className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${
                      isRiderAccordionOpen ? "rotate-180" : "rotate-0"
                    }`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {isRiderAccordionOpen && (
                  <div className="space-y-1.5 pt-1 max-h-64 overflow-y-auto pr-1 animate-fade-in scrollbar-thin">
                    {policyDetail.riders.map((rider, rIdx) => (
                      <div key={rIdx} className="p-2 bg-white border border-slate-200/80 rounded-lg text-[11px] flex items-center justify-between shadow-2xs">
                        <span className="font-semibold text-slate-800 truncate">• {rider.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* Floating Citation Popover (NO Fullscreen Blur/Dim Backdrop) */}
      {activeCitation && (
        <div
          className="fixed bottom-6 right-6 w-96 max-w-[90vw] bg-white border border-slate-300 rounded-2xl p-4 shadow-2xl z-50 animate-slide-up space-y-2 text-slate-900"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between pb-2 border-b border-slate-200">
            <span className="text-xs font-bold text-indigo-700">
              근거 조항 원문 미리보기 (p.{activeCitation.page})
            </span>
            <button
              type="button"
              onClick={() => setActiveCitation(null)}
              className="text-slate-400 hover:text-slate-700 text-xs font-bold p-1 rounded hover:bg-slate-100 transition-all cursor-pointer"
            >
              ✕
            </button>
          </div>

          <div className="space-y-1 text-xs">
            <h4 className="font-bold text-slate-900">{activeCitation.section_title}</h4>
            <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-[11px] leading-relaxed text-slate-700 max-h-40 overflow-y-auto">
              "{activeCitation.snippet}"
            </div>
          </div>

          <div className="pt-1 flex justify-end">
            <button
              type="button"
              onClick={() => openDocTab("pdf")}
              className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[11px] rounded-lg shadow-2xs transition-all cursor-pointer"
            >
              전체 약관 PDF에서 보기 ➔
            </button>
          </div>
        </div>
      )}

      {/* Query History Sliding Drawer */}
      {showDrawer && (
        <div className="fixed inset-0 bg-slate-900/30 z-50 flex justify-start animate-fade-in" onClick={() => setShowDrawer(false)}>
          <div className="w-80 bg-white h-full shadow-2xl p-4 flex flex-col space-y-4 border-r border-slate-200 animate-slide-in" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <span className="text-xs font-bold text-slate-900">
                이 고객 관련 질의 조회 이력
              </span>
              <button
                type="button"
                onClick={() => setShowDrawer(false)}
                className="text-slate-400 hover:text-slate-700 text-xs font-bold p-1 rounded hover:bg-slate-100 transition-all cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {queryLogs.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-400 space-y-1">
                  <p className="font-semibold">조회 이력이 없습니다.</p>
                  <p className="text-[11px]">새로운 상담 질의를 입력하면 이곳에 저장됩니다.</p>
                </div>
              ) : (
                queryLogs.map((log) => (
                  <div
                    key={log.id}
                    className={`p-3 rounded-xl border text-xs space-y-1.5 transition-all cursor-pointer ${
                      log.status === "활성"
                        ? "bg-blue-50/80 border-blue-300 text-blue-950 font-semibold shadow-2xs"
                        : "bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700"
                    }`}
                  >
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-slate-500 font-mono font-medium">{log.dateTime}</span>
                      <span
                        className={`px-2 py-0.5 rounded font-bold text-[9px] ${
                          log.status === "활성"
                            ? "bg-blue-600 text-white"
                            : "bg-slate-200 text-slate-600"
                        }`}
                      >
                        {log.status}
                      </span>
                    </div>
                    <p className="line-clamp-2 leading-snug font-medium text-slate-800">{log.title}</p>
                  </div>
                ))
              )}
            </div>

            <div className="pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowDrawer(false)}
                className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all cursor-pointer"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Debug Logs Modal */}
      {showDebugModal && (
        <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-4 z-50 animate-fade-in" onClick={() => setShowDebugModal(false)}>
          <div className="bg-white border border-slate-300 rounded-2xl p-6 max-w-xl w-full shadow-2xl space-y-4 text-slate-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="font-bold text-sm text-indigo-700">
                AI 손해사정 파이프라인 디버깅 로그
              </div>
              <button
                type="button"
                onClick={() => setShowDebugModal(false)}
                className="text-slate-400 hover:text-slate-700 text-sm font-bold p-1 rounded hover:bg-slate-100 transition-all cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl font-mono text-xs text-emerald-400 space-y-2 max-h-80 overflow-y-auto">
              <div className="text-slate-400 pb-1 border-b border-slate-800 text-[11px]">
                파이프라인 단계별 처리 시간 및 추론 기록
              </div>
              {stepLogs.length === 0 ? (
                <div className="text-slate-500 py-4 text-center">디버깅 기록이 없습니다.</div>
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
                type="button"
                onClick={() => setShowDebugModal(false)}
                className="px-4 py-1.5 bg-slate-800 hover:bg-slate-900 text-white font-semibold text-xs rounded-xl shadow-md transition-all cursor-pointer"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}