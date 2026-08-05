import { useState, useCallback, useRef } from "react";

interface UseSSEReturn {
  data: string;
  isLoading: boolean;
  isCompleted: boolean;
  error: string | null;
  startStream: (query: string, taskName?: string) => void;
  stopStream: () => void;
  resetStream: () => void;
}

export function useSSE(): UseSSEReturn {
  const [data, setData] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

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
    setError(null);
    setIsCompleted(false);
  }, [stopStream]);

  const startStream = useCallback(
    (query: string, taskName: string = "jang") => {
      resetStream();
      setIsLoading(true);

      const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const encodedQuery = encodeURIComponent(query);
      const url = `${baseUrl}/api/rag/stream?query=${encodedQuery}&task_name=${taskName}`;

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
            if (parsed.content) {
              setData((prev) => prev + parsed.content);
            } else if (typeof parsed === "string") {
              setData((prev) => prev + parsed);
            }
          } catch {
            // 일반 텍스트 스트림 처리
            setData((prev) => prev + event.data);
          }
        };

        es.onerror = (err) => {
          console.error("SSE Connection Error:", err);
          // 스트림 정상 종료나 연결 에러 시 처리
          setIsCompleted(true);
          stopStream();
        };
      } catch (err: any) {
        setError(err.message || "SSE 스트림 연결에 실패했습니다.");
        setIsLoading(false);
      }
    },
    [resetStream, stopStream]
  );

  return {
    data,
    isLoading,
    isCompleted,
    error,
    startStream,
    stopStream,
    resetStream,
  };
}
