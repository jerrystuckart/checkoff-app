// Founding Member recognition (Profile tab only). The Founding 500 is retired as a
// marketing campaign, but numbers 1-500 remain a permanent, quiet recognition.
// DB assigns founding_number from a sequence with no cap, so the UI only shows 1-500.
export const FOUNDING_MEMBER_LIMIT = 500

export function foundingMemberDisplay(foundingNumber) {
  const n = Number(foundingNumber)
  if (foundingNumber == null || !Number.isInteger(n) || n < 1 || n > FOUNDING_MEMBER_LIMIT) return null
  return { title: `Founding Member #${n}`, subtitle: 'Here since the beginning.' }
}
