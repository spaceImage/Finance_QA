import { useState, useCallback, useRef } from "react";

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

interface UseSSEReturn {
  data: string;
  blocks: UIBlock[];
  status: string;
  isLoading: boolean;
  isCompleted: boolean;
  error: string | null;
  sessionId: string | null;
  startStream: (query: string, taskName?: string) => Promise<void>;
  sendSlotFill: (slotKey: string, slotValue: string, taskName?: string) => Promise<void>;
  stopStream: () => void;
  resetStream: () => void;
}

export function useSSE(): UseSSEReturn {
  const [data, setData] = useState<string>("");
  const [blocks, setBlocks] = useState<UIBlock[]>([]);
  const [status, setStatus] = useState<string>("SUCCESS");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
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
    setData("");
    setBlocks([]);
    setStatus("SUCCESS");
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

      const activeSessionId = await createSession(taskName);

      const encodedQuery = encodeURIComponent(query);
      let url = `${baseUrl}/api/rag/stream?query=${encodedQuery}&task_name=${taskName}`;
      if (activeSessionId) {
        url += `&session_id=${activeSessionId}`;
      }

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
              stopStream();
              return;
            }

            const parsed = JSON.parse(event.data);
            if (parsed.blocks && Array.isArray(parsed.blocks)) {
              setBlocks(parsed.blocks);
              if (parsed.status) setStatus(parsed.status);
            } else if (parsed.content) {
              setData((prev) => prev + parsed.content);
            }
          } catch {
            setData((prev) => prev + event.data);
          }
        };

        es.onerror = (err) => {
          console.error("SSE Connection Error:", err);
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
        // 세션 ID가 없을 경우 신규 생성
        const newSid = await createSession(taskName);
        if (!newSid) {
          setError("세션 정보를 찾을 수 없습니다.");
          return;
        }
      }

      setIsLoading(true);
      setError(null);
      setData((prev) => prev + `\n\n💬 [보완 답변 전송]: ${slotValue}\n🔄 보완된 정보로 정밀 계산 중...\n\n`);

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
          const finalAnswer = resData.result.answer || "보상 계산이 완료되었습니다.";
          setData((prev) => prev + finalAnswer);
        } else {
          setError("슬롯 보완 답변 처리에 실패했습니다.");
        }
      } catch (e: any) {
        setError(e.message || "Slot-fill API 호출 에러가 발생했습니다.");
      } finally {
        setIsLoading(false);
        setIsCompleted(true);
      }
    },
    [sessionId, baseUrl]
  );

  return {
    data,
    blocks,
    status,
    isLoading,
    isCompleted,
    error,
    sessionId,
    startStream,
    sendSlotFill,
    stopStream,
    resetStream,
  };
}

