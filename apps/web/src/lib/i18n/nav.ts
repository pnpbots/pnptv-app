const strings = {
  en: {
    home: "Home",
    hangouts: "Hangouts",
    prime: "PRIME",
    live: "Live",
    nearby: "Nearby",
    messages: "Messages",
    social: "Social",
    admin: "Admin",
    becomeModel: "Become a Model",
    theHaus: "The Haus",
    profile: "Profile",
    user: "User",
  },
  es: {
    home: "Inicio",
    hangouts: "Encuentros",
    prime: "PRIME",
    live: "En Vivo",
    nearby: "Cercanos",
    messages: "Mensajes",
    social: "Social",
    admin: "Admin",
    becomeModel: "Ser Modelo",
    theHaus: "The Haus",
    profile: "Perfil",
    user: "Usuario",
  },
} as const;

export type NavStrings = typeof strings.en;
export { strings as nav };
