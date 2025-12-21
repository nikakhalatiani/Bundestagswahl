import React, { useState, useEffect } from 'react'

function JsonView({ data }: { data: any }) {
  return (
    <pre style={{ whiteSpace: 'pre-wrap', background: '#fff', padding: 12, borderRadius: 6, overflowX: 'auto' }}>
      {JSON.stringify(data, null, 2)}
    </pre>
  )
}

export default function App() {
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/'
  if (pathname === '/stimmzettel') return <StimmzettelView />
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
      <h1>Bundestagswahl</h1>
      <div style={{ marginBottom: 12 }}>
        <a href="/stimmzettel">Stimmzettel</a> <a href="/">Explorer</a>
      </div>
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

  function StimmzettelView() {
    const [parties, setParties] = useState<any[]>([])
    const [candidates, setCandidates] = useState<any[]>([])
    const [constituencyName, setConstituencyName] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const [selectedFirst, setSelectedFirst] = useState<number | 'invalid' | null>(null)
    const [selectedSecond, setSelectedSecond] = useState<number | 'invalid' | null>(null)
    const [submitting, setSubmitting] = useState(false)
    const [submitResult, setSubmitResult] = useState<string | null>(null)

    useEffect(() => {
      let mounted = true
      async function load() {
        setLoading(true)
        setError(null)
        try {
          const [pRes, cRes, infoRes] = await Promise.all([
            fetch('/api/constituency/1/parties?year=2025'),
            fetch('/api/constituency/1/candidates?year=2025'),
            fetch('/api/constituency/1'),
          ])
          const pJson = await pRes.json()
          const cJson = await cRes.json()
          const infoJson = await infoRes.json()
          if (!mounted) return
          setParties(pJson.data || pJson.result || pJson)
          setCandidates(cJson.data || cJson)
          setConstituencyName(infoJson.data?.name || infoJson.name || null)
        } catch (err: any) {
          setError(String(err))
        } finally {
          setLoading(false)
        }
      }
      load()
      return () => { mounted = false }
    }, [])

    async function submitBallot() {
      setSubmitResult(null)
      setSubmitting(true)
      try {
        const body = {
          constituencyId: 1,
          year: 2025,
          first: selectedFirst === 'invalid' || selectedFirst === null ? { type: 'invalid' } : { type: 'candidate', person_id: selectedFirst },
          second: selectedSecond === 'invalid' || selectedSecond === null ? { type: 'invalid' } : { type: 'party', party_id: selectedSecond }
        }
        const res = await fetch('/api/ballot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        const json = await res.json()
        if (res.ok) {
          alert('Ballot submitted! Thank you for voting.');
        } else {
          alert('Submission failed, try again.');
          console.error('Submission error', json);
        }
        
        setSubmitResult('Ballot submitted')
      } catch (err: any) {
        setSubmitResult(String(err))
      } finally {
        setSubmitting(false)
      }
    }

    return (
      <div style={{ padding: 20 }}>
        <h1>Stimmzettel: {constituencyName}</h1>
        <div style={{ marginBottom: 12 }}>
          <a href="/">Back to Explorer</a>
        </div>
        {loading && <div>Loading...</div>}
        {error && <div style={{ color: 'red' }}>{error}</div>}

        <div style={{ display: 'flex', gap: 24 }}>
          <div style={{ flex: 1 }}>
            <h3>Direktkandidaten (Erststimmen)</h3>
            <div>
              <ol>
                {candidates.map((c: any) => (
                  <li key={c.person_id || c.id} style={{ marginBottom: 6 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input type="radio" name="first" value={String(c.person_id)} checked={selectedFirst === c.person_id} onChange={() => setSelectedFirst(c.person_id)} />
                      {c.title ? c.title + ' ' : ''}{c.first_name} {c.last_name} ({c.short_name || ''})
                    </label>
                  </li>
                ))}
              </ol>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="radio" name="first" value="invalid" checked={selectedFirst === 'invalid'} onChange={() => setSelectedFirst('invalid')} />
                Ungültig / Keine Erststimme
              </label>
            </div>
          </div>

          <div style={{ flex: 1 }}>
            <h3>Parteien (Zweitstimmen)</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {parties.map((p: any) => (
                <label key={p.id || `${p.short_name}-${p.vote_type}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="radio" name="second" value={String(p.id)} checked={selectedSecond === p.id} onChange={() => setSelectedSecond(p.id)} />
                  <strong>{p.short_name || p.shortName}</strong> ({p.long_name})
                </label>
              ))}
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="radio" name="second" value="invalid" checked={selectedSecond === 'invalid'} onChange={() => setSelectedSecond('invalid')} />
                Ungültig / Keine Zweitstimme
              </label>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          <button onClick={submitBallot} disabled={submitting}>{submitting ? 'Submitting...' : 'Submit Ballot'}</button>
          {submitResult && <div style={{ marginTop: 8 }}>{submitResult}</div>}
        </div>
      </div>
    )
  }

  
