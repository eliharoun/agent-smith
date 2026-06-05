import { useContext } from "react";
import { type NotificationsApi, NotificationsContext } from "../ui/NotificationCenter";

export function useNotifications(): NotificationsApi {
  const ctx = useContext(NotificationsContext);
  if (!ctx) {
    throw new Error("useNotifications must be used inside <NotificationCenter>");
  }
  return ctx;
}
