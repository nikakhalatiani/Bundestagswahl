import React, { useState } from 'react'

function JsonView({ data }: { data: any }) {
  return (
    <pre style={{ whiteSpace: 'pre-wrap', background: '#fff', padding: 12, borderRadius: 6, overflowX: 'auto' }}>
      {JSON.stringify(data, null, 2)}
    </pre>
  )
}

export default function App() {
  const [year, setYear] = useState<number>(2025)
  const [constituencyId, setConstituencyId] = useState<number | ''>('')
  const [ids, setIds] = useState<string>('')
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function call(path: string) {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch(path)
      const json = await res.json()
      setResult(json)
    } catch (err: any) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>Bundestagswahl — Explorer</h1>
      <div style={{ display: 'flex', gap: 24 }}>
        <div style={{ width: 360 }}>
          <div style={{ marginBottom: 12 }}>
            <label>Year:&nbsp;</label>
            <input value={year} onChange={(e) => setYear(Number(e.target.value || 0))} style={{ width: 120 }} />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label>Wahlkreis id:&nbsp;</label>
            <input value={constituencyId} onChange={(e) => setConstituencyId(e.target.value === '' ? '' : Number(e.target.value))} style={{ width: 120 }} />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label>Wahlkreis ids (comma):&nbsp;</label>
            <input value={ids} onChange={(e) => setIds(e.target.value)} placeholder="1,2,3" />
          </div>

          <div style={{ display: 'grid', gap: 8 }}>
            <button onClick={() => call(`/api/seats?year=${year}`)}>Q1 Sitzverteilung</button>
            <button onClick={() => call(`/api/members?year=${year}`)}>Q2 Mitglieder des Bundestages</button>
            <button
              onClick={() => {
                if (!constituencyId) return alert('Set a constituency id');
                call(`/api/constituency/${constituencyId}/overview?year=${year}`)
              }}
            >
              Q3 Wahlkreisübersicht
            </button>
            <button onClick={() => call(`/api/constituency-winners?year=${year}`)}>Q4 Stimmkreissieger</button>
            <button onClick={() => call(`/api/direct-without-second-coverage?year=${year}`)}>Q5 Direktmandate ohne Zweitstimmedeckung</button>
            <button onClick={() => call(`/api/closest-winners?year=${year}`)}>Q6 Knappste Sieger (Top 10)</button>
            <button
              onClick={() => {
                const param = ids || ''
                call(`/api/constituencies-single?year=${year}${param ? `&ids=${encodeURIComponent(param)}` : ''}`)
              }}
            >
              Q7 Wahlkreisübersicht (Einzelstimmen)
            </button>
          </div>

          <div style={{ marginTop: 18 }}>
            <small>Backend must be running at the same origin (or adjust fetch URLs).</small>
          </div>
        </div>

        <div style={{ flex: 1 }}>
          <h3>Result</h3>
          {loading && <div>Loading...</div>}
          {error && <div style={{ color: 'red' }}>{error}</div>}
          {result && <JsonView data={result} />}
        </div>
      </div>
    </div>
  )
}
