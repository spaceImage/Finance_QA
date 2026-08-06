"use client";

if (typeof globalThis !== "undefined" && typeof (globalThis as any).DOMMatrix === "undefined") {
  (globalThis as any).DOMMatrix = class DOMMatrix {};
}

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PdfHighlightViewerProps {
  pdfUrl: string;
  initialPage: number;
  snippet?: string;
  sectionTitle?: string;
  onClose: () => void;
}

export default function PdfHighlightViewer({
  pdfUrl,
  initialPage,
  snippet,
}: PdfHighlightViewerProps) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState<number>(initialPage || 1);
  const [scale, setScale] = useState<number>(1.1);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isSearchExpanded, setIsSearchExpanded] = useState<boolean>(false);
  // Page input state — separate from pageNumber so we can edit freely
  const [pageInput, setPageInput] = useState<string>(String(initialPage || 1));
  const searchInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialPage && initialPage > 0) {
      setPageNumber(initialPage);
      setPageInput(String(initialPage));
    }
  }, [initialPage]);

  useEffect(() => {
    setPageInput(String(pageNumber));
  }, [pageNumber]);

  useEffect(() => {
    if (isSearchExpanded) {
      searchInputRef.current?.focus();
    }
  }, [isSearchExpanded]);

  function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
    setNumPages(numPages);
    if (initialPage && initialPage <= numPages) {
      setPageNumber(initialPage);
    }
  }

  const goToPage = useCallback(
    (n: number) => {
      const clamped = Math.max(1, Math.min(n, numPages || n));
      setPageNumber(clamped);
      setPageInput(String(clamped));
    },
    [numPages]
  );

  // Scroll wheel → page navigation when content is at boundary
  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      const el = scrollContainerRef.current;
      if (!el) return;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
      const atTop = el.scrollTop <= 4;

      if (e.deltaY > 0 && atBottom) {
        // Scroll down at bottom → next page
        goToPage(pageNumber + 1);
        // Reset scroll to top after page change
        setTimeout(() => { if (el) el.scrollTop = 0; }, 50);
      } else if (e.deltaY < 0 && atTop) {
        // Scroll up at top → prev page
        goToPage(pageNumber - 1);
        // Reset scroll to bottom after page change
        setTimeout(() => { if (el) el.scrollTop = el.scrollHeight; }, 50);
      }
    },
    [pageNumber, goToPage]
  );

  // Text highlight: background only, NO font changes
  const customTextRenderer = (textItem: { str: string }) => {
    const activeSearch = searchQuery.trim() || snippet?.trim();
    if (!activeSearch || !textItem.str || textItem.str.trim().length === 0) {
      return textItem.str;
    }

    const strTrimmed = textItem.str.trim();
    const cleanSnippet = activeSearch.replace(/[(),]/g, " ");
    const keywords = cleanSnippet
      .split(" ")
      .map((k) => k.trim())
      .filter((k) => k.length >= 2);

    const matches = keywords.some(
      (kw) => strTrimmed.includes(kw) || kw.includes(strTrimmed)
    );

    if (matches && strTrimmed.length >= 2) {
      // Only background color — no font-weight, no color override
      return `<mark style="background-color: rgba(253, 224, 71, 0.55); border-radius: 2px;">${textItem.str}</mark>`;
    }

    return textItem.str;
  };

  return (
    <div className="w-full h-full flex flex-col min-h-0 bg-slate-100/60 overflow-hidden">
      {/* Control Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-50 border-b border-slate-200 shrink-0 text-slate-800">

        {/* Left: Expandable Search */}
        <div className="flex items-center gap-2">
          <div className="relative flex items-center">
            {isSearchExpanded ? (
              <div className="flex items-center gap-1 bg-white border border-indigo-400 rounded-lg px-2 py-0.5 shadow-sm transition-all duration-300 animate-fade-in">
                <svg className="w-3.5 h-3.5 text-indigo-600 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-36 bg-transparent text-[11px] text-slate-900 placeholder-slate-300 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => { setSearchQuery(""); setIsSearchExpanded(false); }}
                  className="text-slate-400 hover:text-slate-600 text-[10px] font-bold px-1"
                >✕</button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setIsSearchExpanded(true)}
                className="p-1 px-2 rounded-lg bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 text-xs font-bold transition-all cursor-pointer shadow-2xs flex items-center gap-1.5"
                title="약관 내용 검색"
              >
                <svg className="w-3.5 h-3.5 text-slate-600" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <span className="text-[10px] font-semibold text-slate-600">검색</span>
              </button>
            )}
          </div>
        </div>

        {/* Right: Page Controls & Zoom */}
        <div className="flex items-center gap-2 shrink-0">

          {/* Page Navigator — with number input for direct jump */}
          <div className="flex items-center gap-0.5 bg-white border border-slate-300 p-0.5 rounded-lg text-xs shadow-2xs">
            <button
              type="button"
              disabled={pageNumber <= 1}
              onClick={() => goToPage(pageNumber - 1)}
              className="px-2 py-0.5 hover:bg-slate-100 disabled:opacity-30 rounded transition-all cursor-pointer text-[10px] font-bold text-slate-700"
            >◀</button>

            {/* Editable page number input */}
            <div className="flex items-center gap-0.5 px-1">
              <input
                type="text"
                inputMode="numeric"
                value={pageInput}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, "");
                  setPageInput(val);
                }}
                onBlur={() => {
                  const n = parseInt(pageInput, 10);
                  if (!isNaN(n)) goToPage(n);
                  else setPageInput(String(pageNumber));
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const n = parseInt(pageInput, 10);
                    if (!isNaN(n)) goToPage(n);
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                className="w-8 text-center font-mono font-bold text-slate-800 text-[11px] bg-slate-100 rounded px-0.5 focus:outline-none focus:bg-indigo-50 focus:ring-1 focus:ring-indigo-300"
              />
              <span className="text-[10px] text-slate-500 font-mono">/ {numPages || "--"}</span>
            </div>

            <button
              type="button"
              disabled={numPages ? pageNumber >= numPages : false}
              onClick={() => goToPage(pageNumber + 1)}
              className="px-2 py-0.5 hover:bg-slate-100 disabled:opacity-30 rounded transition-all cursor-pointer text-[10px] font-bold text-slate-700"
            >▶</button>
          </div>

          {/* Zoom Controller */}
          <div className="flex items-center gap-1 bg-white border border-slate-300 p-0.5 rounded-lg text-xs shadow-2xs">
            <button
              type="button"
              onClick={() => setScale((s) => Math.max(s - 0.15, 0.7))}
              className="px-1.5 py-0.5 hover:bg-slate-100 rounded text-slate-700 font-bold cursor-pointer text-xs"
            >-</button>
            <span className="px-1 text-[10px] text-slate-700 font-mono font-semibold">
              {Math.round(scale * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setScale((s) => Math.min(s + 0.15, 1.8))}
              className="px-1.5 py-0.5 hover:bg-slate-100 rounded text-slate-700 font-bold cursor-pointer text-xs"
            >+</button>
          </div>
        </div>
      </div>

      {/* PDF Scroll Container — wheel scrolls through content, boundary triggers page nav */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-auto p-4 flex justify-center bg-slate-200/50 scrollbar-thin"
        onWheel={handleWheel}
      >
        <Document
          file={pdfUrl}
          onLoadSuccess={onDocumentLoadSuccess}
          loading={
            <div className="py-20 text-center text-xs font-semibold text-slate-500 animate-pulse">
              보험약관 PDF 데이터를 로드하고 있습니다...
            </div>
          }
          error={
            <div className="py-20 text-center text-xs text-rose-600 font-bold">
              PDF 약관 문서를 로드하지 못했습니다.
            </div>
          }
        >
          <div className="shadow-lg border border-slate-300 rounded-lg overflow-hidden bg-white">
            <Page
              pageNumber={pageNumber}
              scale={scale}
              customTextRenderer={customTextRenderer}
              renderTextLayer={true}
              renderAnnotationLayer={true}
            />
          </div>
        </Document>
      </div>
    </div>
  );
}
