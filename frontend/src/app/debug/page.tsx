"use client";

import React, { useState, useEffect } from "react";
import { useSSE, UIBlock, Citation, NodeLog } from "@/hooks/useSSE";

const PRESET_QUERIES = [
  { label: "✅ 재해골절 보상금 (정상 RAG)", query: "재해골절 시 얼마 나오나요?" },
  { label: "✅ 암 진단비 문의 (정상 RAG)", query: "갑상선암 진단 시 보장 금액은?" },
  { label: "✅ Multi-hop 복합 질의 (정상 RAG)", query: "대장점막내암 진단 후 10일 입원 시 보상금은?" },
  { label: "🚫 지원 범위 밖 질문 (Out-of-Scope 차단)", query: "삼성생명은 왜 보험료가 비싼가요?" },
];

export default function DebugPage() {
  const [inputQuery, setInputQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"visual" | "logs" | "models" | "json">("visual");
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [isFetchingLogs, setIsFetchingLogs] = useState(false);
  const [selectedNodeDetails, setSelectedNodeDetails] = useState<NodeLog | null>(null);

  const {
    data,
    blocks,
    status,
    isLoading,
    isCompleted,
    nodeLogs,
    tasks,
    intent,
    llmCalls,
    loopCount,
    sessionId,
    startStream,
  } = useSSE();

  const [liveElapsedSec, setLiveElapsedSec] = useState<number>(0);

  useEffect(() => {
    let timer: any = null;
    if (isLoading) {
      const startTime = Date.now();
      timer = setInterval(() => {
        setLiveElapsedSec((Date.now() - startTime) / 1000);
      }, 100);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isLoading]);

  const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  // Audit Logs fetch
  const fetchSessionAuditLogs = async (sid: string) => {
    setIsFetchingLogs(true);
    try {
      const res = await fetch(`${baseUrl}/api/v1/session/${sid || "default"}/logs`);
      const resData = await res.json();
      if (resData.logs) {
        setAuditLogs(resData.logs);
      }
    } catch (e) {
      console.warn("Audit logs fetch failed:", e);
    } finally {
      setIsFetchingLogs(false);
    }
  };

  useEffect(() => {
    fetchSessionAuditLogs(sessionId || "");
  }, [sessionId, isCompleted]);

  const handleRunTest = (q: string) => {
    setInputQuery(q);
    startStream(q);
  };

  const totalTimeMs = nodeLogs.reduce((acc, n) => acc + (n.duration_ms || 0), 0);
  const totalSeconds = Math.round(totalTimeMs / 1000);

  const isOutOfScope = status === "OUT_OF_SCOPE" || nodeLogs.some((n) => n.node === "out_of_scope_response" || n.is_valid === false);
  const isSlotAsking = status === "SLOT_FILLING" || nodeLogs.some((n) => n.node === "ask_slots");

  const downloadLogsJson = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({ sessionId, status, intent, tasks, nodeLogs, auditLogs }, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `rag_workflow_log_${sessionId || "session"}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/20 to-indigo-50/30 text-slate-800 font-sans p-4 md:p-6 space-y-6">
      {/* Light Theme Header */}
      <header className="max-w-6xl mx-auto w-full flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-4 border-b border-slate-200/80">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-blue-600 flex items-center justify-center font-bold text-white shadow-md shadow-indigo-500/20 text-lg">
            ⚡
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold bg-gradient-to-r from-blue-700 via-indigo-700 to-indigo-900 bg-clip-text text-transparent">
                LangGraph Live Dynamic Orchestration Dashboard
              </h1>
              <span className="px-2.5 py-0.5 bg-indigo-100 text-indigo-800 border border-indigo-200 text-xs font-mono font-semibold rounded-full">
                v2.0
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              실시간 노드 생성 세로 그래프(Real-time Sprouting Nodes), Parallel LLM Builder, 호출 횟수/초 관제
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={downloadLogsJson}
            className="px-3.5 py-1.5 bg-white hover:bg-slate-100 text-slate-700 text-xs font-medium rounded-xl border border-slate-300 shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <span>📥</span>
            <span>로그 JSON 다운로드</span>
          </button>
          <button
            onClick={() => fetchSessionAuditLogs(sessionId || "")}
            disabled={isFetchingLogs}
            className="px-3.5 py-1.5 bg-white hover:bg-slate-100 text-slate-700 text-xs font-medium rounded-xl border border-slate-300 shadow-xs transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <span>🔄</span>
            <span>{isFetchingLogs ? "동기화 중..." : "감사 로그 동기화"}</span>
          </button>
          <a
            href="/"
            className="px-4 py-1.5 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white text-xs font-semibold rounded-xl shadow-sm transition-all flex items-center gap-1.5"
          >
            <span>💬</span>
            <span>상담 화면으로 돌아가기</span>
          </a>
        </div>
      </header>

      <main className="max-w-6xl mx-auto w-full space-y-6">
        {/* Active Session & Query Input */}
        <section className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-indigo-950 flex items-center gap-1.5">
                <span>🔑</span> 활성 세션:
              </span>
              <span className="text-xs font-mono font-semibold px-2.5 py-1 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg">
                {sessionId || "세션 생성 전 (질문 실행 시 자동 생성)"}
              </span>
            </div>
            {isLoading && (
              <span className="text-xs font-bold text-amber-600 bg-amber-50 border border-amber-200 px-3 py-1 rounded-full animate-pulse flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
                LangGraph 노드 실시간 생성 중... ({totalSeconds}초)
              </span>
            )}
          </div>

          {/* Test Query Bar */}
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-2.5">
              <input
                type="text"
                value={inputQuery}
                onChange={(e) => setInputQuery(e.target.value)}
                placeholder="현재 세션에서 테스트할 질문을 입력하세요 (예: 재해골절 시 얼마 나오나요?)"
                className="flex-1 bg-slate-50 border border-slate-300/80 rounded-xl px-4 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all font-mono"
                onKeyDown={(e) => e.key === "Enter" && inputQuery && startStream(inputQuery)}
              />
              <button
                onClick={() => inputQuery && startStream(inputQuery)}
                disabled={isLoading}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md transition-all cursor-pointer disabled:opacity-50"
              >
                {isLoading ? "실행 중..." : "질문 실행"}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold text-slate-500">빠른 테스트 샘플:</span>
              {PRESET_QUERIES.map((preset, idx) => (
                <button
                  key={idx}
                  onClick={() => handleRunTest(preset.query)}
                  disabled={isLoading}
                  className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-medium rounded-lg border border-slate-200 transition-all cursor-pointer disabled:opacity-50"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Real-time State & Metrics Dashboard */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="p-4 bg-white border border-slate-200 rounded-2xl shadow-xs space-y-1">
            <div className="text-[11px] font-bold text-indigo-700 uppercase tracking-wider">Detected Intent</div>
            <div className="text-xs font-bold text-slate-900 font-mono truncate">{intent || "(대기 중)"}</div>
          </div>

          <div className="p-4 bg-white border border-slate-200 rounded-2xl shadow-xs space-y-1">
            <div className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider">Status</div>
            <div>
              <span
                className={`inline-block px-2 py-0.5 text-[11px] font-bold font-mono rounded-md ${
                  isOutOfScope
                    ? "bg-rose-100 text-rose-800 border border-rose-300"
                    : isSlotAsking
                    ? "bg-amber-100 text-amber-800 border border-amber-300"
                    : "bg-emerald-100 text-emerald-800 border border-emerald-300"
                }`}
              >
                {isOutOfScope ? "OUT_OF_SCOPE" : isSlotAsking ? "SLOT_FILLING" : status || "IDLE"}
              </span>
            </div>
          </div>

          <div className="p-4 bg-white border border-slate-200 rounded-2xl shadow-xs space-y-1">
            <div className="text-[11px] font-bold text-purple-700 uppercase tracking-wider">API 호출 횟수</div>
            <div className="text-sm font-bold text-purple-900 font-mono">{llmCalls > 0 ? `${llmCalls} 회` : "0 회"}</div>
          </div>

          <div className="p-4 bg-white border border-slate-200 rounded-2xl shadow-xs space-y-1">
            <div className="text-[11px] font-bold text-amber-700 uppercase tracking-wider">Multi-hop 루프</div>
            <div className="text-sm font-bold text-amber-900 font-mono">{loopCount > 0 ? `${loopCount} 회` : "0 회"}</div>
          </div>

          <div className="p-4 bg-white border border-slate-200 rounded-2xl shadow-xs space-y-1">
            <div className="text-[11px] font-bold text-blue-700 uppercase tracking-wider flex items-center justify-between">
              <span>소요 시간</span>
              {isLoading && <span className="animate-pulse text-blue-600 font-extrabold text-[10px]">● LIVE</span>}
            </div>
            <div className="text-sm font-bold text-blue-900 font-mono">
              {isLoading ? `${liveElapsedSec.toFixed(1)} 초` : `${Math.max(totalSeconds, Math.round(liveElapsedSec))} 초`}
            </div>
          </div>
        </section>

        {/* Navigation Tabs */}
        <section className="bg-white border border-slate-200/90 rounded-2xl shadow-sm overflow-hidden">
          <div className="flex items-center gap-1 border-b border-slate-200 px-4 bg-slate-50/80">
            <button
              onClick={() => setActiveTab("visual")}
              className={`px-4 py-3 text-xs font-bold border-b-2 transition-all cursor-pointer ${
                activeTab === "visual"
                  ? "border-indigo-600 text-indigo-700 bg-white"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              📊 Live Sprouting Flowchart (실시간 노드 생성 대시보드)
            </button>
            <button
              onClick={() => setActiveTab("logs")}
              className={`px-4 py-3 text-xs font-bold border-b-2 transition-all cursor-pointer ${
                activeTab === "logs"
                  ? "border-indigo-600 text-indigo-700 bg-white"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              ⏱️ Node Execution & Audit Logs ({nodeLogs.length})
            </button>
            <button
              onClick={() => setActiveTab("models")}
              className={`px-4 py-3 text-xs font-bold border-b-2 transition-all cursor-pointer ${
                activeTab === "models"
                  ? "border-indigo-600 text-indigo-700 bg-white"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              ⚙️ Model Orchestration Strategy
            </button>
            <button
              onClick={() => setActiveTab("json")}
              className={`px-4 py-3 text-xs font-bold border-b-2 transition-all cursor-pointer ${
                activeTab === "json"
                  ? "border-indigo-600 text-indigo-700 bg-white"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              📄 Raw JSON Inspector
            </button>
          </div>

          {/* Tab 1: Live Sprouting Top-Down Flowchart */}
          {activeTab === "visual" && (
            <div className="p-6 space-y-6">
              <div className="text-xs text-slate-500 flex items-center justify-between">
                <span>
                  미리 플레이스홀더를 생성하지 않고, **질문 실행 시 각 노드가 완료될 때마다 동적으로 실시간 쫘르륵 생성**되는 대시보드입니다.
                </span>
                <span className="font-mono text-[11px] text-indigo-700 font-semibold bg-indigo-50 border border-indigo-200 px-2.5 py-1 rounded-lg">
                  {nodeLogs.length} Nodes Executed
                </span>
              </div>

              {/* Dynamic Live Sprouting Flowchart Canvas */}
              <div className="p-6 bg-slate-50/80 border border-slate-200 rounded-2xl flex flex-col items-center space-y-4 min-h-[220px]">
                {/* 1. START Badge */}
                <div className="px-5 py-2 rounded-xl bg-slate-900 text-white font-mono text-xs font-bold shadow-sm">
                  START
                </div>

                {nodeLogs.length === 0 && !isLoading && (
                  <div className="text-xs text-slate-400 font-mono py-8 italic text-center space-y-1">
                    <div>질문을 입력하고 실행하면, LangGraph 노드가 동적으로 세로로 생성됩니다.</div>
                    <div className="text-[11px] text-indigo-600 font-semibold">● 대기 중 (질문 미실행)</div>
                  </div>
                )}

                {/* DYNAMIC SPROUTING NODES MAPPING */}
                {nodeLogs.map((log, idx) => (
                  <React.Fragment key={idx}>
                    <div className="text-slate-400 font-bold text-sm">↓</div>

                    {/* Node: Task Planner */}
                    {log.node === "task_planner" && (
                      <div
                        onClick={() => setSelectedNodeDetails(log)}
                        className="w-full max-w-lg p-4 rounded-2xl border border-indigo-500 bg-white shadow-md ring-2 ring-indigo-500/20 transition-all cursor-pointer hover:shadow-lg animate-fade-in"
                      >
                        <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-2">
                          <span className="text-xs font-bold text-indigo-900 flex items-center gap-1.5">
                            <span>📋</span> 1. Task Planner Node
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-mono font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                              GPT-4o-mini
                            </span>
                            <span className="text-[10px] bg-slate-100 hover:bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-semibold border border-indigo-200">🔍 결과 보기</span>
                          </div>
                        </div>
                        <div className="text-xs text-slate-600 space-y-1">
                          <div className="font-semibold text-slate-800">질문 분석 및 작업 분해:</div>
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {log.tasks && log.tasks.length > 0 ? (
                              log.tasks.map((tItem: any, tidx: number) => {
                                const isObj = typeof tItem === "object" && tItem !== null;
                                const tName = isObj ? tItem.task_name : String(tItem);
                                const mode = isObj ? tItem.worker_mode : "";
                                return (
                                  <span key={tidx} className="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-[11px] font-mono rounded border border-indigo-200 flex items-center gap-1">
                                    <span>Task #{tidx + 1}: {tName}</span>
                                    {mode && (
                                      <span className="text-[9px] font-bold px-1 bg-indigo-100 rounded uppercase">{mode}</span>
                                    )}
                                  </span>
                                );
                              })
                            ) : (
                              <span className="text-slate-500 text-[11px]">작업 분해 완료</span>
                            )}
                          </div>
                        </div>
                        <div className="mt-2 text-right text-[10px] font-mono text-slate-400">
                          ✓ Execution: {Math.round((log.duration_ms || 0) / 1000)}초 ({log.duration_ms}ms)
                        </div>
                      </div>
                    )}

                    {/* Node: Query Validation */}
                    {log.node === "query_validation" && (
                      <div
                        onClick={() => setSelectedNodeDetails(log)}
                        className={`w-full max-w-lg p-4 rounded-2xl border transition-all cursor-pointer hover:shadow-lg animate-fade-in ${
                          log.is_valid === false
                            ? "bg-rose-50 border-rose-500 text-rose-950 shadow-md ring-2 ring-rose-400"
                            : "bg-white border-indigo-500 shadow-md ring-2 ring-indigo-500/20"
                        }`}
                      >
                        <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-2">
                          <span className="text-xs font-bold text-indigo-900 flex items-center gap-1.5">
                            <span>🛡️</span> 2. Query Validation Node
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-mono font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                              GPT-4o-mini
                            </span>
                            <span className="text-[10px] bg-slate-100 hover:bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-semibold border border-indigo-200">🔍 결과 보기</span>
                          </div>
                        </div>
                        <div className="text-xs text-slate-600 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-800">검증 조건 판단:</span>
                            <span className={`px-2 py-0.5 text-[11px] font-mono font-bold rounded ${log.is_valid === false ? "bg-rose-200 text-rose-900" : "bg-emerald-100 text-emerald-800"}`}>
                              {log.is_valid === false ? "❌ is_valid = False (범위 밖 차단)" : "✔️ is_valid = True (정상)"}
                            </span>
                          </div>
                          {log.reason && (
                            <div className="text-[11px] text-rose-700 bg-rose-100/60 p-2 rounded-lg border border-rose-200 font-mono mt-1">
                              거절 사유: {log.reason}
                            </div>
                          )}
                        </div>
                        <div className="mt-2 text-right text-[10px] font-mono text-slate-400">
                          ✓ Execution: {Math.round((log.duration_ms || 0) / 1000)}초 ({log.duration_ms}ms)
                        </div>
                      </div>
                    )}

                    {/* Node: Out of Scope Response */}
                    {log.node === "out_of_scope_response" && (
                      <div
                        onClick={() => setSelectedNodeDetails(log)}
                        className="w-full max-w-lg p-4 rounded-2xl border border-rose-500 bg-rose-50/90 text-rose-950 shadow-md ring-2 ring-rose-300 cursor-pointer hover:shadow-lg animate-fade-in"
                      >
                        <div className="flex items-center justify-between border-b border-rose-200 pb-2 mb-2">
                          <span className="text-xs font-extrabold text-rose-900 flex items-center gap-1.5">
                            <span>🚫</span> Out-of-Scope Response Node
                          </span>
                          <span className="text-[10px] font-mono font-bold text-rose-700 bg-rose-100 px-2 py-0.5 rounded border border-rose-300">
                            Bypass Vector Search
                          </span>
                        </div>
                        <div className="text-xs text-rose-800 leading-relaxed">
                          보험 증권 및 약관 범주 외 질문이므로 Supabase Vector DB 검색을 차단하고 0원 비용으로 즉시 거절 멘트를 출력합니다.
                        </div>
                        <div className="mt-2 text-right text-[10px] font-mono text-rose-600">
                          ✓ Execution: {Math.round((log.duration_ms || 0) / 1000)}초
                        </div>
                      </div>
                    )}

                    {/* Node: Intent Router */}
                    {log.node === "intent_router" && (
                      <div
                        onClick={() => setSelectedNodeDetails(log)}
                        className="w-full max-w-lg p-4 rounded-2xl border border-indigo-500 bg-white shadow-md ring-2 ring-indigo-500/20 transition-all cursor-pointer hover:shadow-lg animate-fade-in"
                      >
                        <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-2">
                          <span className="text-xs font-bold text-indigo-900 flex items-center gap-1.5">
                            <span>🔮</span> 3. Intent Router Node
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-mono font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                              GPT-4o-mini
                            </span>
                            <span className="text-[10px] bg-slate-100 hover:bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-semibold border border-indigo-200">🔍 결과 보기</span>
                          </div>
                        </div>
                        <div className="text-xs text-slate-600 space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-800">분류된 의도 (Intent):</span>
                            <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 font-mono text-[11px] rounded border border-indigo-200 font-bold">
                              {intent || log.intent || "(완료)"}
                            </span>
                          </div>
                          {log.filters && (
                            <div className="text-[11px] text-slate-700 bg-slate-50 p-2 rounded-lg border border-slate-200 font-mono">
                              매칭 특약 필터 ({log.filters.length}개): {log.filters.join(", ") || "전체 약관 범위"}
                            </div>
                          )}
                        </div>
                        <div className="mt-2 text-right text-[10px] font-mono text-slate-400">
                          ✓ Execution: {Math.round((log.duration_ms || 0) / 1000)}초 ({log.duration_ms}ms)
                        </div>
                      </div>
                    )}

                    {/* Node: Parallel Context Builder */}
                    {log.node === "parallel_context_builder" && (
                      <div
                        onClick={() => setSelectedNodeDetails(log)}
                        className="w-full max-w-2xl p-5 rounded-2xl border border-blue-500 bg-white shadow-lg ring-2 ring-blue-500/20 transition-all cursor-pointer hover:shadow-lg animate-fade-in"
                      >
                        <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-3">
                          <span className="text-xs font-bold text-blue-950 flex items-center gap-2">
                            <span>⚡</span> 4. Parallel Context Builder (LLM Parallel Fan-Out)
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-mono font-bold text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-full border border-blue-200">
                              Fan-Out 3 Sub-Tasks
                            </span>
                            <span className="text-[10px] bg-slate-100 hover:bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-semibold border border-blue-200">🔍 결과 보기</span>
                          </div>
                        </div>

                        {/* Dynamic Sub-Task Parallel Workers Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 my-2">
                          {(tasks && tasks.length > 0 ? tasks : ["기본 증권 조회", "약관 Vector 검색"]).map((tItem: any, tIdx: number) => {
                            const isObj = typeof tItem === "object" && tItem !== null;
                            const tName = isObj ? tItem.task_name : String(tItem);
                            const mode = isObj ? tItem.worker_mode : "RAG_LLM";
                            return (
                              <div key={tIdx} className="p-3 bg-indigo-50/70 border border-indigo-200 rounded-xl space-y-1.5">
                                <div className="text-[10px] font-bold text-indigo-900 flex items-center justify-between">
                                  <span>Worker #{tIdx + 1}</span>
                                  <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded uppercase ${
                                    mode === "RAG_ONLY" ? "bg-blue-100 text-blue-800 border border-blue-200" :
                                    mode === "LLM_ONLY" ? "bg-purple-100 text-purple-800 border border-purple-200" :
                                    "bg-emerald-100 text-emerald-800 border border-emerald-200"
                                  }`}>
                                    {mode}
                                  </span>
                                </div>
                                <div className="text-[11px] text-indigo-950 font-mono font-semibold truncate" title={tName}>
                                  {tName}
                                </div>
                                {isObj && tItem.description && (
                                  <div className="text-[10px] text-slate-500 truncate">{tItem.description}</div>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {/* Fan-In Merge Node */}
                        <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2 text-slate-700 font-medium">
                            <span>🔄 Fan-In Context Merge:</span>
                            <span className="font-mono text-blue-700 font-bold bg-blue-50 px-2 py-0.5 rounded border border-blue-200 text-[11px]">
                              {log.doc_count || 0}개 약관 문서 병합 완료
                            </span>
                          </div>
                          <span className="text-[10px] font-mono text-slate-400">
                            ✓ Duration: {Math.round((log.duration_ms || 0) / 1000)}초 ({log.duration_ms}ms)
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Node: Multi-hop Reasoning */}
                    {log.node === "multi_hop_reasoning" && (
                      <div
                        onClick={() => setSelectedNodeDetails(log)}
                        className="w-full max-w-lg p-4 rounded-2xl border border-purple-500 bg-white shadow-md ring-2 ring-purple-500/20 transition-all cursor-pointer hover:shadow-lg animate-fade-in"
                      >
                        <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-2">
                          <span className="text-xs font-bold text-purple-950 flex items-center gap-1.5">
                            <span>🧠</span> 5. Multi-hop Reasoning Node
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-mono font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-200">
                              GPT-4o-mini
                            </span>
                            <span className="text-[10px] bg-slate-100 hover:bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-semibold border border-purple-200">🔍 결과 보기</span>
                          </div>
                        </div>
                        <div className="text-xs text-slate-600 space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-800">보상 가능 여부:</span>
                            <span className="px-2 py-0.5 bg-purple-50 text-purple-800 font-mono text-[11px] rounded border border-purple-200 font-bold">
                              {log.is_eligible !== undefined ? (log.is_eligible ? "✔️ 지급 대상 (Eligible)" : "❌ 부지급 사유 발견") : "추론 완료"}
                            </span>
                          </div>
                          {log.chain_refs && log.chain_refs.length > 0 && (
                            <div className="text-[11px] text-purple-800 bg-purple-50 p-2 rounded-lg border border-purple-200 font-mono">
                              🔗 연쇄 참조 감지 조항 ({log.chain_refs.length}개): {log.chain_refs.slice(0, 5).join(", ")}
                            </div>
                          )}
                        </div>
                        <div className="mt-2 text-right text-[10px] font-mono text-slate-400">
                          ✓ Execution: {Math.round((log.duration_ms || 0) / 1000)}초 ({log.duration_ms}ms)
                        </div>
                      </div>
                    )}

                    {/* Node: Response Builder */}
                    {log.node === "generate" && (
                      <div
                        onClick={() => setSelectedNodeDetails(log)}
                        className="w-full max-w-lg p-4 rounded-2xl border border-emerald-500 bg-white shadow-md ring-2 ring-emerald-500/20 transition-all cursor-pointer hover:shadow-lg animate-fade-in"
                      >
                        <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-2">
                          <span className="text-xs font-bold text-emerald-950 flex items-center gap-1.5">
                            <span>✍️</span> 6. Response Builder Node
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-mono font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                              GPT-5-mini
                            </span>
                            <span className="text-[10px] bg-slate-100 hover:bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-semibold border border-emerald-200">🔍 결과 보기</span>
                          </div>
                        </div>
                        <div className="text-xs text-slate-600 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-slate-800">구조화 UI Block 생성:</span>
                            <span className="px-2 py-0.5 bg-emerald-50 text-emerald-800 font-mono text-[11px] rounded border border-emerald-200 font-bold">
                              {log.block_count || blocks.length}개 블록 생성 완료
                            </span>
                          </div>
                        </div>
                        <div className="mt-2 text-right text-[10px] font-mono text-slate-400">
                          ✓ Execution: {Math.round((log.duration_ms || 0) / 1000)}초 ({log.duration_ms}ms)
                        </div>
                      </div>
                    )}
                  </React.Fragment>
                ))}

                {/* PULSING SPINNER WHILE EXECUTING NEXT NODE */}
                {isLoading && (
                  <div className="flex flex-col items-center animate-pulse space-y-2 py-2">
                    <div className="text-amber-500 font-bold text-sm">↓</div>
                    <div className="px-5 py-3 rounded-2xl border border-amber-400 bg-amber-50/90 text-amber-900 font-mono text-xs font-bold shadow-xs flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-ping" />
                      <span>● Executing next LangGraph node in real-time...</span>
                    </div>
                  </div>
                )}

                {/* END BADGE WHEN COMPLETED */}
                {!isLoading && nodeLogs.length > 0 && (
                  <React.Fragment>
                    <div className="text-slate-400 font-bold text-sm">↓</div>
                    <div
                      className={`px-5 py-2 rounded-xl text-white font-mono text-xs font-bold shadow-sm ${
                        isOutOfScope ? "bg-rose-800" : isSlotAsking ? "bg-amber-800" : "bg-emerald-800"
                      }`}
                    >
                      END ({isOutOfScope ? "Out of Scope 차단 완료" : isSlotAsking ? "되묻기 완료" : "LangGraph 파이프라인 수행 완료"})
                    </div>
                  </React.Fragment>
                )}
              </div>

              {/* Generated Answer Output */}
              {data && (
                <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-xs space-y-2">
                  <div className="text-xs font-bold text-indigo-900 flex items-center gap-2">
                    <span>✍️</span> Generated Response Output:
                  </div>
                  <div className="text-xs text-slate-700 leading-relaxed font-sans whitespace-pre-wrap">{data}</div>
                </div>
              )}
            </div>
          )}

          {/* Tab 2: Audit Logs */}
          {activeTab === "logs" && (
            <div className="p-6 space-y-6">
              <div className="space-y-3 font-mono text-xs">
                <div className="flex justify-between text-slate-500 pb-2 border-b border-slate-200 text-[11px] font-bold">
                  <span>NODE / STEP NAME</span>
                  <span>DURATION</span>
                </div>
                {nodeLogs.length === 0 ? (
                  <div className="py-8 text-center text-slate-400">실행된 노드 기록이 없습니다. 테스트 질문을 실행하세요.</div>
                ) : (
                  nodeLogs.map((n, i) => (
                    <div key={i} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-b-0">
                      <div className="flex items-center gap-3">
                        <span className="text-slate-400 text-[10px]">#0{i + 1}</span>
                        <span className="font-bold text-indigo-900">{n.node}</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-slate-600">{Math.round((n.duration_ms || 0) / 1000)}초 ({n.duration_ms} ms)</span>
                        <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded text-[10px] font-bold">
                          SUCCESS
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* DB & File Audit Logs */}
              {auditLogs.length > 0 && (
                <div className="pt-4 border-t border-slate-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-bold text-indigo-900 flex items-center gap-2">
                      <span>🗄️</span> DB 및 로컬 파일 감사 로그 (Audit Log Entries)
                    </div>
                    <span className="text-[11px] text-slate-500 font-mono">workflow_audit_logs.json</span>
                  </div>

                  <div className="space-y-2 font-mono text-xs max-h-72 overflow-y-auto">
                    {auditLogs.map((alog, i) => (
                      <div key={i} className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                        <div className="flex items-center justify-between text-[11px] font-bold text-slate-700">
                          <span>
                            [{alog.step_name}] {alog.status}
                          </span>
                          <span className="text-slate-400">{Math.round((alog.execution_time_ms || 0) / 1000)}초 ({alog.execution_time_ms} ms)</span>
                        </div>
                        <div className="text-[11px] text-slate-500 truncate">
                          Summary: {alog.output_payload?.answer_summary || JSON.stringify(alog.output_payload || {})}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tab 3: Model Matrix */}
          {activeTab === "models" && (
            <div className="p-6 space-y-4">
              <div className="text-xs text-slate-500">
                AGENT.MD의 Model Orchestration Strategy에 따른 각 Node별 LLM 모델 할당표입니다.
              </div>

              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-left text-xs font-mono">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 font-bold">
                      <th className="p-3">Node Name</th>
                      <th className="p-3">Assigned Model</th>
                      <th className="p-3">Role / Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    <tr>
                      <td className="p-3 font-bold text-indigo-900">task_planner</td>
                      <td className="p-3 text-indigo-700 font-bold">GPT-4o-mini</td>
                      <td className="p-3 text-slate-500">구조화된 작업 정의 및 서브 타스크 분해</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-bold text-indigo-900">query_validation</td>
                      <td className="p-3 text-indigo-700 font-bold">GPT-4o-mini</td>
                      <td className="p-3 text-slate-500">범주 외 질문 빠른 분류 및 차단</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-bold text-indigo-900">intent_router</td>
                      <td className="p-3 text-indigo-700 font-bold">GPT-4o-mini</td>
                      <td className="p-3 text-slate-500">의도 분류 및 특약 매칭 라우팅</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-bold text-indigo-900">parallel_context_builder</td>
                      <td className="p-3 text-blue-700 font-bold">Rule + Parallel LLMs</td>
                      <td className="p-3 text-slate-500">Sub-Query Expansion + 증권 MD extraction Fan-out 동시 수집</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-bold text-indigo-900">multi_hop_reasoning</td>
                      <td className="p-3 text-purple-700 font-bold">GPT-5-mini</td>
                      <td className="p-3 text-slate-500">연쇄 참조 조항 검토 및 손해사정 보상금 추론</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-bold text-indigo-900">generate (Response Builder)</td>
                      <td className="p-3 text-purple-700 font-bold">GPT-5-mini</td>
                      <td className="p-3 text-slate-500">근거 주석(citations) 및 UI Block 최종 생성</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Tab 4: Raw JSON */}
          {activeTab === "json" && (
            <div className="p-6">
              <pre className="p-4 bg-slate-900 text-emerald-400 font-mono text-xs rounded-xl overflow-x-auto border border-slate-800 max-h-96">
                {JSON.stringify({ sessionId, status, intent, tasks, blocks, nodeLogs, auditLogs, answer: data }, null, 2)}
              </pre>
            </div>
          )}
        </section>
      </main>

      {/* Selected Node Result Detail Inspector Modal */}
      {selectedNodeDetails && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white border border-slate-300 rounded-2xl p-6 max-w-2xl w-full shadow-2xl space-y-4 text-slate-900 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <span className="text-base">📌</span>
                <span className="font-bold text-indigo-950 text-sm">
                  Node Detail Inspector: <span className="font-mono text-indigo-600">{selectedNodeDetails.node}</span>
                </span>
              </div>
              <button
                onClick={() => setSelectedNodeDetails(null)}
                className="text-slate-400 hover:text-slate-700 text-sm font-bold p-1 rounded hover:bg-slate-100 transition-all cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs font-mono">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                <div className="text-slate-500 text-[10px]">EXECUTION DURATION</div>
                <div className="font-bold text-slate-800 text-sm mt-0.5">{Math.round((selectedNodeDetails.duration_ms || 0) / 1000)}초 ({selectedNodeDetails.duration_ms} ms)</div>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                <div className="text-slate-500 text-[10px]">TIMESTAMP</div>
                <div className="font-bold text-slate-800 text-xs mt-0.5">{selectedNodeDetails.timestamp ? selectedNodeDetails.timestamp.split("T")[1]?.slice(0, 8) : "-"}</div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-bold text-slate-700">Node Output & State Payload:</div>
              <pre className="p-4 bg-slate-900 text-emerald-400 font-mono text-xs rounded-xl overflow-x-auto max-h-72 border border-slate-800">
                {JSON.stringify(selectedNodeDetails, null, 2)}
              </pre>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedNodeDetails(null)}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md transition-all cursor-pointer"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
