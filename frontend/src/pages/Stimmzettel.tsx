import React, { useState, useEffect, useRef } from 'react'

export function Stimmzettel() {
    const [parties, setParties] = useState<any[]>([])
    const [candidates, setCandidates] = useState<any[]>([])
    const [constituencyName, setConstituencyName] = useState<string | null>(null)
    const [constituencyNumber, setConstituencyNumber] = useState<number>(1)
    const [year, setYear] = useState<number>(2025)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const [selectedFirst, setSelectedFirst] = useState<number | 'invalid' | null>(null)
    const [selectedSecond, setSelectedSecond] = useState<number | 'invalid' | null>(null)
    const [submitting, setSubmitting] = useState(false)
    const [submitResult, setSubmitResult] = useState<string | null>(null)
    const [authorized, setAuthorized] = useState(false)

    // Debug mode: constituency number and year input
    const [debugConstituencyInput, setDebugConstituencyInput] = useState('')
    const [debugYearInput, setDebugYearInput] = useState('2025')

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

    // Debug: change constituency and year
    function handleDebugConstituencyChange() {
        const num = parseInt(debugConstituencyInput, 10)
        const yr = parseInt(debugYearInput, 10)
        if (!isNaN(num) && num > 0) {
            setConstituencyNumber(num)
            setSelectedFirst(null)
            setSelectedSecond(null)
        }
        if (!isNaN(yr) && yr > 2000) {
            setYear(yr)
            setSelectedFirst(null)
            setSelectedSecond(null)
        }
    }

    useEffect(() => {
        let mounted = true
        async function load() {
            setLoading(true)
            setError(null)
            try {
                const [pRes, cRes, infoRes] = await Promise.all([
                    fetch(`/api/constituency/${constituencyNumber}/parties?year=${year}`),
                    fetch(`/api/constituency/${constituencyNumber}/candidates?year=${year}`),
                    fetch(`/api/constituencies?year=${year}`),
                ])
                const pJson = await pRes.json()
                const cJson = await cRes.json()
                const infoJson = await infoRes.json()
                if (!mounted) return
                setParties(pJson.data || pJson.result || pJson)
                setCandidates(cJson.data || cJson)
                // Find constituency name from list
                const constInfo = (infoJson.data || []).find((c: any) => c.number === constituencyNumber)
                setConstituencyName(constInfo?.name || null)
            } catch (err: any) {
                setError(String(err))
            } finally {
                setLoading(false)
            }
        }
        load()
        return () => { mounted = false }
    }, [constituencyNumber, year])

    async function submitBallot() {
        setSubmitResult(null)
        setSubmitting(true)
        try {
            const body = {
                constituencyNumber: constituencyNumber,
                year: year,
                first: selectedFirst === 'invalid' || selectedFirst === null ? { type: 'invalid' } : { type: 'candidate', person_id: selectedFirst },
                second: selectedSecond === 'invalid' || selectedSecond === null ? { type: 'invalid' } : { type: 'party', party_id: selectedSecond },
                voteCode: fullCode()
            }
            const res = await fetch('/api/ballot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
            const json = await res.json()
            if (res.ok) {
                alert('Ballot submitted! Thank you for voting.');
                setAuthorized(false)
                setCodeParts(Array.from({ length: 16 }, () => ''))
                setSelectedFirst(null)
                setSelectedSecond(null)
                if (inputRefs.current[0]) inputRefs.current[0].focus()
            } else {
                alert('Submission failed, try again.');
                console.error('Submission error', json);
                setSubmitResult('Submission failed')
            }
        } catch (err: any) {
            setSubmitResult(String(err))
        } finally {
            setSubmitting(false)
        }
    }

    // If not authorized (pre-vote), show code entry screen
    if (!authorized) {
        return (
            <div style={{ padding: 20 }}>
                <h1 className="text-2xl font-bold mb-4">Enter Voting Code</h1>
                <p className="mb-4">Please enter your 16-character voting code.</p>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {codeParts.map((part, idx) => (
                        <React.Fragment key={idx}>
                            <input
                                ref={(el) => { inputRefs.current[idx] = el!; }}
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
                        Continue to Vote
                    </button>
                </div>

                {/* Debug: Change constituency and year */}
                <div style={{ marginTop: 24, padding: 16, border: '1px dashed #999', borderRadius: 8, backgroundColor: '#f9f9f9' }}>
                    <p className="text-sm font-semibold text-gray-600 mb-2">Debug: Change Constituency & Year</p>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <input
                            type="number"
                            min="1"
                            max="299"
                            placeholder="Constituency #"
                            value={debugConstituencyInput}
                            onChange={(e) => setDebugConstituencyInput(e.target.value)}
                            style={{ width: 120, padding: 8, border: '1px solid #ccc', borderRadius: 4 }}
                        />
                        <input
                            type="number"
                            min="2017"
                            max="2025"
                            placeholder="Year"
                            value={debugYearInput}
                            onChange={(e) => setDebugYearInput(e.target.value)}
                            style={{ width: 80, padding: 8, border: '1px solid #ccc', borderRadius: 4 }}
                        />
                        <button
                            className="bg-gray-600 text-white px-3 py-2 rounded text-sm"
                            onClick={handleDebugConstituencyChange}
                        >
                            Set
                        </button>
                        <span className="text-sm text-gray-500">Current: #{constituencyNumber} {constituencyName ? `(${constituencyName})` : ''} - Year {year}</span>
                    </div>
                </div>
            </div>
        )
    }

    // Authorized voting view
    return (
        <div style={{ padding: 20 }}>
            <h1 className="text-2xl font-bold mb-4">Ballot: #{constituencyNumber} {constituencyName} ({year})</h1>
            <div style={{ marginBottom: 12 }}>
                <a href="/" className="text-blue-500 hover:underline">Back to Explorer</a>
            </div>
            {loading && <div>Loading...</div>}
            {error && <div style={{ color: 'red' }}>{error}</div>}

            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 300 }}>
                    <h3 className="text-xl font-semibold mb-2">Direct Candidates (First Vote)</h3>
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
                            <span className="text-red-600">Invalid / No First Vote</span>
                        </label>
                    </div>
                </div>

                <div style={{ flex: 1, minWidth: 300 }}>
                    <h3 className="text-xl font-semibold mb-2">Parties (Second Vote)</h3>
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
                            <span className="text-red-600">Invalid / No Second Vote</span>
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
