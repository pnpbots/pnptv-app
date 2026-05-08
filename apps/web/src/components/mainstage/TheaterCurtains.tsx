/** Red velvet curtains flanking the Prime Video for Theater mode. */
export function TheaterCurtains() {
  return (
    <>
      {/* Left curtain */}
      <div
        className="absolute left-0 top-0 bottom-0 pointer-events-none z-10"
        aria-hidden
        style={{
          width: "9%",
          background:
            "linear-gradient(90deg, rgba(30,5,10,0.98) 0%, rgba(150,15,35,0.65) 65%, rgba(180,30,55,0) 100%), " +
            "repeating-linear-gradient(90deg, rgba(255,255,255,0.05) 0 2px, transparent 2px 14px)",
        }}
      />
      {/* Right curtain */}
      <div
        className="absolute right-0 top-0 bottom-0 pointer-events-none z-10"
        aria-hidden
        style={{
          width: "9%",
          background:
            "linear-gradient(270deg, rgba(30,5,10,0.98) 0%, rgba(150,15,35,0.65) 65%, rgba(180,30,55,0) 100%), " +
            "repeating-linear-gradient(90deg, rgba(255,255,255,0.05) 0 2px, transparent 2px 14px)",
        }}
      />
      {/* Top valance — a short burgundy band hanging from the top edge */}
      <div
        className="absolute inset-x-0 top-0 h-4 pointer-events-none z-10"
        aria-hidden
        style={{
          background:
            "linear-gradient(180deg, rgba(90,10,20,0.95) 0%, rgba(180,30,55,0.25) 100%)",
          borderBottom: "1px solid rgba(255,180,80,0.25)",
        }}
      />
    </>
  );
}
