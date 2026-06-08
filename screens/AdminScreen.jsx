import { useState, useEffect, useCallback, memo, useRef } from 'react'
import {
  View,
  Text,
  Image,
  FlatList,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Modal,
  ScrollView,
  Share,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { supabase } from '../lib/supabase'

const AMBER = '#F5A623'
const NAVY = '#1A1A2E'
const RED = '#D85A30'
const GREEN = '#1D9E75'
const BLUE = '#378ADD'
const PURPLE = '#7A4DB3'

const RING_LABELS = [
  { value: 0, label: 'Core', desc: 'Local first', color: '#1D9E75' },
  { value: 1, label: 'Near', desc: 'Easy drive', color: '#378ADD' },
  { value: 2, label: 'Metro', desc: 'Worth the trip', color: '#BA7517' },
  { value: 3, label: 'Destination', desc: 'Special occasion', color: '#D85A30' },
]

const SEASON_OPTIONS = [
  { value: '', label: 'Year-round', color: 'rgba(255,255,255,0.5)' },
  { value: 'summer', label: 'Summer', color: '#F5A623' },
  { value: 'fall', label: 'Fall', color: '#D85A30' },
  { value: 'winter', label: 'Winter', color: '#378ADD' },
  { value: 'spring', label: 'Spring', color: '#1D9E75' },
]

const DIFFICULTY_TIERS = [
  { pts: 1,  label: 'Common',  color: '#6B7280', desc: 'Universal, no partner' },
  { pts: 5,  label: 'Partner', color: '#378ADD', desc: 'Location placement, no secret' },
  { pts: 10, label: 'Rare',    color: '#BA7517', desc: 'Special item, optional secret' },
  { pts: 25, label: 'Legend',  color: '#8B5CF6', desc: 'Secret reveal, year-round partner' },
]

const PARTNER_TIERS = [
  { value: 'partner', label: 'Partner', color: '#378ADD', pts: 5,  price: '$29/mo' },
  { value: 'rare',    label: 'Rare',    color: '#BA7517', pts: 10, price: '$49/mo' },
  { value: 'legend',  label: 'Legend',  color: '#8B5CF6', pts: 25, price: '$99/mo' },
]

const emptyItem = {
  body: '',
  category_id: '',
  neighborhood_id: '',
  is_universal: true,
  ring_weight: 0,
  difficulty: 1,
  photo_required: false,
  is_secret: false,
  secret_reveal_text: '',
  maps_lat: null,
  maps_lng: null,
  geo_radius_m: 100,
  season_tag: '',
  is_recurring: true,
  active_from: '',
  active_until: '',
  website_url: '',
  maps_query: '',
  checkin_type: 'tap',
  _metroId: '',
}

const emptyPartner = {
  business_name: '',
  contact_email: '',
  phone: '',
  plan_tier: 'partner',
  neighborhood_id: null,
  billing_start: '',
  is_active: true,
}

function seasonMeta(tag) {
  return SEASON_OPTIONS.find(s => s.value === (tag ?? '')) ?? SEASON_OPTIONS[0]
}

function toInputDate(value) {
  if (!value) return ''
  return String(value).slice(0, 10)
}

const ItemSeparator = () => <View style={styles.sep} />
const SmallSeparator = () => <View style={{ height: 6 }} />

const ModalShell = memo(function ModalShell({ visible, title, onCancel, onSave, saving, insetsTop, children }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={[styles.modal, { paddingTop: insetsTop + 16 }]}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onCancel}>
            <Text style={styles.modalCancel}>Cancel</Text>
          </TouchableOpacity>

          <Text style={styles.modalTitle}>{title}</Text>

          <TouchableOpacity onPress={onSave} disabled={saving}>
            {saving ? <ActivityIndicator color={AMBER} /> : <Text style={styles.modalSave}>Save</Text>}
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.modalBody} contentContainerStyle={{ paddingBottom: 80 }}>
          {children}
        </ScrollView>
      </View>
    </Modal>
  )
})

const NeighborhoodRingPicker = memo(function NeighborhoodRingPicker({ item, onChange, metros, neighborhoods }) {
  const metroId =
    item._metroId ||
    neighborhoods.find(n => n.id === item.neighborhood_id)?.metro_id ||
    ''

  function hoodsForMetro(metroId) {
    if (!metroId) return neighborhoods
    return neighborhoods.filter(n => n.metro_id === metroId)
  }

  return (
    <>
      <Text style={styles.fieldLabel}>Metro area</Text>
      <View style={styles.optionList}>
        {metros.map(m => (
          <TouchableOpacity
            key={m.id}
            style={[styles.option, metroId === m.id && styles.optionOn]}
            onPress={() => onChange({ ...item, _metroId: m.id, neighborhood_id: '' })}
          >
            <Text style={[styles.optionText, metroId === m.id && styles.optionTextOn]}>
              {m.name}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {metroId ? (
        <>
          <Text style={styles.fieldLabel}>Neighborhood</Text>
          <View style={styles.optionList}>
            {hoodsForMetro(metroId).map(n => (
              <TouchableOpacity
                key={n.id}
                style={[styles.option, item.neighborhood_id === n.id && styles.optionOn]}
                onPress={() => onChange({ ...item, neighborhood_id: n.id })}
              >
                <Text style={[styles.optionText, item.neighborhood_id === n.id && styles.optionTextOn]}>
                  {n.name}, {n.state}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      ) : null}

      <Text style={styles.fieldLabel}>Ring weight</Text>
      <Text style={styles.fieldHint}>
        Controls where this item appears in sorted feeds — Core shows first for locals, Destination for adventurous browsing.
      </Text>
      <View style={styles.ringRow}>
        {RING_LABELS.map(r => (
          <TouchableOpacity
            key={r.value}
            style={[
              styles.ringCard,
              item.ring_weight === r.value && { borderColor: r.color, borderWidth: 1.5 },
            ]}
            onPress={() => onChange({ ...item, ring_weight: r.value })}
          >
            <View style={[styles.ringDot, { backgroundColor: r.color }]} />
            <Text style={[styles.ringLabel, item.ring_weight === r.value && { color: r.color }]}>
              {r.label}
            </Text>
            <Text style={styles.ringDesc}>{r.desc}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.fieldLabel}>Season</Text>
      <Text style={styles.fieldHint}>
        Super Bowl party = Winter. State Fair = Fall. Popsicle on the curb = Summer. Year-round = no restriction.
      </Text>
      <View style={styles.segRow}>
        {SEASON_OPTIONS.map(s => {
          const selected = (item.season_tag ?? '') === s.value
          return (
            <TouchableOpacity
              key={s.value || 'year-round'}
              style={[styles.seg, selected && styles.segOn]}
              onPress={() => onChange({ ...item, season_tag: s.value })}
            >
              <Text style={[styles.segText, selected && styles.segTextOn]}>{s.label}</Text>
            </TouchableOpacity>
          )
        })}
      </View>

      <Text style={styles.fieldLabel}>Recurring?</Text>
      <Text style={styles.fieldHint}>
        One-time items can auto-deactivate after the end date passes.
      </Text>
      <View style={styles.segRow}>
        <TouchableOpacity
          style={[styles.seg, item.is_recurring !== false && styles.segOn]}
          onPress={() => onChange({ ...item, is_recurring: true })}
        >
          <Text style={[styles.segText, item.is_recurring !== false && styles.segTextOn]}>
            Every year
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.seg, item.is_recurring === false && styles.segOn]}
          onPress={() => onChange({ ...item, is_recurring: false })}
        >
          <Text style={[styles.segText, item.is_recurring === false && styles.segTextOn]}>
            One-time event
          </Text>
        </TouchableOpacity>
      </View>

      {(item.is_recurring === false || item.active_from || item.active_until) && (
        <>
          <Text style={styles.fieldLabel}>Date window (optional)</Text>
          <Text style={styles.fieldHint}>
            Leave blank for open-ended. One-time items deactivate automatically after the end date.
          </Text>

          <Text style={styles.fieldSubLabel}>Active from</Text>
          <TextInput
            style={styles.input}
            value={toInputDate(item.active_from)}
            onChangeText={v => onChange({ ...item, active_from: v })}
            placeholder="YYYY-MM-DD"
            placeholderTextColor="rgba(255,255,255,0.3)"
            autoCapitalize="none"
          />

          <Text style={styles.fieldSubLabel}>Active until</Text>
          <TextInput
            style={styles.input}
            value={toInputDate(item.active_until)}
            onChangeText={v => onChange({ ...item, active_until: v })}
            placeholder="YYYY-MM-DD"
            placeholderTextColor="rgba(255,255,255,0.3)"
            autoCapitalize="none"
          />
        </>
      )}

      <Text style={styles.fieldLabel}>Website URL (optional)</Text>
      <TextInput
        style={styles.input}
        value={item.website_url ?? ''}
        onChangeText={v => onChange({ ...item, website_url: v })}
        placeholder="https://rosiesbar.com"
        placeholderTextColor="rgba(255,255,255,0.3)"
        autoCapitalize="none"
      />

      <Text style={styles.fieldLabel}>Maps search (optional)</Text>
      <TextInput
        style={styles.input}
        value={item.maps_query ?? ''}
        onChangeText={v => onChange({ ...item, maps_query: v })}
        placeholder="Rosie's Bar Peoria AZ"
        placeholderTextColor="rgba(255,255,255,0.3)"
        autoCapitalize="none"
      />
      <Text style={styles.fieldHint}>
        Used for the "Get directions" button. Exact address or business name + city works fine.
      </Text>
    </>
  )
})

const ItemForm = memo(function ItemForm({ item, onChange, categories, neighborhoods, metros, geocoding, onGeocode, partners = [] }) {
  return (
    <>
      <Text style={styles.fieldLabel}>Item text</Text>
      <TextInput
        style={styles.textArea}
        value={item.body}
        onChangeText={v => onChange({ ...item, body: v })}
        multiline
        numberOfLines={3}
        placeholderTextColor="rgba(255,255,255,0.3)"
        placeholder="e.g. Order the Monkeypants — not on the menu"
      />

      <Text style={styles.fieldLabel}>Check-in type</Text>
      <View style={styles.segRow}>
        {['tap', 'photo', 'gps', 'qr'].map(t => (
          <TouchableOpacity
            key={t}
            style={[styles.seg, item.checkin_type === t && styles.segOn]}
            onPress={() => onChange({ ...item, checkin_type: t })}
          >
            <Text style={[styles.segText, item.checkin_type === t && styles.segTextOn]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.fieldLabel}>Scope</Text>
      <View style={styles.segRow}>
        <TouchableOpacity
          style={[styles.seg, item.is_universal && styles.segOn]}
          onPress={() =>
            onChange({
              ...item,
              is_universal: true,
              neighborhood_id: '',
              _metroId: '',
              ring_weight: 0,
            })
          }
        >
          <Text style={[styles.segText, item.is_universal && styles.segTextOn]}>Universal</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.seg, !item.is_universal && styles.segOn]}
          onPress={() => onChange({ ...item, is_universal: false })}
        >
          <Text style={[styles.segText, !item.is_universal && styles.segTextOn]}>Neighborhood</Text>
        </TouchableOpacity>
      </View>

      {!item.is_universal && (
        <NeighborhoodRingPicker item={item} onChange={onChange} metros={metros} neighborhoods={neighborhoods} />
      )}

      <Text style={styles.fieldLabel}>Category</Text>
      <View style={styles.optionList}>
        {categories.map(c => (
          <TouchableOpacity
            key={c.id}
            style={[styles.option, item.category_id === c.id && styles.optionOn]}
            onPress={() => onChange({ ...item, category_id: c.id })}
          >
            <View style={[styles.catDot, { backgroundColor: c.color_hex }]} />
            <Text style={[styles.optionText, item.category_id === c.id && styles.optionTextOn]}>
              {c.name}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.fieldLabel}>Active</Text>
      <View style={styles.segRow}>
        <TouchableOpacity
          style={[styles.seg, item.is_active !== false && styles.segOn]}
          onPress={() => onChange({ ...item, is_active: true })}
        >
          <Text style={[styles.segText, item.is_active !== false && styles.segTextOn]}>Active</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.seg, item.is_active === false && styles.segOn]}
          onPress={() => onChange({ ...item, is_active: false })}
        >
          <Text style={[styles.segText, item.is_active === false && styles.segTextOn]}>Inactive</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.fieldLabel}>Difficulty &amp; points</Text>
      <View style={{ gap: 8 }}>
        {DIFFICULTY_TIERS.map(t => (
          <TouchableOpacity
            key={t.pts}
            style={[styles.option, (item.difficulty ?? 1) === t.pts && { borderColor: t.color, backgroundColor: t.color + '18' }]}
            onPress={() => {
              const u = { ...item, difficulty: t.pts }
              if (t.pts === 25) { u.photo_required = true; u.is_secret = true }
              if (t.pts < 10)   { u.is_secret = false }
              onChange(u)
            }}
          >
            <View style={[styles.catDot, { backgroundColor: t.color }]} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.optionText, (item.difficulty ?? 1) === t.pts && { color: t.color, fontWeight: '700' }]}>
                {t.label} · {t.pts}pt{t.pts > 1 ? 's' : ''}
              </Text>
              <Text style={[styles.fieldHint, { marginBottom: 0, marginTop: 2 }]}>{t.desc}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.fieldLabel}>Photo required?</Text>
      <View style={styles.segRow}>
        <TouchableOpacity style={[styles.seg, item.photo_required && styles.segOn]} onPress={() => onChange({ ...item, photo_required: true })}>
          <Text style={[styles.segText, item.photo_required && styles.segTextOn]}>Required</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.seg, !item.photo_required && styles.segOn]} onPress={() => onChange({ ...item, photo_required: false })}>
          <Text style={[styles.segText, !item.photo_required && styles.segTextOn]}>Optional</Text>
        </TouchableOpacity>
      </View>

      {(item.difficulty ?? 1) >= 10 && (
        <>
          <Text style={styles.fieldLabel}>Secret item?</Text>
          <View style={styles.segRow}>
            <TouchableOpacity style={[styles.seg, item.is_secret && styles.segOn]} onPress={() => onChange({ ...item, is_secret: true, photo_required: true })}>
              <Text style={[styles.segText, item.is_secret && styles.segTextOn]}>🔒 Secret reveal</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.seg, !item.is_secret && styles.segOn]} onPress={() => onChange({ ...item, is_secret: false })}>
              <Text style={[styles.segText, !item.is_secret && styles.segTextOn]}>Visible</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.fieldHint}>Secret items show as "🔒 Secret item" until GPS confirms the user is at the location.</Text>

          {item.is_secret && (
            <>
              <Text style={styles.fieldLabel}>Reveal text <Text style={{ color: AMBER }}>★ required</Text></Text>
              <TextInput
                style={styles.textArea}
                value={item.secret_reveal_text ?? ''}
                onChangeText={v => onChange({ ...item, secret_reveal_text: v })}
                multiline numberOfLines={3}
                placeholderTextColor="rgba(255,255,255,0.3)"
                placeholder="Add an Egg to the OG Burger w/ Parm fries at Baba's Burgers and Birds"
              />
              <Text style={styles.fieldHint}>Shown only after GPS confirms the user is at the location. Make it specific and memorable.</Text>
            </>
          )}
        </>
      )}

      <Text style={styles.fieldLabel}>GPS coordinates</Text>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={item.maps_lat ? String(item.maps_lat) : ''}
          onChangeText={v => onChange({ ...item, maps_lat: parseFloat(v) || null })}
          placeholder="Latitude" placeholderTextColor="rgba(255,255,255,0.3)"
          keyboardType="decimal-pad"
        />
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={item.maps_lng ? String(item.maps_lng) : ''}
          onChangeText={v => onChange({ ...item, maps_lng: parseFloat(v) || null })}
          placeholder="Longitude" placeholderTextColor="rgba(255,255,255,0.3)"
          keyboardType="decimal-pad"
        />
        <TextInput
          style={[styles.input, { width: 72 }]}
          value={String(item.geo_radius_m ?? 100)}
          onChangeText={v => onChange({ ...item, geo_radius_m: parseInt(v) || 100 })}
          placeholder="100m" placeholderTextColor="rgba(255,255,255,0.3)"
          keyboardType="number-pad"
        />
      </View>
      <TouchableOpacity
        style={[styles.seg, { alignItems: 'center', opacity: geocoding ? 0.6 : 1 }]}
        onPress={() => onGeocode(item.maps_query, (lat, lng) => onChange({ ...item, maps_lat: lat, maps_lng: lng }))}
        disabled={geocoding}
      >
        <Text style={styles.segText}>{geocoding ? 'Looking up...' : '📍 Auto-fill from Maps search'}</Text>
      </TouchableOpacity>
      {item.maps_lat && item.maps_lng
        ? <Text style={[styles.fieldHint, { color: GREEN }]}>✓ GPS set: {Number(item.maps_lat).toFixed(5)}, {Number(item.maps_lng).toFixed(5)} · radius {item.geo_radius_m ?? 100}m</Text>
        : <Text style={styles.fieldHint}>Auto-fill from Maps search above, or enter lat/lng manually. For new businesses, right-click in Google Maps to copy coordinates.</Text>
      }

      {partners.length > 0 && (
        <>
          <Text style={styles.fieldLabel}>Partner (optional)</Text>
          <View style={styles.optionList}>
            <TouchableOpacity
              style={[styles.option, !item.partner_id && styles.optionOn]}
              onPress={() => onChange({ ...item, partner_id: null })}
            >
              <Text style={[styles.optionText, !item.partner_id && styles.optionTextOn]}>None</Text>
            </TouchableOpacity>
            {partners.filter(p => p.is_active).map(p => (
              <TouchableOpacity
                key={p.id}
                style={[styles.option, item.partner_id === p.id && styles.optionOn]}
                onPress={() => onChange({ ...item, partner_id: p.id })}
              >
                <Text style={[styles.optionText, item.partner_id === p.id && styles.optionTextOn]}>{p.business_name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}
    </>
  )
})

const PartnerForm = memo(function PartnerForm({ partner, onChange, neighborhoods }) {
  // Stateless -- AdminScreen owns partner state via editPartner / emptyPartner
  // Use functional updater so we always merge into the LATEST state, not the
  // potentially-stale `partner` prop captured at last render (avoids losing
  // typed email/phone when a tier or neighborhood button is tapped immediately after).
  function upd(patch) { onChange(prev => ({ ...prev, ...patch })) }

  return (
    <>
      <Text style={styles.fieldLabel}>Business name</Text>
      <TextInput style={styles.input} value={partner.business_name ?? ''} onChangeText={v => upd({ business_name: v })}
        placeholder="Joe's BBQ" placeholderTextColor="rgba(255,255,255,0.3)" />

      <Text style={styles.fieldLabel}>Contact email</Text>
      <TextInput style={styles.input} value={partner.contact_email ?? ''} onChangeText={v => upd({ contact_email: v })}
        placeholder="owner@joesbqq.com" placeholderTextColor="rgba(255,255,255,0.3)"
        autoCapitalize="none" keyboardType="email-address" />

      <Text style={styles.fieldLabel}>Phone (optional)</Text>
      <TextInput style={styles.input} value={partner.phone ?? ''} onChangeText={v => upd({ phone: v })}
        placeholder="602-555-1234" placeholderTextColor="rgba(255,255,255,0.3)" keyboardType="phone-pad" />

      <Text style={styles.fieldLabel}>Partnership tier</Text>
      {PARTNER_TIERS.map(t => (
        <TouchableOpacity key={t.value}
          style={[styles.option, partner.plan_tier === t.value && { borderColor: t.color, backgroundColor: t.color + '18' }]}
          onPress={() => upd({ plan_tier: t.value })}>
          <View style={[styles.catDot, { backgroundColor: t.color }]} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.optionText, partner.plan_tier === t.value && { color: t.color, fontWeight: '700' }]}>
              {t.label} · {t.pts}pts · {t.price}
            </Text>
          </View>
        </TouchableOpacity>
      ))}

      <Text style={styles.fieldLabel}>Neighborhood</Text>
      <View style={styles.optionList}>
        {neighborhoods.map(n => (
          <TouchableOpacity key={n.id}
            style={[styles.option, partner.neighborhood_id === n.id && styles.optionOn]}
            onPress={() => upd({ neighborhood_id: n.id })}>
            <Text style={[styles.optionText, partner.neighborhood_id === n.id && styles.optionTextOn]}>
              {n.name}, {n.state}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.fieldLabel}>Billing start (optional)</Text>
      <TextInput style={styles.input} value={toInputDate(partner.billing_start)}
        onChangeText={v => upd({ billing_start: v })}
        placeholder="YYYY-MM-DD" placeholderTextColor="rgba(255,255,255,0.3)" autoCapitalize="none" />

      <Text style={styles.fieldLabel}>Status</Text>
      <View style={styles.segRow}>
        <TouchableOpacity style={[styles.seg, partner.is_active !== false && styles.segOn]} onPress={() => upd({ is_active: true })}>
          <Text style={[styles.segText, partner.is_active !== false && styles.segTextOn]}>Active</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.seg, partner.is_active === false && styles.segOn]} onPress={() => upd({ is_active: false })}>
          <Text style={[styles.segText, partner.is_active === false && styles.segTextOn]}>Inactive</Text>
        </TouchableOpacity>
      </View>
    </>
  )
})

export default function AdminScreen() {
  const insets = useSafeAreaInsets()
  const navigation = useNavigation()

  // ── Tab ──
  const [adminTab, setAdminTab] = useState('items') // 'items' | 'lists' | 'partners' | 'suggestions'

  // ── Items tab state ──
  const [items, setItems] = useState([])
  const [metros, setMetros] = useState([])
  const [neighborhoods, setNeighborhoods] = useState([])
  const [categories, setCategories] = useState([])
  const [partners, setPartners] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterMetro, setFilterMetro] = useState('all')
  const [filterScope, setFilterScope] = useState('all')
  const [filterActive, setFilterActive] = useState('all')
  const [filterRing, setFilterRing] = useState('all')
  const [editItem, setEditItem] = useState(null)
  const [saving, setSaving] = useState(false)
  const [showAdd, setShowAdd] = useState(false)

  // ── Partners tab state ──
  const [editPartner, setEditPartner]   = useState(null)
  const [showAddPartner, setShowAddPartner] = useState(false)
  const [savingPartner, setSavingPartner]   = useState(false)
  // Ref always tracks the latest editPartner value so savePartnerRecord
  // never reads a stale closure (React may batch state updates and not
  // re-render ModalShell's onSave before the user taps Save).
  const editPartnerRef = useRef(null)
  const [geocoding, setGeocoding]           = useState(false)

  // ── Suggestions tab state ──
  const [suggestions, setSuggestions]               = useState([])
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)

  // ── Curated Lists tab state ──
  const [curatedLists, setCuratedLists]     = useState([])
  const [audienceGroups, setAudienceGroups] = useState([])
  const [selectedListId, setSelectedListId] = useState(null)
  const [curatedItems, setCuratedItems]     = useState([])
  const [loadingCurated, setLoadingCurated] = useState(false)
  const [loadingListItems, setLoadingListItems] = useState(false)
  const [pickerVisible, setPickerVisible]   = useState(false)
  const [pickerSearch, setPickerSearch]     = useState('')
  const [pickerSelected, setPickerSelected] = useState(new Set())
  const [addingItems, setAddingItems]       = useState(false)

  const [newItem, setNewItem] = useState(emptyItem)

  // Keep ref in sync — this runs synchronously after every render where
  // editPartner changed, so editPartnerRef.current is always fresh by the
  // time any user tap (Save) is processed by the JS thread.
  useEffect(() => {
    editPartnerRef.current = editPartner
  }, [editPartner])

  useEffect(() => {
    init()
  }, [])

  async function init() {
    setLoading(true)

    const [
      { data: itemData },
      { data: metroData },
      { data: hoodData },
      { data: catData },
      { data: partnerData },
    ] = await Promise.all([
      supabase
        .from('items')
        .select(`
          id, body, is_active, is_universal, checkin_type,
          ring_weight, difficulty, photo_required, is_secret,
          secret_reveal_text, maps_lat, maps_lng, geo_radius_m,
          season_tag, is_recurring, active_from, active_until,
          website_url, maps_query, partner_id, neighborhood_id, category_id,
          categories(name,color_hex),
          neighborhoods!items_neighborhood_id_fkey(name,metro_id,state)
        `)
        .order('body'),
      supabase.from('metro_areas').select('id, name').eq('is_active', true).order('name'),
      supabase.from('neighborhoods').select('id, name, metro_id, state').eq('is_active', true).order('name'),
      supabase.from('categories').select('id, name, color_hex').order('name'),
      supabase.from('partners').select('id,business_name,plan_tier,is_active,neighborhood_id,contact_email,phone,billing_start').order('business_name'),
    ])

    setItems(itemData ?? [])
    setMetros(metroData ?? [])
    setNeighborhoods(hoodData ?? [])
    setCategories(catData ?? [])
    setPartners(partnerData ?? [])
    setLoading(false)
  }

  const filtered = items.filter(item => {
    if (search && !item.body.toLowerCase().includes(search.toLowerCase())) return false
    if (filterScope === 'universal' && !item.is_universal) return false
    if (filterScope === 'neighborhood' && item.is_universal) return false
    if (filterActive === 'active' && !item.is_active) return false
    if (filterActive === 'inactive' && item.is_active) return false
    if (filterRing !== 'all' && String(item.ring_weight ?? 0) !== filterRing) return false

    if (filterMetro !== 'all') {
      const hood = neighborhoods.find(n => n.id === item.neighborhood_id)
      if (!item.is_universal && hood?.metro_id !== filterMetro) return false
      if (item.is_universal) return false
    }

    return true
  })

  const toggleActive = useCallback(async (item) => {
    const next = !item.is_active
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, is_active: next } : i))

    const { error } = await supabase
      .from('items')
      .update({ is_active: next })
      .eq('id', item.id)

    if (error) {
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, is_active: !next } : i))
      Alert.alert('Error', error.message)
    }
  }, [])

  async function saveEdit() {
    if (!editItem?.body?.trim()) {
      Alert.alert('Item text cannot be empty')
      return
    }

    setSaving(true)

    const updates = {
      body:               editItem.body.trim(),
      category_id:        editItem.category_id || null,
      is_universal:       editItem.is_universal,
      checkin_type:       editItem.checkin_type,
      ring_weight:        editItem.is_universal ? 0 : (editItem.ring_weight ?? 0),
      difficulty:         editItem.difficulty ?? 1,
      photo_required:     editItem.photo_required ?? false,
      is_secret:          editItem.is_secret ?? false,
      secret_reveal_text: editItem.is_secret ? (editItem.secret_reveal_text || null) : null,
      maps_lat:           editItem.maps_lat ?? null,
      maps_lng:           editItem.maps_lng ?? null,
      geo_radius_m:       (editItem.maps_lat && editItem.maps_lng) ? (editItem.geo_radius_m || 100) : null,
      season_tag:         editItem.season_tag || null,
      is_recurring:       editItem.is_recurring !== false,
      active_from:        editItem.active_from || null,
      active_until:       editItem.active_until || null,
      website_url:        editItem.website_url || null,
      maps_query:         editItem.maps_query || null,
      neighborhood_id:    editItem.is_universal ? null : (editItem.neighborhood_id || null),
      partner_id:         editItem.partner_id || null,
    }

    if (updates.is_secret) {
      if (!updates.secret_reveal_text) { Alert.alert('Secret items require reveal text'); setSaving(false); return }
      if (!updates.maps_lat || !updates.maps_lng) { Alert.alert('Secret items require GPS coordinates'); setSaving(false); return }
    }

    if (updates.checkin_type === 'gps') {
      if (!updates.maps_lat || !updates.maps_lng) { Alert.alert('GPS check-in requires coordinates'); setSaving(false); return }
    }

    const { error } = await supabase
      .from('items')
      .update(updates)
      .eq('id', editItem.id)

    setSaving(false)

    if (error) {
      Alert.alert('Save failed', error.message)
      return
    }

    const hood = neighborhoods.find(n => n.id === updates.neighborhood_id)
    const cat = categories.find(c => c.id === updates.category_id)

    setItems(prev =>
      prev.map(i =>
        i.id === editItem.id
          ? {
              ...i,
              ...updates,
              categories: cat ? { name: cat.name, color_hex: cat.color_hex } : null,
              neighborhoods: hood ? { name: hood.name, metro_id: hood.metro_id, state: hood.state } : null,
            }
          : i
      )
    )

    setEditItem(null)
  }

  const deleteItem = useCallback((item) => {
    Alert.alert(
      'Delete item?',
      `"${item.body.slice(0, 60)}"\n\nConsider deactivating instead — deletion is permanent.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete permanently',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase.from('items').delete().eq('id', item.id)
            if (error) Alert.alert('Error', error.message)
            else setItems(prev => prev.filter(i => i.id !== item.id))
          },
        },
      ]
    )
  }, [])

  async function addItem() {
    if (!newItem.body.trim()) {
      Alert.alert('Enter item text')
      return
    }

    setSaving(true)

    const { data, error } = await supabase
      .from('items')
      .insert({
        body:               newItem.body.trim(),
        category_id:        newItem.category_id || null,
        neighborhood_id:    newItem.is_universal ? null : (newItem.neighborhood_id || null),
        is_universal:       newItem.is_universal,
        ring_weight:        newItem.is_universal ? 0 : (newItem.ring_weight ?? 0),
        difficulty:         newItem.difficulty ?? 1,
        photo_required:     newItem.photo_required ?? false,
        is_secret:          newItem.is_secret ?? false,
        secret_reveal_text: newItem.is_secret ? (newItem.secret_reveal_text || null) : null,
        maps_lat:           newItem.maps_lat ?? null,
        maps_lng:           newItem.maps_lng ?? null,
        geo_radius_m:       (newItem.maps_lat && newItem.maps_lng) ? (newItem.geo_radius_m || 100) : null,
        season_tag:         newItem.season_tag || null,
        is_recurring:       newItem.is_recurring !== false,
        active_from:        newItem.active_from || null,
        active_until:       newItem.active_until || null,
        website_url:        newItem.website_url || null,
        maps_query:         newItem.maps_query || null,
        checkin_type:       newItem.checkin_type || 'tap',
        is_active:          true,
        is_approved:        true,
        partner_id:         newItem.partner_id || null,
      })
      .select(`
        id,
        body,
        is_active,
        is_universal,
        checkin_type,
        ring_weight,
        season_tag,
        is_recurring,
        active_from,
        active_until,
        website_url,
        maps_query,
        neighborhood_id,
        category_id,
        categories(name,color_hex),
        neighborhoods!items_neighborhood_id_fkey(name,metro_id,state)
      `)
      .single()

    setSaving(false)

    if (error) {
      Alert.alert('Error', error.message)
      return
    }

    setItems(prev => [...prev, data].sort((a, b) => a.body.localeCompare(b.body)))
    setNewItem(emptyItem)
    setShowAdd(false)
  }

  async function loadSuggestions() {
    setLoadingSuggestions(true)
    const { data, error } = await supabase
      .from('user_suggestions')
      .select('id, place_name, experience_body, website_url, status, created_at, metro_id, metro_areas(name)')
      .order('created_at', { ascending: false })
    if (error) {
      Alert.alert('Error loading suggestions', error.message)
    } else {
      setSuggestions(data ?? [])
    }
    setLoadingSuggestions(false)
  }

  function promptStatusChange(suggestion) {
    const STATUS_OPTIONS = [
      { label: 'New',              value: 'new' },
      { label: 'Reviewed',         value: 'reviewed' },
      { label: 'Add to pipeline',  value: 'added_to_pipeline' },
      { label: 'Add as item',      value: 'added_as_item' },
      { label: 'Reject',           value: 'rejected' },
    ]
    Alert.alert(
      suggestion.place_name,
      'Update status',
      [
        ...STATUS_OPTIONS
          .filter(o => o.value !== suggestion.status)
          .map(o => ({
            text: o.label,
            onPress: () => updateSuggestionStatus(suggestion.id, o.value),
          })),
        { text: 'Cancel', style: 'cancel' },
      ]
    )
  }

  async function updateSuggestionStatus(id, status) {
    const { error } = await supabase
      .from('user_suggestions')
      .update({ status })
      .eq('id', id)
    if (error) {
      Alert.alert('Error', error.message)
      return
    }
    setSuggestions(prev => prev.map(s => s.id === id ? { ...s, status } : s))
  }

  const geocodeAddress = useCallback(async (query, onResult) => {
    if (!query?.trim()) { Alert.alert('Enter a Maps search value first'); return }
    setGeocoding(true)
    try {
      const encoded = encodeURIComponent(query.trim())
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=1`,
        { headers: { 'Accept-Language': 'en', 'User-Agent': 'CheckOff-Admin/1.0' } }
      )
      const data = await res.json()
      if (!data?.length) {
        Alert.alert('Not found', `No location found for "${query}"\n\nTry adding city and state, or enter coordinates manually.`)
        return
      }
      const { lat, lon, display_name } = data[0]
      onResult(parseFloat(lat), parseFloat(lon))
      Alert.alert('📍 Location found', display_name.split(',').slice(0, 3).join(','))
    } catch (e) {
      Alert.alert('Geocoding failed', e.message)
    } finally {
      setGeocoding(false)
    }
  }, [])

  async function savePartnerRecord(partner) {
    if (!partner.business_name?.trim()) { Alert.alert('Business name required'); return }
    if (!partner.contact_email?.trim()) { Alert.alert('Contact email required'); return }
    setSavingPartner(true)

    const newEmail = partner.contact_email.trim().toLowerCase()
    const payload = {
      business_name:   partner.business_name.trim(),
      contact_email:   newEmail,
      phone:           partner.phone?.trim() || null,
      plan_tier:       partner.plan_tier ?? 'partner',
      neighborhood_id: partner.neighborhood_id || null,
      is_active:       partner.is_active !== false,
      billing_start:   partner.billing_start || null,
    }

    try {
      if (partner.id) {
        // Check if email changed — if so, use the edge function so both
        // partners.contact_email AND auth.users.email are updated together.
        // Without updating auth.users the partner can't log in with the new email.
        const existingPartner = partners.find(p => p.id === partner.id)
        const oldEmail = existingPartner?.contact_email?.trim().toLowerCase()
        const emailChanged = oldEmail && newEmail !== oldEmail

        if (emailChanged) {
          // Edge function handles BOTH tables atomically
          const { data: fnData, error: fnErr } = await supabase.functions.invoke('update-partner-email', {
            body: { partner_id: partner.id, new_email: newEmail },
          })
          if (fnErr) throw new Error(fnErr.message)
          if (fnData?.warning) {
            console.warn('update-partner-email warning:', fnData.warning)
          }
          // Update the remaining fields (everything except email) directly
          const { business_name, phone, plan_tier, neighborhood_id, is_active, billing_start } = payload
          const { error: restErr } = await supabase.from('partners')
            .update({ business_name, phone, plan_tier, neighborhood_id, is_active, billing_start })
            .eq('id', partner.id)
          if (restErr) throw restErr
        } else {
          // Email unchanged — simple direct update
          const { error } = await supabase.from('partners').update(payload).eq('id', partner.id)
          if (error) throw error
        }

        setPartners(prev => prev.map(p => p.id === partner.id ? { ...p, ...payload } : p))
        Alert.alert('Partner updated')
      } else {
        // New partner — just insert, no auth account exists yet
        const { data, error } = await supabase.from('partners')
          .insert(payload)
          .select('id,business_name,plan_tier,is_active,neighborhood_id,contact_email,phone,billing_start')
          .single()
        if (error) throw error
        setPartners(prev => [...prev, data].sort((a,b) => a.business_name.localeCompare(b.business_name)))
        Alert.alert('Partner added')
      }
      setEditPartner(null)
      setShowAddPartner(false)
    } catch (e) {
      Alert.alert('Save failed', e.message)
    } finally {
      setSavingPartner(false)
    }
  }

  async function deletePartner(partner) {
    Alert.alert('Remove partner?', `Remove "${partner.business_name}"? Items linked to this partner will be unlinked.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        const { error } = await supabase.from('partners').delete().eq('id', partner.id)
        if (error) { Alert.alert('Error', error.message); return }
        setPartners(prev => prev.filter(p => p.id !== partner.id))
      }},
    ])
  }

  const renderItem = useCallback(({ item }) => {
    const ring = RING_LABELS[item.ring_weight ?? 0] ?? RING_LABELS[0]
    const season = seasonMeta(item.season_tag)

    return (
      <View style={[styles.row, !item.is_active && styles.rowInactive]}>
        <TouchableOpacity
          style={[
            styles.activeDot,
            { backgroundColor: item.is_active ? GREEN : 'rgba(255,255,255,0.15)' },
          ]}
          onPress={() => toggleActive(item)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        />

        <TouchableOpacity style={styles.rowBody} onPress={() => setEditItem({ ...item })}>
          <Text style={[styles.itemText, !item.is_active && styles.itemTextInactive]} numberOfLines={2}>
            {item.body}
          </Text>

          <View style={styles.tagRow}>
            {item.categories && (
              <View style={[styles.tag, { backgroundColor: item.categories.color_hex + '28' }]}>
                <Text style={[styles.tagText, { color: item.categories.color_hex }]}>
                  {item.categories.name}
                </Text>
              </View>
            )}

            {item.is_universal ? (
              <View style={[styles.tag, { backgroundColor: '#1D9E7522' }]}>
                <Text style={[styles.tagText, { color: GREEN }]}>Universal</Text>
              </View>
            ) : (
              <>
                {item.neighborhoods && (
                  <View style={[styles.tag, { backgroundColor: '#378ADD22' }]}>
                    <Text style={[styles.tagText, { color: BLUE }]}>
                      {item.neighborhoods.name}
                    </Text>
                  </View>
                )}

                <View style={[styles.tag, { backgroundColor: ring.color + '22' }]}>
                  <Text style={[styles.tagText, { color: ring.color }]}>{ring.label}</Text>
                </View>
              </>
            )}

            <View style={[styles.tag, { backgroundColor: season.color + '22' }]}>
              <Text style={[styles.tagText, { color: season.color }]}>{season.label}</Text>
            </View>

            {item.is_recurring === false && (
              <View style={[styles.tag, { backgroundColor: '#FFF2DE' }]}>
                <Text style={[styles.tagText, { color: AMBER }]}>One-time</Text>
              </View>
            )}

            {!item.is_active && (
              <View style={[styles.tag, { backgroundColor: '#D85A3022' }]}>
                <Text style={[styles.tagText, { color: RED }]}>Inactive</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={styles.deleteBtn} onPress={() => deleteItem(item)}>
          <Text style={styles.deleteBtnText}>✕</Text>
        </TouchableOpacity>
      </View>
    )
  }, [toggleActive, deleteItem])

  // ── Curated Lists helpers ──
  async function loadCuratedLists() {
    setLoadingCurated(true)
    const [{ data: lists }, { data: groups }] = await Promise.all([
      supabase
        .from('curated_lists')
        .select('id, title, season, year, city_slug, audience_group_id, is_active')
        .order('city_slug', { ascending: true, nullsFirst: true }),
      supabase
        .from('audience_groups')
        .select('id, name, tagline, emoji, city_slug')
        .order('display_order'),
    ])
    setCuratedLists(lists ?? [])
    setAudienceGroups(groups ?? [])
    setLoadingCurated(false)
  }

  async function selectCuratedList(listId) {
    setSelectedListId(listId)
    setLoadingListItems(true)
    const { data } = await supabase
      .from('curated_list_items')
      .select('id, display_order, item_id, items(id, body, checkin_type, has_alcohol, categories(name, color_hex))')
      .eq('curated_list_id', listId)
      .order('display_order')
    setCuratedItems(data ?? [])
    setLoadingListItems(false)
  }

  async function removeCuratedItem(cliId) {
    Alert.alert('Remove item?', 'Remove from this curated list?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('curated_list_items').delete().eq('id', cliId)
          if (error) { Alert.alert('Error', error.message); return }
          setCuratedItems(prev => prev.filter(li => li.id !== cliId))
        },
      },
    ])
  }

  async function addPickedItemsToCuratedList() {
    if (!pickerSelected.size || !selectedListId) return
    setAddingItems(true)
    const maxOrder = curatedItems.reduce((m, li) => Math.max(m, li.display_order ?? 0), 0)
    const rows = [...pickerSelected].map((itemId, i) => ({
      curated_list_id: selectedListId,
      item_id: itemId,
      display_order: maxOrder + i + 1,
    }))
    const { data, error } = await supabase
      .from('curated_list_items')
      .insert(rows)
      .select('id, display_order, item_id, items(id, body, checkin_type, has_alcohol, categories(name, color_hex))')
    if (error) { Alert.alert('Error', error.message) }
    else {
      setCuratedItems(prev => [...prev, ...(data ?? [])])
      setPickerVisible(false)
      setPickerSelected(new Set())
      setPickerSearch('')
    }
    setAddingItems(false)
  }

  async function toggleCuratedActive(listId, active) {
    const { error } = await supabase.from('curated_lists').update({ is_active: active }).eq('id', listId)
    if (error) { Alert.alert('Error', error.message); return }
    setCuratedLists(prev => prev.map(l => l.id === listId ? { ...l, is_active: active } : l))
  }

  const SEASON_CLR = { summer: AMBER, fall: RED, winter: BLUE, spring: GREEN, anytime: '#7A4DB3' }
  const selectedList  = curatedLists.find(l => l.id === selectedListId)
  const selectedGroup = audienceGroups.find(g => g.id === selectedList?.audience_group_id)
  const existingIds   = new Set(curatedItems.map(li => li.item_id))

  // Filter picker items by the selected list's metro so admins only see
  // relevant items. Universal items always show. If no city_slug, show all.
  const listCitySlug = selectedList?.city_slug ?? null
  const pickerItems  = items.filter(i => {
    if (!i.is_active || existingIds.has(i.id)) return false
    if (pickerSearch && !i.body.toLowerCase().includes(pickerSearch.toLowerCase())) return false
    if (!listCitySlug) return true   // universal list — show everything
    if (i.is_universal) return true  // universal items always relevant
    // Match item's neighborhood metro to list's city_slug
    const hood  = neighborhoods.find(n => n.id === i.neighborhood_id)
    if (!hood) return false
    const metro = metros.find(m => m.id === hood.metro_id)
    return metro?.name?.toLowerCase().includes(listCitySlug.toLowerCase())
  })

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>

      {/* HEADER */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Admin</Text>
          <Text style={styles.headerSub}>
            {adminTab === 'items'
              ? `${filtered.length} of ${items.length} items`
              : adminTab === 'partners'
                ? `${partners.length} partners`
                : adminTab === 'suggestions'
                  ? `${suggestions.length} suggestions`
                  : `${curatedLists.length} curated lists`}
          </Text>
        </View>
        {adminTab === 'items' && (
          <TouchableOpacity style={styles.addBtn} onPress={() => setShowAdd(true)}>
            <Text style={styles.addBtnText}>+ Add item</Text>
          </TouchableOpacity>
        )}
        {adminTab === 'partners' && (
          <TouchableOpacity style={styles.addBtn} onPress={() => {
            setEditPartner({ ...emptyPartner })
            setShowAddPartner(true)
          }}>
            <Text style={styles.addBtnText}>+ Add partner</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* TAB ROW */}
      <View style={styles.tabRow}>
        {[['items', 'Items'], ['lists', 'Curated Lists'], ['partners', 'Partners'], ['suggestions', 'Suggestions']].map(([k, l]) => (
          <TouchableOpacity
            key={k}
            style={[styles.tabPill, adminTab === k && styles.tabPillOn]}
            onPress={() => {
              setAdminTab(k)
              if (k === 'lists' && curatedLists.length === 0) loadCuratedLists()
              if (k === 'suggestions') loadSuggestions()
            }}
          >
            <Text style={[styles.tabPillText, adminTab === k && styles.tabPillTextOn]}>{l}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ════════════════════════════════ */}
      {/* ITEMS TAB                        */}
      {/* ════════════════════════════════ */}
      {adminTab === 'items' && (
        <>
          <View style={styles.searchWrap}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search items…"
              placeholderTextColor="rgba(255,255,255,0.3)"
              value={search}
              onChangeText={setSearch}
              blurOnSubmit={false}
              autoCorrect={false}
            />
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.filterScroll}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 6 }}
          >
            <TouchableOpacity
              style={[styles.pill, filterMetro === 'all' && styles.pillOn]}
              onPress={() => setFilterMetro('all')}
            >
              <Text style={[styles.pillText, filterMetro === 'all' && styles.pillTextOn]}>All metros</Text>
            </TouchableOpacity>
            {metros.map(m => (
              <TouchableOpacity
                key={m.id}
                style={[styles.pill, filterMetro === m.id && styles.pillOn]}
                onPress={() => setFilterMetro(m.id)}
              >
                <Text style={[styles.pillText, filterMetro === m.id && styles.pillTextOn]}>{m.name}</Text>
              </TouchableOpacity>
            ))}
            <View style={styles.pillDivider} />
            {[['all','All'],['universal','Universal'],['neighborhood','Neighborhood']].map(([k,l]) => (
              <TouchableOpacity key={k} style={[styles.pill, filterScope === k && styles.pillOn]} onPress={() => setFilterScope(k)}>
                <Text style={[styles.pillText, filterScope === k && styles.pillTextOn]}>{l}</Text>
              </TouchableOpacity>
            ))}
            <View style={styles.pillDivider} />
            {[['all','All'],['active','Active'],['inactive','Inactive']].map(([k,l]) => (
              <TouchableOpacity key={k} style={[styles.pill, filterActive === k && styles.pillOn]} onPress={() => setFilterActive(k)}>
                <Text style={[styles.pillText, filterActive === k && styles.pillTextOn]}>{l}</Text>
              </TouchableOpacity>
            ))}
            <View style={styles.pillDivider} />
            <TouchableOpacity style={[styles.pill, filterRing === 'all' && styles.pillOn]} onPress={() => setFilterRing('all')}>
              <Text style={[styles.pillText, filterRing === 'all' && styles.pillTextOn]}>All rings</Text>
            </TouchableOpacity>
            {RING_LABELS.map(r => (
              <TouchableOpacity key={String(r.value)} style={[styles.pill, filterRing === String(r.value) && styles.pillOn]} onPress={() => setFilterRing(String(r.value))}>
                <Text style={[styles.pillText, filterRing === String(r.value) && styles.pillTextOn]}>{r.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={styles.hint}>Tap dot to toggle active · tap row to edit</Text>

          {loading ? (
            <View style={styles.center}><ActivityIndicator color={AMBER} /></View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={i => i.id}
              renderItem={renderItem}
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
              ItemSeparatorComponent={ItemSeparator}
              ListEmptyComponent={<View style={styles.center}><Text style={styles.emptyText}>No items match</Text></View>}
            />
          )}

          <ModalShell visible={!!editItem} title="Edit item" onCancel={() => setEditItem(null)} onSave={saveEdit} saving={saving} insetsTop={insets.top}>
            {editItem && (
              <>
                <ItemForm item={editItem} onChange={setEditItem} categories={categories} neighborhoods={neighborhoods} metros={metros} geocoding={geocoding} onGeocode={geocodeAddress} partners={partners} />
                <TouchableOpacity style={styles.dangerBtn} onPress={() => { setEditItem(null); deleteItem(editItem) }}>
                  <Text style={styles.dangerBtnText}>Delete this item permanently</Text>
                </TouchableOpacity>
              </>
            )}
          </ModalShell>

          <ModalShell visible={showAdd} title="New item" onCancel={() => setShowAdd(false)} onSave={addItem} saving={saving} insetsTop={insets.top}>
            <ItemForm item={newItem} onChange={setNewItem} categories={categories} neighborhoods={neighborhoods} metros={metros} geocoding={geocoding} onGeocode={geocodeAddress} partners={partners} />
          </ModalShell>
        </>
      )}

      {/* ════════════════════════════════ */}
      {/* CURATED LISTS TAB               */}
      {/* ════════════════════════════════ */}
      {adminTab === 'lists' && (
        <>
          {loadingCurated ? (
            <View style={styles.center}><ActivityIndicator color={AMBER} /></View>
          ) : (
            <View style={{ flex: 1, flexDirection: 'row' }}>

              {/* LEFT PANE — list cards */}
              <View style={styles.clLeftPane}>
                <FlatList
                  data={curatedLists}
                  keyExtractor={l => l.id}
                  contentContainerStyle={{ padding: 12, gap: 8 }}
                  ItemSeparatorComponent={SmallSeparator}
                  ListEmptyComponent={
                    <View style={styles.center}>
                      <Text style={styles.emptyText}>No curated lists yet</Text>
                    </View>
                  }
                  renderItem={({ item: cl }) => {
                    const group   = audienceGroups.find(g => g.id === cl.audience_group_id)
                    const sc      = SEASON_CLR[cl.season] ?? 'rgba(255,255,255,0.4)'
                    const isSelected = cl.id === selectedListId
                    return (
                      <TouchableOpacity
                        style={[styles.clCard, isSelected && styles.clCardSelected]}
                        onPress={() => selectCuratedList(cl.id)}
                        activeOpacity={0.85}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <Text style={{ fontSize: 20 }}>{group?.emoji ?? '📋'}</Text>
                          <Text style={[styles.clCardTitle, isSelected && { color: AMBER }]} numberOfLines={2}>
                            {cl.title}
                          </Text>
                          <View style={[styles.clActiveDot, { backgroundColor: cl.is_active ? GREEN : 'rgba(255,255,255,0.2)' }]} />
                        </View>
                        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                          {cl.season && (
                            <View style={[styles.clSeasonPill, { backgroundColor: sc + '22', borderColor: sc + '55' }]}>
                              <Text style={[styles.clSeasonPillText, { color: sc }]}>
                                {cl.season}{cl.year ? ` ${cl.year}` : ''}
                              </Text>
                            </View>
                          )}
                          <View style={[styles.clSeasonPill, cl.city_slug
                            ? { backgroundColor: 'rgba(55,138,221,0.15)', borderColor: 'rgba(55,138,221,0.3)' }
                            : { backgroundColor: 'rgba(29,158,117,0.15)', borderColor: 'rgba(29,158,117,0.3)' }
                          ]}>
                            <Text style={[styles.clSeasonPillText, { color: cl.city_slug ? BLUE : GREEN }]}>
                              {cl.city_slug ?? 'universal'}
                            </Text>
                          </View>
                        </View>
                      </TouchableOpacity>
                    )
                  }}
                />
              </View>

              {/* RIGHT PANE — selected list items */}
              <View style={styles.clRightPane}>
                {!selectedListId ? (
                  <View style={styles.center}>
                    <Text style={{ fontSize: 28, marginBottom: 8 }}>📋</Text>
                    <Text style={styles.emptyText}>Select a list to manage its items</Text>
                  </View>
                ) : (
                  <>
                    {/* Right pane header */}
                    <View style={styles.clRightHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.clRightTitle} numberOfLines={1}>
                          {selectedGroup?.emoji ?? '📋'}  {selectedList?.title ?? ''}
                        </Text>
                        <Text style={styles.clRightSub}>
                          {curatedItems.length} items · {selectedGroup?.tagline ?? ''}
                        </Text>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TouchableOpacity
                          style={styles.addBtn}
                          onPress={() => setPickerVisible(true)}
                        >
                          <Text style={styles.addBtnText}>+ Add</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.clToggleBtn}
                          onPress={() => toggleCuratedActive(selectedListId, !selectedList?.is_active)}
                        >
                          <Text style={styles.clToggleBtnText}>
                            {selectedList?.is_active ? 'Deactivate' : 'Activate'}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>

                    {/* Items list */}
                    {loadingListItems ? (
                      <View style={styles.center}><ActivityIndicator color={AMBER} /></View>
                    ) : (
                      <FlatList
                        data={curatedItems}
                        keyExtractor={li => li.id}
                        contentContainerStyle={{ padding: 12, paddingBottom: 40, gap: 6 }}
                        ItemSeparatorComponent={SmallSeparator}
                        ListEmptyComponent={
                          <View style={{ padding: 32, alignItems: 'center' }}>
                            <Text style={styles.emptyText}>No items yet — tap + Add</Text>
                          </View>
                        }
                        renderItem={({ item: li, index }) => {
                          const cat = li.items?.categories
                          return (
                            <View style={styles.clItemRow}>
                              <Text style={styles.clItemNum}>{index + 1}</Text>
                              <View style={{ flex: 1 }}>
                                <Text style={styles.clItemBody} numberOfLines={2}>
                                  {li.items?.body ?? ''}
                                </Text>
                                <View style={{ flexDirection: 'row', gap: 5, marginTop: 3, flexWrap: 'wrap' }}>
                                  {cat && (
                                    <View style={[styles.clTag, { backgroundColor: cat.color_hex + '28' }]}>
                                      <Text style={[styles.clTagText, { color: cat.color_hex }]}>{cat.name}</Text>
                                    </View>
                                  )}
                                  <View style={styles.clTag}>
                                    <Text style={styles.clTagText}>{li.items?.checkin_type ?? 'tap'}</Text>
                                  </View>
                                  {li.items?.has_alcohol && (
                                    <View style={[styles.clTag, { backgroundColor: AMBER + '22' }]}>
                                      <Text style={[styles.clTagText, { color: AMBER }]}>🍺 alcohol</Text>
                                    </View>
                                  )}
                                </View>
                              </View>
                              <TouchableOpacity
                                onPress={() => removeCuratedItem(li.id)}
                                style={styles.clRemoveBtn}
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                              >
                                <Text style={styles.clRemoveBtnText}>✕</Text>
                              </TouchableOpacity>
                            </View>
                          )
                        }}
                      />
                    )}
                  </>
                )}
              </View>
            </View>
          )}


          {/* ITEM PICKER MODAL */}
          <Modal visible={pickerVisible} animationType="slide" presentationStyle="pageSheet">
            <View style={[styles.modal, { paddingTop: insets.top + 16 }]}>
              <View style={styles.modalHeader}>
                <TouchableOpacity onPress={() => { setPickerVisible(false); setPickerSelected(new Set()); setPickerSearch('') }}>
                  <Text style={styles.modalCancel}>Cancel</Text>
                </TouchableOpacity>
                <View style={{ alignItems: 'center' }}>
                  <Text style={styles.modalTitle}>Add items</Text>
                  {listCitySlug && (
                    <Text style={{ fontSize: 10, color: AMBER, fontWeight: '700', marginTop: 2 }}>
                      {listCitySlug.charAt(0).toUpperCase() + listCitySlug.slice(1)} + universal
                    </Text>
                  )}
                </View>
                <TouchableOpacity onPress={addPickedItemsToCuratedList} disabled={addingItems || pickerSelected.size === 0}>
                  {addingItems
                    ? <ActivityIndicator color={AMBER} />
                    : <Text style={[styles.modalSave, pickerSelected.size === 0 && { opacity: 0.3 }]}>
                        Add {pickerSelected.size > 0 ? `(${pickerSelected.size})` : ''}
                      </Text>
                  }
                </TouchableOpacity>
              </View>

              <View style={{ paddingHorizontal: 20, paddingVertical: 10 }}>
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search items…"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  value={pickerSearch}
                  onChangeText={setPickerSearch}
                  autoFocus
                />
              </View>

              <FlatList
                data={pickerItems.slice(0, 150)}
                keyExtractor={i => i.id}
                contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
                ItemSeparatorComponent={ItemSeparator}
                ListEmptyComponent={
                  <View style={styles.center}>
                    <Text style={styles.emptyText}>No items match</Text>
                  </View>
                }
                renderItem={({ item }) => {
                  const isChosen = pickerSelected.has(item.id)
                  const cat = categories.find(c => c.id === item.category_id)
                  return (
                    <TouchableOpacity
                      style={[styles.clPickerRow, isChosen && styles.clPickerRowOn]}
                      onPress={() => {
                        const next = new Set(pickerSelected)
                        isChosen ? next.delete(item.id) : next.add(item.id)
                        setPickerSelected(next)
                      }}
                      activeOpacity={0.8}
                    >
                      <View style={[styles.clPickerCheck, isChosen && styles.clPickerCheckOn]}>
                        {isChosen && <Text style={{ color: NAVY, fontSize: 10, fontWeight: '900' }}>✓</Text>}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.itemText} numberOfLines={2}>{item.body}</Text>
                        {cat && <Text style={[styles.tagText, { color: cat.color_hex, marginTop: 2 }]}>{cat.name}</Text>}
                      </View>
                      <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>{item.checkin_type}</Text>
                    </TouchableOpacity>
                  )
                }}
              />
            </View>
          </Modal>
        </>
      )}

      {/* ════════════════════════════════ */}
      {/* PARTNERS TAB                     */}
      {/* ════════════════════════════════ */}
      {adminTab === 'partners' && (
        <>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>

            {/* ── Onboarding QR card ── */}
            <View style={styles.qrCard}>
              <View style={{ flex: 1, paddingRight: 16 }}>
                <Text style={styles.qrCardTitle}>Onboard new partners</Text>
                <Text style={styles.qrCardSub}>
                  Show this QR in person or share the link — businesses can sign up and pay in under 2 minutes.
                </Text>
                <Text style={styles.qrCardUrl}>getcheckoff.com/pricing</Text>
                <TouchableOpacity
                  style={styles.sharePartnerBtn}
                  onPress={() => Share.share({
                    message: 'Get your business on CheckOff → https://getcheckoff.com/pricing',
                    url: 'https://getcheckoff.com/pricing',
                  })}
                >
                  <Text style={styles.sharePartnerBtnText}>Share link  ↗</Text>
                </TouchableOpacity>
              </View>
              <Image
                source={{ uri: 'https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=https%3A%2F%2Fgetcheckoff.com%2Fpricing&margin=6' }}
                style={styles.qrImage}
              />
            </View>

            {partners.length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: 32 }}>
                <Text style={styles.emptyText}>No partners yet — tap + Add partner</Text>
              </View>
            ) : (
              partners.map(p => {
                const tier = PARTNER_TIERS.find(t => t.value === p.plan_tier) ?? PARTNER_TIERS[0]
                const hood = neighborhoods.find(n => n.id === p.neighborhood_id)
                const assignedItems = items.filter(i => i.partner_id === p.id)
                const secretItems   = assignedItems.filter(i => i.is_secret)
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.partnerCard, !p.is_active && { opacity: 0.5 }]}
                    onPress={() => { setEditPartner({ ...p }); setShowAddPartner(false) }}
                    activeOpacity={0.85}
                  >
                    <View style={[styles.partnerTierBar, { backgroundColor: tier.color }]} />
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <Text style={styles.partnerName}>{p.business_name}</Text>
                        <View style={[styles.tag, { backgroundColor: tier.color + '22' }]}>
                          <Text style={[styles.tagText, { color: tier.color }]}>{tier.label}</Text>
                        </View>
                        {!p.is_active && (
                          <View style={[styles.tag, { backgroundColor: '#D85A3022' }]}>
                            <Text style={[styles.tagText, { color: RED }]}>Inactive</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.partnerMeta}>
                        {hood ? hood.name + ', ' + hood.state : 'No neighborhood'} ·
                        {' '}{assignedItems.length} item{assignedItems.length !== 1 ? 's' : ''}
                        {secretItems.length ? ' · 🔒 ' + secretItems.length + ' secret' : ''}
                      </Text>
                      <Text style={styles.partnerMeta}>{p.contact_email}</Text>
                    </View>
                    <View style={{ gap: 6, alignItems: 'flex-end' }}>
                      <TouchableOpacity
                        style={styles.pitchBtn}
                        onPress={() => navigation.navigate('PartnerPreview', { partner_id: p.id })}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Text style={styles.pitchBtnText}>Pitch ›</Text>
                      </TouchableOpacity>
                    </View>
                  </TouchableOpacity>
                )
              })
            )}
          </ScrollView>

          {/* ADD PARTNER MODAL — outside ScrollView so it can render properly */}
          <ModalShell
            visible={showAddPartner}
            title="Add partner"
            onCancel={() => { setShowAddPartner(false); setEditPartner(null) }}
            onSave={() => editPartnerRef.current && savePartnerRecord(editPartnerRef.current)}
            saving={savingPartner}
            insetsTop={insets.top}
          >
            {showAddPartner && (
              <PartnerForm
                partner={editPartner ?? emptyPartner}
                onChange={setEditPartner}
                neighborhoods={neighborhoods}
              />
            )}
          </ModalShell>

          {/* EDIT PARTNER MODAL — outside ScrollView so it can render properly */}
          <ModalShell
            visible={!!editPartner && !showAddPartner}
            title="Edit partner"
            onCancel={() => setEditPartner(null)}
            onSave={() => editPartnerRef.current && savePartnerRecord(editPartnerRef.current)}
            saving={savingPartner}
            insetsTop={insets.top}
          >
            {!!editPartner && !showAddPartner && (
              <>
                <PartnerForm partner={editPartner} onChange={setEditPartner} neighborhoods={neighborhoods} />
                <TouchableOpacity style={styles.dangerBtn} onPress={() => { setEditPartner(null); deletePartner(editPartner) }}>
                  <Text style={styles.dangerBtnText}>Remove this partner</Text>
                </TouchableOpacity>
              </>
            )}
          </ModalShell>
        </>
      )}

      {/* ════════════════════════════════ */}
      {/* SUGGESTIONS TAB                  */}
      {/* ════════════════════════════════ */}
      {adminTab === 'suggestions' && (
        loadingSuggestions ? (
          <View style={styles.center}><ActivityIndicator color={AMBER} /></View>
        ) : (
          <FlatList
            data={suggestions}
            keyExtractor={s => s.id}
            contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
            ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
            ListEmptyComponent={
              <View style={styles.center}>
                <Text style={{ fontSize: 28, marginBottom: 8 }}>📭</Text>
                <Text style={styles.emptyText}>No suggestions yet</Text>
                <Text style={[styles.emptyText, { marginTop: 4, fontSize: 12 }]}>
                  They'll appear here when users submit places from any list.
                </Text>
              </View>
            }
            ListHeaderComponent={
              suggestions.length > 0 ? (
                <Text style={[styles.hint, { marginBottom: 12 }]}>
                  Tap a card to update status · every submission is a warm partner lead
                </Text>
              ) : null
            }
            renderItem={({ item: s }) => {
              const STATUS_COLOR = {
                new:                AMBER,
                reviewed:           BLUE,
                added_to_pipeline:  GREEN,
                added_as_item:      PURPLE,
                rejected:           'rgba(255,255,255,0.25)',
              }
              const STATUS_LABEL = {
                new:                'New',
                reviewed:           'Reviewed',
                added_to_pipeline:  'In pipeline',
                added_as_item:      'Added as item',
                rejected:           'Rejected',
              }
              const color = STATUS_COLOR[s.status] ?? AMBER
              const date  = new Date(s.created_at).toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric',
              })
              return (
                <TouchableOpacity
                  style={styles.suggCard}
                  onPress={() => promptStatusChange(s)}
                  activeOpacity={0.85}
                >
                  <View style={styles.suggCardTop}>
                    <Text style={styles.suggCardName}>{s.place_name}</Text>
                    <View style={[styles.suggStatusPill, { borderColor: color + '60', backgroundColor: color + '18' }]}>
                      <Text style={[styles.suggStatusText, { color }]}>
                        {STATUS_LABEL[s.status] ?? s.status}
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.suggCardExp} numberOfLines={3}>
                    {s.experience_body}
                  </Text>

                  <View style={styles.suggCardMeta}>
                    {s.metro_areas?.name && (
                      <Text style={styles.suggMetaText}>📍 {s.metro_areas.name}</Text>
                    )}
                    {s.website_url ? (
                      <Text style={styles.suggMetaLink} numberOfLines={1}>
                        🔗 {s.website_url.replace(/^https?:\/\//, '')}
                      </Text>
                    ) : null}
                    <Text style={styles.suggMetaText}>{date}</Text>
                  </View>
                </TouchableOpacity>
              )
            }}
          />
        )
      )}

    </View>
  )
}


const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F0F1E' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#fff' },
  headerSub: { fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 },

  tabRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 10 },
  tabPill: {
    paddingHorizontal: 16, paddingVertical: 7, borderRadius: 999,
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.15)', backgroundColor: 'rgba(255,255,255,0.04)',
  },
  tabPillOn: { backgroundColor: '#F5A623', borderColor: '#F5A623' },
  tabPillText: { fontSize: 13, color: 'rgba(255,255,255,0.5)', fontWeight: '600' },
  tabPillTextOn: { color: '#1A1A2E', fontWeight: '800' },

  addBtn: { backgroundColor: '#F5A623', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  addBtnText: { fontSize: 13, fontWeight: '700', color: '#1A1A2E' },

  searchWrap: { paddingHorizontal: 16, marginBottom: 8 },
  searchInput: {
    backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 9, color: '#fff', fontSize: 14,
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.1)',
  },
  filterScroll: { maxHeight: 48, marginBottom: 4 },
  pill: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.15)', backgroundColor: 'rgba(255,255,255,0.04)',
  },
  pillOn: { backgroundColor: '#F5A623', borderColor: '#F5A623' },
  pillText: { fontSize: 12, color: 'rgba(255,255,255,0.5)', fontWeight: '500' },
  pillTextOn: { color: '#1A1A2E', fontWeight: '700' },
  pillDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.12)', marginHorizontal: 4 },
  hint: { fontSize: 10, color: 'rgba(255,255,255,0.25)', paddingHorizontal: 16, marginBottom: 8, marginTop: 4 },

  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 12 },
  rowInactive: { opacity: 0.45 },
  activeDot: { width: 12, height: 12, borderRadius: 6, flexShrink: 0 },
  rowBody: { flex: 1 },
  itemText: { fontSize: 15, color: '#fff', lineHeight: 18 },
  itemTextInactive: { color: 'rgba(255,255,255,0.45)' },
  tagRow: { flexDirection: 'row', gap: 5, marginTop: 4, flexWrap: 'wrap' },
  tag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  tagText: { fontSize: 10, fontWeight: '600', color: 'rgba(255,255,255,0.4)' },
  deleteBtn: { padding: 6 },
  deleteBtnText: { fontSize: 14, color: 'rgba(255,255,255,0.2)' },
  sep: { height: 0.5, backgroundColor: 'rgba(255,255,255,0.07)' },
  emptyText: { color: 'rgba(255,255,255,0.35)', fontSize: 14 },

  modal: { flex: 1, backgroundColor: '#0F0F1E' },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingBottom: 16,
    borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  modalTitle: { fontSize: 15, fontWeight: '700', color: '#fff' },
  modalCancel: { fontSize: 15, color: 'rgba(255,255,255,0.5)' },
  modalSave: { fontSize: 15, fontWeight: '700', color: '#F5A623' },
  modalBody: { flex: 1, paddingHorizontal: 20, paddingTop: 20 },

  fieldLabel: {
    fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.4)', marginBottom: 6, marginTop: 20,
  },
  fieldSubLabel: { fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.45)', marginBottom: 6, marginTop: 12 },
  fieldHint: { fontSize: 11, color: 'rgba(255,255,255,0.28)', marginBottom: 10, lineHeight: 15 },
  textArea: {
    backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, color: '#fff', fontSize: 15,
    lineHeight: 22, borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.15)', minHeight: 80, textAlignVertical: 'top',
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, color: '#fff', fontSize: 14,
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.15)',
  },
  segRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  seg: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8,
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.15)', backgroundColor: 'rgba(255,255,255,0.05)',
  },
  segOn: { backgroundColor: '#F5A623', borderColor: '#F5A623' },
  segText: { fontSize: 13, color: 'rgba(255,255,255,0.55)', fontWeight: '500' },
  segTextOn: { color: '#1A1A2E', fontWeight: '700' },
  optionList: { gap: 6 },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10,
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.04)',
  },
  optionOn: { borderColor: '#F5A623', backgroundColor: 'rgba(245,166,35,0.1)' },
  optionText: { fontSize: 14, color: 'rgba(255,255,255,0.55)' },
  optionTextOn: { color: '#F5A623', fontWeight: '600' },
  catDot: { width: 8, height: 8, borderRadius: 4 },
  ringRow: { flexDirection: 'row', gap: 8 },
  ringCard: {
    flex: 1, padding: 10, borderRadius: 10, borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(255,255,255,0.04)', alignItems: 'center', gap: 4,
  },
  ringDot: { width: 8, height: 8, borderRadius: 4 },
  ringLabel: { fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.6)' },
  ringDesc: { fontSize: 9, color: 'rgba(255,255,255,0.3)', textAlign: 'center' },
  dangerBtn: { marginTop: 32, padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#D85A3055', alignItems: 'center' },
  dangerBtnText: { fontSize: 14, color: '#D85A30', fontWeight: '600' },

  partnerCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 14,
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.1)',
    padding: 14, marginBottom: 10,
  },
  partnerTierBar: { width: 4, height: 48, borderRadius: 2, flexShrink: 0 },
  partnerName:    { fontSize: 14, fontWeight: '700', color: '#fff' },
  partnerMeta:    { fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 },
  pitchBtn:       { backgroundColor: AMBER, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  pitchBtnText:   { fontSize: 11, fontWeight: '800', color: NAVY },

  // ── Curated Lists ──
  clLeftPane: { width: 200, borderRightWidth: 0.5, borderRightColor: 'rgba(255,255,255,0.08)', backgroundColor: 'rgba(255,255,255,0.01)' },
  clRightPane: { flex: 1 },
  clCard: { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: 10, borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.08)' },
  clCardSelected: { borderColor: '#F5A623', backgroundColor: 'rgba(245,166,35,0.07)' },
  clCardTitle: { flex: 1, fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.85)', lineHeight: 16 },
  clActiveDot: { width: 7, height: 7, borderRadius: 3.5, flexShrink: 0 },
  clSeasonPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, borderWidth: 0.5 },
  clSeasonPillText: { fontSize: 10, fontWeight: '700' },
  clRightHeader: {
    flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 12, paddingVertical: 12,
    borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.08)', gap: 10,
  },
  clRightTitle: { fontSize: 14, fontWeight: '800', color: '#fff', marginBottom: 3 },
  clRightSub: { fontSize: 11, color: 'rgba(255,255,255,0.4)' },
  clToggleBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.2)' },
  clToggleBtnText: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.5)' },
  clItemRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 10, paddingVertical: 10, borderRadius: 8,
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.07)', backgroundColor: 'rgba(255,255,255,0.02)',
  },
  clItemNum: { fontSize: 11, color: 'rgba(255,255,255,0.25)', fontWeight: '700', minWidth: 20, textAlign: 'right' },
  clItemBody: { fontSize: 13, color: '#fff', lineHeight: 18 },
  clTag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.07)' },
  clTagText: { fontSize: 10, fontWeight: '600', color: 'rgba(255,255,255,0.4)' },
  clRemoveBtn: { padding: 4 },
  clRemoveBtnText: { fontSize: 13, color: 'rgba(255,255,255,0.2)' },
  clPickerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 4 },
  clPickerRowOn: { backgroundColor: 'rgba(245,166,35,0.06)', borderRadius: 8, paddingHorizontal: 8 },
  clPickerCheck: {
    width: 20, height: 20, borderRadius: 5, borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  clPickerCheckOn: { backgroundColor: '#F5A623', borderColor: '#F5A623' },

  // ── Partner onboarding QR card ──
  qrCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(245,166,35,0.08)', borderRadius: 16,
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.25)',
    padding: 16, marginBottom: 20,
  },
  qrCardTitle: { fontSize: 15, fontWeight: '800', color: '#fff', marginBottom: 6 },
  qrCardSub:   { fontSize: 12, color: 'rgba(255,255,255,0.45)', lineHeight: 17, marginBottom: 10 },
  qrCardUrl:   { fontSize: 11, color: '#F5A623', fontWeight: '700', marginBottom: 12, letterSpacing: 0.3 },
  sharePartnerBtn: {
    backgroundColor: '#F5A623', borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 8, alignSelf: 'flex-start',
  },
  sharePartnerBtnText: { fontSize: 13, fontWeight: '700', color: '#1A1A2E' },
  qrImage: { width: 100, height: 100, borderRadius: 8, flexShrink: 0 },

  // ── Suggestions tab ──
  suggCard: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.1)',
    padding: 14,
  },
  suggCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 8,
  },
  suggCardName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  suggStatusPill: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    flexShrink: 0,
  },
  suggStatusText: {
    fontSize: 10,
    fontWeight: '700',
  },
  suggCardExp: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.55)',
    lineHeight: 19,
    marginBottom: 10,
  },
  suggCardMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.07)',
    paddingTop: 10,
  },
  suggMetaText: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.3)',
    fontWeight: '500',
  },
  suggMetaLink: {
    fontSize: 11,
    color: AMBER,
    fontWeight: '600',
    flex: 1,
  },
})
