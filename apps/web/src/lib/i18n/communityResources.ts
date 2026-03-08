const strings = {
  en: {
    pageTitle: "Community Resources — PNPtv!",
    pageDescription: "Harm reduction guides, emergency hotlines, sexual health resources, and mental health support for the queer PNP community.",
    pageHeading: "Community Resources",
    pageSubtitle: "Real resources for real situations. No judgment — just information that could help.",
    emergencyTitle: "Emergency Resources",
    emergencySubtitle: "If you or someone you know is in crisis, these lines are available 24/7.",
    emergencyResources: [
      {
        name: "National Drug Helpline",
        number: "1-844-289-0879",
        description: "Free, confidential support for substance use questions and crisis situations.",
        available: "24/7, Free, Confidential",
      },
      {
        name: "Crisis Text Line",
        number: "Text HOME to 741741",
        description: "Text-based crisis support for anyone in emotional distress.",
        available: "24/7, Free, Confidential",
      },
      {
        name: "SAMHSA National Helpline",
        number: "1-800-662-4357",
        description: "Treatment referrals and information for substance use and mental health disorders.",
        available: "24/7, Free, Confidential",
      },
      {
        name: "The Trevor Project",
        number: "1-866-488-7386",
        description: "Crisis intervention and suicide prevention for LGBTQ+ young people.",
        available: "24/7, Free, Confidential",
      },
      {
        name: "Trans Lifeline",
        number: "1-877-565-8860",
        description: "Peer support from trans people for trans people, including substance-related crises.",
        available: "Available daily, Free, Confidential",
      },
    ],
    harmReductionTitle: "Harm Reduction Basics",
    harmReductionSubtitle: "Practical information to reduce risk when using substances.",
    harmReductionItems: [
      {
        title: "Test Your Substances",
        body: "Fentanyl test strips can detect fentanyl contamination in meth, MDMA, cocaine, and other substances. Reagent test kits (Marquis, Mecke, Froehde) can help identify what a substance actually is. Both are available online and at many harm reduction organizations. A positive fentanyl test means slow down, reduce your dose, and never use alone.",
      },
      {
        title: "Hydration and Nutrition",
        body: "For stimulants, drink water regularly but do not overhydrate — electrolyte drinks (sports drinks, coconut water) are better than plain water. Eat before and after if you can. Vitamin C can help your body process stimulants. Avoid mixing alcohol with stimulants, as alcohol masks how intoxicated you are while amplifying cardiovascular stress.",
      },
      {
        title: "Safer Use Practices",
        body: "Start with a small test dose, especially with a new batch or source. Wait before redosing — stimulants can take longer to feel than you expect. Use your own equipment and never share pipes, syringes, or any item that contacts blood or saliva. Clean surfaces before using. If injecting, use new sterile equipment every time and dispose of sharps safely.",
      },
      {
        title: "Know the Signs of Overdose",
        body: "Stimulant overdose signs: chest pain, irregular heartbeat, extremely high temperature, seizures, confusion, or unresponsiveness. Opioid overdose signs: slow or stopped breathing, blue lips or fingertips, deep gurgling or snoring, unresponsive to voice or touch. If you see any of these signs, call 911 immediately. Good Samaritan laws in most U.S. states protect you from drug charges when you call for help.",
      },
      {
        title: "The Buddy System",
        body: "Never use alone. If using in a private setting, make sure someone outside knows where you are and has a check-in time. If they do not hear from you by that time, they should come by or call for a wellness check. Apps like bSafe allow you to set automatic alerts if you do not check in. The buddy system is one of the single most effective overdose prevention tools available.",
      },
      {
        title: "Naloxone (Narcan)",
        body: "Naloxone reverses opioid overdose and can be life-saving within minutes. It is available without a prescription at most pharmacies in the United States and many other countries. Even if you do not use opioids, carry it — fentanyl contamination of non-opioid substances is common and unpredictable. NEXT Distro (nextdistro.org) ships free Narcan by mail in many U.S. states.",
      },
    ],
    sexualHealthTitle: "Sexual Health",
    sexualHealthSubtitle: "Information and resources for safer sex and sexual health care.",
    sexualHealthItems: [
      {
        title: "PrEP — HIV Prevention",
        body: "PrEP (pre-exposure prophylaxis) is a daily medication that reduces your risk of getting HIV by up to 99% when taken as directed. It is available by prescription and covered by most insurance plans in the U.S. GetYourPrEP.com offers telehealth prescriptions with sliding-scale payment. In Latin America, many government health systems provide PrEP at no cost — contact your local health ministry for access.",
      },
      {
        title: "Regular Testing",
        body: "The CDC recommends HIV testing at least once per year for sexually active gay and bisexual men, and every 3-6 months if you have multiple partners. Testing for other STIs (gonorrhea, syphilis, chlamydia, hepatitis C) should happen at the same frequency. GRINDR4EQUALITY and many community health centers offer free or low-cost testing. In the U.S., GetTested.CDC.gov helps you find testing near you.",
      },
      {
        title: "Consent and Boundaries",
        body: "Consent is ongoing and can be withdrawn at any time — including when substances are involved. Communicating boundaries clearly before a session, checking in during, and debriefing afterward are all part of a healthy approach to sexual connection. If you or someone else is too impaired to clearly consent, that is a signal to pause.",
      },
      {
        title: "Safer Sex Supplies",
        body: "Condoms remain one of the most effective tools for preventing HIV transmission and other STIs. PREP has not replaced condoms — they work best together. Mail-order condom programs (like those run by many local health departments) ship free supplies. Lube matters: water-based lube is always safe; avoid oil-based lube with condoms.",
      },
    ],
    mentalHealthTitle: "Mental Health",
    mentalHealthSubtitle: "Resources for emotional wellbeing, recovery, and community support.",
    mentalHealthItems: [
      {
        title: "When Partying Becomes a Problem",
        body: "There is no single definition of a substance use problem. Signs that use may be becoming harmful include: using more than you intend, difficulty stopping or cutting back, missing work, social, or family obligations due to use, using to cope with anxiety, depression, or loneliness, or experiencing health complications. These signs are not moral failures — they are information. If you are seeing them, reaching out is a sign of strength.",
      },
      {
        title: "Recovery Resources",
        body: "Crystal Meth Anonymous (CMA) offers peer support meetings specifically for meth use, with many LGBTQ+-welcoming chapters globally. NA (Narcotics Anonymous) has widespread meetings and an online directory at na.org. SMART Recovery offers a secular, evidence-based alternative to 12-step programs with online meetings available 24/7. Many people in the PNP community use these resources while continuing to engage with the community in other ways.",
      },
      {
        title: "Therapy for the Queer Community",
        body: "Psychology Today's therapist directory (psychologytoday.com/us/therapists) allows filtering by LGBTQ+ affirming providers and sliding-scale fees. Talkspace and BetterHelp offer text-based and video therapy with many LGBTQ+-affirming practitioners. The National Queer and Trans Therapists of Color Network (nqttcn.com) connects BIPOC community members with culturally specific care. If cost is a barrier, community health centers often offer therapy on a sliding scale.",
      },
      {
        title: "Self-Care and Rest",
        body: "Sleep is the most underrated recovery tool available. After a session, prioritize rest, nutrition, and hydration. Gentle movement (walking, stretching) can help your body process. Avoid back-to-back sessions without adequate recovery time. Check in with yourself honestly: am I using to enjoy, or am I using to avoid? That question alone — asked with compassion, not judgment — is a powerful form of self-care.",
      },
    ],
    communityGuidelinesTitle: "Community Guidelines",
    communityGuidelinesBody: "PNPtv is built on mutual respect, harm reduction, and community care. We ask all members to engage with honesty, treat each other with dignity, respect consent in all interactions, report content or behavior that violates community standards, and prioritize the wellbeing of themselves and others. Violations of our community guidelines — including harassment, non-consensual sharing of content, and content involving minors — result in immediate and permanent removal from the platform.",
    communityGuidelinesCta: "Read Full Community Guidelines",
    copyrightNote: "Resource information is provided for harm reduction purposes. PNPtv does not endorse any specific organizations and is not responsible for the content of external websites. In an emergency, call your local emergency services.",
  },
  es: {
    pageTitle: "Recursos Comunitarios — PNPtv!",
    pageDescription: "Guías de reducción de daños, líneas de crisis, recursos de salud sexual y apoyo de salud mental para la comunidad queer PNP.",
    pageHeading: "Recursos Comunitarios",
    pageSubtitle: "Recursos reales para situaciones reales. Sin juicio — solo información que podría ayudar.",
    emergencyTitle: "Recursos de Emergencia",
    emergencySubtitle: "Si tú o alguien que conoces está en crisis, estas líneas están disponibles las 24 horas, los 7 días de la semana.",
    emergencyResources: [
      {
        name: "Línea Nacional de Ayuda para Drogas (EE. UU.)",
        number: "1-844-289-0879",
        description: "Apoyo gratuito y confidencial para preguntas sobre uso de sustancias y situaciones de crisis.",
        available: "24/7, Gratuito, Confidencial",
      },
      {
        name: "Crisis Text Line (EE. UU.)",
        number: "Envía HELLO al 741741",
        description: "Apoyo en crisis por mensaje de texto para cualquier persona en angustia emocional.",
        available: "24/7, Gratuito, Confidencial",
      },
      {
        name: "SAMHSA — Línea Nacional de Ayuda",
        number: "1-800-662-4357",
        description: "Referencias de tratamiento e información para trastornos de uso de sustancias y salud mental.",
        available: "24/7, Gratuito, Confidencial",
      },
      {
        name: "The Trevor Project (LGBTQ+)",
        number: "1-866-488-7386",
        description: "Intervención en crisis y prevención del suicidio para jóvenes LGBTQ+.",
        available: "24/7, Gratuito, Confidencial",
      },
      {
        name: "Trans Lifeline",
        number: "1-877-565-8860",
        description: "Apoyo entre pares de personas trans para personas trans, incluyendo crisis relacionadas con sustancias.",
        available: "Disponible diariamente, Gratuito, Confidencial",
      },
    ],
    harmReductionTitle: "Fundamentos de Reducción de Daños",
    harmReductionSubtitle: "Información práctica para reducir riesgos al usar sustancias.",
    harmReductionItems: [
      {
        title: "Prueba tus Sustancias",
        body: "Las tiras de prueba para fentanilo pueden detectar contaminación de fentanilo en metanfetamina, MDMA, cocaína y otras sustancias. Los kits de prueba de reactivos (Marquis, Mecke, Froehde) pueden ayudar a identificar qué es realmente una sustancia. Ambos están disponibles en línea y en muchas organizaciones de reducción de daños. Una prueba positiva de fentanilo significa: reduce la velocidad, disminuye tu dosis y nunca uses solo.",
      },
      {
        title: "Hidratación y Nutrición",
        body: "Para estimulantes, bebe agua regularmente pero no te sobrehidrates — las bebidas con electrolitos (bebidas deportivas, agua de coco) son mejores que el agua sola. Come antes y después si puedes. La vitamina C puede ayudar a tu cuerpo a procesar los estimulantes. Evita mezclar alcohol con estimulantes, ya que el alcohol enmascara qué tan intoxicado estás mientras amplifica el estrés cardiovascular.",
      },
      {
        title: "Prácticas de Uso Más Seguro",
        body: "Comienza con una dosis de prueba pequeña, especialmente con un lote o fuente nueva. Espera antes de redosar — los estimulantes pueden tardar más en sentirse de lo que esperas. Usa tu propio equipo y nunca compartas pipas, jeringas ni ningún artículo que entre en contacto con sangre o saliva. Si te inyectas, usa equipo estéril nuevo cada vez y desecha los objetos punzantes de manera segura.",
      },
      {
        title: "Reconoce los Signos de Sobredosis",
        body: "Signos de sobredosis por estimulantes: dolor en el pecho, latidos irregulares, temperatura extremadamente alta, convulsiones, confusión o falta de respuesta. Signos de sobredosis por opioides: respiración lenta o detenida, labios o dedos azulados, gorgoteo profundo o ronquidos, sin respuesta a la voz o el tacto. Si ves cualquiera de estos signos, llama al 911 (o al número de emergencias local) inmediatamente.",
      },
      {
        title: "El Sistema de Compañero",
        body: "Nunca uses solo. Si usas en un entorno privado, asegúrate de que alguien fuera sepa dónde estás y tenga una hora de registro. Si no tiene noticias tuyas en ese momento, debería pasar o llamar para un control de bienestar. El sistema de compañero es una de las herramientas de prevención de sobredosis más efectivas disponibles.",
      },
      {
        title: "Naloxona (Narcan)",
        body: "La naloxona revierte la sobredosis de opioides y puede salvar vidas en minutos. Está disponible sin receta en la mayoría de las farmacias de EE. UU. y muchos otros países. Incluso si no usas opioides, llévala — la contaminación de fentanilo de sustancias no opioides es común e impredecible. En muchos países latinoamericanos, la naloxona se puede obtener a través de organizaciones de salud pública y clínicas comunitarias.",
      },
    ],
    sexualHealthTitle: "Salud Sexual",
    sexualHealthSubtitle: "Información y recursos para sexo más seguro y atención de salud sexual.",
    sexualHealthItems: [
      {
        title: "PrEP — Prevención del VIH",
        body: "La PrEP (profilaxis preexposición) es un medicamento diario que reduce tu riesgo de contraer el VIH hasta en un 99% cuando se toma según las indicaciones. En muchos países de América Latina, los sistemas de salud gubernamentales proporcionan PrEP sin costo — contacta a tu ministerio de salud local para obtener acceso. En EE. UU., GetYourPrEP.com ofrece recetas de telesalud con pago escalonado.",
      },
      {
        title: "Pruebas Regulares",
        body: "Los CDC recomiendan la prueba del VIH al menos una vez al año para hombres gay y bisexuales sexualmente activos, y cada 3-6 meses si tienes múltiples parejas. Las pruebas de otras ITS (gonorrea, sífilis, clamidia, hepatitis C) deben realizarse con la misma frecuencia. En muchas ciudades latinoamericanas, los centros de salud comunitaria ofrecen pruebas gratuitas.",
      },
      {
        title: "Consentimiento y Límites",
        body: "El consentimiento es continuo y puede retirarse en cualquier momento — incluso cuando hay sustancias involucradas. Comunicar los límites claramente antes de una sesión, verificar durante y conversar después son parte de un enfoque saludable para la conexión sexual. Si tú o alguien más está demasiado afectado para dar consentimiento claro, esa es una señal para hacer una pausa.",
      },
      {
        title: "Suministros para Sexo Más Seguro",
        body: "Los condones siguen siendo una de las herramientas más efectivas para prevenir la transmisión del VIH y otras ITS. La PrEP no ha reemplazado a los condones — funcionan mejor juntos. El lubricante importa: el lubricante a base de agua siempre es seguro; evita el lubricante a base de aceite con condones. Muchas organizaciones de salud comunitaria distribuyen suministros gratuitos.",
      },
    ],
    mentalHealthTitle: "Salud Mental",
    mentalHealthSubtitle: "Recursos para el bienestar emocional, la recuperación y el apoyo comunitario.",
    mentalHealthItems: [
      {
        title: "Cuando el Party se Convierte en un Problema",
        body: "No existe una sola definición de un problema con sustancias. Las señales de que el uso puede estar volviéndose dañino incluyen: usar más de lo que pretendes, dificultad para detenerte o reducir el consumo, faltar a obligaciones laborales, sociales o familiares debido al uso, usar para hacer frente a la ansiedad, la depresión o la soledad, o experimentar complicaciones de salud. Estas señales no son fallas morales — son información. Si las estás viendo, pedir ayuda es una señal de fortaleza.",
      },
      {
        title: "Recursos de Recuperación",
        body: "Crystal Meth Anonymous (CMA) ofrece reuniones de apoyo entre pares específicamente para el uso de metanfetamina, con muchos capítulos que dan la bienvenida a la comunidad LGBTQ+. NA (Narcóticos Anónimos) tiene reuniones generalizadas y un directorio en línea en na.org. SMART Recovery ofrece una alternativa laica y basada en evidencia a los programas de 12 pasos con reuniones en línea disponibles las 24 horas.",
      },
      {
        title: "Terapia para la Comunidad Queer",
        body: "El directorio de terapeutas de Psychology Today (psychologytoday.com) permite filtrar por proveedores afirmadores de LGBTQ+ y tarifas escalonadas. En América Latina, muchas clínicas comunitarias ofrecen servicios de salud mental a costos reducidos. La Red Nacional de Terapeutas Queer y Trans de Color (nqttcn.com) conecta a los miembros de la comunidad BIPOC con atención culturalmente específica.",
      },
      {
        title: "Autocuidado y Descanso",
        body: "El sueño es la herramienta de recuperación más subestimada disponible. Después de una sesión, prioriza el descanso, la nutrición y la hidratación. El movimiento suave (caminar, estirar) puede ayudar a tu cuerpo a procesar. Evita sesiones consecutivas sin tiempo de recuperación adecuado. Hazle una pregunta con compasión: ¿estoy usando para disfrutar, o estoy usando para evitar algo? Esa pregunta sola es una poderosa forma de autocuidado.",
      },
    ],
    communityGuidelinesTitle: "Pautas Comunitarias",
    communityGuidelinesBody: "PNPtv está construida sobre el respeto mutuo, la reducción de daños y el cuidado comunitario. Pedimos a todos los miembros que participen con honestidad, que traten a los demás con dignidad, que respeten el consentimiento en todas las interacciones, que reporten contenido o comportamiento que viole los estándares comunitarios y que prioricen el bienestar de ellos mismos y de los demás. Las violaciones de nuestras pautas comunitarias resultan en una eliminación inmediata y permanente de la plataforma.",
    communityGuidelinesCta: "Leer las Pautas Comunitarias Completas",
    copyrightNote: "La información de recursos se proporciona con fines de reducción de daños. PNPtv no respalda ninguna organización específica y no es responsable del contenido de sitios web externos. En una emergencia, llama a los servicios de emergencia de tu localidad.",
  },
} as const;

export type CommunityResourcesStrings = typeof strings.en;
export { strings as communityResources };
