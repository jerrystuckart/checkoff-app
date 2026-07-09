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
  Switch,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import * as ImagePicker from 'expo-image-picker'
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
  allows_personal_note: false,
  personal_prompt_label: '',
  personal_place_label: '',
  is_insider_drop: false,
  insider_drop_requires_points: null,
  insider_drop_requires_status: '',
  insider_drop_teaser_text: '',
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

      <Text style={styles.fieldLabel}>Season</Text>
      <View style={styles.segRow}>
        {SEASON_OPTIONS.map(s => (
          <TouchableOpacity
            key={s.value}
            style={[styles.seg, (item.season_tag ?? '') === s.value && styles.segOn]}
            onPress={() => onChange({ ...item, season_tag: s.value || null })}
          >
            <Text style={[styles.segText, (item.season_tag ?? '') === s.value && styles.segTextOn]}>{s.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.fieldLabel}>Recurrence</Text>
      <View style={styles.segRow}>
        <TouchableOpacity style={[styles.seg, item.is_recurring !== false && styles.segOn]} onPress={() => onChange({ ...item, is_recurring: true, active_from: '', active_until: '' })}>
          <Text style={[styles.segText, item.is_recurring !== false && styles.segTextOn]}>Every year</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.seg, item.is_recurring === false && styles.segOn]} onPress={() => onChange({ ...item, is_recurring: false })}>
          <Text style={[styles.segText, item.is_recurring === false && styles.segTextOn]}>One-time</Text>
        </TouchableOpacity>
      </View>
      {(item.is_recurring === false || item.active_from || item.active_until) && (
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.fieldHint, { marginBottom: 4 }]}>Active from</Text>
            <TextInput
              style={styles.input}
              value={item.active_from ?? ''}
              onChangeText={v => onChange({ ...item, active_from: v || null })}
              placeholder="YYYY-MM-DD" placeholderTextColor="rgba(255,255,255,0.3)"
              autoCapitalize="none"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.fieldHint, { marginBottom: 4 }]}>Active until</Text>
            <TextInput
              style={styles.input}
              value={item.active_until ?? ''}
              onChangeText={v => onChange({ ...item, active_until: v || null })}
              placeholder="YYYY-MM-DD" placeholderTextColor="rgba(255,255,255,0.3)"
              autoCapitalize="none"
            />
          </View>
        </View>
      )}

      <Text style={styles.fieldLabel}>Website URL (optional)</Text>
      <TextInput
        style={styles.input}
        value={item.website_url ?? ''}
        onChangeText={v => onChange({ ...item, website_url: v })}
        placeholder="https://..." placeholderTextColor="rgba(255,255,255,0.3)"
        autoCapitalize="none" keyboardType="url"
      />

      <Text style={styles.fieldLabel}>GPS coordinates</Text>
      <TextInput
        style={[styles.input, { marginBottom: 8 }]}
        value={item.maps_query ?? ''}
        onChangeText={v => onChange({ ...item, maps_query: v })}
        placeholder="Maps search query (e.g. Baba's Burgers Tucson AZ)"
        placeholderTextColor="rgba(255,255,255,0.3)"
      />
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
        : <Text style={styles.fieldHint}>Enter a search query above and tap Auto-fill, or type lat/lng manually.</Text>
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

      <Text style={styles.fieldLabel}>Personal note</Text>
      <TouchableOpacity
        style={[styles.seg, { alignItems: 'flex-start' }]}
        onPress={() => onChange({ ...item, allows_personal_note: !item.allows_personal_note })}
      >
        <Text style={[styles.segText, item.allows_personal_note && styles.segTextOn]}>
          {item.allows_personal_note ? '✓ Allows personal note' : 'No personal note'}
        </Text>
      </TouchableOpacity>
      {item.allows_personal_note && (
        <>
          <Text style={[styles.fieldHint, { marginTop: 8, marginBottom: 4 }]}>Prompt label (e.g. "What did you order?")</Text>
          <TextInput
            style={styles.input}
            value={item.personal_prompt_label ?? ''}
            onChangeText={v => onChange({ ...item, personal_prompt_label: v })}
            placeholder="e.g. What did you order?" placeholderTextColor="rgba(255,255,255,0.3)"
          />
          <Text style={[styles.fieldHint, { marginTop: 8, marginBottom: 4 }]}>Place label (e.g. "Your order")</Text>
          <TextInput
            style={styles.input}
            value={item.personal_place_label ?? ''}
            onChangeText={v => onChange({ ...item, personal_place_label: v })}
            placeholder="e.g. Your order" placeholderTextColor="rgba(255,255,255,0.3)"
          />
        </>
      )}

      <Text style={styles.fieldLabel}>Insider Drop</Text>
      <TouchableOpacity
        style={[styles.seg, { alignItems: 'flex-start' }]}
        onPress={() => onChange({ ...item, is_insider_drop: !item.is_insider_drop })}
      >
        <Text style={[styles.segText, item.is_insider_drop && styles.segTextOn]}>
          {item.is_insider_drop ? '✓ Insider drop (gated)' : 'Not an insider drop'}
        </Text>
      </TouchableOpacity>
      {item.is_insider_drop && (
        <>
          <Text style={[styles.fieldHint, { marginTop: 8, marginBottom: 4 }]}>Requires points (optional)</Text>
          <TextInput
            style={styles.input}
            value={item.insider_drop_requires_points != null ? String(item.insider_drop_requires_points) : ''}
            onChangeText={v => onChange({ ...item, insider_drop_requires_points: parseInt(v) || null })}
            placeholder="e.g. 50" placeholderTextColor="rgba(255,255,255,0.3)"
            keyboardType="number-pad"
          />
          <Text style={[styles.fieldHint, { marginTop: 8, marginBottom: 4 }]}>Requires status (optional)</Text>
          <TextInput
            style={styles.input}
            value={item.insider_drop_requires_status ?? ''}
            onChangeText={v => onChange({ ...item, insider_drop_requires_status: v })}
            placeholder="e.g. trailblazer" placeholderTextColor="rgba(255,255,255,0.3)"
            autoCapitalize="none"
          />
          <Text style={[styles.fieldHint, { marginTop: 8, marginBottom: 4 }]}>Teaser text (shown before unlock)</Text>
          <TextInput
            style={styles.textArea}
            value={item.insider_drop_teaser_text ?? ''}
            onChangeText={v => onChange({ ...item, insider_drop_teaser_text: v })}
            multiline numberOfLines={2}
            placeholder="Unlock this after earning 50 points…" placeholderTextColor="rgba(255,255,255,0.3)"
          />
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
  const [adminTab, setAdminTab] = useState('items') // 'items' | 'lists' | 'partners' | 'metrics' | 'home' | 'images'

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

  // ── Metrics tab state ──
  const [metrics, setMetrics]           = useState(null)
  const [loadingMetrics, setLoadingMetrics] = useState(false)

  // ── Home tab state ──
  const [homeData, setHomeData]         = useState(null)
  const [loadingHome, setLoadingHome]   = useState(false)

  // ── Images tab state ──
  const [imgMetroId, setImgMetroId]     = useState('')
  const [imgExpId, setImgExpId]         = useState('')
  const [imgGroupId, setImgGroupId]     = useState('')
  const [imgExpUrl, setImgExpUrl]       = useState(null)
  const [imgGroupUrl, setImgGroupUrl]   = useState(null)
  const [imgMetroUrls, setImgMetroUrls] = useState([])
  const [uploadingImg, setUploadingImg] = useState(false)
  const [featuredExps, setFeaturedExps] = useState([])

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
  const [showNewList, setShowNewList]       = useState(false)
  const [newListForm, setNewListForm]       = useState({ title: '', city_slug: '', season: '', is_active: true })
  const [savingList, setSavingList]         = useState(false)

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
          allows_personal_note, personal_prompt_label, personal_place_label,
          is_insider_drop, insider_drop_requires_points, insider_drop_requires_status, insider_drop_teaser_text,
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
      allows_personal_note:  editItem.allows_personal_note ?? false,
      personal_prompt_label: editItem.allows_personal_note ? (editItem.personal_prompt_label || null) : null,
      personal_place_label:  editItem.allows_personal_note ? (editItem.personal_place_label || null) : null,
      is_insider_drop:                editItem.is_insider_drop ?? false,
      insider_drop_requires_points:   editItem.is_insider_drop ? (editItem.insider_drop_requires_points ?? null) : null,
      insider_drop_requires_status:   editItem.is_insider_drop ? (editItem.insider_drop_requires_status || null) : null,
      insider_drop_teaser_text:       editItem.is_insider_drop ? (editItem.insider_drop_teaser_text || null) : null,
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
        allows_personal_note:  newItem.allows_personal_note ?? false,
        personal_prompt_label: newItem.allows_personal_note ? (newItem.personal_prompt_label || null) : null,
        personal_place_label:  newItem.allows_personal_note ? (newItem.personal_place_label || null) : null,
        is_insider_drop:                newItem.is_insider_drop ?? false,
        insider_drop_requires_points:   newItem.is_insider_drop ? (newItem.insider_drop_requires_points ?? null) : null,
        insider_drop_requires_status:   newItem.is_insider_drop ? (newItem.insider_drop_requires_status || null) : null,
        insider_drop_teaser_text:       newItem.is_insider_drop ? (newItem.insider_drop_teaser_text || null) : null,
      })
      .select(`
        id, body, is_active, is_universal, checkin_type,
        ring_weight, difficulty, photo_required, is_secret,
        secret_reveal_text, maps_lat, maps_lng, geo_radius_m,
        season_tag, is_recurring, active_from, active_until,
        website_url, maps_query, partner_id, neighborhood_id, category_id,
        allows_personal_note, personal_prompt_label, personal_place_label,
        is_insider_drop, insider_drop_requires_points, insider_drop_requires_status, insider_drop_teaser_text,
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

  // ── Metrics ──
  async function loadMetrics() {
    setLoadingMetrics(true)
    try {
      const now   = new Date()
      const ago7  = new Date(now - 7  * 86400000).toISOString()
      const ago30 = new Date(now - 30 * 86400000).toISOString()

      const [
        { count: totalUsers },
        { count: newUsers7 },
        { count: totalCheckins },
        { count: checkins7 },
        { count: activeItems },
        { data: topItems },
        { data: recentSignups },
      ] = await Promise.all([
        supabase.from('users').select('*', { count: 'exact', head: true }),
        supabase.from('users').select('*', { count: 'exact', head: true }).gte('created_at', ago7),
        supabase.from('check_ins').select('*', { count: 'exact', head: true }),
        supabase.from('check_ins').select('*', { count: 'exact', head: true }).gte('checked_at', ago7),
        supabase.from('items').select('*', { count: 'exact', head: true }).eq('is_active', true),
        supabase.from('check_ins').select('item_id, items(body)').gte('checked_at', ago30).limit(500),
        supabase.from('users').select('id, created_at, email').order('created_at', { ascending: false }).limit(8),
      ])

      // tally top items from check_ins
      const tally = {}
      ;(topItems ?? []).forEach(ci => {
        const key = ci.item_id
        if (!tally[key]) tally[key] = { body: ci.items?.body ?? ci.item_id, count: 0 }
        tally[key].count++
      })
      const top10 = Object.values(tally).sort((a, b) => b.count - a.count).slice(0, 10)

      setMetrics({ totalUsers, newUsers7, totalCheckins, checkins7, activeItems, top10, recentSignups: recentSignups ?? [], ago30Label: '30d' })
    } catch (e) {
      Alert.alert('Metrics error', e.message)
    }
    setLoadingMetrics(false)
  }

  // ── Home Screen ──
  async function loadHomeData() {
    setLoadingHome(true)
    try {
      const [
        { data: exps },
        { data: metroList },
        { data: next10 },
      ] = await Promise.all([
        supabase.from('featured_experiences').select('id, title, active, display_order, image_url').order('display_order'),
        supabase.from('metro_areas').select('id, name, is_active').order('name'),
        supabase.from('curated_lists').select('id, title, is_active').eq('audience_group', 'the-next-10').limit(1),
      ])
      setHomeData({ exps: exps ?? [], metros: metroList ?? [], next10: next10?.[0] ?? null })
      setFeaturedExps(exps ?? [])
    } catch (e) {
      Alert.alert('Error', e.message)
    }
    setLoadingHome(false)
  }

  async function toggleMetroActive(id, current) {
    const { error } = await supabase.from('metro_areas').update({ is_active: !current }).eq('id', id)
    if (error) { Alert.alert('Error', error.message); return }
    setHomeData(prev => prev ? { ...prev, metros: prev.metros.map(m => m.id === id ? { ...m, is_active: !current } : m) } : prev)
  }

  async function toggleExpActive(id, current) {
    const { error } = await supabase.from('featured_experiences').update({ active: !current }).eq('id', id)
    if (error) { Alert.alert('Error', error.message); return }
    setHomeData(prev => prev ? { ...prev, exps: prev.exps.map(e => e.id === id ? { ...e, active: !current } : e) } : prev)
  }

  async function toggleNext10(id, current) {
    const { error } = await supabase.from('curated_lists').update({ is_active: !current }).eq('id', id)
    if (error) { Alert.alert('Error', error.message); return }
    setHomeData(prev => prev ? { ...prev, next10: prev.next10 ? { ...prev.next10, is_active: !current } : null } : prev)
  }

  // ── New List ──
  async function saveNewList() {
    if (!newListForm.title.trim()) { Alert.alert('Title required'); return }
    setSavingList(true)
    const { data, error } = await supabase
      .from('curated_lists')
      .insert({
        title:     newListForm.title.trim(),
        city_slug: newListForm.city_slug.trim() || null,
        season:    newListForm.season || null,
        is_active: newListForm.is_active,
      })
      .select('id, title, season, year, city_slug, audience_group_id, is_active')
      .single()
    setSavingList(false)
    if (error) { Alert.alert('Error', error.message); return }
    setCuratedLists(prev => [data, ...prev])
    setShowNewList(false)
    setNewListForm({ title: '', city_slug: '', season: '', is_active: true })
  }

  // ── Image upload helpers ──
  async function pickAndUploadImage(path, onSuccess) {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo library access in Settings.'); return }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85 })
    if (result.canceled) return
    const asset = result.assets[0]
    const ext = asset.uri.split('.').pop() ?? 'jpg'
    const uploadPath = `${path}/${Date.now()}.${ext}`
    setUploadingImg(true)
    try {
      const response = await fetch(asset.uri)
      const blob = await response.blob()
      const { error } = await supabase.storage.from('checkoff-images').upload(uploadPath, blob, { contentType: asset.mimeType ?? 'image/jpeg', upsert: false })
      if (error) throw error
      const { data: { publicUrl } } = supabase.storage.from('checkoff-images').getPublicUrl(uploadPath)
      await onSuccess(publicUrl)
    } catch (e) {
      Alert.alert('Upload failed', e.message)
    }
    setUploadingImg(false)
  }

  async function uploadMetroHero() {
    if (!imgMetroId) { Alert.alert('Select a city first'); return }
    await pickAndUploadImage(`metro/${imgMetroId}`, async (publicUrl) => {
      const { data: row } = await supabase.from('metro_areas').select('hero_images').eq('id', imgMetroId).single()
      const imgs = row?.hero_images ?? []
      await supabase.from('metro_areas').update({ hero_images: [...imgs, publicUrl] }).eq('id', imgMetroId)
      setImgMetroUrls(prev => [...prev, publicUrl])
      Alert.alert('Uploaded')
    })
  }

  async function deleteMetroHero(url) {
    const { data: row } = await supabase.from('metro_areas').select('hero_images').eq('id', imgMetroId).single()
    const imgs = (row?.hero_images ?? []).filter(u => u !== url)
    await supabase.from('metro_areas').update({ hero_images: imgs }).eq('id', imgMetroId)
    setImgMetroUrls(imgs)
  }

  async function loadMetroImages(metroId) {
    if (!metroId) { setImgMetroUrls([]); return }
    const { data } = await supabase.from('metro_areas').select('hero_images').eq('id', metroId).single()
    setImgMetroUrls(data?.hero_images ?? [])
  }

  async function uploadExpImage() {
    if (!imgExpId) { Alert.alert('Select an experience first'); return }
    await pickAndUploadImage(`experiences/${imgExpId}`, async (publicUrl) => {
      await supabase.from('featured_experiences').update({ image_url: publicUrl }).eq('id', imgExpId)
      setImgExpUrl(publicUrl)
      Alert.alert('Uploaded')
    })
  }

  async function loadExpImage(expId) {
    if (!expId) { setImgExpUrl(null); return }
    const { data } = await supabase.from('featured_experiences').select('image_url').eq('id', expId).single()
    setImgExpUrl(data?.image_url ?? null)
  }

  async function uploadGroupImage() {
    if (!imgGroupId) { Alert.alert('Select a group first'); return }
    await pickAndUploadImage(`groups/${imgGroupId}`, async (publicUrl) => {
      await supabase.from('audience_groups').update({ image_url: publicUrl }).eq('id', imgGroupId)
      setImgGroupUrl(publicUrl)
      Alert.alert('Uploaded')
    })
  }

  async function loadGroupImage(groupId) {
    if (!groupId) { setImgGroupUrl(null); return }
    const { data } = await supabase.from('audience_groups').select('image_url').eq('id', groupId).single()
    setImgGroupUrl(data?.image_url ?? null)
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
                : adminTab === 'lists'
                  ? `${curatedLists.length} curated lists`
                  : adminTab === 'metrics'
                    ? 'App metrics'
                    : adminTab === 'home'
                      ? 'Home screen'
                      : 'Image manager'}
          </Text>
        </View>
        {adminTab === 'items' && (
          <TouchableOpacity style={styles.addBtn} onPress={() => setShowAdd(true)}>
            <Text style={styles.addBtnText}>+ Add item</Text>
          </TouchableOpacity>
        )}
        {adminTab === 'lists' && (
          <TouchableOpacity style={styles.addBtn} onPress={() => setShowNewList(true)}>
            <Text style={styles.addBtnText}>+ New list</Text>
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
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabRow} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
        {[['items', 'Items'], ['lists', 'Lists'], ['partners', 'Partners'], ['metrics', 'Metrics'], ['home', 'Home'], ['images', 'Images']].map(([k, l]) => (
          <TouchableOpacity
            key={k}
            style={[styles.tabPill, adminTab === k && styles.tabPillOn]}
            onPress={() => {
              setAdminTab(k)
              if (k === 'lists' && curatedLists.length === 0) loadCuratedLists()
              if (k === 'metrics' && !metrics) loadMetrics()
              if (k === 'home' && !homeData) loadHomeData()
            }}
          >
            <Text style={[styles.tabPillText, adminTab === k && styles.tabPillTextOn]}>{l}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

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
      {/* METRICS TAB                      */}
      {/* ════════════════════════════════ */}
      {adminTab === 'metrics' && (
        loadingMetrics ? (
          <View style={styles.center}><ActivityIndicator color={AMBER} size="large" /></View>
        ) : !metrics ? (
          <View style={styles.center}>
            <TouchableOpacity style={styles.addBtn} onPress={loadMetrics}>
              <Text style={styles.addBtnText}>Load metrics</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60, gap: 16 }}>
            {/* Stat cards */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {[
                { label: 'Total Users',     value: metrics.totalUsers,    color: AMBER,  sub: `+${metrics.newUsers7} this week` },
                { label: 'Total Check-ins', value: metrics.totalCheckins, color: GREEN,  sub: `+${metrics.checkins7} this week` },
                { label: 'Active Items',    value: metrics.activeItems,   color: BLUE,   sub: 'currently live' },
                { label: 'Avg / User',      value: metrics.totalUsers > 0 ? (metrics.totalCheckins / metrics.totalUsers).toFixed(1) : '—', color: '#BA7517', sub: 'check-ins per user' },
              ].map(c => (
                <View key={c.label} style={[styles.metricCard, { borderColor: c.color + '30' }]}>
                  <Text style={[styles.metricValue, { color: c.color }]}>{c.value}</Text>
                  <Text style={styles.metricLabel}>{c.label}</Text>
                  <Text style={styles.metricSub}>{c.sub}</Text>
                </View>
              ))}
            </View>

            {/* Top 10 items */}
            <View style={styles.metricSection}>
              <Text style={styles.metricSectionTitle}>Top items (last 30 days)</Text>
              {metrics.top10.length === 0 ? (
                <Text style={styles.emptyText}>No check-in data</Text>
              ) : metrics.top10.map((item, i) => (
                <View key={i} style={styles.metricRow}>
                  <Text style={styles.metricRowNum}>{i + 1}</Text>
                  <Text style={styles.metricRowBody} numberOfLines={1}>{item.body}</Text>
                  <Text style={styles.metricRowCount}>{item.count}</Text>
                </View>
              ))}
            </View>

            {/* Recent signups */}
            <View style={styles.metricSection}>
              <Text style={styles.metricSectionTitle}>Recent signups</Text>
              {metrics.recentSignups.map(u => (
                <View key={u.id} style={styles.metricRow}>
                  <Text style={styles.metricRowBody} numberOfLines={1}>{u.email ?? u.id}</Text>
                  <Text style={styles.metricRowCount}>{new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</Text>
                </View>
              ))}
            </View>

            <TouchableOpacity style={[styles.addBtn, { alignSelf: 'center' }]} onPress={loadMetrics}>
              <Text style={styles.addBtnText}>↻ Refresh</Text>
            </TouchableOpacity>
          </ScrollView>
        )
      )}

      {/* ════════════════════════════════ */}
      {/* HOME TAB                         */}
      {/* ════════════════════════════════ */}
      {adminTab === 'home' && (
        loadingHome ? (
          <View style={styles.center}><ActivityIndicator color={AMBER} size="large" /></View>
        ) : !homeData ? (
          <View style={styles.center}>
            <TouchableOpacity style={styles.addBtn} onPress={loadHomeData}>
              <Text style={styles.addBtnText}>Load home data</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60, gap: 16 }}>

            {/* Next10 Banner */}
            <View style={styles.homeSection}>
              <Text style={styles.homeSectionTitle}>Next 10 Banner</Text>
              <Text style={styles.homeSectionSub}>Curated list shown as the hero banner on Home.</Text>
              {homeData.next10 ? (
                <View style={styles.homeRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.homeRowLabel}>{homeData.next10.title}</Text>
                    <Text style={styles.homeRowSub}>audience_group = the-next-10</Text>
                  </View>
                  <Switch
                    value={homeData.next10.is_active}
                    onValueChange={() => toggleNext10(homeData.next10.id, homeData.next10.is_active)}
                    trackColor={{ false: 'rgba(255,255,255,0.1)', true: GREEN }}
                    thumbColor="#fff"
                  />
                </View>
              ) : (
                <Text style={styles.homeSectionSub}>No list has audience_group = 'the-next-10' — banner is hidden.</Text>
              )}
            </View>

            {/* Experiences Rail */}
            <View style={styles.homeSection}>
              <Text style={styles.homeSectionTitle}>Experiences Rail</Text>
              <Text style={styles.homeSectionSub}>Horizontal cards shown on Home. Toggle to show/hide each.</Text>
              {homeData.exps.length === 0 ? (
                <Text style={styles.homeSectionSub}>No experiences configured.</Text>
              ) : homeData.exps.map(exp => (
                <View key={exp.id} style={styles.homeRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.homeRowLabel} numberOfLines={1}>{exp.title}</Text>
                    <Text style={styles.homeRowSub}>order: {exp.display_order}</Text>
                  </View>
                  <Switch
                    value={exp.active}
                    onValueChange={() => toggleExpActive(exp.id, exp.active)}
                    trackColor={{ false: 'rgba(255,255,255,0.1)', true: GREEN }}
                    thumbColor="#fff"
                  />
                </View>
              ))}
            </View>

            {/* Metro/City Pills */}
            <View style={styles.homeSection}>
              <Text style={styles.homeSectionTitle}>City Pills</Text>
              <Text style={styles.homeSectionSub}>Cities shown in the home-screen city selector. Toggle to show/hide.</Text>
              {homeData.metros.map(m => (
                <View key={m.id} style={styles.homeRow}>
                  <Text style={[styles.homeRowLabel, { flex: 1 }]}>{m.name}</Text>
                  <Switch
                    value={m.is_active}
                    onValueChange={() => toggleMetroActive(m.id, m.is_active)}
                    trackColor={{ false: 'rgba(255,255,255,0.1)', true: GREEN }}
                    thumbColor="#fff"
                  />
                </View>
              ))}
            </View>

            <TouchableOpacity style={[styles.addBtn, { alignSelf: 'center' }]} onPress={loadHomeData}>
              <Text style={styles.addBtnText}>↻ Refresh</Text>
            </TouchableOpacity>
          </ScrollView>
        )
      )}

      {/* ════════════════════════════════ */}
      {/* IMAGES TAB                       */}
      {/* ════════════════════════════════ */}
      {adminTab === 'images' && (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60, gap: 16 }}>

          {/* Metro Hero Images */}
          <View style={styles.homeSection}>
            <Text style={styles.homeSectionTitle}>Metro Hero Images</Text>
            <Text style={styles.homeSectionSub}>Photos shown behind the seasonal list card. Stored in checkoff-images/metro/.</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
              <View style={{ flexDirection: 'row', gap: 8, paddingVertical: 4 }}>
                {metros.map(m => (
                  <TouchableOpacity
                    key={m.id}
                    style={[styles.pill, imgMetroId === m.id && styles.pillOn]}
                    onPress={() => { setImgMetroId(m.id); loadMetroImages(m.id) }}
                  >
                    <Text style={[styles.pillText, imgMetroId === m.id && styles.pillTextOn]}>{m.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
            {imgMetroId ? (
              <>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                  {imgMetroUrls.map(url => (
                    <View key={url} style={{ position: 'relative' }}>
                      <Image source={{ uri: url }} style={{ width: 90, height: 60, borderRadius: 6 }} />
                      <TouchableOpacity
                        style={styles.imgDeleteBtn}
                        onPress={() => Alert.alert('Remove photo?', '', [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Remove', style: 'destructive', onPress: () => deleteMetroHero(url) },
                        ])}
                      >
                        <Text style={{ color: '#fff', fontSize: 10, fontWeight: '900' }}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
                <TouchableOpacity style={[styles.addBtn, uploadingImg && { opacity: 0.5 }]} onPress={uploadMetroHero} disabled={uploadingImg}>
                  <Text style={styles.addBtnText}>{uploadingImg ? 'Uploading…' : '+ Upload photo'}</Text>
                </TouchableOpacity>
              </>
            ) : (
              <Text style={styles.homeSectionSub}>Select a city above to manage its hero images.</Text>
            )}
          </View>

          {/* Experience Card Images */}
          <View style={styles.homeSection}>
            <Text style={styles.homeSectionTitle}>Experience Card Images</Text>
            <Text style={styles.homeSectionSub}>Image shown on each experience chip in the Experiences Rail.</Text>
            {featuredExps.length === 0 ? (
              <Text style={[styles.homeSectionSub, { marginBottom: 8 }]}>
                No experiences loaded — switch to Home tab first to load them.
              </Text>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', gap: 8, paddingVertical: 4 }}>
                  {featuredExps.map(e => (
                    <TouchableOpacity
                      key={e.id}
                      style={[styles.pill, imgExpId === e.id && styles.pillOn]}
                      onPress={() => { setImgExpId(e.id); loadExpImage(e.id) }}
                    >
                      <Text style={[styles.pillText, imgExpId === e.id && styles.pillTextOn]} numberOfLines={1}>{e.title}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            )}
            {imgExpId && (
              <>
                {imgExpUrl ? (
                  <Image source={{ uri: imgExpUrl }} style={{ width: 120, height: 80, borderRadius: 8, marginBottom: 10 }} />
                ) : (
                  <Text style={[styles.homeSectionSub, { marginBottom: 10 }]}>No image set</Text>
                )}
                <TouchableOpacity style={[styles.addBtn, uploadingImg && { opacity: 0.5 }]} onPress={uploadExpImage} disabled={uploadingImg}>
                  <Text style={styles.addBtnText}>{uploadingImg ? 'Uploading…' : imgExpUrl ? '↺ Replace image' : '+ Upload image'}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>

          {/* Curated Group Art */}
          <View style={styles.homeSection}>
            <Text style={styles.homeSectionTitle}>Curated Group Art</Text>
            <Text style={styles.homeSectionSub}>Background image for each audience group chip in the template rail.</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
              <View style={{ flexDirection: 'row', gap: 8, paddingVertical: 4 }}>
                {audienceGroups.map(g => (
                  <TouchableOpacity
                    key={g.id}
                    style={[styles.pill, imgGroupId === g.id && styles.pillOn]}
                    onPress={() => { setImgGroupId(g.id); loadGroupImage(g.id) }}
                  >
                    <Text style={[styles.pillText, imgGroupId === g.id && styles.pillTextOn]}>{g.emoji ?? ''}{g.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
            {audienceGroups.length === 0 && (
              <Text style={[styles.homeSectionSub, { marginBottom: 8 }]}>
                No groups loaded — switch to Lists tab first to load audience groups.
              </Text>
            )}
            {imgGroupId && (
              <>
                {imgGroupUrl ? (
                  <Image source={{ uri: imgGroupUrl }} style={{ width: 80, height: 80, borderRadius: 8, marginBottom: 10 }} />
                ) : (
                  <Text style={[styles.homeSectionSub, { marginBottom: 10 }]}>No art set</Text>
                )}
                <TouchableOpacity style={[styles.addBtn, uploadingImg && { opacity: 0.5 }]} onPress={uploadGroupImage} disabled={uploadingImg}>
                  <Text style={styles.addBtnText}>{uploadingImg ? 'Uploading…' : imgGroupUrl ? '↺ Replace art' : '+ Upload art'}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </ScrollView>
      )}

      {/* NEW LIST MODAL */}
      <Modal visible={showNewList} animationType="slide" presentationStyle="pageSheet">
        <View style={[styles.modal, { paddingTop: insets.top + 16 }]}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => { setShowNewList(false); setNewListForm({ title: '', city_slug: '', season: '', is_active: true }) }}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>New List</Text>
            <TouchableOpacity onPress={saveNewList} disabled={savingList}>
              {savingList ? <ActivityIndicator color={AMBER} /> : <Text style={styles.modalSave}>Create</Text>}
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
            <View>
              <Text style={styles.fieldLabel}>Title *</Text>
              <TextInput
                style={styles.fieldInput}
                value={newListForm.title}
                onChangeText={v => setNewListForm(p => ({ ...p, title: v }))}
                placeholder="e.g. Top Tucson Tacos"
                placeholderTextColor="rgba(255,255,255,0.25)"
              />
            </View>
            <View>
              <Text style={styles.fieldLabel}>City slug</Text>
              <TextInput
                style={styles.fieldInput}
                value={newListForm.city_slug}
                onChangeText={v => setNewListForm(p => ({ ...p, city_slug: v }))}
                placeholder="e.g. tucson (blank = universal)"
                placeholderTextColor="rgba(255,255,255,0.25)"
                autoCapitalize="none"
              />
            </View>
            <View>
              <Text style={styles.fieldLabel}>Season</Text>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                {SEASON_OPTIONS.map(s => (
                  <TouchableOpacity
                    key={s.value}
                    style={[styles.pill, newListForm.season === s.value && styles.pillOn]}
                    onPress={() => setNewListForm(p => ({ ...p, season: s.value }))}
                  >
                    <Text style={[styles.pillText, newListForm.season === s.value && styles.pillTextOn]}>{s.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={styles.fieldLabel}>Active immediately</Text>
              <Switch
                value={newListForm.is_active}
                onValueChange={v => setNewListForm(p => ({ ...p, is_active: v }))}
                trackColor={{ false: 'rgba(255,255,255,0.1)', true: GREEN }}
                thumbColor="#fff"
              />
            </View>
          </ScrollView>
        </View>
      </Modal>

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

  tabRow: { marginBottom: 10 },
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

  // ── Metrics tab ──
  metricCard: {
    flex: 1, minWidth: 140, backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14, borderWidth: 0.5, padding: 14,
  },
  metricValue: { fontSize: 32, fontWeight: '800', lineHeight: 36 },
  metricLabel: { fontSize: 12, fontWeight: '700', color: '#fff', marginTop: 6 },
  metricSub:   { fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 2 },
  metricSection: {
    backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 14,
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.08)', padding: 14, gap: 8,
  },
  metricSectionTitle: { fontSize: 13, fontWeight: '700', color: AMBER, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.6 },
  metricRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.05)' },
  metricRowNum:   { fontSize: 11, color: 'rgba(255,255,255,0.25)', fontWeight: '700', minWidth: 18, textAlign: 'right' },
  metricRowBody:  { flex: 1, fontSize: 13, color: '#fff' },
  metricRowCount: { fontSize: 12, fontWeight: '700', color: AMBER },

  // ── Home tab ──
  homeSection: {
    backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 14,
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.08)', padding: 14,
  },
  homeSectionTitle: { fontSize: 14, fontWeight: '800', color: '#fff', marginBottom: 4 },
  homeSectionSub:   { fontSize: 12, color: 'rgba(255,255,255,0.35)', marginBottom: 10, lineHeight: 17 },
  homeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  homeRowLabel: { fontSize: 13, fontWeight: '600', color: '#fff' },
  homeRowSub:   { fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 1 },

  // ── Images tab ──
  imgDeleteBtn: {
    position: 'absolute', top: -6, right: -6,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: RED, alignItems: 'center', justifyContent: 'center',
  },
})
