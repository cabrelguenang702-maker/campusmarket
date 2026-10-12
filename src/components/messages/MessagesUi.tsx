import { createContext, useContext } from "react";

/** État d'interface partagé par le layout /messages (ouverture de la boîte « Nouvelle conversation »). */
type Ctx = { newOpen: boolean; setNewOpen: (o: boolean) => void };
export const MessagesUiContext = createContext<Ctx | null>(null);

export function useMessagesUi() {
  const ctx = useContext(MessagesUiContext);
  if (!ctx) throw new Error("useMessagesUi doit être utilisé dans le layout /messages");
  return ctx;
}
