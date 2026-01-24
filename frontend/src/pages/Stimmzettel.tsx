import React, { useState, useEffect, useRef } from 'react'

export function Stimmzettel() {
    const [parties, setParties] = useState<any[]>([])
    const [candidates, setCandidates] = useState<any[]>([])
    const [constituencyName, setConstituencyName] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const [selectedFirst, setSelectedFirst] = useState<number | 'invalid' | null>(null)
    const [selectedSecond, setSelectedSecond] = useState<number | 'invalid' | null>(null)
    const [submitting, setSubmitting] = useState(false)
    const [submitResult, setSubmitResult] = useState<string | null>(null)
    const [authorized, setAuthorized] = useState(false)
    const [submitted, setSubmitted] = useState(false)

    // 16 single-char code inputs (displayed as 4x4 with dashes)
    const [codeParts, setCodeParts] = useState<string[]>(Array.from({ length: 16 }, () => ''))
    const inputRefs = useRef<HTMLInputElement[]>([])

    function normalizeChar(s: string) {
        return s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 1)
    }

    function handleCodeChange(idx: number, val: string) {
        const ch = normalizeChar(val)
        const next = [...codeParts]
        next[idx] = ch
        setCodeParts(next)
        if (ch && idx < 15) {
            const nextEl = inputRefs.current[idx + 1]
            nextEl?.focus()
        }
    }

    function handleKeyDown(idx: number, e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === 'Backspace') {
            if (codeParts[idx] === '' && idx > 0) {
                const prev = inputRefs.current[idx - 1]
                prev?.focus()
            }
        }
    }

    function handlePaste(idx: number, e: React.ClipboardEvent<HTMLInputElement>) {
        const pasted = (e.clipboardData.getData('text') || '')
        const cleaned = pasted.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16 - idx)
        if (!cleaned) return
        const next = [...codeParts]
        for (let i = 0; i < cleaned.length; i++) {
            next[idx + i] = cleaned[i]
        }
        setCodeParts(next)
        // focus after pasted chars
        const focusIdx = Math.min(15, idx + cleaned.length)
        inputRefs.current[focusIdx]?.focus()
        e.preventDefault()
    }

    function fullCode() {
        return codeParts.join('')
    }

    function validateFullCode() {
        const code = fullCode()
        return /^[A-Z0-9]{16}$/.test(code)
    }

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
                setSubmitted(true)
                setAuthorized(false)
            } else {
                alert('Submission failed, try again.');
                console.error('Submission error', json);
                setSubmitResult('Submission failed')
            }
        } catch (err: any) {
            setSubmitResult(String(err))
        } finally {
            setSubmitting(false)
            // Clear code inputs
            setCodeParts(Array.from({ length: 16 }, () => ''))
            // Clear votes
            setSelectedFirst(null)
            setSelectedSecond(null)
        }
    }

    // If not authorized (pre-vote), show code entry screen
    if (!authorized && !submitted) {
        return (
            <div style={{ padding: 20 }}>
                <h1 className="text-2xl font-bold mb-4">Wahlcode eingeben</h1>
                <p className="mb-4">Bitte geben Sie Ihren 16-stelligen Wahlcode ein.</p>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {codeParts.map((part, idx) => (
                        <React.Fragment key={idx}>
                            <input
                                ref={(el) => (inputRefs.current[idx] = el!)}
                                value={part}
                                onChange={(e) => handleCodeChange(idx, e.target.value)}
                                onKeyDown={(e) => handleKeyDown(idx, e)}
                                onPaste={(e) => handlePaste(idx, e)}
                                style={{ width: 30, padding: 8, fontSize: 18, textTransform: 'uppercase', letterSpacing: 2, textAlign: 'center', border: '1px solid #ccc' }}
                            />
                            {(idx % 4 === 3) && idx !== 15 ? <span style={{ padding: '0 6px' }}>-</span> : null}
                        </React.Fragment>
                    ))}
                </div>
                <div style={{ marginTop: 12 }}>
                    <button
                        className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
                        disabled={!validateFullCode()}
                        onClick={() => setAuthorized(true)}
                    >
                        Weiter zur Wahl
                    </button>
                </div>
            </div>
        )
    }

    // After submission: require code again (post-vote screen)
    if (submitted && !authorized) {
        return (
            <div style={{ padding: 20 }}>
                <h1 className="text-2xl font-bold mb-4">Wahlcode eingeben</h1>
                <p className="mb-4">Ihre Stimme wurde abgegeben. Geben Sie den Wahlcode erneut ein, um die Bestätigung zu sehen.</p>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {codeParts.map((part, idx) => (
                        <React.Fragment key={idx}>
                            <input
                                ref={(el) => (inputRefs.current[idx] = el!)}
                                value={part}
                                onChange={(e) => handleCodeChange(idx, e.target.value)}
                                onKeyDown={(e) => handleKeyDown(idx, e)}
                                onPaste={(e) => handlePaste(idx, e)}
                                style={{ width: 30, padding: 8, fontSize: 18, textTransform: 'uppercase', letterSpacing: 2, textAlign: 'center', border: '1px solid #ccc' }}
                            />
                            {(idx % 4 === 3) && idx !== 15 ? <span style={{ padding: '0 6px' }}>-</span> : null}
                        </React.Fragment>
                    ))}
                </div>
                <div style={{ marginTop: 12 }}>
                    <button
                        className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
                        disabled={!validateFullCode()}
                        onClick={() => setAuthorized(true)}
                    >
                        Bestätigung anzeigen
                    </button>
                </div>
            </div>
        )
    }

    // Authorized voting view
    return (
        <div style={{ padding: 20 }}>
            <h1 className="text-2xl font-bold mb-4">Stimmzettel: {constituencyName}</h1>
            <div style={{ marginBottom: 12 }}>
                <a href="/" className="text-blue-500 hover:underline">Back to Explorer</a>
            </div>
            {loading && <div>Loading...</div>}
            {error && <div style={{ color: 'red' }}>{error}</div>}

            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 300 }}>
                    <h3 className="text-xl font-semibold mb-2">Direktkandidaten (Erststimmen)</h3>
                    <div>
                        <ol className="list-decimal pl-5">
                            {candidates.map((c: any) => (
                                <li key={c.person_id || c.id} style={{ marginBottom: 6 }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                                        <input type="radio" name="first" value={String(c.person_id)} checked={selectedFirst === c.person_id} onChange={() => setSelectedFirst(c.person_id)} />
                                        <span>
                                            {c.title ? c.title + ' ' : ''}{c.first_name} {c.last_name} ({c.short_name || ''})
                                        </span>
                                    </label>
                                </li>
                            ))}
                        </ol>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, cursor: 'pointer' }}>
                            <input type="radio" name="first" value="invalid" checked={selectedFirst === 'invalid'} onChange={() => setSelectedFirst('invalid')} />
                            <span className="text-red-600">Ungültig / Keine Erststimme</span>
                        </label>
                    </div>
                </div>

                <div style={{ flex: 1, minWidth: 300 }}>
                    <h3 className="text-xl font-semibold mb-2">Parteien (Zweitstimmen)</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {parties.map((p: any) => (
                            <label key={p.id || `${p.short_name}-${p.vote_type}`} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                                <input type="radio" name="second" value={String(p.id)} checked={selectedSecond === p.id} onChange={() => setSelectedSecond(p.id)} />
                                <span>
                                    <strong>{p.short_name || p.shortName}</strong> ({p.long_name})
                                </span>
                            </label>
                        ))}
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, cursor: 'pointer' }}>
                            <input type="radio" name="second" value="invalid" checked={selectedSecond === 'invalid'} onChange={() => setSelectedSecond('invalid')} />
                            <span className="text-red-600">Ungültig / Keine Zweitstimme</span>
                        </label>
                    </div>
                </div>
            </div>

            <div style={{ marginTop: 18 }}>
                <button
                    className="bg-green-600 text-white px-6 py-3 rounded text-lg font-bold disabled:opacity-50"
                    onClick={submitBallot}
                    disabled={submitting}
                >
                    {submitting ? 'Submitting...' : 'Submit Ballot'}
                </button>
                {submitResult && <div style={{ marginTop: 8 }}>{submitResult}</div>}
            </div>
        </div>
    )
}
