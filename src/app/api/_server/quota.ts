const DAILY_GUEST_ATTEMPTS = 6;
const guestUsage = new Map<string, { day: string; attempts: number }>();

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

export function guestIdentity(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "local-guest";
}

export function claimGuestAttempts(identity: string, attempts: number) {
  const day = utcDay();
  const current = guestUsage.get(identity);
  const used = current?.day === day ? current.attempts : 0;
  if (used + attempts > DAILY_GUEST_ATTEMPTS) {
    return {
      allowed: false as const,
      remaining: Math.max(0, DAILY_GUEST_ATTEMPTS - used),
      limit: DAILY_GUEST_ATTEMPTS,
    };
  }
  guestUsage.set(identity, { day, attempts: used + attempts });
  return {
    allowed: true as const,
    remaining: DAILY_GUEST_ATTEMPTS - used - attempts,
    limit: DAILY_GUEST_ATTEMPTS,
  };
}
