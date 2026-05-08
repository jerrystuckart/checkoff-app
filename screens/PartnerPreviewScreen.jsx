import React, { useState, useEffect } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, Share, Linking,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { supabase } from '../lib/supabase'

const AMBER  = '#F5A623'
const NAVY   = '#1A1A2E'
const GREEN  = '#1D9E75'
const BLUE   = '#378ADD'
const PURPLE = '#8B5CF6'

const PLAN_TIERS = [
  {
    id: 'partner',
    label: 'Partner',
    color: BLUE,
    monthly: 29,
    annual: 290,
    perMonth: 24,
    pts: 5,
    features: [
      'Your item placed on local lists',
      '5-point check-in for customers',
      'Neighborhood-level placement',
      'Monthly foot traffic report',
    ],
  },
  {
    id: 'rare',
    label: 'Rare',
    color: AMBER,
    monthly: 49,
    annual: 490,
    perMonth: 41,
    pts: 10,
    features: [
      'Everything in Partner',
      '10-point check-in — higher in lists',
      'Optional secret reveal experience',
      'Priority placement in Nearby feed',
    ],
    popular: true,
  },
  {
    id: 'legend',
    label: 'Legend',
    color: PURPLE,
    monthly: 99,
    annual: 990,
    perMonth: 83,
    pts: 25,
    features: [
      'Everything in Rare',
      '25-point check-in — top of lists',
      'Secret reveal with GPS unlock',
      'Year-round featured placement',
      'White-glove item setup',
    ],
  },
]

/**
 * PartnerPreviewScreen
 *
 * Two modes:
 *   1. Browse mode (no params) — shows all partner items grouped by neighborhood
 *   2. Preview mode (partner_id param) — shows a single partner's item as the
 *      business owner would see it. Used for founder pitch demos.
 *
 * Route params: { partner_id?: string, item_id?: string }
 */
export default function PartnerPreviewScreen({ route, navigation }) {
  const { partner_id, item_id } = route.params ?? {}
  const insets = useSafeAreaInsets()

  const [partnerItems, setPartnerItems] = useState([])
  const [loading, setLoading]           = useState(true)
  const [selectedItem, setSelectedItem] = useState(null)

  useEffect(() => { load() }, [partner_id, item_id])

  async function load() {
    setLoading(true)

    if (item_id) {
      // Single item preview mode
      const { data } = await supabase
        .from('items')
        .select(`
          id, body, checkin_type, ring_weight, maps_query, website_url,
          categories ( name, color_hex ),
          neighborhoods!items_neighborhood_id_fkey ( name, state )
        `)
        .eq('id', item_id)
        .single()
      if (data) setSelectedItem(data)
      setLoading(false)
      return
    }

    // Browse mode — load all active partner items
    let query = supabase
      .from('items')
      .select(`
        id, body, checkin_type, ring_weight, partner_id, maps_query, website_url,
        categories ( name, color_hex ),
        neighborhoods!items_neighborhood_id_fkey ( name, state )
      `)
      .eq('is_active', true)
      .not('partner_id', 'is', null)
      .order('body')

    if (partner_id) {
      query = query.eq('partner_id', partner_id)
    }

    const { data } = await query
    setPartnerItems(data ?? [])
    if (data?.length === 1) setSelectedItem(data[0])
    setLoading(false)
  }

  function pitchMessage(item) {
    const hood = item.neighborhoods?.name ?? 'your area'
    return `Hey! Your business is featured on CheckOff — the local experience app. People in ${hood} will see "${item.body}" on their list and come specifically to check it off. Download the app: https://checkoff.app`
  }

  async function sharePitch(item) {
    try {
      await Share.share({
        message: pitchMessage(item),
        title: 'Your business on CheckOff',
      })
    } catch(e) { /* cancelled */ }
  }

  function openDirections(item) {
    if (!item.maps_query) return
    const encoded = encodeURIComponent(item.maps_query)
    const url = `maps://?q=${encoded}`
    Linking.canOpenURL(url).then(ok =>
      Linking.openURL(ok ? url : `https://maps.google.com/?q=${encoded}`).catch(() => {})
    )
  }

  const RING_COLORS = ['#1D9E75','#378ADD','#BA7517','#D85A30']
  const RING_LABELS = ['Core — locals first','Near — easy drive','Metro — worth the trip','Destination — special occasion']

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={AMBER} size="large" />
      </View>
    )
  }

  // ── Single item demo view ──
  if (selectedItem) {
    const item      = selectedItem
    const ring      = item.ring_weight ?? 0
    const ringColor = RING_COLORS[ring] ?? RING_COLORS[0]
    const ringLabel = RING_LABELS[ring] ?? RING_LABELS[0]

    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
      >
        {/* Partner badge */}
        <View style={styles.partnerBadge}>
          <View style={styles.partnerDot} />
          <Text style={styles.partnerBadgeText}>Official CheckOff Partner</Text>
        </View>

        {/* The item as it appears on the list */}
        <View style={styles.itemCard}>
          <Text style={styles.itemCardLabel}>Your item on the list</Text>
          <View style={styles.tagRow}>
            <View style={[styles.tag, { backgroundColor: ringColor + '22' }]}>
              <Text style={[styles.tagText, { color: ringColor }]}>
                {item.ring_weight === 0 ? 'Top of list' : ringLabel.split(' — ')[0]}
              </Text>
            </View>
            {item.categories && (
              <View style={[styles.tag, { backgroundColor: item.categories.color_hex + '22' }]}>
                <Text style={[styles.tagText, { color: item.categories.color_hex }]}>
                  {item.categories.name}
                </Text>
              </View>
            )}
          </View>
          <Text style={styles.itemBody}>{item.body}</Text>
          {item.neighborhoods && (
            <Text style={styles.itemHood}>
              {item.neighborhoods.name}, {item.neighborhoods.state}
            </Text>
          )}
        </View>

        {/* Stats pitch */}
        <View style={styles.statsCard}>
          <Text style={styles.statsTitle}>What this means for your business</Text>
          <View style={styles.statRow}>
            <View style={[styles.statDot, { backgroundColor: ringColor }]} />
            <Text style={styles.statText}>
              <Text style={styles.statBold}>{ringLabel}</Text> — people in your neighborhood see your item first
            </Text>
          </View>
          <View style={styles.statRow}>
            <View style={[styles.statDot, { backgroundColor: AMBER }]} />
            <Text style={styles.statText}>
              <Text style={styles.statBold}>Intent-driven foot traffic</Text> — people come in specifically asking for this by name
            </Text>
          </View>
          <View style={styles.statRow}>
            <View style={[styles.statDot, { backgroundColor: GREEN }]} />
            <Text style={styles.statText}>
              <Text style={styles.statBold}>GPS verified check-ins</Text> — every visit is logged, you see the data
            </Text>
          </View>
          <View style={styles.statRow}>
            <View style={[styles.statDot, { backgroundColor: '#378ADD' }]} />
            <Text style={styles.statText}>
              <Text style={styles.statBold}>Loyalty built in</Text> — reward your regulars automatically
            </Text>
          </View>
        </View>

        {/* Action buttons */}
        {item.maps_query && (
          <TouchableOpacity style={styles.actionBtn} onPress={() => openDirections(item)}>
            <Text style={styles.actionBtnText}>⌖  Get directions to this location</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.actionBtn, styles.actionBtnPrimary]}
          onPress={() => sharePitch(item)}
        >
          <Text style={[styles.actionBtnText, { color: NAVY }]}>
            Share this preview with the business owner
          </Text>
        </TouchableOpacity>

        {/* ── Pricing tiers ── */}
        <View style={styles.pricingSection}>
          <Text style={styles.pricingTitle}>Ready to get on the list?</Text>
          <Text style={styles.pricingSub}>
            Pick a plan — sign up takes 2 minutes. Cancel anytime.
          </Text>

          {PLAN_TIERS.map(tier => (
            <View key={tier.id} style={[styles.tierCard, { borderColor: tier.color + '55' }, tier.popular && styles.tierCardPopular]}>
              {tier.popular && (
                <View style={[styles.popularBadge, { backgroundColor: tier.color }]}>
                  <Text style={styles.popularBadgeText}>Most popular</Text>
                </View>
              )}
              <View style={styles.tierHeader}>
                <View style={[styles.tierDot, { backgroundColor: tier.color }]} />
                <Text style={[styles.tierName, { color: tier.color }]}>{tier.label}</Text>
                <View style={{ flex: 1 }} />
                <Text style={styles.tierPrice}>${tier.monthly}<Text style={styles.tierPricePer}>/mo</Text></Text>
              </View>
              <Text style={styles.tierAnnual}>or ${tier.annual}/yr — save 2 months free</Text>
              <View style={styles.tierFeatures}>
                {tier.features.map((f, i) => (
                  <View key={i} style={styles.tierFeatureRow}>
                    <Text style={[styles.tierCheck, { color: tier.color }]}>✓</Text>
                    <Text style={styles.tierFeatureText}>{f}</Text>
                  </View>
                ))}
              </View>
              <TouchableOpacity
                style={[styles.tierBtn, { backgroundColor: tier.color }]}
                onPress={() => Linking.openURL('https://getcheckoff.com/partner').catch(() => {})}
              >
                <Text style={styles.tierBtnText}>Get started — {tier.label}</Text>
              </TouchableOpacity>
            </View>
          ))}

          <Text style={styles.pricingFootnote}>
            Secure payment via Stripe · 30-day money-back guarantee · No setup fees
          </Text>
        </View>

        {partnerItems.length > 1 && (
          <TouchableOpacity
            style={styles.backToList}
            onPress={() => setSelectedItem(null)}
          >
            <Text style={styles.backToListText}>← View all partner items</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    )
  }

  // ── Browse mode — all partner items ──
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
    >
      <Text style={styles.pageTitle}>Partner items</Text>
      <Text style={styles.pageSub}>
        {partnerItems.length} business{partnerItems.length !== 1 ? 'es' : ''} on the list
      </Text>

      {partnerItems.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>No partner items yet</Text>
          <Text style={styles.emptySub}>
            Add a partner_id to an item in the admin panel to feature it here.
          </Text>
        </View>
      ) : (
        partnerItems.map(item => {
          const ring      = item.ring_weight ?? 0
          const ringColor = RING_COLORS[ring]
          return (
            <TouchableOpacity
              key={item.id}
              style={styles.listRow}
              onPress={() => setSelectedItem(item)}
              activeOpacity={0.8}
            >
              <View style={[styles.ringIndicator, { backgroundColor: ringColor }]} />
              <View style={styles.listRowBody}>
                <Text style={styles.listRowText} numberOfLines={2}>{item.body}</Text>
                <Text style={styles.listRowHood}>
                  {item.neighborhoods?.name ?? 'No neighborhood'} · {item.categories?.name ?? 'Misc'}
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          )
        })
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#0F0F1E' },
  content:          { padding: 20, paddingBottom: 60 },
  center:           { alignItems: 'center', justifyContent: 'center', flex: 1 },

  partnerBadge:     { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  partnerDot:       { width: 8, height: 8, borderRadius: 4, backgroundColor: AMBER },
  partnerBadgeText: { fontSize: 12, color: AMBER, fontWeight: '700', letterSpacing: 0.5 },

  itemCard:         { backgroundColor: 'rgba(245,166,35,0.07)', borderRadius: 16, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(245,166,35,0.25)' },
  itemCardLabel:    { fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', marginBottom: 10 },
  tagRow:           { flexDirection: 'row', gap: 6, marginBottom: 12, flexWrap: 'wrap' },
  tag:              { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  tagText:          { fontSize: 11, fontWeight: '700' },
  itemBody:         { fontSize: 20, fontWeight: '700', color: '#fff', lineHeight: 26, marginBottom: 8 },
  itemHood:         { fontSize: 12, color: 'rgba(255,255,255,0.35)' },

  statsCard:        { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, padding: 18, marginBottom: 16, gap: 14 },
  statsTitle:       { fontSize: 13, fontWeight: '700', color: '#fff', marginBottom: 4 },
  statRow:          { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  statDot:          { width: 8, height: 8, borderRadius: 4, flexShrink: 0, marginTop: 4 },
  statText:         { fontSize: 13, color: 'rgba(255,255,255,0.5)', flex: 1, lineHeight: 19 },
  statBold:         { color: '#fff', fontWeight: '600' },

  actionBtn:        { backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 10, borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.12)' },
  actionBtnPrimary: { backgroundColor: AMBER, borderColor: AMBER },
  actionBtnText:    { fontSize: 14, fontWeight: '600', color: '#fff' },

  backToList:       { alignItems: 'center', paddingVertical: 14 },
  backToListText:   { fontSize: 13, color: 'rgba(255,255,255,0.4)' },

  pageTitle:        { fontSize: 22, fontWeight: '700', color: '#fff', marginBottom: 4 },
  pageSub:          { fontSize: 13, color: 'rgba(255,255,255,0.4)', marginBottom: 20 },

  listRow:          { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.07)' },
  ringIndicator:    { width: 4, height: 36, borderRadius: 2, flexShrink: 0 },
  listRowBody:      { flex: 1 },
  listRowText:      { fontSize: 13, color: '#fff', lineHeight: 18 },
  listRowHood:      { fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 3 },
  chevron:          { fontSize: 20, color: 'rgba(255,255,255,0.2)' },

  emptyWrap:        { paddingTop: 60, alignItems: 'center' },
  emptyTitle:       { fontSize: 16, fontWeight: '600', color: '#fff', marginBottom: 8 },
  emptySub:         { fontSize: 13, color: 'rgba(255,255,255,0.35)', textAlign: 'center', lineHeight: 19 },

  // ── Pricing section ──
  pricingSection:   { marginTop: 8 },
  pricingTitle:     { fontSize: 18, fontWeight: '800', color: '#fff', marginBottom: 6, textAlign: 'center' },
  pricingSub:       { fontSize: 13, color: 'rgba(255,255,255,0.4)', textAlign: 'center', marginBottom: 20, lineHeight: 18 },
  tierCard: {
    backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 16,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    padding: 18, marginBottom: 12, position: 'relative',
  },
  tierCardPopular: {
    backgroundColor: 'rgba(245,166,35,0.07)', borderColor: 'rgba(245,166,35,0.35)',
  },
  popularBadge: {
    position: 'absolute', top: -10, right: 16,
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999,
  },
  popularBadgeText: { fontSize: 10, fontWeight: '800', color: '#1A1A2E' },
  tierHeader:       { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  tierDot:          { width: 10, height: 10, borderRadius: 5 },
  tierName:         { fontSize: 16, fontWeight: '800' },
  tierPrice:        { fontSize: 22, fontWeight: '800', color: '#fff' },
  tierPricePer:     { fontSize: 13, fontWeight: '400', color: 'rgba(255,255,255,0.4)' },
  tierAnnual:       { fontSize: 11, color: 'rgba(255,255,255,0.35)', marginBottom: 14 },
  tierFeatures:     { gap: 8, marginBottom: 16 },
  tierFeatureRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  tierCheck:        { fontSize: 13, fontWeight: '800', lineHeight: 18 },
  tierFeatureText:  { fontSize: 13, color: 'rgba(255,255,255,0.65)', flex: 1, lineHeight: 18 },
  tierBtn:          { borderRadius: 10, padding: 14, alignItems: 'center' },
  tierBtnText:      { fontSize: 14, fontWeight: '800', color: '#fff' },
  pricingFootnote:  { fontSize: 11, color: 'rgba(255,255,255,0.25)', textAlign: 'center', marginTop: 8, marginBottom: 8, lineHeight: 16 },
})
