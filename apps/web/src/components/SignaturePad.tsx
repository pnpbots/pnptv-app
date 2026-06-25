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

  // ── Pointer Events (covers touch + mouse + stylus uniformly) ──────────────
  // Uses non-passive native listeners so preventDefault() stops page scroll.
  // setPointerCapture ensures pointermove fires even if finger drifts outside.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onDown = (e: PointerEvent) => {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      isDrawing.current = true;
      lastPos.current = getPos(canvas, e.clientX, e.clientY);
    };

    const onMove = (e: PointerEvent) => {
      e.preventDefault();
      if (!isDrawing.current) return;
      const { x, y } = getPos(canvas, e.clientX, e.clientY);
      strokeTo(canvas, x, y);
    };

    const onUp = (e: PointerEvent) => {
      e.preventDefault();
      commitSig(canvas);
    };

    const onCancel = () => commitSig(canvas);

    canvas.addEventListener("pointerdown", onDown, { passive: false });
    canvas.addEventListener("pointermove", onMove, { passive: false });
    canvas.addEventListener("pointerup", onUp, { passive: false });
    canvas.addEventListener("pointercancel", onCancel);

    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onCancel);
    };
  }, []); // run once — refs handle stable callbacks

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
        className="w-full rounded-lg cursor-crosshair touch-none select-none"
        style={{
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(255,255,255,0.04)",
          touchAction: "none",
          userSelect: "none",
          WebkitUserSelect: "none",
        }}
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
