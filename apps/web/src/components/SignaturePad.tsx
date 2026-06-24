import React, { useRef, useEffect, useState } from "react";

interface SignaturePadProps {
  onSave: (dataUrl: string) => void;
  width?: number;
  height?: number;
}

export function SignaturePad({ onSave, width = 320, height = 120 }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const hasSigRef = useRef(false);
  const onSaveRef = useRef(onSave);
  const [hasSig, setHasSig] = useState(false);

  // Keep onSaveRef current without re-running the touch-listener effect
  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);

  const getPos = (canvas: HTMLCanvasElement, clientX: number, clientY: number) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  };

  const strokeTo = (canvas: HTMLCanvasElement, x: number, y: number) => {
    const ctx = canvas.getContext("2d");
    if (!ctx || !lastPos.current) return;
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(x, y);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    lastPos.current = { x, y };
    hasSigRef.current = true;
    setHasSig(true);
  };

  const commitSig = (canvas: HTMLCanvasElement) => {
    isDrawing.current = false;
    lastPos.current = null;
    if (hasSigRef.current) onSaveRef.current(canvas.toDataURL("image/png"));
  };

  // ── Touch events: must be non-passive so preventDefault() actually works ─────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      isDrawing.current = true;
      const t = e.touches[0];
      lastPos.current = getPos(canvas, t.clientX, t.clientY);
    };

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (!isDrawing.current) return;
      const t = e.touches[0];
      const { x, y } = getPos(canvas, t.clientX, t.clientY);
      strokeTo(canvas, x, y);
    };

    const onTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
      commitSig(canvas);
    };

    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd, { passive: false });

    return () => {
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
    };
  }, []); // run once — onSaveRef handles the stable callback

  // ── Mouse events: React synthetic handlers are fine for desktop ───────────────
  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current; if (!canvas) return;
    isDrawing.current = true;
    lastPos.current = getPos(canvas, e.clientX, e.clientY);
  };

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current) return;
    const canvas = canvasRef.current; if (!canvas) return;
    const { x, y } = getPos(canvas, e.clientX, e.clientY);
    strokeTo(canvas, x, y);
  };

  const onMouseUp = () => { const c = canvasRef.current; if (c) commitSig(c); };
  const onMouseLeave = () => { const c = canvasRef.current; if (c) commitSig(c); };

  // ── Initial background fill ────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    ctx.fillStyle = "rgba(255,255,255,0.04)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  const clear = () => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(255,255,255,0.04)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    hasSigRef.current = false;
    setHasSig(false);
    onSaveRef.current("");
  };

  return (
    <div className="flex flex-col gap-1.5">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="w-full rounded-lg cursor-crosshair touch-none"
        style={{ border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)" }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
      />
      <div className="flex items-center justify-between">
        <p className="text-xs" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
          {hasSig ? "Signature captured ✓" : "Draw your signature above"}
        </p>
        {hasSig && (
          <button onClick={clear} className="text-xs" style={{ color: "#FF453A" }}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
