'use client'

import { useCallback, useEffect, useMemo, useState, FormEvent } from 'react'

const ADMIN_ORIGINAL_BUCKET = '__original__'
const DEMO_BUCKET = 'demo'
const CUTOUT_ASPECT = 278 / 147.2

interface RedeemedCode {
  code: string
  redeemedAt: string
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

type ApiFail = 'unauthorized' | 'bad_request' | 'invalid_code' | 'unknown_code' | 'not_redeemed' | string

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

function campaignCardClass(key: string): string {
  if (key === ADMIN_ORIGINAL_BUCKET) return 'campaign-card campaign-card-playa'
  if (key === 'scoops' || key.startsWith('scoops')) return 'campaign-card campaign-card-scoops'
  return 'campaign-card'
}

function sortedCampaignKeys(campaigns: Record<string, CampaignTotals>): string[] {
  return Object.keys(campaigns)
    .filter(k => campaigns[k].total > 0)
    .sort((a, b) => {
      if (a === ADMIN_ORIGINAL_BUCKET) return -1
      if (b === ADMIN_ORIGINAL_BUCKET) return 1
      return a.localeCompare(b)
    })
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
  const [generatingCutout, setGeneratingCutout] = useState(false)
  const [downloadingSheet, setDownloadingSheet] = useState(false)
  const [previewCode, setPreviewCode] = useState<string | null>(null)
  const [cutoutPreviews, setCutoutPreviews] = useState<{ id: string; label: string; url: string }[]>([])
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
      for (const c of cutoutPreviews) URL.revokeObjectURL(c.url)
    }
  }, [cutoutPreviews])

  const revokeCutoutPreviews = useCallback((previews: { url: string }[]) => {
    for (const c of previews) URL.revokeObjectURL(c.url)
  }, [])

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

  const fetchCutoutBlob = async (code: string, preset?: string, design?: File | null) => {
    const form = new FormData()
    form.append('password', password)
    form.append('code', code)
    if (preset) form.append('preset', preset)
    if (design) form.append('design', design)
    const res = await fetch('/api/admin/demo-cutout', { method: 'POST', body: form })
    if (!res.ok) return null
    const blob = await res.blob()
    return URL.createObjectURL(blob)
  }

  const handlePreviewCutout = async () => {
    setGeneratingCutout(true)
    setError('')
    try {
      const previewRes = await fetch('/api/admin/demo-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const previewData = await previewRes.json() as { previewCode?: string }
      if (!previewRes.ok || !previewData.previewCode) {
        setError('Could not generate coupon.')
        return
      }

      const code = previewData.previewCode
      let next: { id: string; label: string; url: string }[] = []

      if (couponDesign) {
        const url = await fetchCutoutBlob(code, undefined, couponDesign)
        if (!url) {
          setError('Could not render cutout.')
          return
        }
        next = [{ id: 'custom', label: 'Custom', url }]
      } else {
        const [hanoverUrl, scoopsUrl] = await Promise.all([
          fetchCutoutBlob(code, 'playa'),
          fetchCutoutBlob(code, 'scoops'),
        ])
        if (!hanoverUrl || !scoopsUrl) {
          setError('Could not render cutouts.')
          return
        }
        next = [
          { id: 'playa', label: 'Hanover', url: hanoverUrl },
          { id: 'scoops', label: 'Scoops', url: scoopsUrl },
        ]
      }

      setCutoutPreviews(prev => {
        revokeCutoutPreviews(prev)
        return next
      })

      await markDemoGenerated(code)
    } catch {
      setError('Network error.')
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
        setError('Generate a cutout first.')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener,noreferrer')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      await markDemoGenerated(res.headers.get('X-Preview-Code'))
    } catch {
      setError('Network error.')
    } finally {
      setDownloadingSheet(false)
    }
  }

  const campaignKeys = useMemo(
    () => sortedCampaignKeys(stats?.campaigns ?? {}),
    [stats?.campaigns]
  )

  const redemptionPct = stats && stats.total > 0
    ? Math.round((stats.redeemed / stats.total) * 100)
    : 0

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
    if (!confirm(`Reset ${code}?`)) return
    setResettingCode(code)
    setError('')
    try {
      const res = await adminRequest(password, code)
      const data = await res.json() as Record<string, unknown> & { error?: ApiFail }

      if (res.status === 401) {
        setStats(null)
        setPassword('')
        setError('Session expired.')
        return
      }

      if (!res.ok) {
        const map: Record<string, string> = {
          unknown_code: 'Code not found.',
          not_redeemed: 'Not redeemed yet.',
          invalid_code: 'Invalid code.',
          demo_restricted: 'Only new demo codes can be reset.',
        }
        const key = typeof data.error === 'string' ? data.error : 'error'
        setError(map[key] ?? `Could not reset.`)
        return
      }

      setStats(normalizeDashboard(data))
    } catch {
      setError('Network error.')
    } finally {
      setResettingCode(null)
    }
  }

  if (!stats) {
    if (initialLoad) {
      return (
        <main className="page">
          <div className="card">
            <h1 className="headline" style={{ fontSize: '1.5rem' }}>Admin</h1>
            <p className="subtext">Loading…</p>
          </div>
        </main>
      )
    }
    return (
      <main className="page">
        <div className="card">
          <h1 className="headline" style={{ fontSize: '1.5rem' }}>Admin</h1>
          <form onSubmit={handleLogin} style={{ marginTop: 16 }}>
            <label style={{ display: 'block', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500, color: '#555' }}>
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

  return (
    <div className="admin-page">
      <div className="admin-inner">
        <div className="admin-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 className="admin-title">Admin</h1>
          {!stats.demoMode && (
            <button type="button" className="admin-btn-secondary" onClick={() => { setStats(null); setPassword(''); setError('') }}>
              Sign out
            </button>
          )}
        </div>

        <div className="coupon-generator" style={{ marginTop: 16, padding: '16px 18px', background: '#fafafa', border: '1px solid #e5e7eb', borderRadius: 10 }}>
          <h2 className="section-title">Generate</h2>
          <p className="admin-muted" style={{ marginBottom: 12 }}>
            Unique single-use codes. Upload optional.
          </p>
          <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#444', maxWidth: 360 }}>
            Design (PNG/JPG)
            <input
              type="file"
              accept="image/png,image/jpeg,image/jpg"
              onChange={e => setCouponDesign(e.target.files?.[0] ?? null)}
              style={{ display: 'block', marginTop: 6, fontSize: '0.875rem', width: '100%' }}
            />
          </label>
          {designPreview && (
            <img
              src={designPreview}
              alt="Upload preview"
              style={{ marginTop: 10, maxHeight: 64, maxWidth: 200, borderRadius: 6, border: '1px solid #e5e7eb' }}
            />
          )}
          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              onClick={handlePreviewCutout}
              disabled={generatingCutout || downloadingSheet}
              className="btn-primary"
              style={{ marginTop: 0, padding: '10px 16px', width: 'auto', fontSize: '0.875rem', fontWeight: 600 }}
            >
              {generatingCutout ? '…' : 'Preview cutout'}
            </button>
          </div>

          {(cutoutPreviews.length > 0 || previewCode) && (
            <div className="preview-row">
              {cutoutPreviews.map(c => (
                <div className="preview-cutout-slot" key={c.id}>
                  <p className={`preview-cutout-label preview-cutout-label-${c.id}`}>{c.label}</p>
                  <div className="preview-cutout-frame">
                    <iframe
                      src={c.url}
                      title={`${c.label} cutout`}
                      className="preview-cutout-iframe"
                    />
                  </div>
                </div>
              ))}
              {previewCode && (
                <div className="preview-phone-slot">
                  <p className="preview-cutout-label">Redeem</p>
                  <div className="preview-phone-frame">
                    <iframe
                      key={previewCode}
                      src={`/redeem?code=${encodeURIComponent(previewCode)}`}
                      title="Redeem preview"
                      className="preview-phone-iframe"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
          {cutoutPreviews.length > 0 && (
            <p className="admin-muted" style={{ marginTop: 8, fontSize: '0.8rem' }}>
              <button type="button" className="admin-btn-inline" onClick={handleDownloadPrintSheet} disabled={downloadingSheet}>
                {downloadingSheet ? '…' : 'Download print sheet'}
              </button>
            </p>
          )}
        </div>

        {error && <p className="error-msg" style={{ marginTop: 12 }}>{error}</p>}

        <div className="stat-grid" style={{ marginTop: 24 }}>
          <div className="stat-card">
            <div className="stat-number">{stats.total}</div>
            <div className="stat-label">Total</div>
          </div>
          <div className="stat-card">
            <div className="stat-number stat-redeemed">{stats.redeemed}</div>
            <div className="stat-label">Redeemed</div>
          </div>
          <div className="stat-card">
            <div className="stat-number stat-remaining">{stats.remaining}</div>
            <div className="stat-label">Remaining</div>
          </div>
          <div className="stat-card">
            <div className="stat-number stat-rate">{redemptionPct}%</div>
            <div className="stat-label">Rate</div>
          </div>
        </div>

        {campaignKeys.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <h2 className="section-title section-title-campaign">By campaign</h2>
            <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
              {campaignKeys.map(key => (
                <div className={campaignCardClass(key)} key={key}>
                  <div className="campaign-name">{stats.campaigns[key].heading}</div>
                  <div className="campaign-stats">
                    <span>{stats.campaigns[key].total} total</span>
                    <span className="campaign-stat-redeemed">{stats.campaigns[key].redeemed} redeemed</span>
                    <span>{stats.campaigns[key].remaining} left</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {stats.redeemedCodes.length > 0 ? (
          <div>
            <h2 className="section-title">Recent redemptions</h2>
            <div className="code-table admin-table-reset">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Code</th>
                    <th>Campaign</th>
                    <th>Redeemed</th>
                    <th style={{ width: 72 }} aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {stats.redeemedCodes.map((row, i) => {
                    const resetLocked = stats.demoMode && (row.campaignBucket ?? ADMIN_ORIGINAL_BUCKET) !== DEMO_BUCKET
                    return (
                      <tr key={`${row.code}-${row.redeemedAt}`}>
                        <td style={{ color: '#999' }}>{i + 1}</td>
                        <td>{row.code}</td>
                        <td>{row.campaignHeading ?? '—'}</td>
                        <td>{fmt(row.redeemedAt)}</td>
                        <td>
                          <button
                            type="button"
                            disabled={resettingCode !== null || resetLocked}
                            onClick={() => handleResetCoupon(row.code)}
                            className="btn-reset-row"
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
        ) : null}
      </div>
    </div>
  )
}
