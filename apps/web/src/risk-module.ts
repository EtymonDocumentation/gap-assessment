import { SERVER_MODE } from "./server/mode";
import { useSession } from "./server/session-store";

/**
 * Is the risk module available to this account? Always on in the static demo. On the server it needs the "risk" module on the account;
 * the menu entry and the risk links are hidden without it, and the server refuses the data calls too.
 */
export function useRiskAllowed(): boolean {
  const modules = useSession((s) => s.user?.plan.modules);
  return !SERVER_MODE || !!modules?.includes("risk");
}

/** Is the TRD module available? Always on in the static demo; on the server it needs the "trd" module on the account. */
export function useTrdAllowed(): boolean {
  const modules = useSession((s) => s.user?.plan.modules);
  return !SERVER_MODE || !!modules?.includes("trd");
}

/** Is the sampling module available? When it is off, the links between sampling points and risk items are hidden; the data stays. */
export function useSamplingAllowed(): boolean {
  const modules = useSession((s) => s.user?.plan.modules);
  return !SERVER_MODE || !!modules?.includes("sampling");
}
