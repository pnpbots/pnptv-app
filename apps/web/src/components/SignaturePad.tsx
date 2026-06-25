import React, { useRef, useEffect, useState } from "react";

interface SignaturePadProps {
  onSave: (dataUrl: string) => void;
  width?: number;
  height?: number;
}

// Renders the typed name onto the canvas in a signature-style font and returns
// the data URL. The canvas itself stays hidden — it only exists as a serialization
// mechanism so the stored format (base64 PNG) stays consistent with the rest of
// the enrollment pipeline.
function renderToCanvas(
  canvas: HTMLCanvasElement,
  name: string,
  width: number,
  height: number
): string {
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  ctx.fillRect(0, 0, width, height);
  if (!name.trim()) return "";
  const fontSize = Math.min(42, height * 0.52);
  ctx.font = `italic ${fontSize}px Georgia, 'Times New Roman', serif`;
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Trim to fit canvas width
  let display = name;
  while (ctx.measureText(display).width > width - 24 && display.length > 1) {
    display = display.slice(0, -1);
  }
  ctx.fillText(display, width / 2, height / 2);
  return canvas.toDataURL("image/png");
}

export function SignaturePad({ onSave, width = 320, height = 120 }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onSaveRef = useRef(onSave);
  const [typedName, setTypedName] = useState("");

  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const name = e.target.value;
    setTypedName(name);
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!name.trim()) {
      onSaveRef.current("");
      return;
    }
    const dataUrl = renderToCanvas(canvas, name, width, height);
    if (dataUrl) onSaveRef.current(dataUrl);
  };

  const clear = () => {
    setTypedName("");
    onSaveRef.current("");
  };

  const hasSig = typedName.trim().length > 0;

  return (
    <div className="flex flex-col gap-2">
      {/* Hidden canvas — only used to produce the stored data URL */}
      <canvas ref={canvasRef} width={width} height={height} style={{ display: "none" }} />

      {/* Signature-style text input */}
      <input
        type="text"
        value={typedName}
        onChange={handleChange}
        placeholder="Type your full legal name"
        className="w-full rounded-lg px-3 py-3 text-white outline-none"
        style={{
          background: "rgba(255,255,255,0.06)",
          border: `1px solid rgba(255,255,255,${hasSig ? "0.25" : "0.12"})`,
          fontSize: "16px",
          fontStyle: "italic",
          fontFamily: "Georgia, 'Times New Roman', serif",
          letterSpacing: "0.02em",
        }}
        autoComplete="name"
        autoCapitalize="words"
        inputMode="text"
      />

      {/* Live cursive preview */}
      {hasSig && (
        <div
          className="w-full rounded-lg px-4 py-3 text-center"
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.08)",
            fontFamily: "Georgia, 'Times New Roman', serif",
            fontStyle: "italic",
            fontSize: "22px",
            color: "#ffffff",
            letterSpacing: "0.03em",
            minHeight: 52,
          }}
        >
          {typedName}
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
          {hasSig ? "Signature captured ✓" : "Type your full legal name above"}
        </p>
        {hasSig && (
          <button onClick={clear} type="button" className="text-xs" style={{ color: "#FF453A" }}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
