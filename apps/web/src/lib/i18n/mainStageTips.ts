export interface MainStageTip {
  emoji: string;
  body: string;
}

const tipsEn: MainStageTip[] = [
  { emoji: "💧", body: "Hydration check — grab a sip before the next thing." },
  { emoji: "🌊", body: "Breathe in for four, out for four. Reset." },
  { emoji: "💆", body: "Roll your shoulders back. Release whatever you're carrying." },
  { emoji: "🍎", body: "Eat something real today. Your body is working hard." },
  { emoji: "🌿", body: "Two minutes of fresh air changes more than you'd think." },
  { emoji: "🔥", body: "You're doing great. Not perfect — great. Keep going." },
  { emoji: "🤝", body: "Check in on someone you haven't heard from in a while." },
  { emoji: "🧠", body: "How are you actually feeling right now? That's worth a moment." },
  { emoji: "🔒", body: "Trust your gut. If something feels off, it probably is." },
  { emoji: "💤", body: "Rest is not a reward — it's part of the work." },
  { emoji: "✊", body: "You belong here. No qualifications needed." },
  { emoji: "🎶", body: "Put on something that makes you feel like yourself." },
  { emoji: "🌙", body: "You don't have to be 'on' all the time. Let yourself be." },
  { emoji: "💬", body: "Someone in this community is rooting for you right now." },
  { emoji: "🥤", body: "Cold drink + a stretch. Two seconds, big payoff." },
  { emoji: "🌟", body: "Progress over perfection, every single time." },
];

const tipsEs: MainStageTip[] = [
  { emoji: "💧", body: "Hidratación — toma un trago antes de lo que sigue." },
  { emoji: "🌊", body: "Inhala cuatro, exhala cuatro. Reinicia." },
  { emoji: "💆", body: "Echa los hombros atrás. Suelta lo que cargas." },
  { emoji: "🍎", body: "Come algo de verdad hoy. Tu cuerpo está trabajando duro." },
  { emoji: "🌿", body: "Dos minutos de aire fresco cambian más de lo que crees." },
  { emoji: "🔥", body: "Lo estás haciendo genial. No perfecto — genial. Sigue." },
  { emoji: "🤝", body: "Escríbele a alguien de quien no has sabido en un rato." },
  { emoji: "🧠", body: "¿Cómo te sientes de verdad ahorita? Eso vale un momento." },
  { emoji: "🔒", body: "Confía en tu instinto. Si algo no se siente bien, probablemente no lo es." },
  { emoji: "💤", body: "El descanso no es un premio — es parte del proceso." },
  { emoji: "✊", body: "Perteneces aquí. Sin condiciones." },
  { emoji: "🎶", body: "Pon algo que te haga sentir tú misme." },
  { emoji: "🌙", body: "No tienes que estar 'encendide' todo el tiempo. Permítetelo." },
  { emoji: "💬", body: "Alguien en esta comunidad te está apoyando ahorita mismo." },
  { emoji: "🥤", body: "Bebida fría + un estirón. Dos segundos, gran resultado." },
  { emoji: "🌟", body: "Progreso sobre perfección, siempre." },
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
