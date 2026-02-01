import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Card, CardHeader, CardSectionTitle, CardSubtitle, CardTitle } from '../components/ui/Card';
import { PartyBadge } from '../components/ui/PartyBadge';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '../components/ui/Table';
import { cn } from '../utils/cn';
import { getPartyColor, getPartyDisplayName } from '../utils/party';

type VoteSelectionStep = 'select' | 'review' | 'done';

function truncatePartyName(text: string, maxLength: number = 16): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - 3) + '...';
}

export function Stimmzettel({ year, setYear }: { year: number; setYear: (y: number) => void }) {
    const navigate = useNavigate();
    const [parties, setParties] = useState<any[]>([]);
    const [candidates, setCandidates] = useState<any[]>([]);
    const [constituencyName, setConstituencyName] = useState<string | null>(null);
    const [constituencyNumber, setConstituencyNumber] = useState<number | null>(null);
    const [constituencyElectionId, setConstituencyElectionId] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [selectedFirst, setSelectedFirst] = useState<number | 'invalid' | null>(null);
    const [selectedSecond, setSelectedSecond] = useState<number | 'invalid' | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [submitResult, setSubmitResult] = useState<string | null>(null);
    const [authorized, setAuthorized] = useState(false);
    const [step, setStep] = useState<VoteSelectionStep>('select');

    const [codeParts, setCodeParts] = useState<string[]>(Array.from({ length: 16 }, () => ''));
    const inputRefs = useRef<HTMLInputElement[]>([]);

    function normalizeChar(s: string) {
        return s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 1);
    }

    function handleCodeChange(idx: number, val: string) {
        const ch = normalizeChar(val);
        const next = [...codeParts];
        next[idx] = ch;
        setCodeParts(next);
        if (ch && idx < 15) {
            const nextEl = inputRefs.current[idx + 1];
            nextEl?.focus();
        }
    }

    function handleKeyDown(idx: number, e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === 'Backspace') {
            if (codeParts[idx] === '' && idx > 0) {
                const prev = inputRefs.current[idx - 1];
                prev?.focus();
            }
        }
    }

    function handlePaste(idx: number, e: React.ClipboardEvent<HTMLInputElement>) {
        const pasted = (e.clipboardData.getData('text') || '');
        const cleaned = pasted.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16 - idx);
        if (!cleaned) return;
        const next = [...codeParts];
        for (let i = 0; i < cleaned.length; i++) {
            next[idx + i] = cleaned[i];
        }
        setCodeParts(next);
        const focusIdx = Math.min(15, idx + cleaned.length);
        inputRefs.current[focusIdx]?.focus();
        e.preventDefault();
    }

    function fullCode() {
        return codeParts.join('');
    }

    function validateFullCode() {
        const code = fullCode();
        return /^[A-Z0-9]{16}$/.test(code);
    }

    useEffect(() => {
        let mounted = true;
        async function load() {
            if (!authorized || !constituencyNumber || !constituencyElectionId) return;
            setLoading(true);
            setError(null);
            try {
                const [pRes, cRes, infoRes] = await Promise.all([
                    fetch(`/api/constituency/${constituencyNumber}/parties?constituencyElectionId=${constituencyElectionId}`),
                    fetch(`/api/constituency/${constituencyNumber}/candidates?constituencyElectionId=${constituencyElectionId}`),
                    fetch(`/api/constituencies?year=${year}`),
                ]);
                const pJson = await pRes.json();
                const cJson = await cRes.json();
                const infoJson = await infoRes.json();
                if (!mounted) return;
                setParties(pJson.data || pJson.result || pJson);
                setCandidates(cJson.data || cJson);
                const constInfo = (infoJson.data || []).find((c: any) => c.number === constituencyNumber);
                setConstituencyName(constInfo?.name || null);
            } catch (err: any) {
                setError(String(err));
            } finally {
                setLoading(false);
            }
        }
        load();
        return () => { mounted = false; };
    }, [authorized, constituencyNumber, constituencyElectionId, year]);

    async function submitBallot() {
        setSubmitResult(null);
        setSubmitting(true);
        try {
            if (!constituencyNumber) {
                setSubmitResult('Unable to submit without a constituency assignment.');
                return;
            }
            const body = {
                constituencyNumber: constituencyNumber,
                year: year,
                first: selectedFirst === 'invalid' || selectedFirst === null
                    ? { type: 'invalid' }
                    : { type: 'candidate', person_id: selectedFirst },
                second: selectedSecond === 'invalid' || selectedSecond === null
                    ? { type: 'invalid' }
                    : { type: 'party', party_id: selectedSecond },
                votingCode: fullCode()
            };
            const res = await fetch('/api/ballot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const json = await res.json();
            if (res.ok) {
                setStep('done');
            } else {
                console.error('Submission error', json);
                setSubmitResult(json.error || 'Submission failed. Please try again.');
            }
        } catch (err: any) {
            setSubmitResult(String(err));
        } finally {
            setSubmitting(false);
        }
    }

    const [validating, setValidating] = useState(false);
    const [codeError, setCodeError] = useState<string | null>(null);

    async function validateAndProceed() {
        setValidating(true);
        setCodeError(null);
        try {
            const res = await fetch('/api/codes/validate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: fullCode() })
            });
            const json = await res.json();
            if (json.valid) {
                if (!json.constituency || !json.year || !json.constituency_election_id) {
                    setCodeError('This voting code is missing constituency information.');
                    return;
                }
                const nextYear = Number(json.year);
                const nextNumber = Number(json.constituency.number);
                const nextConstituencyElectionId = Number(json.constituency_election_id);
                setYear(nextYear);
                setConstituencyNumber(nextNumber);
                setConstituencyName(json.constituency.name || null);
                setConstituencyElectionId(Number.isFinite(nextConstituencyElectionId) ? nextConstituencyElectionId : null);
                setAuthorized(true);
                setStep('select');
                setSubmitResult(null);
            } else {
                if (json.error === 'invalid_code') {
                    setCodeError('Invalid voting code. Please check your entry.');
                } else if (json.error === 'code_already_used') {
                    setCodeError('This voting code has already been used.');
                } else if (json.error === 'code_missing_context') {
                    setCodeError('This voting code is missing constituency details.');
                } else if (json.error === 'invalid_code_context') {
                    setCodeError('This voting code is not valid for the selected election.');
                } else {
                    setCodeError('Unable to validate the code.');
                }
            }
        } catch (err: any) {
            setCodeError('Network error. Please try again.');
        } finally {
            setValidating(false);
        }
    }

    function resetForNextVoter() {
        setAuthorized(false);
        setStep('select');
        setCodeParts(Array.from({ length: 16 }, () => ''));
        setSelectedFirst(null);
        setSelectedSecond(null);
        setConstituencyNumber(null);
        setConstituencyName(null);
        setConstituencyElectionId(null);
        setSubmitResult(null);
        setCodeError(null);
        setTimeout(() => {
            inputRefs.current[0]?.focus();
        }, 0);
    }

    const selectedCandidate = candidates.find((c: any) => c.person_id === selectedFirst);
    const selectedParty = parties.find((p: any) => p.id === selectedSecond);
    const selectedCandidateParty = selectedCandidate?.short_name || '';
    const selectedCandidatePartyLong = selectedCandidate?.long_name || selectedCandidate?.longName || '';
    const selectedPartyShort = selectedParty?.short_name || selectedParty?.shortName || '';
    const selectedPartyLong = selectedParty?.long_name || selectedParty?.longName || '';
    const canProceed = selectedFirst !== null && selectedSecond !== null;

    if (!authorized) {
        return (
            <div className="mx-auto w-full max-w-3xl space-y-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Enter voting code</CardTitle>
                        <CardSubtitle>
                            Use the 16-character code provided to you to unlock the ballot.
                        </CardSubtitle>
                    </CardHeader>
                    <div className="space-y-4">
                        <div className="flex flex-wrap items-center gap-2">
                            {codeParts.map((part, idx) => (
                                <React.Fragment key={idx}>
                                    <input
                                        ref={(el) => { inputRefs.current[idx] = el!; }}
                                        value={part}
                                        onChange={(e) => handleCodeChange(idx, e.target.value)}
                                        onKeyDown={(e) => handleKeyDown(idx, e)}
                                        onPaste={(e) => handlePaste(idx, e)}
                                        className="h-12 w-[2.157rem] rounded-md border border-line bg-surface text-center text-lg font-semibold uppercase text-ink shadow-sm transition focus:border-ink-faint focus:outline-none focus:ring-2 focus:ring-black/5"
                                    />
                                    {(idx % 4 === 3) && idx !== 15 ? (
                                        <span className="text-ink-faint">-</span>
                                    ) : null}
                                </React.Fragment>
                            ))}
                        </div>
                        <p className="text-sm text-ink-muted">
                            You can paste the full code into a box.
                        </p>
                        {codeError && (
                            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                                {codeError}
                            </div>
                        )}
                        <Button
                            variant="primary"
                            size="md"
                            className="h-10"
                            disabled={!validateFullCode() || validating}
                            onClick={validateAndProceed}
                        >
                            {validating ? 'Validating...' : 'Continue to ballot'}
                        </Button>
                    </div>
                </Card>

            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <div className="text-xs uppercase tracking-[0.3em] text-ink-faint">Ballot</div>
                    <h1 className="text-2xl font-bold text-ink">
                        Constituency {constituencyNumber ?? '—'} {constituencyName ? `- ${constituencyName}` : ''}
                    </h1>
                    <p className="text-sm text-ink-muted">Election year {year}</p>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[0.7rem] uppercase tracking-[0.3em] text-ink-faint">
                <span className={cn('rounded-full border px-3 py-1', step === 'select' ? 'border-ink text-ink' : 'border-line')}>
                    1 Select
                </span>
                <span className={cn('rounded-full border px-3 py-1', step === 'review' ? 'border-ink text-ink' : 'border-line')}>
                    2 Review
                </span>
                <span className={cn('rounded-full border px-3 py-1', step === 'done' ? 'border-ink text-ink' : 'border-line')}>
                    3 Finish
                </span>
            </div>

            {loading && (
                <div className="rounded-md border border-line bg-surface px-4 py-3 text-sm text-ink-muted">
                    Loading ballot data...
                </div>
            )}
            {error && (
                <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                    {error}
                </div>
            )}

            {step === 'select' && (
                <div className="space-y-6">
                    <div className="grid gap-6 lg:grid-cols-2">
                        <Card>
                            <CardHeader>
                                <CardTitle>First vote</CardTitle>
                                <CardSubtitle>Choose a direct candidate in your constituency.</CardSubtitle>
                            </CardHeader>
                            <CardSectionTitle>Direct candidates</CardSectionTitle>
                            <div className="overflow-hidden rounded-[14px] border border-line bg-surface shadow-sm">
                                <div className="overflow-x-auto">
                                    <Table variant="members">
                                        <TableHead>
                                            <TableRow>
                                                <TableHeaderCell>Candidate</TableHeaderCell>
                                                <TableHeaderCell>Party</TableHeaderCell>
                                            </TableRow>
                                        </TableHead>
                                        <TableBody>
                                            {candidates.map((c: any) => {
                                                const isSelected = selectedFirst === c.person_id;
                                                const candidateParty = c.short_name || '';
                                                const partyColor = getPartyColor(candidateParty);
                                                return (
                                                    <TableRow
                                                        key={c.person_id || c.id}
                                                        className={cn(
                                                            'cursor-pointer transition-colors hover:bg-surface-accent',
                                                            isSelected && 'bg-surface-accent'
                                                        )}
                                                        onClick={() => setSelectedFirst(c.person_id)}
                                                        style={isSelected ? { boxShadow: `inset 4px 0 0 ${partyColor}` } : undefined}
                                                    >
                                                        <TableCell>
                                                            <label className="flex items-start gap-3">
                                                                <input
                                                                    type="radio"
                                                                    name="first"
                                                                    value={String(c.person_id)}
                                                                    checked={selectedFirst === c.person_id}
                                                                    onChange={() => setSelectedFirst(c.person_id)}
                                                                    onClick={(e) => e.stopPropagation()}
                                                                    className="mt-1 h-4 w-4 accent-black"
                                                                />
                                                                <div className="text-ink">
                                                                    {c.title ? `${c.title} ` : ''}
                                                                    <strong className="font-semibold">{c.last_name}</strong>, {c.first_name}
                                                                </div>
                                                            </label>
                                                        </TableCell>
                                                        <TableCell>
                                                            <div className="flex flex-col gap-1">
                                                                <PartyBadge party={candidateParty}>
                                                                    {truncatePartyName(getPartyDisplayName(candidateParty), 16)}
                                                                </PartyBadge>
                                                                {c.long_name && (
                                                                    <span className="text-xs text-ink-muted">{c.long_name}</span>
                                                                )}
                                                            </div>
                                                        </TableCell>
                                                    </TableRow>
                                                );
                                            })}
                                        </TableBody>
                                    </Table>
                                </div>
                            </div>
                            <div className="mt-4">
                                <label
                                    className={cn(
                                        'flex items-center gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 transition hover:border-red-300',
                                        selectedFirst === 'invalid' && 'border-red-400 bg-red-100 text-red-800'
                                    )}
                                >
                                    <input
                                        type="radio"
                                        name="first"
                                        value="invalid"
                                        checked={selectedFirst === 'invalid'}
                                        onChange={() => setSelectedFirst('invalid')}
                                        className="h-4 w-4 accent-black"
                                    />
                                    <span>Invalid / No first vote</span>
                                </label>
                            </div>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>Second vote</CardTitle>
                                <CardSubtitle>Choose a party list for proportional seats.</CardSubtitle>
                            </CardHeader>
                            <CardSectionTitle>Party lists</CardSectionTitle>
                            <div className="overflow-hidden rounded-[14px] border border-line bg-surface shadow-sm">
                                <div className="overflow-x-auto">
                                    <Table variant="members">
                                        <TableHead>
                                            <TableRow>
                                                <TableHeaderCell>Party list</TableHeaderCell>
                                                <TableHeaderCell>Party</TableHeaderCell>
                                            </TableRow>
                                        </TableHead>
                                        <TableBody>
                                            {parties.map((p: any) => {
                                                const shortName = p.short_name || p.shortName || p.name || '';
                                                const longName = p.long_name || p.longName || '';
                                                const isSelected = selectedSecond === p.id;
                                                const partyColor = getPartyColor(shortName);
                                                return (
                                                    <TableRow
                                                        key={p.id || `${shortName}-${longName}`}
                                                        className={cn(
                                                            'cursor-pointer transition-colors hover:bg-surface-accent',
                                                            isSelected && 'bg-surface-accent'
                                                        )}
                                                        onClick={() => setSelectedSecond(p.id)}
                                                        style={isSelected ? { boxShadow: `inset 4px 0 0 ${partyColor}` } : undefined}
                                                    >
                                                        <TableCell>
                                                            <label className="flex items-start gap-3">
                                                                <input
                                                                    type="radio"
                                                                    name="second"
                                                                    value={String(p.id)}
                                                                    checked={selectedSecond === p.id}
                                                                    onChange={() => setSelectedSecond(p.id)}
                                                                    onClick={(e) => e.stopPropagation()}
                                                                    className="mt-1 h-4 w-4 accent-black"
                                                                />
                                                                <div className="text-ink">
                                                                    <strong className="font-semibold">
                                                                        {getPartyDisplayName(shortName)}
                                                                    </strong>
                                                                    {longName && (
                                                                        <div className="text-xs text-ink-muted">{longName}</div>
                                                                    )}
                                                                </div>
                                                            </label>
                                                        </TableCell>
                                                        <TableCell>
                                                            <PartyBadge party={shortName}>
                                                                {truncatePartyName(getPartyDisplayName(shortName), 16)}
                                                            </PartyBadge>
                                                        </TableCell>
                                                    </TableRow>
                                                );
                                            })}
                                        </TableBody>
                                    </Table>
                                </div>
                            </div>
                            <div className="mt-4">
                                <label
                                    className={cn(
                                        'flex items-center gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 transition hover:border-red-300',
                                        selectedSecond === 'invalid' && 'border-red-400 bg-red-100 text-red-800'
                                    )}
                                >
                                    <input
                                        type="radio"
                                        name="second"
                                        value="invalid"
                                        checked={selectedSecond === 'invalid'}
                                        onChange={() => setSelectedSecond('invalid')}
                                        className="h-4 w-4 accent-black"
                                    />
                                    <span>Invalid / No second vote</span>
                                </label>
                            </div>
                        </Card>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface px-4 py-3">
                        <span className="text-sm text-ink-muted">
                            Select one candidate and one party to continue.
                        </span>
                        <Button
                            variant="primary"
                            size="md"
                            className="h-10"
                            disabled={!canProceed || loading}
                            onClick={() => {
                                setSubmitResult(null);
                                setStep('review');
                            }}
                        >
                            Review selections
                        </Button>
                    </div>
                </div>
            )}

            {step === 'review' && (
                <div className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Review your ballot</CardTitle>
                            <CardSubtitle>
                                Once confirmed, the vote cannot be changed! Please check your selection carefully before proceeding.
                            </CardSubtitle>
                        </CardHeader>
                        <div className="grid gap-4 lg:grid-cols-2">
                            <div className="rounded-md border border-line bg-surface-muted p-4">
                                <div className="text-xs uppercase tracking-[0.3em] text-ink-faint">First vote</div>
                                {selectedFirst === 'invalid' || !selectedCandidate ? (
                                    <p className="mt-2 text-sm text-red-700">Invalid / No first vote</p>
                                ) : (
                                    <div className="mt-3 flex items-center justify-between gap-3">
                                        <div>
                                            <p className="text-base font-semibold text-ink">
                                                {selectedCandidate.title ? `${selectedCandidate.title} ` : ''}
                                                {selectedCandidate.first_name} {selectedCandidate.last_name}
                                            </p>
                                            <p className="text-sm text-ink-muted">{selectedCandidatePartyLong}</p>
                                        </div>
                                        <PartyBadge party={selectedCandidateParty} size="fixed">
                                            {truncatePartyName(getPartyDisplayName(selectedCandidateParty), 16)}
                                        </PartyBadge>
                                    </div>
                                )}
                            </div>
                            <div className="rounded-md border border-line bg-surface-muted p-4">
                                <div className="text-xs uppercase tracking-[0.3em] text-ink-faint">Second vote</div>
                                {selectedSecond === 'invalid' || !selectedParty ? (
                                    <p className="mt-2 text-sm text-red-700">Invalid / No second vote</p>
                                ) : (
                                    <div className="mt-3 flex items-center justify-between gap-3">
                                        <div>
                                            <p className="text-base font-semibold text-ink">
                                                {selectedPartyShort}
                                            </p>
                                            <p className="text-sm text-ink-muted">
                                                {selectedPartyLong}
                                            </p>
                                        </div>
                                        <PartyBadge party={selectedPartyShort} size="fixed">
                                            {truncatePartyName(getPartyDisplayName(selectedPartyShort), 16)}
                                        </PartyBadge>
                                    </div>
                                )}
                            </div>
                        </div>

                        {submitResult && (
                            <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                                {submitResult}
                            </div>
                        )}

                        <div className="mt-5 flex flex-wrap items-center gap-3">
                            <Button
                                variant="secondary"
                                onClick={() => {
                                    setSubmitResult(null);
                                    setStep('select');
                                }}
                                disabled={submitting}
                            >
                                Back to edit
                            </Button>
                            <Button
                                variant="primary"
                                size="md"
                                className="h-10"
                                onClick={submitBallot}
                                disabled={submitting}
                            >
                                {submitting ? 'Casting ballot...' : 'Cast ballot'}
                            </Button>
                        </div>
                    </Card>

                </div>
            )}

            {step === 'done' && (
                <Card className="border-emerald-200 bg-emerald-50/40">
                    <CardHeader className="space-y-2">
                        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-700">
                            <span className="h-2 w-2 rounded-full bg-emerald-500" />
                            Vote recorded
                        </div>
                        <CardTitle className="text-2xl">Thank you for voting</CardTitle>
                        <CardSubtitle className="text-emerald-800">Your ballot has been successfully cast.</CardSubtitle>
                    </CardHeader>
                    <div className="space-y-4">
                        <div className="rounded-md border border-emerald-200 bg-white px-4 py-3 text-sm text-emerald-900">
                            The next voter can now enter their code.
                        </div>
                        <Button variant="primary" size="md" className="h-10" onClick={resetForNextVoter}>
                            Start next voter
                        </Button>
                    </div>
                </Card>
            )}
        </div>
    );
}
