import React from "react";

const PINK = "#D4007A";
const ORANGE = "#E69138";
const CYAN = "#5BC8F5";

function Sparkles() {
  return (
    <>
      <circle className="tutorial-sparkle" cx="30" cy="30" r="3" fill={CYAN} opacity="0.6" />
      <circle className="tutorial-sparkle-delayed" cx="170" cy="45" r="2.5" fill={PINK} opacity="0.5" />
      <circle className="tutorial-sparkle" cx="160" cy="160" r="2" fill={ORANGE} opacity="0.5" />
    </>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full tutorial-illustration-float">
      {children}
      <Sparkles />
    </svg>
  );
}

const illustrations: Record<string, React.ReactNode> = {
  welcome: (
    <Wrap>
      <rect x="60" y="40" width="80" height="120" rx="12" stroke={PINK} strokeWidth="3" />
      <rect x="75" y="55" width="50" height="8" rx="4" fill={PINK} opacity="0.6" />
      <rect x="75" y="70" width="40" height="6" rx="3" fill={ORANGE} opacity="0.4" />
      <rect x="75" y="82" width="45" height="6" rx="3" fill={ORANGE} opacity="0.4" />
      <circle cx="100" cy="115" r="15" stroke={CYAN} strokeWidth="2" />
      <path d="M95 115 L105 115 M100 110 L100 120" stroke={CYAN} strokeWidth="2" strokeLinecap="round" />
    </Wrap>
  ),

  feed: (
    <Wrap>
      <rect x="50" y="35" width="100" height="30" rx="8" fill={PINK} opacity="0.15" stroke={PINK} strokeWidth="1.5" />
      <rect x="60" y="45" width="40" height="4" rx="2" fill={PINK} opacity="0.6" />
      <rect x="60" y="53" width="60" height="3" rx="1.5" fill="white" opacity="0.2" />
      <rect x="50" y="75" width="100" height="40" rx="8" fill={ORANGE} opacity="0.1" stroke={ORANGE} strokeWidth="1.5" />
      <circle cx="65" cy="90" r="8" fill={CYAN} opacity="0.3" />
      <rect x="80" y="85" width="55" height="4" rx="2" fill="white" opacity="0.3" />
      <rect x="80" y="93" width="40" height="3" rx="1.5" fill="white" opacity="0.15" />
      <rect x="50" y="125" width="100" height="35" rx="8" fill={CYAN} opacity="0.08" stroke={CYAN} strokeWidth="1.5" />
      <rect x="60" y="135" width="50" height="4" rx="2" fill="white" opacity="0.25" />
      <rect x="60" y="143" width="70" height="3" rx="1.5" fill="white" opacity="0.15" />
    </Wrap>
  ),

  navigate: (
    <Wrap>
      <rect x="45" y="140" width="110" height="30" rx="10" fill="rgba(30,30,30,0.8)" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
      <circle cx="65" cy="155" r="6" fill={PINK} opacity="0.6" />
      <circle cx="85" cy="155" r="6" fill={ORANGE} opacity="0.4" />
      <circle cx="105" cy="155" r="6" fill={CYAN} opacity="0.4" />
      <circle cx="125" cy="155" r="6" fill="white" opacity="0.2" />
      <circle cx="140" cy="155" r="6" fill="white" opacity="0.2" />
      <path d="M90 60 L100 45 L110 60" stroke={CYAN} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M100 45 L100 110" stroke={CYAN} strokeWidth="2" strokeLinecap="round" strokeDasharray="4 4" />
    </Wrap>
  ),

  groupChat: (
    <Wrap>
      <rect x="40" y="50" width="80" height="35" rx="12" fill={PINK} opacity="0.15" stroke={PINK} strokeWidth="1.5" />
      <rect x="55" y="62" width="40" height="4" rx="2" fill="white" opacity="0.4" />
      <rect x="55" y="70" width="25" height="3" rx="1.5" fill="white" opacity="0.2" />
      <rect x="80" y="95" width="80" height="35" rx="12" fill={CYAN} opacity="0.12" stroke={CYAN} strokeWidth="1.5" />
      <rect x="95" y="107" width="45" height="4" rx="2" fill="white" opacity="0.4" />
      <rect x="95" y="115" width="30" height="3" rx="1.5" fill="white" opacity="0.2" />
      <circle cx="50" cy="100" r="12" fill={ORANGE} opacity="0.2" stroke={ORANGE} strokeWidth="1.5" />
      <circle cx="150" cy="65" r="12" fill={CYAN} opacity="0.15" stroke={CYAN} strokeWidth="1.5" />
    </Wrap>
  ),

  videoCall: (
    <Wrap>
      <rect x="45" y="50" width="110" height="75" rx="12" stroke={CYAN} strokeWidth="2" fill={CYAN} fillOpacity="0.06" />
      <circle cx="80" cy="82" r="15" fill={PINK} opacity="0.2" stroke={PINK} strokeWidth="1.5" />
      <circle cx="120" cy="82" r="15" fill={ORANGE} opacity="0.2" stroke={ORANGE} strokeWidth="1.5" />
      <circle cx="100" cy="145" r="12" fill="#FF453A" opacity="0.8" />
      <rect x="93" y="142" width="14" height="6" rx="3" fill="white" opacity="0.9" />
    </Wrap>
  ),

  createGroup: (
    <Wrap>
      <circle cx="100" cy="90" r="40" stroke={PINK} strokeWidth="2" strokeDasharray="6 4" fill={PINK} fillOpacity="0.05" />
      <path d="M88 90 L112 90 M100 78 L100 102" stroke={PINK} strokeWidth="3" strokeLinecap="round" />
      <circle cx="55" cy="60" r="10" fill={ORANGE} opacity="0.25" />
      <circle cx="145" cy="60" r="10" fill={CYAN} opacity="0.25" />
      <circle cx="55" cy="120" r="10" fill={CYAN} opacity="0.2" />
      <circle cx="145" cy="120" r="10" fill={ORANGE} opacity="0.2" />
    </Wrap>
  ),

  primeContent: (
    <Wrap>
      <rect x="50" y="45" width="100" height="110" rx="14" stroke={ORANGE} strokeWidth="2" fill={ORANGE} fillOpacity="0.06" />
      <polygon points="90,75 90,115 120,95" fill={PINK} opacity="0.7" />
      <rect x="60" y="50" width="25" height="10" rx="5" fill={ORANGE} opacity="0.8" />
      <text x="66" y="58" fill="white" fontSize="7" fontWeight="bold" fontFamily="monospace">PRIME</text>
    </Wrap>
  ),

  browse: (
    <Wrap>
      <rect x="35" y="50" width="55" height="50" rx="10" fill={PINK} opacity="0.1" stroke={PINK} strokeWidth="1.5" />
      <rect x="110" y="50" width="55" height="50" rx="10" fill={ORANGE} opacity="0.1" stroke={ORANGE} strokeWidth="1.5" />
      <rect x="35" y="110" width="55" height="50" rx="10" fill={CYAN} opacity="0.08" stroke={CYAN} strokeWidth="1.5" />
      <rect x="110" y="110" width="55" height="50" rx="10" fill={PINK} opacity="0.08" stroke={PINK} strokeWidth="1.5" />
      <polygon points="55,68 55,88 70,78" fill="white" opacity="0.4" />
      <polygon points="130,68 130,88 145,78" fill="white" opacity="0.4" />
    </Wrap>
  ),

  liveStream: (
    <Wrap>
      <rect x="45" y="45" width="110" height="80" rx="12" stroke={PINK} strokeWidth="2" fill={PINK} fillOpacity="0.05" />
      <circle cx="100" cy="85" r="18" fill={PINK} opacity="0.2" stroke={PINK} strokeWidth="1.5" />
      <polygon points="95,78 95,92 108,85" fill="white" opacity="0.7" />
      <circle cx="55" cy="55" r="5" fill="#FF453A" />
      <rect x="63" y="52" width="25" height="7" rx="3.5" fill="#FF453A" opacity="0.8" />
      <text x="67" y="58" fill="white" fontSize="6" fontWeight="bold" fontFamily="monospace">LIVE</text>
    </Wrap>
  ),

  tips: (
    <Wrap>
      <circle cx="100" cy="80" r="35" stroke={ORANGE} strokeWidth="2" fill={ORANGE} fillOpacity="0.08" />
      <text x="85" y="90" fill={ORANGE} fontSize="30" fontFamily="monospace">$</text>
      <path d="M60 130 Q80 115, 100 130 Q120 115, 140 130" stroke={PINK} strokeWidth="2" fill="none" opacity="0.4" />
      <circle cx="60" cy="50" r="4" fill={PINK} opacity="0.5" />
      <circle cx="140" cy="50" r="4" fill={CYAN} opacity="0.5" />
    </Wrap>
  ),

  bookSession: (
    <Wrap>
      <rect x="55" y="45" width="90" height="90" rx="12" stroke={CYAN} strokeWidth="2" fill={CYAN} fillOpacity="0.05" />
      <line x1="55" y1="70" x2="145" y2="70" stroke={CYAN} strokeWidth="1" opacity="0.3" />
      <rect x="70" y="80" width="15" height="12" rx="3" fill={PINK} opacity="0.4" />
      <rect x="92" y="80" width="15" height="12" rx="3" fill={ORANGE} opacity="0.4" />
      <rect x="114" y="80" width="15" height="12" rx="3" fill={CYAN} opacity="0.3" />
      <rect x="70" y="100" width="15" height="12" rx="3" fill="white" opacity="0.1" />
      <rect x="92" y="100" width="15" height="12" rx="3" fill={PINK} opacity="0.25" />
      <rect x="70" y="52" width="25" height="6" rx="3" fill="white" opacity="0.2" />
    </Wrap>
  ),

  mapDiscovery: (
    <Wrap>
      <circle cx="100" cy="90" r="50" stroke={CYAN} strokeWidth="1.5" fill={CYAN} fillOpacity="0.04" strokeDasharray="4 3" />
      <circle cx="100" cy="90" r="25" stroke={CYAN} strokeWidth="1" fill={CYAN} fillOpacity="0.06" strokeDasharray="3 3" />
      <path d="M100 65 C106 65, 112 72, 112 80 C112 92, 100 100, 100 100 C100 100, 88 92, 88 80 C88 72, 94 65, 100 65Z" fill={PINK} opacity="0.7" />
      <circle cx="100" cy="78" r="4" fill="white" opacity="0.8" />
      <circle cx="65" cy="75" r="5" fill={ORANGE} opacity="0.4" />
      <circle cx="130" cy="100" r="5" fill={CYAN} opacity="0.4" />
    </Wrap>
  ),

  privacy: (
    <Wrap>
      <rect x="70" y="60" width="60" height="50" rx="8" stroke="white" strokeWidth="2" opacity="0.3" fill="white" fillOpacity="0.03" />
      <rect x="85" y="45" width="30" height="25" rx="15" stroke="white" strokeWidth="2" opacity="0.3" fill="none" />
      <circle cx="100" cy="82" r="6" fill={CYAN} opacity="0.6" />
      <line x1="100" y1="88" x2="100" y2="98" stroke={CYAN} strokeWidth="2" opacity="0.5" />
      <circle cx="55" cy="90" r="8" fill={PINK} opacity="0.15" stroke={PINK} strokeWidth="1" strokeDasharray="2 2" />
      <circle cx="145" cy="90" r="8" fill={ORANGE} opacity="0.15" stroke={ORANGE} strokeWidth="1" strokeDasharray="2 2" />
    </Wrap>
  ),

  socialPost: (
    <Wrap>
      <rect x="50" y="45" width="100" height="30" rx="10" fill={PINK} opacity="0.12" stroke={PINK} strokeWidth="1.5" />
      <rect x="62" y="55" width="50" height="4" rx="2" fill="white" opacity="0.3" />
      <rect x="62" y="63" width="30" height="3" rx="1.5" fill="white" opacity="0.15" />
      <rect x="50" y="85" width="100" height="60" rx="10" fill={ORANGE} opacity="0.08" stroke={ORANGE} strokeWidth="1.5" />
      <rect x="62" y="95" width="75" height="35" rx="6" fill="white" opacity="0.05" />
      <path d="M85 108 L95 118 L110 100" stroke={CYAN} strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.4" />
    </Wrap>
  ),

  engage: (
    <Wrap>
      <path d="M100 75 C100 62, 80 55, 75 70 C70 55, 50 62, 50 75 C50 95, 75 110, 75 110 C75 110, 100 95, 100 75Z" fill={PINK} opacity="0.4" />
      <path d="M150 75 C150 62, 130 55, 125 70 C120 55, 100 62, 100 75 C100 95, 125 110, 125 110 C125 110, 150 95, 150 75Z" fill={ORANGE} opacity="0.3" />
      <circle cx="65" cy="135" r="8" fill={CYAN} opacity="0.3" />
      <circle cx="85" cy="135" r="8" fill={PINK} opacity="0.2" />
      <circle cx="105" cy="135" r="8" fill={ORANGE} opacity="0.2" />
      <circle cx="125" cy="135" r="8" fill={CYAN} opacity="0.15" />
    </Wrap>
  ),

  directMessage: (
    <Wrap>
      <rect x="55" y="55" width="90" height="55" rx="14" stroke={CYAN} strokeWidth="2" fill={CYAN} fillOpacity="0.06" />
      <rect x="70" y="70" width="45" height="4" rx="2" fill="white" opacity="0.35" />
      <rect x="70" y="80" width="30" height="3" rx="1.5" fill="white" opacity="0.2" />
      <rect x="70" y="90" width="50" height="4" rx="2" fill="white" opacity="0.25" />
      <polygon points="70,110 85,110 70,125" fill={CYAN} opacity="0.3" />
      <circle cx="140" cy="60" r="8" fill={PINK} opacity="0.3" />
    </Wrap>
  ),

  shareMedia: (
    <Wrap>
      <rect x="55" y="50" width="90" height="70" rx="12" stroke={ORANGE} strokeWidth="1.5" fill={ORANGE} fillOpacity="0.06" />
      <rect x="65" y="60" width="35" height="30" rx="6" fill={PINK} opacity="0.15" stroke={PINK} strokeWidth="1" />
      <rect x="105" y="60" width="30" height="30" rx="6" fill={CYAN} opacity="0.1" stroke={CYAN} strokeWidth="1" />
      <polygon points="75,70 75,85 88,77" fill="white" opacity="0.35" />
      <path d="M105 140 L115 130 L125 140 M115 130 L115 155" stroke={CYAN} strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.5" />
    </Wrap>
  ),

  profileCustomize: (
    <Wrap>
      <circle cx="100" cy="75" r="25" stroke={PINK} strokeWidth="2" fill={PINK} fillOpacity="0.1" />
      <circle cx="100" cy="68" r="8" fill="white" opacity="0.2" />
      <path d="M85 85 Q100 95, 115 85" stroke="white" strokeWidth="1.5" fill="none" opacity="0.2" />
      <rect x="65" y="115" width="70" height="8" rx="4" fill={ORANGE} opacity="0.3" />
      <rect x="75" y="130" width="50" height="5" rx="2.5" fill="white" opacity="0.15" />
      <rect x="80" y="140" width="40" height="5" rx="2.5" fill="white" opacity="0.1" />
    </Wrap>
  ),

  subscribePlans: (
    <Wrap>
      <rect x="30" y="55" width="60" height="90" rx="10" stroke={CYAN} strokeWidth="1.5" fill={CYAN} fillOpacity="0.06" />
      <rect x="40" y="65" width="40" height="6" rx="3" fill={CYAN} opacity="0.5" />
      <rect x="40" y="77" width="30" height="4" rx="2" fill="white" opacity="0.2" />
      <rect x="40" y="85" width="35" height="4" rx="2" fill="white" opacity="0.15" />
      <rect x="40" y="93" width="25" height="4" rx="2" fill="white" opacity="0.15" />
      <rect x="110" y="45" width="60" height="100" rx="10" stroke={PINK} strokeWidth="2" fill={PINK} fillOpacity="0.08" />
      <rect x="120" y="50" width="25" height="10" rx="5" fill={ORANGE} opacity="0.8" />
      <text x="125" y="58" fill="white" fontSize="6" fontWeight="bold" fontFamily="monospace">PRIME</text>
      <rect x="120" y="67" width="40" height="6" rx="3" fill={PINK} opacity="0.5" />
      <rect x="120" y="79" width="30" height="4" rx="2" fill="white" opacity="0.2" />
      <rect x="120" y="87" width="35" height="4" rx="2" fill="white" opacity="0.15" />
      <rect x="120" y="95" width="25" height="4" rx="2" fill="white" opacity="0.15" />
      <rect x="120" y="103" width="30" height="4" rx="2" fill="white" opacity="0.15" />
      <rect x="120" y="111" width="20" height="4" rx="2" fill="white" opacity="0.1" />
    </Wrap>
  ),

  paymentMethods: (
    <Wrap>
      <rect x="35" y="55" width="55" height="40" rx="8" stroke={CYAN} strokeWidth="1.5" fill={CYAN} fillOpacity="0.08" />
      <rect x="42" y="62" width="20" height="3" rx="1.5" fill="white" opacity="0.3" />
      <rect x="42" y="68" width="40" height="5" rx="2.5" fill={ORANGE} opacity="0.4" />
      <rect x="42" y="78" width="15" height="8" rx="2" fill="white" opacity="0.15" />
      <rect x="60" y="78" width="15" height="8" rx="2" fill="white" opacity="0.1" />
      <text x="55" y="50" fill={CYAN} fontSize="10" fontFamily="monospace" opacity="0.6">💳</text>
      <circle cx="140" cy="75" r="22" stroke={PINK} strokeWidth="1.5" fill={PINK} fillOpacity="0.06" />
      <text x="129" y="72" fill={ORANGE} fontSize="14" fontFamily="monospace" opacity="0.7">$</text>
      <text x="138" y="84" fill={PINK} fontSize="7" fontWeight="bold" fontFamily="monospace" opacity="0.8">USDC</text>
      <path d="M90 75 L110 75" stroke={ORANGE} strokeWidth="2" strokeLinecap="round" strokeDasharray="4 3" />
      <text x="67" y="120" fill="white" fontSize="7" fontFamily="monospace" opacity="0.25">ePayco</text>
      <text x="125" y="120" fill="white" fontSize="7" fontFamily="monospace" opacity="0.25">Daimo</text>
    </Wrap>
  ),

  instantAccess: (
    <Wrap>
      <circle cx="100" cy="80" r="35" stroke="#34C759" strokeWidth="2" fill="#34C759" fillOpacity="0.08" />
      <path d="M85 80 L95 90 L115 70" stroke="#34C759" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M65 130 L75 120 M100 130 L100 118 M135 130 L125 120" stroke={CYAN} strokeWidth="1.5" strokeLinecap="round" opacity="0.3" />
      <circle cx="65" cy="135" r="4" fill={PINK} opacity="0.4" />
      <circle cx="100" cy="135" r="4" fill={ORANGE} opacity="0.4" />
      <circle cx="135" cy="135" r="4" fill={CYAN} opacity="0.4" />
      <rect x="55" y="145" width="20" height="3" rx="1.5" fill="white" opacity="0.15" />
      <rect x="90" y="145" width="20" height="3" rx="1.5" fill="white" opacity="0.15" />
      <rect x="125" y="145" width="20" height="3" rx="1.5" fill="white" opacity="0.15" />
    </Wrap>
  ),

  connectAccounts: (
    <Wrap>
      <circle cx="70" cy="85" r="22" stroke={CYAN} strokeWidth="2" fill={CYAN} fillOpacity="0.08" />
      <circle cx="130" cy="85" r="22" stroke={PINK} strokeWidth="2" fill={PINK} fillOpacity="0.08" />
      <path d="M92 85 L108 85" stroke={ORANGE} strokeWidth="2.5" strokeLinecap="round" strokeDasharray="4 3" />
      <circle cx="92" cy="85" r="3" fill={ORANGE} opacity="0.6" />
      <circle cx="108" cy="85" r="3" fill={ORANGE} opacity="0.6" />
      <text x="62" y="90" fill={CYAN} fontSize="16" fontFamily="monospace" opacity="0.7">@</text>
      <text x="122" y="90" fill={PINK} fontSize="16" fontFamily="monospace" opacity="0.7">@</text>
    </Wrap>
  ),
};

export function TutorialIllustration({ name }: { name: string }) {
  return (
    <div className="w-40 h-40 mx-auto">
      {illustrations[name] || illustrations.welcome}
    </div>
  );
}
