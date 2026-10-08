// Secret CheckOff — one layout for the locked and unlocked states:
//   1. photo hero (dark bottom gradient, safe-area-aware back control, small
//      status label)  2. venue name + short title  3. readable body +
//   compact status/points  4. one clear primary action (pinned above the tab
//   bar) with smaller secondary actions.
//
// Purely presentational: every decision (which photo, which copy, which
// actions) is made by lib/secretRevealModel.js and passed in; side effects
// (location, navigation, share, save) stay in screens/SecretRevealScreen.jsx.
import React, { useEffect, useRef } from 'react'
import {
  View, Text, Image, ScrollView, Animated, Easing, StyleSheet,
  TouchableOpacity, ActivityIndicator,
} from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import BookmarkIcon from '../BookmarkIcon'
import { revealHeadline, unlockedHeroHeight } from '../../lib/secretRevealModel'
import { shouldAnimateReveal } from '../../lib/secretRevealVisit'

export const COLORS = {
  BG: '#0F0F1E',
  NAVY: '#1A1A2E',
  GOLD: '#F5A623',
  PURPLE: '#8B5CF6',
  LAVENDER: '#D4BBFF',
  TEXT: '#FFFFFF',
  BODY: 'rgba(255,255,255,0.88)',
  MUTED: 'rgba(255,255,255,0.68)',
  LINE: 'rgba(255,255,255,0.12)',
  WARN: '#FFB84D',
  OK: '#4ADE9F',
}

const PRIMARY_LABELS = {
  directions: 'Get directions',
  settings: 'Open Settings',
  retry: 'Try again',
  checkoff: 'Check it off',
}

const SECONDARY = {
  directions: { icon: '⌖', label: 'Directions', a11y: 'Get directions' },
  website: { icon: '↗', label: 'Website', a11y: 'Visit website' },
  save: { label: 'Save', a11y: 'Save' },
  share: { icon: '⇪', label: 'Share', a11y: 'Share' },
}

function LockGlyph() {
  return (
    <View style={styles.lockGlyph}>
      <View style={styles.lockShackle} />
      <View style={styles.lockBody} />
    </View>
  )
}

function CheckGlyph() {
  return (
    <View style={styles.checkGlyph}><Text style={styles.checkGlyphText}>✓</Text></View>
  )
}

function BrandedHero() {
  // Zero-network fallback: purple depth + gold glow + "unlock radius" rings.
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient
        colors={['#3A2A78', '#1F1645', COLORS.BG]}
        locations={[0, 0.6, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.glowGold} />
      <View style={[styles.ring, { width: 120, height: 120, borderRadius: 60 }]} />
      <View style={[styles.ring, { width: 210, height: 210, borderRadius: 105 }]} />
      <View style={[styles.ring, { width: 310, height: 310, borderRadius: 155 }]} />
    </View>
  )
}

export default function SecretRevealView({
  phase,                 // 'locked' | 'revealed'
  venueName,             // string | null
  area,                  // string | null (neighborhood hint, never the venue)
  lockedTitle = "Something's hidden here",
  lockedBlurb,           // string (locked body copy)
  paragraphs = [],       // revealed description paragraphs
  status,                // lockedStatus() result (locked only)
  pointsText,            // '25 pts' | null
  requirementText,       // string | null (revealed only)
  lockedPhoto,           // { url } | null — business photo
  unlockedPhoto,         // { url } | null — approved experience photo
  onLockedPhotoError,
  onUnlockedPhotoError,
  plan,                  // { primary: {id}|null, secondary: string[] }
  saved = false,
  onBack,
  onPrimary,
  onSecondary,
  photoCTA = null,
  insets = { top: 0, bottom: 0 },
  footerBottomPad = 16,
  heroHeight = 300,
  reduceMotion = false,
}) {
  const revealed = phase === 'revealed'
  const lockedH = heroHeight + insets.top
  const unlockedH = unlockedHeroHeight(heroHeight) + insets.top
  const heroH = useRef(new Animated.Value(revealed ? unlockedH : lockedH)).current
  const mix = useRef(new Animated.Value(revealed ? 1 : 0)).current
  const contentIn = useRef(new Animated.Value(0)).current
  const cardIn = useRef(new Animated.Value(revealed ? 1 : 0)).current
  const glow = useRef(new Animated.Value(0)).current
  const prevPhase = useRef(phase)
  const mounted = useRef(false)
  const played = useRef(false) // the arrival plays at most once per mount (= per screen visit)

  useEffect(() => {
    const arrival = mounted.current && prevPhase.current !== phase && revealed
    mounted.current = true
    prevPhase.current = phase
    const settle = () => {
      heroH.setValue(revealed ? unlockedH : lockedH)
      mix.setValue(revealed ? 1 : 0)
      cardIn.setValue(revealed ? 1 : 0)
      glow.setValue(0)
    }
    if (shouldAnimateReveal({ arrival, alreadyPlayed: played.current, reduceMotion })) {
      played.current = true
      contentIn.setValue(1)
      cardIn.setValue(0)
      glow.setValue(0)
      const run = Animated.parallel([
        Animated.timing(heroH, { toValue: unlockedH, duration: 700, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }),
        Animated.timing(mix, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
        Animated.sequence([
          Animated.delay(320),
          Animated.parallel([
            Animated.spring(cardIn, { toValue: 1, friction: 7, tension: 70, useNativeDriver: true }),
            Animated.sequence([
              Animated.timing(glow, { toValue: 1, duration: 260, useNativeDriver: true }),
              Animated.timing(glow, { toValue: 0, duration: 900, useNativeDriver: true }),
            ]),
          ]),
        ]),
      ])
      run.start()
      return () => run.stop()
    }
    settle()
    if (reduceMotion || revealed) {
      contentIn.setValue(1)
      return undefined
    }
    contentIn.setValue(0)
    const fade = Animated.timing(contentIn, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true })
    fade.start()
    return () => fade.stop()
  }, [phase, reduceMotion, lockedH, unlockedH])

  // The unlocked photo fades in over the locked layer (business photo or
  // branded fallback). If it is the same url as the locked photo, one layer.
  const showUnlockedLayer = !!unlockedPhoto?.url && unlockedPhoto.url !== lockedPhoto?.url
  const baseUrl = revealed && !showUnlockedLayer ? (unlockedPhoto?.url ?? lockedPhoto?.url) : lockedPhoto?.url
  const unlockedScale = mix.interpolate({ inputRange: [0, 1], outputRange: [1.06, 1] })
  const contentStyle = {
    opacity: contentIn,
    transform: [{ translateY: contentIn.interpolate({ inputRange: [0, 1], outputRange: [reduceMotion ? 0 : 14, 0] }) }],
  }
  const cardStyle = {
    opacity: cardIn,
    transform: [
      { translateY: cardIn.interpolate({ inputRange: [0, 1], outputRange: [reduceMotion ? 0 : 30, 0] }) },
      { scale: cardIn.interpolate({ inputRange: [0, 1], outputRange: [reduceMotion ? 1 : 0.94, 1] }) },
    ],
  }

  const primaryId = plan?.primary?.id ?? null
  const primaryLabel = primaryId ? PRIMARY_LABELS[primaryId] : null

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {/* ── 1. Hero ── */}
        <Animated.View style={{ height: heroH, overflow: 'hidden' }}>
          <BrandedHero />
          {baseUrl ? (
            <Image
              source={{ uri: baseUrl }}
              resizeMode="cover"
              onError={revealed && !showUnlockedLayer && unlockedPhoto?.url === baseUrl ? onUnlockedPhotoError : onLockedPhotoError}
              style={StyleSheet.absoluteFill}
              accessibilityIgnoresInvertColors
            />
          ) : null}
          {showUnlockedLayer ? (
            <Animated.View style={[StyleSheet.absoluteFill, { opacity: mix, transform: [{ scale: unlockedScale }] }]}>
              <Image
                source={{ uri: unlockedPhoto.url }}
                resizeMode="cover"
                onError={onUnlockedPhotoError}
                style={StyleSheet.absoluteFill}
                accessibilityIgnoresInvertColors
              />
            </Animated.View>
          ) : null}
          <LinearGradient
            colors={['rgba(8,8,20,0.55)', 'rgba(8,8,20,0)']}
            style={styles.topScrim}
            pointerEvents="none"
          />
          <LinearGradient
            colors={['rgba(15,15,30,0)', 'rgba(15,15,30,0.78)', COLORS.BG]}
            locations={[0, 0.62, 1]}
            style={styles.bottomScrim}
            pointerEvents="none"
          />
          <View style={[styles.statusRow, { top: insets.top + 12 }]} pointerEvents="none">
            <View style={styles.statusPill}>
              {revealed ? <CheckGlyph /> : <LockGlyph />}
              <Text style={styles.statusPillText} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                {revealed ? 'Unlocked' : 'Locked'}
              </Text>
            </View>
          </View>
        </Animated.View>

        {/* ── 2 + 3. Venue / discovery card, body ── */}
        <View style={styles.content}>
          {revealed ? (
            <Animated.View style={[styles.discoveryCard, cardStyle]}>
              <Animated.View
                pointerEvents="none"
                style={[styles.discoveryGlow, { opacity: glow }]}
              />
              <View style={styles.eyebrowRow}>
                <CheckGlyph />
                <Text style={styles.eyebrow} maxFontSizeMultiplier={1.3}>SECRET UNLOCKED</Text>
              </View>
              <Text style={styles.discoveryHeadline} accessibilityRole="header" maxFontSizeMultiplier={1.35}>
                {revealHeadline(venueName)}
              </Text>
              <View style={styles.goldRule} />
              <View style={styles.paragraphs}>
                {paragraphs.map((p, i) => (
                  <Text key={i} style={styles.description} selectable maxFontSizeMultiplier={1.6}>{p}</Text>
                ))}
              </View>
            </Animated.View>
          ) : (
            <Animated.View style={contentStyle}>
              {venueName ? (
                <Text style={styles.venue} accessibilityRole="header" maxFontSizeMultiplier={1.4}>{venueName}</Text>
              ) : null}
              <Text style={[styles.title, !venueName && styles.titleAlone]} maxFontSizeMultiplier={1.4}>
                {lockedTitle}
              </Text>
              {area ? <Text style={styles.area} maxFontSizeMultiplier={1.4}>{area}</Text> : null}
              {lockedBlurb ? <Text style={styles.blurb}>{lockedBlurb}</Text> : null}
              <View
                style={styles.statusCard}
                accessible
                accessibilityLabel={`${status?.headline ?? ''}. ${status?.detail ?? ''}`}
              >
                <View style={styles.statusHead}>
                  {status?.kind === 'checking' ? (
                    <ActivityIndicator size="small" color={COLORS.LAVENDER} />
                  ) : (
                    <View style={[styles.statusDot, (status?.kind === 'denied' || status?.kind === 'nofix') && { backgroundColor: COLORS.WARN }]} />
                  )}
                  <Text
                    style={[styles.statusHeadline, status?.kind === 'far' && { color: COLORS.GOLD }]}
                    maxFontSizeMultiplier={1.4}
                  >
                    {status?.headline}
                  </Text>
                </View>
                {status?.detail ? <Text style={styles.statusDetail} maxFontSizeMultiplier={1.4}>{status.detail}</Text> : null}
              </View>
            </Animated.View>
          )}

          {/* Secondary actions: smaller, never competing with the primary */}
          <Animated.View style={[styles.secondaryRow, { opacity: revealed ? cardIn : contentIn }]}>
            {(plan?.secondary ?? []).map((id) => {
              const def = SECONDARY[id]
              if (!def) return null
              const label = id === 'save' ? (saved ? 'Saved' : 'Save') : def.label
              return (
                <TouchableOpacity
                  key={id}
                  style={styles.chip}
                  onPress={() => onSecondary?.(id)}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={id === 'save' ? (saved ? 'Remove from Saved' : 'Save') : def.a11y}
                  accessibilityState={id === 'save' ? { selected: saved } : undefined}
                >
                  {id === 'save'
                    ? <BookmarkIcon filled={saved} color={COLORS.GOLD} size={16} />
                    : <Text style={styles.chipIcon}>{def.icon}</Text>}
                  <Text style={styles.chipText} maxFontSizeMultiplier={1.25}>{label}</Text>
                </TouchableOpacity>
              )
            })}
          </Animated.View>
          {/* Admin/community photo contribution: last, below the reward and utilities */}
          {photoCTA ? <Animated.View style={[styles.ctaWrap, { opacity: revealed ? cardIn : contentIn }]}>{photoCTA}</Animated.View> : null}
        </View>
      </ScrollView>

      {/* ── 4. Primary action, pinned above the tab bar ── */}
      {primaryId ? (
        <View style={[styles.footer, { paddingBottom: footerBottomPad }]}>
          {revealed && requirementText ? (
            <Text style={styles.requirement} maxFontSizeMultiplier={1.35}>{requirementText}</Text>
          ) : null}
          <TouchableOpacity
            style={[styles.primary, primaryId !== 'checkoff' && styles.primaryCompact]}
            onPress={() => onPrimary?.(primaryId)}
            activeOpacity={0.88}
            accessibilityRole="button"
            accessibilityLabel={primaryId === 'checkoff' && pointsText ? `${primaryLabel}, ${pointsText}` : primaryLabel}
          >
            <Text style={styles.primaryText} maxFontSizeMultiplier={1.3}>
              {primaryLabel}
              {primaryId === 'checkoff' && pointsText ? <Text style={styles.primaryPts}>{`  ·  ${pointsText}`}</Text> : null}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Back control: fixed, safe-area aware, 44pt target */}
      <TouchableOpacity
        style={[styles.back, { top: insets.top + 6 }]}
        onPress={onBack}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Back"
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        <View style={styles.chevron} />
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.BG },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingBottom: 24 },

  glowGold: {
    position: 'absolute', top: -70, right: -50, width: 260, height: 260, borderRadius: 130,
    backgroundColor: COLORS.GOLD, opacity: 0.1,
  },
  ring: {
    position: 'absolute', alignSelf: 'center', top: '30%',
    borderWidth: 1, borderColor: 'rgba(212,187,255,0.16)',
  },
  topScrim: { position: 'absolute', top: 0, left: 0, right: 0, height: 120 },
  bottomScrim: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '70%' },

  back: {
    position: 'absolute', left: 16, width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(15,15,30,0.95)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center', justifyContent: 'center',
  },
  chevron: {
    width: 11, height: 11, borderLeftWidth: 2.5, borderBottomWidth: 2.5, borderColor: '#fff',
    transform: [{ rotate: '45deg' }], marginLeft: 4,
  },

  statusRow: { position: 'absolute', right: 16, left: 68, alignItems: 'flex-end' },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1, maxWidth: '100%',
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
    backgroundColor: 'rgba(15,15,30,0.68)', borderWidth: 1, borderColor: 'rgba(212,187,255,0.35)',
  },
  statusPillText: { fontSize: 12, fontWeight: '800', color: COLORS.LAVENDER, letterSpacing: 0.4, flexShrink: 1 },
  lockGlyph: { alignItems: 'center' },
  lockShackle: {
    width: 9, height: 7, borderTopLeftRadius: 5, borderTopRightRadius: 5,
    borderWidth: 2, borderBottomWidth: 0, borderColor: COLORS.LAVENDER, marginBottom: -1,
  },
  lockBody: { width: 14, height: 10, borderRadius: 3, backgroundColor: COLORS.LAVENDER },
  checkGlyph: {
    width: 16, height: 16, borderRadius: 8, backgroundColor: COLORS.GOLD,
    alignItems: 'center', justifyContent: 'center',
  },
  checkGlyphText: { fontSize: 10, fontWeight: '900', color: COLORS.NAVY, lineHeight: 12 },

  content: { paddingHorizontal: 20, marginTop: -32 },
  venue: { fontSize: 30, lineHeight: 36, fontWeight: '800', color: COLORS.TEXT, letterSpacing: -0.6 },
  title: { fontSize: 17, lineHeight: 23, fontWeight: '700', color: COLORS.LAVENDER, marginTop: 6 },
  titleAlone: { fontSize: 26, lineHeight: 32, color: COLORS.TEXT, marginTop: 0, fontWeight: '800' },
  area: { fontSize: 13, lineHeight: 18, color: COLORS.MUTED, marginTop: 4, fontWeight: '600' },

  discoveryCard: {
    marginTop: 4, padding: 20, borderRadius: 20,
    backgroundColor: 'rgba(245,166,35,0.07)', borderWidth: 1, borderColor: 'rgba(245,166,35,0.38)',
  },
  discoveryGlow: {
    ...StyleSheet.absoluteFillObject, borderRadius: 20, borderWidth: 2, borderColor: COLORS.GOLD,
    shadowColor: COLORS.GOLD, shadowOpacity: 0.8, shadowRadius: 18, shadowOffset: { width: 0, height: 0 },
  },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  eyebrow: { fontSize: 12, fontWeight: '800', color: COLORS.GOLD, letterSpacing: 1.2, flexShrink: 1 },
  discoveryHeadline: { fontSize: 24, lineHeight: 30, fontWeight: '800', color: COLORS.TEXT, letterSpacing: -0.3, marginTop: 10 },
  goldRule: { width: 36, height: 3, borderRadius: 2, backgroundColor: COLORS.GOLD, marginTop: 14 },
  paragraphs: { marginTop: 16, gap: 14 },
  description: { fontSize: 18, lineHeight: 28, color: COLORS.TEXT, textAlign: 'left' },
  ctaWrap: { marginTop: 4 },
  blurb: { fontSize: 15, lineHeight: 22, color: COLORS.BODY, marginTop: 14 },

  statusCard: {
    marginTop: 16, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: COLORS.LINE, gap: 6,
  },
  statusHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: COLORS.OK },
  statusHeadline: { fontSize: 18, lineHeight: 24, fontWeight: '800', color: COLORS.TEXT, flexShrink: 1 },
  statusDetail: { fontSize: 13, lineHeight: 19, color: COLORS.MUTED },

  secondaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 20 },
  chip: {
    flexGrow: 1, flexBasis: 72, minHeight: 56, alignItems: 'center', justifyContent: 'center',
    gap: 4, paddingHorizontal: 6, paddingVertical: 8, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: COLORS.LINE,
  },
  chipIcon: { fontSize: 16, color: COLORS.GOLD },
  chipText: { fontSize: 12, fontWeight: '700', color: COLORS.TEXT, textAlign: 'center' },

  footer: {
    paddingHorizontal: 20, paddingTop: 12, backgroundColor: COLORS.BG,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.LINE, gap: 10,
  },
  requirement: { fontSize: 13, lineHeight: 18, color: COLORS.MUTED, textAlign: 'center', fontWeight: '600' },
  primary: {
    minHeight: 56, borderRadius: 16, backgroundColor: COLORS.GOLD,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 14,
  },
  primaryCompact: { minHeight: 52 },
  primaryText: { fontSize: 17, fontWeight: '800', color: COLORS.NAVY, textAlign: 'center' },
  primaryPts: { fontSize: 15, fontWeight: '700', color: 'rgba(26,26,46,0.75)' },
})
