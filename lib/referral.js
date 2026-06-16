import { supabase } from './supabase'
import { checkAndAwardPointMilestoneBadges } from './points'

const BONUS_PTS = 5

async function addBonusPoints(userId) {
  const { data: u } = await supabase
    .from('users')
    .select('lifetime_points')
    .eq('id', userId)
    .single()
  const newPts = (u?.lifetime_points ?? 0) + BONUS_PTS
  await supabase.from('users').update({ lifetime_points: newPts }).eq('id', userId)
  await checkAndAwardPointMilestoneBadges(userId, newPts)
}

/**
 * handleFirstCheckinReferralBonus(userId)
 *
 * Call after a user earns their first_checkin badge.
 * Awards BONUS_PTS to both the new user and their inviter (once only).
 * Never throws — swallows all errors so the check-in flow is unaffected.
 */
export async function handleFirstCheckinReferralBonus(userId) {
  if (!userId) return
  try {
    const { data: userData } = await supabase
      .from('users')
      .select('referred_by, display_name')
      .eq('id', userId)
      .single()

    const referrerId = userData?.referred_by ?? null
    if (!referrerId) return

    // Gate on bonus_awarded_at — only award once
    const { data: referral } = await supabase
      .from('invite_referrals')
      .select('id, bonus_awarded_at')
      .eq('invitee_user_id', userId)
      .single()

    if (!referral || referral.bonus_awarded_at != null) return

    const now = new Date().toISOString()

    await Promise.all([
      addBonusPoints(userId),
      addBonusPoints(referrerId),
      supabase
        .from('invite_referrals')
        .update({ first_checkin_at: now, bonus_awarded_at: now })
        .eq('id', referral.id),
    ])

    const inviteeName = userData?.display_name ?? 'Your friend'
    await supabase.from('notification_queue').insert([
      {
        type:      'invite_bonus',
        payload:   {
          to_user_id: userId,
          title:      'Welcome bonus 🎉',
          body:       'You and your friend both earned 5 bonus pts for checking off your first item.',
        },
        delivered: false,
      },
      {
        type:      'invite_bonus',
        payload:   {
          to_user_id: referrerId,
          title:      'Your invite paid off 🤝',
          body:       `${inviteeName} just checked off their first item. You both earned 5 bonus pts.`,
        },
        delivered: false,
      },
    ])
  } catch {
    // Non-critical — never break the check-in flow
  }
}

/**
 * recordReferral(inviteeUserId, referralCode)
 *
 * Called from JoinListScreen when a user opens a ref_ invite link.
 * Sets referred_by on the user and links the invite_referrals row.
 * Idempotent and never throws — never blocks the join flow.
 */
export async function recordReferral(inviteeUserId, referralCode) {
  if (!inviteeUserId || !referralCode) return
  try {
    const { data: referral } = await supabase
      .from('invite_referrals')
      .select('id, inviter_user_id, invitee_user_id')
      .eq('invite_code', referralCode)
      .single()

    if (!referral) return
    if (referral.inviter_user_id === inviteeUserId) return

    await supabase
      .from('users')
      .update({ referred_by: referral.inviter_user_id })
      .eq('id', inviteeUserId)
      .is('referred_by', null)

    if (!referral.invitee_user_id) {
      await supabase
        .from('invite_referrals')
        .update({ invitee_user_id: inviteeUserId })
        .eq('id', referral.id)
        .is('invitee_user_id', null)
    }
  } catch {
    // Non-critical
  }
}
