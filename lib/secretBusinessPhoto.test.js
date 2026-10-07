import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchSecretBusinessPhotoUrl } from './secretBusinessPhoto.js'

function fakeClient({ path, rowError = null, signed = 'https://signed/biz.jpg', signError = null }) {
  const calls = { select: null, bucket: null, signedPath: null }
  return {
    calls,
    from: () => ({ select: (cols) => { calls.select = cols; return { eq: () => ({ maybeSingle: async () => ({ data: path === undefined ? null : { secret_business_photo_storage_path: path }, error: rowError }) }) } } }),
    storage: { from: (b) => { calls.bucket = b; return { createSignedUrl: async (p) => { calls.signedPath = p; return { data: signError ? null : { signedUrl: signed }, error: signError } } } } },
  }
}

test('reads ONLY the business photo column and signs that exact path', async () => {
  const c = fakeClient({ path: 'secret-business-photos/i1/1.jpg' })
  assert.equal(await fetchSecretBusinessPhotoUrl({ itemId: 'i1', client: c }), 'https://signed/biz.jpg')
  assert.equal(c.calls.select, 'secret_business_photo_storage_path')
  assert.equal(c.calls.bucket, 'submission-photos')
  assert.equal(c.calls.signedPath, 'secret-business-photos/i1/1.jpg')
})

test('no business photo / errors -> null (no fallback to any cover image)', async () => {
  assert.equal(await fetchSecretBusinessPhotoUrl({ itemId: 'i1', client: fakeClient({ path: null }) }), null)
  assert.equal(await fetchSecretBusinessPhotoUrl({ itemId: 'i1', client: fakeClient({ path: undefined }) }), null)
  assert.equal(await fetchSecretBusinessPhotoUrl({ itemId: 'i1', client: fakeClient({ path: ' ' }) }), null)
  assert.equal(await fetchSecretBusinessPhotoUrl({ itemId: 'i1', client: fakeClient({ path: 'p', signError: { message: 'denied' } }) }), null)
  assert.equal(await fetchSecretBusinessPhotoUrl({ itemId: 'i1', client: fakeClient({ path: 'p', rowError: { message: 'x' } }) }), null)
  assert.equal(await fetchSecretBusinessPhotoUrl({ itemId: null, client: fakeClient({ path: 'p' }) }), null)
})
