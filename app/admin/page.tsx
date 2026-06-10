'use client'

import { useCallback, useEffect, useMemo, useState, FormEvent } from 'react'

const ADMIN_ORIGINAL_BUCKET = '__original__'

function isPlayaCampaignBucket(bucket: string): boolean {
  return bucket === ADMIN_ORIGINAL_BUCKET
}

function isScoopsCampaignBucket(bucket: string): boolean {
  const s = bucket.trim().toLowerCase()
  return s === 'scoops' || s.startsWith('scoops-')
}

interface RedeemedCode {
  code: string
  redeemedAt: string
  /** Present for all rows after server update; missing older responses default to Playa legacy. */
  campaignBucket?: string
  campaignHeading?: string
}

interface CampaignTotals {
  total: number
  redeemed: number
  remaining: number
  heading: string
}

interface Stats {
  total: number
  redeemed: number
  remaining: number
  redeemedCodes: RedeemedCode[]
  campaigns: Record<string, CampaignTotals>
  demoMode: boolean
}

const EMPTY_STATS: Stats = {
  total: 0,
  redeemed: 0,
  remaining: 0,
  redeemedCodes: [],
  campaigns: {},
  demoMode: false,
}

const DEMO_BUCKET = 'demo'
/** Matches the 2×5 Letter grid cell (printer slip proportions). */
const CUTOUT_ASPECT = 278 / 147.2

type ApiFail = 'unauthorized' | 'bad_request' | 'invalid_code' | 'unknown_code' | 'not_redeemed' | string

function campaignSlugFootnote(bucketKey: string): string {
  if (bucketKey === ADMIN_ORIGINAL_BUCKET) return 'Playa legacy · no campaign tag in Redis'
  return `@${bucketKey}`
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
  })
}

function normalizeDashboard(data: Record<string, unknown>): Stats {
  const redeemedCodes = Array.isArray(data.redeemedCodes)
    ? (data.redeemedCodes as RedeemedCode[]).map(row => ({
        ...row,
        campaignBucket: row.campaignBucket ?? ADMIN_ORIGINAL_BUCKET,
      }))
    : []
  return {
    total: Number(data.total ?? 0),
    redeemed: Number(data.redeemed ?? 0),
    remaining: Number(data.remaining ?? 0),
    redeemedCodes,
    campaigns: (data.campaigns && typeof data.campaigns === 'object')
      ? data.campaigns as Record<string, CampaignTotals>
      : {},
    demoMode: Boolean(data.demoMode),
  }
}

const VIEW_CYCLE = ['all', 'playa', 'scoops'] as const
type CampaignSlice = (typeof VIEW_CYCLE)[number]

function rowBucket(row: RedeemedCode): string {
  return row.campaignBucket ?? ADMIN_ORIGINAL_BUCKET
}

function filterDashboard(stats: Stats, slice: CampaignSlice) {
  if (slice === 'all') {
    const pct = stats.total > 0 ? Math.round((stats.redeemed / stats.total) * 100) : 0
    return {
      label: 'All programs',
      sub: `${stats.total.toLocaleString()} QR codes in this project · Playa + Scoops (+ any other batches)`,
      total: stats.total,
      redeemed: stats.redeemed,
      remaining: stats.remaining,
      pct,
      redeemedCodes: stats.redeemedCodes,
      campaignKeys: Object.keys(stats.campaigns)
        .filter(k => stats.campaigns[k].total > 0)
        .sort((a, b) => {
          if (a === ADMIN_ORIGINAL_BUCKET) return -1
          if (b === ADMIN_ORIGINAL_BUCKET) return 1
          return a.localeCompare(b)
        }),
    }
  }

  const bucketMatch = slice === 'playa' ? isPlayaCampaignBucket : isScoopsCampaignBucket
  const campaignKeys = Object.keys(stats.campaigns).filter(k => bucketMatch(k) && stats.campaigns[k].total > 0)

  let total = 0
  let redeemed = 0
  for (const k of campaignKeys) {
    const c = stats.campaigns[k]
    total += c.total
    redeemed += c.redeemed
  }
  const remaining = total - redeemed
  const pct = total > 0 ? Math.round((redeemed / total) * 100) : 0
  const redeemedCodes = stats.redeemedCodes.filter(r => bucketMatch(rowBucket(r)))

  const label = slice === 'playa' ? 'Playa Bowls' : 'Scoops'
  const sub =
    total > 0
      ? `${total.toLocaleString()} QR codes in this batch`
      : slice === 'scoops'
        ? 'No Scoops-tagged coupons in Redis yet · run generate-codes -- --campaign …'
        : 'No legacy Playa batch in Redis yet'

  return { label, sub, total, redeemed, remaining, pct, redeemedCodes, campaignKeys }
}

async function adminRequest(password: string, resetCode?: string) {
  return fetch('/api/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(resetCode ? { password, resetCode } : { password }),
  })
}

function cleanupGeneratedBatch(password: string) {
  fetch('/api/admin/demo-cleanup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
    keepalive: true,
  }).catch(() => {})
}

export default function AdminPage() {
  const [password, setPassword] = useState('')
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(false)
  const [initialLoad, setInitialLoad] = useState(true)
  const [error, setError] = useState('')
  const [resettingCode, setResettingCode] = useState<string | null>(null)
  const [viewIndex, setViewIndex] = useState(0)
  const [generatingCutout, setGeneratingCutout] = useState(false)
  const [downloadingSheet, setDownloadingSheet] = useState(false)
  const [previewingRedemption, setPreviewingRedemption] = useState(false)
  const [previewCode, setPreviewCode] = useState<string | null>(null)
  const [cutoutPreviewUrl, setCutoutPreviewUrl] = useState<string | null>(null)
  const [couponDesign, setCouponDesign] = useState<File | null>(null)
  const [designPreview, setDesignPreview] = useState<string | null>(null)
  const [generatedThisSession, setGeneratedThisSession] = useState(false)

  const refreshDashboard = useCallback(async (pwd: string) => {
    const res = await adminRequest(pwd)
    const data = await res.json() as Record<string, unknown> & { error?: ApiFail }
    if (!res.ok) {
      if (data.error === 'unauthorized') return { ok: false as const, error: 'unauthorized' as const }
      return { ok: false as const, error: String(data.error ?? 'error') }
    }
    return { ok: true as const, stats: normalizeDashboard(data) }
  }, [])

  useEffect(() => {
    let cancelled = false
    refreshDashboard('').then(result => {
      if (cancelled) return
      if (result.ok) setStats(result.stats)
      setInitialLoad(false)
    })
    return () => { cancelled = true }
  }, [refreshDashboard])

  useEffect(() => {
    if (!couponDesign) {
      setDesignPreview(null)
      return
    }
    const url = URL.createObjectURL(couponDesign)
    setDesignPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [couponDesign])

  useEffect(() => {
    if (!generatedThisSession) return

    const onLeave = () => cleanupGeneratedBatch(password)

    window.addEventListener('pagehide', onLeave)
    return () => window.removeEventListener('pagehide', onLeave)
  }, [generatedThisSession, password])

  useEffect(() => {
    return () => {
      if (cutoutPreviewUrl) URL.revokeObjectURL(cutoutPreviewUrl)
    }
  }, [cutoutPreviewUrl])

  const markDemoGenerated = useCallback(async (code: string | null | undefined) => {
    setGeneratedThisSession(true)
    if (code) setPreviewCode(code)
    const result = await refreshDashboard(password)
    if (result.ok) setStats(result.stats)
  }, [password, refreshDashboard])

  const buildDesignForm = useCallback(() => {
    const form = new FormData()
    form.append('password', password)
    if (couponDesign) form.append('design', couponDesign)
    return form
  }, [password, couponDesign])

  const handlePreviewCutout = async () => {
    setGeneratingCutout(true)
    setError('')
    try {
      const previewRes = await fetch('/api/admin/demo-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const previewData = await previewRes.json() as { previewCode?: string; error?: string }
      if (!previewRes.ok || !previewData.previewCode) {
        setError('Could not generate coupon — try again.')
        return
      }

      const cutoutForm = buildDesignForm()
      cutoutForm.append('code', previewData.previewCode)

      const res = await fetch('/api/admin/demo-cutout', { method: 'POST', body: cutoutForm })
      if (!res.ok) {
        setError('Could not render coupon cutout — try again.')
        return
      }

      const blob = await res.blob()
      setCutoutPreviewUrl(prev => {
        if (prev) URL.revokeObjectURL(prev)
        return URL.createObjectURL(blob)
      })

      await markDemoGenerated(previewData.previewCode)
    } catch {
      setError('Network error — try again.')
    } finally {
      setGeneratingCutout(false)
    }
  }

  const handleDownloadPrintSheet = async () => {
    setDownloadingSheet(true)
    setError('')
    try {
      const form = buildDesignForm()
      form.append('reuseBatch', 'true')

      const res = await fetch('/api/admin/demo-pdf', { method: 'POST', body: form })
      if (!res.ok) {
        setError('Could not generate print sheet — preview a cutout first.')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener,noreferrer')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)

      await markDemoGenerated(res.headers.get('X-Preview-Code'))
    } catch {
      setError('Network error — try again.')
    } finally {
      setDownloadingSheet(false)
    }
  }

  const handlePreviewRedemption = async () => {
    setPreviewingRedemption(true)
    setError('')
    try {
      const res = await fetch('/api/admin/demo-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = await res.json() as { previewCode?: string; error?: string }
      if (!res.ok || !data.previewCode) {
        setError('Could not load redemption preview — try again.')
        return
      }
      await markDemoGenerated(data.previewCode)
    } catch {
      setError('Network error — try again.')
    } finally {
      setPreviewingRedemption(false)
    }
  }

  const slice = VIEW_CYCLE[viewIndex % VIEW_CYCLE.length]!
  const fd = useMemo(() => filterDashboard(stats ?? EMPTY_STATS, slice), [stats, slice])

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const result = await refreshDashboard(password)
    if (!result.ok) {
      setError(result.error === 'unauthorized' ? 'Wrong password.' : 'Something went wrong.')
    } else {
      setStats(result.stats)
    }
    setLoading(false)
  }

  const handleResetCoupon = async (code: string) => {
    if (!confirm(`Clear redemption for ${code}? The coupon can be used again.`)) return
    setResettingCode(code)
    setError('')
    try {
      const res = await adminRequest(password, code)
      const data = await res.json() as Record<string, unknown> & { error?: ApiFail }

      if (res.status === 401) {
        setStats(null)
        setPassword('')
        setError('Session expired — sign in again.')
        return
      }

      if (!res.ok) {
        const map: Record<string, string> = {
          unknown_code: 'That code does not exist in this project.',
          not_redeemed: 'That code is already available (not redeemed).',
          invalid_code: 'Invalid code format.',
          demo_restricted: 'Only freshly generated coupon codes can be reset here.',
        }
        const key = typeof data.error === 'string' ? data.error : 'error'
        setError(map[key] ?? `Could not reset: ${key}`)
        return
      }

      setStats(normalizeDashboard(data))
    } catch {
      setError('Network error — try again.')
    } finally {
      setResettingCode(null)
    }
  }

  // ── Login form ─────────────────────────────────────
  if (!stats) {
    if (initialLoad) {
      return (
        <main className="page">
          <div className="card">
            <div className="icon-wrap" style={{ background: '#f3e8ff', marginBottom: 20 }}>🔒</div>
            <h1 className="headline" style={{ fontSize: '1.5rem' }}>Admin</h1>
            <p style={{ color: '#888', fontSize: '0.9rem', marginTop: 16 }}>Loading…</p>
          </div>
        </main>
      )
    }
    return (
      <main className="page">
        <div className="card">
          <div className="icon-wrap" style={{ background: '#f3e8ff', marginBottom: 20 }}>🔒</div>
          <h1 className="headline" style={{ fontSize: '1.5rem' }}>Admin</h1>
          <form onSubmit={handleLogin} style={{ marginTop: 16 }}>
            <label style={{ display: 'block', textAlign: 'left', fontSize: '0.85rem', fontWeight: 600, color: '#555' }}>
              Password
              <input
                type="password"
                className="login-input"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            {error && <p className="error-msg">{error}</p>}
            <button className="btn-primary" type="submit" disabled={loading}>
              {loading ? 'Checking…' : 'Sign in'}
            </button>
          </form>
        </div>
      </main>
    )
  }

  const stepView = (delta: number) => {
    setViewIndex(i => {
      const n = VIEW_CYCLE.length
      return ((i + delta) % n + n) % n
    })
  }

  return (
    <div className="admin-page">
      <div className="admin-inner">
        <div className="admin-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 className="admin-title">Admin Dashboard</h1>
            <p style={{ color: '#666', fontSize: '0.85rem', marginTop: 4 }}>
              QR redemption stats across campaigns — use ‹ › to focus one brand or see combined totals.
            </p>
          </div>
          {!stats.demoMode && (
            <button
              type="button"
              onClick={() => { setStats(null); setPassword(''); setError(''); setViewIndex(0) }}
              style={{ background: 'none', border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: '0.85rem', color: '#555' }}
            >
              Sign out
            </button>
          )}
        </div>

        <div className="coupon-generator" style={{ marginTop: 20, padding: '16px 18px', background: '#fafafa', border: '1px solid #e5e7eb', borderRadius: 12 }}>
          <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 260px', minWidth: 0 }}>
              <h2 className="section-title" style={{ marginBottom: 4 }}>Generate coupons</h2>
              <p style={{ color: '#444', fontSize: '0.85rem', marginBottom: 8, lineHeight: 1.45 }}>
                Every code is unique and single-use — redemption confirms the coupon is authentic, not a screenshot or duplicate.
              </p>
              <p style={{ color: '#666', fontSize: '0.82rem', marginBottom: 14 }}>
                Upload your own design (optional) or use a default. Preview shows one printer cutout — the slip you&apos;d cut from the sheet.
              </p>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#444', maxWidth: 360 }}>
                Coupon design
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/jpg"
                  onChange={e => setCouponDesign(e.target.files?.[0] ?? null)}
                  style={{ display: 'block', marginTop: 6, fontSize: '0.8rem', width: '100%' }}
                />
                <span style={{ fontWeight: 400, color: '#888', fontSize: '0.75rem' }}>PNG or JPG · Playa default if empty</span>
              </label>
              {designPreview && (
                <div style={{ marginTop: 12 }}>
                  <img
                    src={designPreview}
                    alt="Uploaded coupon design preview"
                    style={{ maxHeight: 100, maxWidth: '100%', borderRadius: 8, border: '1px solid #e5e7eb' }}
                  />
                </div>
              )}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
                <button
                  type="button"
                  onClick={handlePreviewCutout}
                  disabled={generatingCutout || downloadingSheet || previewingRedemption}
                  className="btn-primary"
                  style={{ marginTop: 0, padding: '10px 18px', width: 'auto', fontSize: '0.9rem' }}
                >
                  {generatingCutout ? 'Generating…' : 'Preview coupon cutout'}
                </button>
                <button
                  type="button"
                  onClick={handlePreviewRedemption}
                  disabled={generatingCutout || downloadingSheet || previewingRedemption}
                  style={{
                    marginTop: 0,
                    padding: '10px 18px',
                    width: 'auto',
                    fontSize: '0.9rem',
                    borderRadius: 10,
                    border: '1px solid #e5e7eb',
                    background: '#fff',
                    color: '#333',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {previewingRedemption ? 'Loading…' : 'Preview redemption'}
                </button>
              </div>

              {cutoutPreviewUrl && (
                <div style={{ marginTop: 18 }}>
                  <p style={{ fontSize: '0.82rem', fontWeight: 600, color: '#444', marginBottom: 8 }}>
                    Printer cutout — one slip
                  </p>
                  <div
                    style={{
                      maxWidth: 380,
                      padding: 10,
                      border: '2px dashed #c4c4c4',
                      borderRadius: 6,
                      background: '#fff',
                      boxShadow: '0 4px 14px rgba(0,0,0,0.06)',
                    }}
                  >
                    <iframe
                      src={cutoutPreviewUrl}
                      title="Coupon cutout preview"
                      style={{
                        display: 'block',
                        width: '100%',
                        aspectRatio: String(CUTOUT_ASPECT),
                        border: 'none',
                        borderRadius: 2,
                      }}
                    />
                  </div>
                  <p style={{ fontSize: '0.75rem', color: '#888', marginTop: 8 }}>
                    Cut along the dashed border · same size as one cell on the 2×5 print sheet
                    {' · '}
                    <button
                      type="button"
                      onClick={handleDownloadPrintSheet}
                      disabled={downloadingSheet}
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        color: '#2563eb',
                        cursor: 'pointer',
                        fontSize: 'inherit',
                        textDecoration: 'underline',
                      }}
                    >
                      {downloadingSheet ? 'Preparing…' : 'Download full print sheet'}
                    </button>
                  </p>
                </div>
              )}

              {previewCode && (
                <div style={{ marginTop: 18 }}>
                  <p style={{ fontSize: '0.82rem', fontWeight: 600, color: '#444', marginBottom: 10 }}>
                    Customer view — what they see after scanning
                  </p>
                  <div
                    style={{
                      width: 'min(100%, 300px)',
                      border: '10px solid #1f2937',
                      borderRadius: 28,
                      overflow: 'hidden',
                      boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                      background: '#fff',
                    }}
                  >
                    <iframe
                      key={previewCode}
                      src={`/redeem?code=${encodeURIComponent(previewCode)}`}
                      title="Redemption preview"
                      style={{ display: 'block', width: '100%', height: 520, border: 'none' }}
                    />
                  </div>
                  <p style={{ fontSize: '0.75rem', color: '#888', marginTop: 8 }}>
                    Code <code style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 4 }}>{previewCode}</code>
                    {' · '}
                    <a
                      href={`/redeem?code=${encodeURIComponent(previewCode)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#2563eb' }}
                    >
                      Open full screen
                    </a>
                  </p>
                </div>
              )}
            </div>

            <div style={{ flex: '0 1 200px', minWidth: 160 }}>
              <p style={{ fontSize: '0.82rem', fontWeight: 600, color: '#444', marginBottom: 10 }}>Default designs</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <img
                    src="/api/coupon-art/playa"
                    alt="Playa Bowls default coupon"
                    style={{ width: '100%', borderRadius: 8, border: '1px solid #e5e7eb', display: 'block' }}
                  />
                  <span style={{ fontSize: '0.72rem', color: '#888', marginTop: 4, display: 'block' }}>Playa Bowls</span>
                </div>
                <div>
                  <img
                    src="/api/coupon-art/scoops"
                    alt="Scoops default coupon"
                    style={{ width: '100%', borderRadius: 8, border: '1px solid #e5e7eb', display: 'block' }}
                  />
                  <span style={{ fontSize: '0.72rem', color: '#888', marginTop: 4, display: 'block' }}>Scoops</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {error && (
          <p className="error-msg" style={{ marginTop: 12, marginBottom: 0 }}>
            {error}
          </p>
        )}

        <div className="admin-view-switch" role="group" aria-label="Program filter">
          <button type="button" className="admin-view-arrow" aria-label="Previous program" onClick={() => stepView(-1)}>
            ‹
          </button>
          <div className="admin-view-center">
            <div className="admin-view-label">{fd.label}</div>
            <p className="admin-view-sub">{fd.sub}</p>
          </div>
          <button type="button" className="admin-view-arrow" aria-label="Next program" onClick={() => stepView(1)}>
            ›
          </button>
        </div>

        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-number">{fd.total}</div>
            <div className="stat-label">{slice === 'all' ? 'Total QR codes' : 'QR codes (this slice)'}</div>
          </div>
          <div className="stat-card">
            <div className="stat-number" style={{ backgroundImage: 'linear-gradient(135deg, #22c55e, #16a34a)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              {fd.redeemed}
            </div>
            <div className="stat-label">Redeemed</div>
          </div>
          <div className="stat-card">
            <div className="stat-number" style={{ backgroundImage: 'linear-gradient(135deg, #3b82f6, #1d4ed8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              {fd.remaining}
            </div>
            <div className="stat-label">Remaining</div>
          </div>
          <div className="stat-card">
            <div className="stat-number" style={{ backgroundImage: 'linear-gradient(135deg, #f59e0b, #d97706)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              {fd.pct}%
            </div>
            <div className="stat-label">Redemption rate</div>
          </div>
        </div>

        {fd.campaignKeys.length > 0 && (
          <div style={{ marginBottom: 28 }}>
            <h2 className="section-title" style={{ marginBottom: 12 }}>
              {slice === 'all' ? 'By campaign' : 'Campaign breakdown'}
            </h2>
            <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
              {fd.campaignKeys.map(key => (
                <div className="stat-card" key={key}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: 8, color: '#333', lineHeight: 1.3 }}>
                    {stats.campaigns[key].heading}
                  </div>
                  <div style={{ fontSize: '0.68rem', color: '#888', marginBottom: 6, fontFamily: 'ui-monospace, monospace' }}>
                    {campaignSlugFootnote(key)}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#555', display: 'grid', gap: 4 }}>
                    <span>{stats.campaigns[key].total} total</span>
                    <span>{stats.campaigns[key].remaining} remaining</span>
                    <span style={{ color: '#16a34a' }}>{stats.campaigns[key].redeemed} redeemed</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {slice !== 'all' && fd.total === 0 ? (
          <div style={{ textAlign: 'center', padding: '28px 0', color: '#999', fontSize: '0.9rem' }}>
            No QR codes in Redis for this slice yet — generate a batch or switch view with the arrows.
          </div>
        ) : fd.redeemedCodes.length > 0 ? (
          <div>
            <h2 className="section-title">Redeemed codes ({fd.redeemed})</h2>
            <p style={{ color: '#888', fontSize: '0.78rem', marginTop: '-6px', marginBottom: 12 }}>
              {fd.redeemedCodes.length < fd.redeemed
                ? `Showing ${fd.redeemedCodes.length} recent redemptions · ${fd.redeemed.toLocaleString()} total in this slice.`
                : 'Reset applies in Redis · the table respects the Playa / Scoops filter above.'}
            </p>
            <div className="code-table admin-table-reset">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Code</th>
                    <th>Campaign</th>
                    <th>Redeemed at</th>
                    <th style={{ width: 88 }} aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {fd.redeemedCodes.map((row, i) => {
                    const resetLocked = stats.demoMode && rowBucket(row) !== DEMO_BUCKET
                    return (
                    <tr key={`${row.code}-${row.redeemedAt}`}>
                      <td style={{ color: '#999' }}>{i + 1}</td>
                      <td>{row.code}</td>
                      <td style={{ fontSize: '0.82rem', color: '#444' }}>
                        {row.campaignHeading ?? '—'}
                      </td>
                      <td style={{ fontFamily: 'inherit', fontSize: '0.82rem', color: '#444' }}>
                        {fmt(row.redeemedAt)}
                      </td>
                      <td>
                        <button
                          type="button"
                          disabled={resettingCode !== null || resetLocked}
                          onClick={() => handleResetCoupon(row.code)}
                          className="btn-reset-row"
                          title={resetLocked ? 'Historical codes cannot be reset' : `Clear redemption for ${row.code}`}
                        >
                          {resettingCode === row.code ? '…' : 'Reset'}
                        </button>
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : stats.redeemed > 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: '#999' }}>
            No redemptions in this slice · other campaigns may still have redeemed codes (switch view).
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>
            No coupons redeemed yet.
          </div>
        )}
      </div>
    </div>
  )
}
