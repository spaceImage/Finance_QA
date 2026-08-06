import { useState, useCallback, useRef } from "react";

export interface Citation {
  id: number;
  section_title: string;
  page: number;
  snippet: string;
}

export interface GroundingInfo {
  excerpt?: string;
  condition?: string;
  formula?: string;
  reasoning?: string;
}

export interface BlockItem {
  text: string;
  grounding?: GroundingInfo;
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

// Phase 1 결과: 계획 수립, 상담사 승인 대기
export interface PlanResult {
  status: "AWAITING_CONFIRMATION";
  taskPlan: string[];
  taskClassification: string[];
  answer: string;
}

// Phase 2 결과: 약관 조회 완료
export interface AnalysisResult {
  status: "SUCCESS" | "OUT_OF_SCOPE" | "NEED_MORE_INFO";
  answer: string;
  blocks: UIBlock[];
  consultationSummary: string;
  taskPlan: string[];
  taskClassification: string[];
  referencedPages: ReferencedPage[];
}

export interface ReferencedPage {
  section_title: string;
  page_number: number;
  source_pdf: string;
  full_content: string;
}

interface UseSSEReturn {
  // Phase 1 (AWAITING_CONFIRMATION) state
  planResult: PlanResult | null;
  // Phase 2 (SUCCESS) state  
  analysisResult: AnalysisResult | null;
  // Shared loading/progress
  isLoading: boolean;
  isCompleted: boolean;
  progress: number;
  currentStepLabel: string;
  stepLogs: StepLog[];
  error: string | null;
  sessionId: string | null;
  // Actions
  startStream: (query: string, taskName?: string) => Promise<void>;
  confirmStream: (query: string, taskName?: string) => Promise<void>;
  sendSlotFill: (slotKey: string, slotValue: string, taskName?: string) => Promise<void>;
  stopStream: () => void;
  resetStream: () => void;
}

export function useSSE(baseUrl: string = "http://localhost:8000"): UseSSEReturn {
  const [planResult, setPlanResult] = useState<PlanResult | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [currentStepLabel, setCurrentStepLabel] = useState<string>("");
  const [stepLogs, setStepLogs] = useState<StepLog[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);

  const stopStream = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsLoading(false);
  }, []);

  const resetStream = useCallback(() => {
    stopStream();
    setPlanResult(null);
    setAnalysisResult(null);
    setProgress(0);
    setCurrentStepLabel("");
    setStepLogs([]);
    setError(null);
    setIsCompleted(false);
  }, [stopStream]);

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
        return resData.session_id;
      }
    } catch (e) {
      console.warn("세션 생성 오류 (기본 진행):", e);
    }
    return null;
  };

  // SSE 메시지 파싱 공통 핸들러
  const buildSSEHandler = useCallback(
    (
      onPlan: (data: PlanResult) => void,
      onAnalysis: (data: AnalysisResult) => void,
      onTextChunk: (chunk: string) => void,
    ) =>
      (event: MessageEvent) => {
        if (event.data === "[DONE]") {
          setIsCompleted(true);
          setProgress(100);
          stopStream();
          return;
        }
        try {
          const parsed = JSON.parse(event.data);

          // Step progress event
          if (parsed.progress !== undefined && parsed.label) {
            setProgress(parsed.progress);
            setCurrentStepLabel(parsed.label);
            setStepLogs((prev) => [
              ...prev,
              {
                step: parsed.step || prev.length + 1,
                label: parsed.label,
                timestamp: new Date().toLocaleTimeString(),
              },
            ]);
            return;
          }

          // Final payload with status
          if (parsed.status) {
            const status = parsed.status;

            if (status === "AWAITING_CONFIRMATION") {
              onPlan({
                status: "AWAITING_CONFIRMATION",
                taskPlan: parsed.task_plan || [],
                taskClassification: parsed.task_classification || [],
                answer: parsed.answer || "",
              });
            } else {
              // SUCCESS / OUT_OF_SCOPE / NEED_MORE_INFO
              onAnalysis({
                status,
                answer: parsed.answer || "",
                blocks: parsed.blocks || [],
                consultationSummary: parsed.consultation_summary || "",
                taskPlan: parsed.task_plan || [],
                taskClassification: parsed.task_classification || [],
                referencedPages: parsed.referenced_pages || [],
              });
            }
            setProgress(100);
            return;
          }

          // Streaming text chunk
          if (parsed.content) {
            onTextChunk(parsed.content);
          }
        } catch {
          onTextChunk(event.data);
        }
      },
    [stopStream]
  );

  // Phase 1: 질의 분석 → AWAITING_CONFIRMATION 상태로 일시 정지
  const startStream = useCallback(
    async (query: string, taskName: string = "jang") => {
      resetStream();
      setIsLoading(true);
      setProgress(10);
      const initLabel = "🔮 상담 내용 분석 및 약관 조회 범위 확인 중...";
      setCurrentStepLabel(initLabel);
      setStepLogs([{ step: 1, label: initLabel, timestamp: new Date().toLocaleTimeString() }]);

      const activeSessionId = await createSession(taskName);
      const encodedQuery = encodeURIComponent(query);
      let url = `${baseUrl}/api/rag/stream?query=${encodedQuery}&task_name=${taskName}&confirm=false`;
      if (activeSessionId) url += `&session_id=${activeSessionId}`;

      try {
        const es = new EventSource(url);
        eventSourceRef.current = es;

        let streamingText = "";

        es.onmessage = buildSSEHandler(
          (plan) => setPlanResult(plan),
          (analysis) => setAnalysisResult(analysis),
          (chunk) => {
            streamingText += chunk;
          }
        );

        es.onerror = () => {
          setIsCompleted(true);
          stopStream();
        };
      } catch (err: any) {
        setError(err.message || "SSE 연결 실패");
        setIsLoading(false);
      }
    },
    [resetStream, stopStream, buildSSEHandler, baseUrl]
  );

  // Phase 2: 상담사 승인 → 약관 DB 조회 + 최종 답변 생성
  // planResult를 유지한 채로 analysisResult만 업데이트
  const confirmStream = useCallback(
    async (query: string, taskName: string = "jang") => {
      // planResult는 유지, analysis + loading 상태만 리셋
      setAnalysisResult(null);
      setIsLoading(true);
      setIsCompleted(false);
      setError(null);
      setProgress(30);
      const confirmLabel = "🔍 약관 DB 정밀 조회 중...";
      setCurrentStepLabel(confirmLabel);
      setStepLogs((prev) => [
        ...prev,
        { step: prev.length + 1, label: confirmLabel, timestamp: new Date().toLocaleTimeString() },
      ]);

      const encodedQuery = encodeURIComponent(query);
      const url = `${baseUrl}/api/rag/stream?query=${encodedQuery}&task_name=${taskName}&confirm=true`;

      try {
        const es = new EventSource(url);
        eventSourceRef.current = es;

        es.onmessage = buildSSEHandler(
          () => {}, // confirm 단계에서는 plan 무시
          (analysis) => setAnalysisResult(analysis),
          () => {} // 텍스트 청크는 analysisResult.answer로 처리
        );

        es.onerror = () => {
          setIsCompleted(true);
          stopStream();
        };
      } catch (err: any) {
        setError(err.message || "SSE 승인 연결 실패");
        setIsLoading(false);
      }
    },
    [stopStream, buildSSEHandler, baseUrl]
  );

  const sendSlotFill = useCallback(
    async (slotKey: string, slotValue: string, taskName: string = "jang") => {
      setIsLoading(true);
      setError(null);

      try {
        const res = await fetch(`${baseUrl}/api/v1/chat/slot-fill`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId,
            task_name: taskName,
            slot_key: slotKey,
            slot_value: slotValue,
          }),
        });

        if (!res.ok) throw new Error("슬롯 보완 처리 중 서버 오류");

        const resData = await res.json();
        const resultData = resData.result || resData;

        setAnalysisResult({
          status: "SUCCESS",
          answer: resultData.answer || "",
          blocks: resultData.blocks || [],
          consultationSummary: resultData.consultation_summary || "",
          taskPlan: resultData.task_plan || [],
          taskClassification: resultData.task_classification || [],
          referencedPages: resultData.referenced_pages || [],
        });
      } catch (e: any) {
        setError(e.message || "Slot-fill API 호출 에러");
      } finally {
        setIsLoading(false);
        setIsCompleted(true);
      }
    },
    [sessionId, baseUrl]
  );

  return {
    planResult,
    analysisResult,
    isLoading,
    isCompleted,
    progress,
    currentStepLabel,
    stepLogs,
    error,
    sessionId,
    startStream,
    confirmStream,
    sendSlotFill,
    stopStream,
    resetStream,
  };
}
