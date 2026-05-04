'use client'

import { useCallback, useMemo, useState, FormEvent } from 'react'
import {
  ADMIN_ORIGINAL_BUCKET,
  isPlayaCampaignBucket,
  isScoopsCampaignBucket,
} from '@/lib/coupon-record'

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
}

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

export default function AdminPage() {
  const [password, setPassword] = useState('')
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [resettingCode, setResettingCode] = useState<string | null>(null)
  const [viewIndex, setViewIndex] = useState(0)

  const refreshDashboard = useCallback(async (pwd: string) => {
    const res = await adminRequest(pwd)
    const data = await res.json() as Record<string, unknown> & { error?: ApiFail }
    if (!res.ok) {
      if (data.error === 'unauthorized') return { ok: false as const, error: 'unauthorized' as const }
      return { ok: false as const, error: String(data.error ?? 'error') }
    }
    return { ok: true as const, stats: normalizeDashboard(data) }
  }, [])

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

  const slice = VIEW_CYCLE[viewIndex % VIEW_CYCLE.length]!
  const fd = useMemo(() => filterDashboard(stats, slice), [stats, slice])

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
              Same redeem site for Playa and Scoops — use ‹ › to focus one brand or see combined totals.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { setStats(null); setPassword(''); setError(''); setViewIndex(0) }}
            style={{ background: 'none', border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: '0.85rem', color: '#555' }}
          >
            Sign out
          </button>
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
            <h2 className="section-title" style={{ marginBottom: 8 }}>
              {slice === 'all' ? 'By campaign' : 'Campaign breakdown'}
            </h2>
            <p style={{ color: '#888', fontSize: '0.78rem', marginBottom: 12 }}>
              {slice === 'all' ? (
                <>
                  Each batch uses the slug from <code style={{ fontSize: '0.76rem', background: '#f3f4f6', padding: '2px 5px', borderRadius: 4 }}>npm run generate-codes -- --campaign …</code>.
                  Playa’s first batch lives in the legacy bucket unless you retagged it.
                </>
              ) : slice === 'playa' ? (
                <>Showing only Playa’s legacy (“no tag”) Redis entries.</>
              ) : (
                <>Showing buckets whose slug is <code style={{ fontSize: '0.76rem', background: '#f3f4f6', padding: '2px 5px', borderRadius: 4 }}>scoops</code> or starts with <code style={{ fontSize: '0.76rem', background: '#f3f4f6', padding: '2px 5px', borderRadius: 4 }}>scoops-</code>.</>
              )}
            </p>
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
            <h2 className="section-title">Redeemed codes ({fd.redeemedCodes.length})</h2>
            <p style={{ color: '#888', fontSize: '0.78rem', marginTop: '-6px', marginBottom: 12 }}>
              Reset applies in Redis · the table respects the Playa / Scoops filter above.
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
                  {fd.redeemedCodes.map((row, i) => (
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
                          disabled={resettingCode !== null}
                          onClick={() => handleResetCoupon(row.code)}
                          className="btn-reset-row"
                          title={`Clear redemption for ${row.code}`}
                        >
                          {resettingCode === row.code ? '…' : 'Reset'}
                        </button>
                      </td>
                    </tr>
                  ))}
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
