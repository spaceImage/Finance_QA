import { useState, useCallback, useRef, useEffect } from "react";

export interface Citation {
  id: number;
  section_title: string;
  page: number;
  snippet: string;
}

export interface BlockItem {
  text: string;
  citations?: Citation[];
}

export interface UIBlock {
  block_type: "CONTEXT" | "RETRIEVAL_RESULT" | "CAUTION" | "DELIVER";
  title: string;
  variant?: string;
  content?: string;
  items?: (string | BlockItem)[];
}

export interface StepLog {
  step: number;
  label: string;
  timestamp: string;
}

export interface NodeLog {
  node: string;
  duration_ms: number;
  timestamp: string;
  [key: string]: any;
}

interface UseSSEReturn {
  data: string;
  blocks: UIBlock[];
  status: string;
  isLoading: boolean;
  isCompleted: boolean;
  progress: number;
  currentStepLabel: string;
  stepLogs: StepLog[];
  nodeLogs: NodeLog[];
  tasks: string[];
  intent: string;
  llmCalls: number;
  loopCount: number;
  error: string | null;
  sessionId: string | null;
  startStream: (query: string, taskName?: string) => Promise<void>;
  sendSlotFill: (slotKey: string, slotValue: string, taskName?: string) => Promise<void>;
  approveTaskPlan: (approvedTasks?: string[], taskName?: string) => Promise<void>;
  stopStream: () => void;
  resetStream: () => void;
}

export function useSSE(): UseSSEReturn {
  const [data, setData] = useState<string>("");
  const [blocks, setBlocks] = useState<UIBlock[]>([]);
  const [status, setStatus] = useState<string>("SUCCESS");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [currentStepLabel, setCurrentStepLabel] = useState<string>("");
  const [stepLogs, setStepLogs] = useState<StepLog[]>([]);
  const [nodeLogs, setNodeLogs] = useState<NodeLog[]>([]);
  const [tasks, setTasks] = useState<string[]>([]);
  const [intent, setIntent] = useState<string>("");
  const [llmCalls, setLlmCalls] = useState<number>(0);
  const [loopCount, setLoopCount] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);

  // 컴포넌트 마운트 시 저장된 세션 복원
  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = sessionStorage.getItem("active_rag_session");
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed.sessionId) setSessionId(parsed.sessionId);
          if (parsed.answer) setData(parsed.answer);
          if (parsed.blocks) setBlocks(parsed.blocks);
          if (parsed.status) setStatus(parsed.status);
          if (parsed.nodeLogs) setNodeLogs(parsed.nodeLogs);
          if (parsed.tasks) setTasks(parsed.tasks);
          if (parsed.intent) setIntent(parsed.intent);
          if (parsed.llmCalls) setLlmCalls(parsed.llmCalls);
          if (parsed.loopCount) setLoopCount(parsed.loopCount);
          if (parsed.stepLogs) setStepLogs(parsed.stepLogs);
        } catch (e) {
          console.warn("세션 복원 실패:", e);
        }
      }
    }
  }, []);

  const saveToSessionStorage = (updated: Record<string, any>) => {
    if (typeof window !== "undefined") {
      const existing = sessionStorage.getItem("active_rag_session");
      let currentData = {};
      if (existing) {
        try { currentData = JSON.parse(existing); } catch (e) {}
      }
      const newDump = { ...currentData, ...updated, timestamp: new Date().toISOString() };
      sessionStorage.setItem("active_rag_session", JSON.stringify(newDump));
    }
  };

  const stopStream = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsLoading(false);
  }, []);

  const resetStream = useCallback(() => {
    stopStream();
    setData("");
    setBlocks([]);
    setStatus("SUCCESS");
    setProgress(0);
    setCurrentStepLabel("");
    setStepLogs([]);
    setNodeLogs([]);
    setTasks([]);
    setIntent("");
    setLlmCalls(0);
    setLoopCount(0);
    setError(null);
    setIsCompleted(false);
  }, [stopStream]);

  const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  const createSession = async (taskName: string = "jang"): Promise<string | null> => {
    try {
      const res = await fetch(`${baseUrl}/api/v1/session/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_name: taskName }),
      });
      const resData = await res.json();
      if (resData.session_id) {
        setSessionId(resData.session_id);
        saveToSessionStorage({ sessionId: resData.session_id });
        return resData.session_id;
      }
    } catch (e) {
      console.warn("세션 생성 오류 (기본 진행):", e);
    }
    return null;
  };

  const startStream = useCallback(
    async (query: string, taskName: string = "jang") => {
      resetStream();
      setIsLoading(true);
      setProgress(15);
      const initLabel = "🔮 1단계: 파이프라인 초기화 및 라우팅 분석 중...";
      setCurrentStepLabel(initLabel);
      setStepLogs([{ step: 1, label: initLabel, timestamp: new Date().toLocaleTimeString() }]);

      let activeSessionId = sessionId;
      if (!activeSessionId) {
        activeSessionId = await createSession(taskName);
      }

      const encodedQuery = encodeURIComponent(query);
      let url = `${baseUrl}/api/rag/stream?query=${encodedQuery}&task_name=${taskName}`;
      if (activeSessionId) {
        url += `&session_id=${activeSessionId}`;
      }

      let accumulatedText = "";

      try {
        const es = new EventSource(url);
        eventSourceRef.current = es;

        es.onopen = () => {
          setIsLoading(true);
        };

        es.onmessage = (event) => {
          try {
            if (event.data === "[DONE]") {
              setIsCompleted(true);
              setProgress(100);
              stopStream();
              saveToSessionStorage({ query, answer: accumulatedText, isCompleted: true });
              return;
            }

            const parsed = JSON.parse(event.data);
            if (parsed.progress_node) {
              if (parsed.node_logs) {
                setNodeLogs(parsed.node_logs);
                const calls = parsed.node_logs.filter((n: any) =>
                  ["task_planner", "query_validation", "intent_router", "grade_documents", "multi_hop_reasoning", "generate", "out_of_scope_response"].includes(n.node)
                ).length;
                setLlmCalls(calls);

                const loops = parsed.node_logs.filter((n: any) => n.node === "multi_hop_reasoning" || n.node === "rewrite_query").length;
                setLoopCount(loops);

                saveToSessionStorage({
                  sessionId: activeSessionId,
                  query,
                  status: parsed.status || "RUNNING",
                  nodeLogs: parsed.node_logs || [],
                  tasks: parsed.tasks || [],
                  intent: parsed.intent || "",
                  llmCalls: calls,
                  loopCount: loops,
                });
              }
              if (parsed.tasks) setTasks(parsed.tasks);
              if (parsed.intent) setIntent(parsed.intent);
              if (parsed.status) setStatus(parsed.status);
            } else if (parsed.progress !== undefined) {
              setProgress(parsed.progress);
              if (parsed.label) {
                setCurrentStepLabel(parsed.label);
                setStepLogs((prev) => [
                  ...prev,
                  { step: parsed.step || prev.length + 1, label: parsed.label, timestamp: new Date().toLocaleTimeString() }
                ]);
              }
            } else if (parsed.blocks && Array.isArray(parsed.blocks)) {
              setBlocks(parsed.blocks);
              if (parsed.status) setStatus(parsed.status);
              if (parsed.node_logs) setNodeLogs(parsed.node_logs);
              if (parsed.tasks) setTasks(parsed.tasks);
              if (parsed.intent) setIntent(parsed.intent);
              setProgress(100);

              const calls = (parsed.node_logs || []).filter((n: any) =>
                ["task_planner", "query_validation", "intent_router", "grade_documents", "multi_hop_reasoning", "generate", "out_of_scope_response"].includes(n.node)
              ).length;
              setLlmCalls(calls);

              saveToSessionStorage({
                sessionId: activeSessionId,
                query,
                status: parsed.status || "SUCCESS",
                blocks: parsed.blocks,
                nodeLogs: parsed.node_logs || [],
                tasks: parsed.tasks || [],
                intent: parsed.intent || "",
                llmCalls: calls,
              });
            } else if (parsed.content) {
              accumulatedText += parsed.content;
              setData(accumulatedText);
            }
          } catch {
            accumulatedText += event.data;
            setData(accumulatedText);
          }
        };

        es.onerror = () => {
          setIsCompleted(true);
          stopStream();
        };
      } catch (err: any) {
        setError(err.message || "SSE 스트림 연결에 실패했습니다.");
        setIsLoading(false);
      }
    },
    [resetStream, stopStream, baseUrl]
  );

  const sendSlotFill = useCallback(
    async (slotKey: string, slotValue: string, taskName: string = "jang") => {
      if (!sessionId) {
        const newSid = await createSession(taskName);
        if (!newSid) {
          setError("세션 정보를 찾을 수 없습니다.");
          return;
        }
      }

      setIsLoading(true);
      try {
        const res = await fetch(`${baseUrl}/api/v1/chat/slot-fill`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId,
            slot_key: slotKey,
            slot_value: slotValue,
            task_name: taskName,
          }),
        });
        const resData = await res.json();
        if (resData.status === "success" && resData.result) {
          const result = resData.result;
          setData(result.answer || "");
          setBlocks(result.blocks || []);
          if (result.node_logs) setNodeLogs(result.node_logs);
          if (result.tasks) setTasks(result.tasks);
          if (result.intent) setIntent(result.intent);
          setStatus(result.status || "SUCCESS");
          setIsCompleted(true);

          saveToSessionStorage({
            sessionId,
            status: result.status || "SUCCESS",
            answer: result.answer || "",
            blocks: result.blocks || [],
            nodeLogs: result.node_logs || [],
            tasks: result.tasks || [],
            intent: result.intent || [],
          });
        }
      } catch (err: any) {
        setError(err.message || "슬롯 보완 전송에 실패했습니다.");
      } finally {
        setIsLoading(false);
      }
    },
    [sessionId, baseUrl]
  );

  const approveTaskPlan = useCallback(
    async (approvedTasks?: string[], taskName: string = "jang") => {
      if (!sessionId) {
        setError("세션 정보를 찾을 수 없습니다.");
        return;
      }

      setIsLoading(true);
      try {
        const res = await fetch(`${baseUrl}/api/v1/chat/approve-task-plan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId,
            approved_tasks: approvedTasks || tasks,
            task_name: taskName,
          }),
        });
        const resData = await res.json();
        if (resData.status === "success" && resData.result) {
          const result = resData.result;
          setData(result.answer || "");
          setBlocks(result.blocks || []);
          if (result.node_logs) setNodeLogs(result.node_logs);
          if (result.tasks) setTasks(result.tasks);
          if (result.intent) setIntent(result.intent);
          setStatus(result.status || "SUCCESS");
          setIsCompleted(true);

          saveToSessionStorage({
            sessionId,
            status: result.status || "SUCCESS",
            answer: result.answer || "",
            blocks: result.blocks || [],
            nodeLogs: result.node_logs || [],
            tasks: result.tasks || [],
            intent: result.intent || "",
          });
        }
      } catch (err: any) {
        setError(err.message || "작업 승인 처리 실패");
      } finally {
        setIsLoading(false);
      }
    },
    [sessionId, tasks, baseUrl]
  );

  return {
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
    stopStream,
    resetStream,
  };
}
