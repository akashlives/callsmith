/**
 * Apply is a named hand, not "a pointer event happened."
 *
 * `isTrusted` rejects script-synthesized clicks (`el.click()`, `dispatchEvent`,
 * `Runtime.evaluate` back doors). CDP-delivered computer-use clicks arrive
 * trusted — the ledger names that ingress; this helper does not claim they
 * are a person.
 *
 * Missing `userActivation` (older engines) does not brick the human path.
 * An explicit inactive activation does.
 */
export type ApplyGesture = {
  trusted: boolean;
  activation: boolean | null;
  allowed: boolean;
  reason?: "untrusted_input" | "no_user_activation";
};

export function inspectApplyGesture(event: { isTrusted?: boolean }): ApplyGesture {
  const trusted = event.isTrusted === true;
  const activationApi =
    typeof navigator !== "undefined" ? navigator.userActivation : undefined;
  const activation = activationApi ? activationApi.isActive : null;
  if (!trusted) {
    return { trusted: false, activation, allowed: false, reason: "untrusted_input" };
  }
  if (activation === false) {
    return { trusted: true, activation: false, allowed: false, reason: "no_user_activation" };
  }
  return { trusted: true, activation, allowed: true };
}

export function emitCallsmith(event: string, detail: Record<string, unknown>) {
  if (typeof console === "undefined") return;
  console.info(`callsmith:${event}`, detail);
}
