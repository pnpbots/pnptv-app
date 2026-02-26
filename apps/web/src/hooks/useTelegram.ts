import { useEffect, useState } from "react";
import { getTelegramWebApp, isTelegramContext } from "@/lib/telegram";

interface TelegramUser {
  id: number;
  firstName: string;
  lastName?: string;
  username?: string;
  languageCode?: string;
  photoUrl?: string;
}

interface UseTelegramReturn {
  isTelegram: boolean;
  user: TelegramUser | null;
  initData: string;
  platform: string;
  colorScheme: "light" | "dark";
  expand: () => void;
  haptic: {
    impact: (style?: "light" | "medium" | "heavy") => void;
    notification: (type: "success" | "warning" | "error") => void;
    selection: () => void;
  };
}

export function useTelegram(): UseTelegramReturn {
  const [user, setUser] = useState<TelegramUser | null>(null);
  const [isTelegram, setIsTelegram] = useState(false);

  useEffect(() => {
    const webapp = getTelegramWebApp();
    if (webapp && isTelegramContext()) {
      setIsTelegram(true);
      webapp.ready();
      webapp.expand();

      const tgUser = webapp.initDataUnsafe.user;
      if (tgUser) {
        setUser({
          id: tgUser.id,
          firstName: tgUser.first_name,
          lastName: tgUser.last_name,
          username: tgUser.username,
          languageCode: tgUser.language_code,
          photoUrl: tgUser.photo_url,
        });
      }
    }
  }, []);

  const webapp = getTelegramWebApp();

  return {
    isTelegram,
    user,
    initData: webapp?.initData ?? "",
    platform: webapp?.platform ?? "web",
    colorScheme: webapp?.colorScheme ?? "dark",
    expand: () => webapp?.expand(),
    haptic: {
      impact: (style = "medium") => webapp?.HapticFeedback?.impactOccurred(style),
      notification: (type) => webapp?.HapticFeedback?.notificationOccurred(type),
      selection: () => webapp?.HapticFeedback?.selectionChanged(),
    },
  };
}
