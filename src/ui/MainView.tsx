/**
 * Main view for Audio Score plugin.
 * Displays score canvas.
 */

import * as React from "react";
import { getState, useStore } from "../store";
import { renderScore, calculateSize, hitTestMeasure, RenderOptions } from "./ScoreRenderer";
import { exportScorePdf } from "./pdfExport";
import { setState } from "../store";
import { t } from "../i18n";
import { decodeWorkspaceContent, readPluginBinary } from "../host";
import type { ScoreData } from "../types";
import { playScore } from "../core/player";

interface MainViewProps {
  language?: string;
  api: {
    drive: {
      readFile?(path: string): Promise<string>;
    };
  };
  filePath?: string;
  fileName?: string;
  fileContent?: string;
}

export function MainView({ api, language, filePath, fileName: activeFileName, fileContent }: MainViewProps) {
  const i = t(language);
  const {
    score: sharedScore,
    chordAnnotations: sharedChordAnnotations,
    fileName: sharedFileName,
    playbackHandle,
  } = useStore();

  const [saveMsg, setSaveMsg] = React.useState("");
  const [pdfExporting, setPdfExporting] = React.useState(false);
  const [openedScore, setOpenedScore] = React.useState<ScoreData | null>(null);
  const [openedFileName, setOpenedFileName] = React.useState("");
  const containerRef = React.useRef<HTMLDivElement>(null);
  const canvasAreaRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const ownedPlaybackRef = React.useRef<ReturnType<typeof playScore> | null>(null);
  const [canvasWidth, setCanvasWidth] = React.useState(800);
  const [highlightMeasure, setHighlightMeasure] = React.useState(0);
  const [loadError, setLoadError] = React.useState("");
  const score = openedScore ?? sharedScore;
  const chordAnnotations = openedScore
    ? openedScore.chordAnnotations ?? []
    : sharedChordAnnotations;
  const fileName = openedScore ? openedFileName : sharedFileName;

  React.useEffect(() => () => {
    ownedPlaybackRef.current?.stop();
    ownedPlaybackRef.current = null;
  }, []);

  // A Desktop main view is mounted independently from the sidebar. Load the
  // selected score here instead of relying on ScorePanel to populate the
  // module-level store as a side effect.
  React.useEffect(() => {
    if (!filePath) {
      setOpenedScore(null);
      setOpenedFileName("");
      return;
    }
    const name = (activeFileName || filePath.split(/[\\/]/).pop() || "").toLowerCase();
    const isMidi = name.endsWith(".mid") || name.endsWith(".midi");
    const isAudioScore = name.endsWith(".audioscore");
    console.info("[Audio Score] main view file selected", {
      filePath,
      fileName: name,
      isMidi,
      isAudioScore,
      hasFileContent: !!fileContent,
      fileContentLength: fileContent?.length ?? 0,
    });
    if (!isMidi && !isAudioScore) {
      setOpenedScore(null);
      setOpenedFileName("");
      return;
    }

    let cancelled = false;
    setLoadError("");
    void (async () => {
      try {
        let parsed: ScoreData;
        if (isMidi) {
          const { parseMidi } = await import("../core/midiImport");
          const content = fileContent
            ? decodeWorkspaceContent(fileContent)
            : await readPluginBinary(api, filePath);
          parsed = parseMidi(new Uint8Array(content));
        } else {
          const content = fileContent || await api.drive.readFile?.(filePath);
          if (!content) throw new Error("Workspace file reading is unavailable.");
          const decoded = content.startsWith("data:")
            ? new TextDecoder().decode(decodeWorkspaceContent(content))
            : content;
          parsed = JSON.parse(decoded) as ScoreData;
          if (!parsed?.measures) throw new Error("Invalid Audio Score file.");
        }
        if (cancelled) return;
        console.info("[Audio Score] main view score parsed", {
          filePath,
          measures: parsed.measures.length,
          notes: parsed.measures.reduce((total, measure) => total + measure.notes.length, 0),
          duration: parsed.totalDuration,
        });
        const nextFileName = (activeFileName || filePath.split(/[\\/]/).pop() || "Score")
          .replace(/\.(?:audioscore|mid|midi)$/i, "");
        // Keep the file opened by this main view locally. ScorePanel also
        // publishes its local state to the shared store and may briefly emit
        // null while loading, which must not erase an already parsed score.
        setOpenedScore(parsed);
        setOpenedFileName(nextFileName);
        setState({
          score: parsed,
          chordAnnotations: parsed.chordAnnotations ?? [],
          fileName: nextFileName,
        });
      } catch (error) {
        if (!cancelled) {
          console.error("[Audio Score] main view file load failed", {
            filePath,
            error,
          });
          setLoadError(error instanceof Error ? error.message : String(error));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [activeFileName, api, fileContent, filePath]);

  // Highlight current measure during playback
  React.useEffect(() => {
    if (!playbackHandle || !score) {
      if (highlightMeasure !== 0) setHighlightMeasure(0);
      return;
    }
    const beatDuration = 60 / score.bpm;
    const measureDuration = beatDuration * score.beatsPerMeasure;
    const downbeat = score.downbeatOffset ?? 0;
    let prevMeasure = -1;
    let rafId = 0;

    function tick() {
      if (!playbackHandle) return;
      const absTime = playbackHandle.getElapsed();
      const idx = Math.floor((absTime - downbeat) / measureDuration);
      const m = Math.max(1, Math.min(idx + 1, score!.measures.length));
      if (m !== prevMeasure) {
        prevMeasure = m;
        setHighlightMeasure(m);
      }
      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [playbackHandle, score]);

  // Track canvas area width (excluding padding) via ResizeObserver
  React.useEffect(() => {
    const el = canvasAreaRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w > 0) setCanvasWidth(w);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Read CSS variables for dark mode colors
  const getColors = React.useCallback(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      bg: style.getPropertyValue("--as-bg-primary").trim() || "#ffffff",
      text: style.getPropertyValue("--as-text").trim() || "#1a1a1a",
      secondary: style.getPropertyValue("--as-text-secondary").trim() || "#666666",
      border: style.getPropertyValue("--as-border").trim() || "#d8d8da",
      accent: style.getPropertyValue("--as-accent").trim() || "#2563eb",
      muted: style.getPropertyValue("--as-text-muted").trim() || "#999999",
    };
  }, []);

  // Render score to canvas
  React.useEffect(() => {
    if (!score || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const colors = getColors();
    const dpr = window.devicePixelRatio || 1;

    // iOS Safari has a max canvas area of ~16.7 million pixels.
    // Reduce effective DPR when the canvas would exceed this limit.
    const MAX_CANVAS_AREA = 16_777_216;

    const opts: RenderOptions = {
      width: canvasWidth,
      backgroundColor: colors.bg,
      staffColor: colors.secondary,
      noteColor: colors.text,
      accentColor: colors.accent,
      chordAnnotations,
      highlightMeasure,
    };
    const size = calculateSize(score, opts);

    let effectiveDpr = dpr;
    if (size.width * dpr * size.height * dpr > MAX_CANVAS_AREA) {
      effectiveDpr = Math.sqrt(MAX_CANVAS_AREA / (size.width * size.height));
    }
    canvas.width = Math.floor(size.width * effectiveDpr);
    canvas.height = Math.floor(size.height * effectiveDpr);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    ctx.setTransform(effectiveDpr, 0, 0, effectiveDpr, 0, 0);

    renderScore(ctx, score, opts);
  }, [score, chordAnnotations, canvasWidth, getColors, highlightMeasure]);

  const startPlayback = React.useCallback((startMeasure?: number) => {
    console.info("[Audio Score] main view starting playback", {
      startMeasure: startMeasure ?? 1,
      measures: score?.measures.length ?? 0,
      notes: score?.measures.reduce((total, measure) => total + measure.notes.length, 0) ?? 0,
    });
    playbackHandle?.stop();
    const handle = playScore(score!, startMeasure);
    ownedPlaybackRef.current = handle;
    setState({ playbackHandle: handle, playFromMeasure: null });
    void handle.finished.then(() => {
      if (ownedPlaybackRef.current !== handle) return;
      ownedPlaybackRef.current = null;
      if (getState().playbackHandle === handle) {
        setState({ playbackHandle: null });
      }
    });
  }, [playbackHandle, score]);

  const handlePlayStop = React.useCallback(() => {
    if (playbackHandle) {
      playbackHandle.stop();
      ownedPlaybackRef.current = null;
      setState({ playbackHandle: null, playFromMeasure: null });
      return;
    }
    if (score) startPlayback();
  }, [playbackHandle, score, startPlayback]);

  // Canvas click → play from clicked measure
  const handleCanvasClick = React.useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!score) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const opts: RenderOptions = {
        width: canvasWidth,
        chordAnnotations,
      };
      const measure = hitTestMeasure(score, opts, x, y);
      if (measure != null) {
        startPlayback(measure);
      }
    },
    [score, canvasWidth, chordAnnotations, startPlayback],
  );

  // PDF export handler
  const handleSavePdf = React.useCallback(async () => {
    if (!score || pdfExporting) return;
    setPdfExporting(true);
    try {
      const title = fileName
        ? fileName.replace(/\.[^.]+$/, "")
        : "Score";
      await exportScorePdf(score, title, chordAnnotations);
      setSaveMsg(i.savePdfSuccess);
      setTimeout(() => setSaveMsg(""), 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSaveMsg(`PDF export failed: ${msg}`);
      setTimeout(() => setSaveMsg(""), 5000);
    } finally {
      setPdfExporting(false);
    }
  }, [score, fileName, chordAnnotations, i, pdfExporting]);

  return (
    <div className="audio-score-main" ref={containerRef}>
      {!score ? (
        <div className="audio-score-main-empty">{loadError || i.mainViewEmpty}</div>
      ) : (
        <>
          {/* Toolbar */}
          <div className="audio-score-main-tabs">
            <div className="audio-score-main-tab-spacer" />
            <button className="audio-score-btn" onClick={handlePlayStop}>
              {playbackHandle ? i.stop : i.play}
            </button>
            <button
              className="audio-score-btn"
              onClick={handleSavePdf}
              disabled={pdfExporting}
            >
              {i.savePdf}
            </button>
            {saveMsg && <span className="audio-score-export-msg">{saveMsg}</span>}
          </div>

          {/* Canvas area */}
          <div className="audio-score-main-canvas-area" ref={canvasAreaRef}>
            <canvas
              ref={canvasRef}
              className="audio-score-canvas"
              onClick={handleCanvasClick}
              style={{ cursor: "pointer" }}
            />
          </div>
        </>
      )}
    </div>
  );
}
