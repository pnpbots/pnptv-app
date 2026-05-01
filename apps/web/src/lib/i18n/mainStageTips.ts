export interface MainStageTip {
  emoji: string;
  body: string;
}

const tipsEn: MainStageTip[] = [
  { emoji: "💧", body: "Hydration check — grab a sip." },
  { emoji: "🍓", body: "Berries, banana, whatever's nearby. Treat yourself." },
  { emoji: "💪", body: "Protein shake? Keep that energy going." },
  { emoji: "✨", body: "You look incredible tonight. Don't stop." },
  { emoji: "🎵", body: "Roll your hips. Smile. The room is yours." },
  { emoji: "🌟", body: "Eyes up — someone just dropped a fire emoji for you." },
  { emoji: "🥤", body: "Cold drink + a stretch. Two seconds, big payoff." },
  { emoji: "💋", body: "Wink at the camera. Someone's screenshotting." },
  { emoji: "🍎", body: "Apple, mango, anything sweet — fuel up." },
  { emoji: "🌿", body: "Open a window for a sec. Fresh air, fresh you." },
  { emoji: "😎", body: "Eye contact with the lens. They feel it." },
  { emoji: "🔥", body: "You're doing great. Keep going." },
  { emoji: "💆", body: "Roll your shoulders back. Own your posture." },
  { emoji: "🌊", body: "Breathe in for four, out for four. Stay in your flow." },
];

const tipsEs: MainStageTip[] = [
  { emoji: "💧", body: "Hidratación — toma un trago." },
  { emoji: "🍓", body: "Fresas, plátano, lo que tengas cerca. Mímate." },
  { emoji: "💪", body: "¿Un shake de proteína? Mantén esa energía." },
  { emoji: "✨", body: "Estás increíble esta noche. No pares." },
  { emoji: "🎵", body: "Mueve las caderas. Sonríe. El cuarto es tuyo." },
  { emoji: "🌟", body: "Levanta la vista — alguien acaba de mandarte fuego." },
  { emoji: "🥤", body: "Bebida fría + un estirón. Dos segundos, gran resultado." },
  { emoji: "💋", body: "Guíñale al lente. Alguien está tomando captura." },
  { emoji: "🍎", body: "Manzana, mango, algo dulce — recarga." },
  { emoji: "🌿", body: "Abre la ventana un momento. Aire fresco, tú renovade." },
  { emoji: "😎", body: "Contacto visual con el lente. Se siente." },
  { emoji: "🔥", body: "Lo estás haciendo genial. Sigue así." },
  { emoji: "💆", body: "Echa los hombros atrás. Dueñx de tu postura." },
  { emoji: "🌊", body: "Inhala cuatro, exhala cuatro. Mantén tu flujo." },
];

export const mainStageTips: Record<"en" | "es", MainStageTip[]> = {
  en: tipsEn,
  es: tipsEs,
};

export function getLocalizedTips(): MainStageTip[] {
  const lang =
    typeof navigator !== "undefined" && navigator.language?.startsWith("es")
      ? "es"
      : "en";
  return mainStageTips[lang];
}
