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
  startStream: (query: string, taskName?: string) => void;
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

        es.onerror = () => {
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
    blocks,
    status,
    isLoading,
    isCompleted,
    error,
    startStream,
    stopStream,
    resetStream,
  };
}
