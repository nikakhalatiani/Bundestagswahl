import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardSubtitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

export function Admin({ year }: { year: number }) {
    const navigate = useNavigate();
    const [recalculating, setRecalculating] = useState(false);
    const [recalcResult, setRecalcResult] = useState<{ success: boolean; message: string; stats?: any } | null>(null);

    async function handleRecalculateSeats() {
        setRecalculating(true);
        setRecalcResult(null);
        try {
            const res = await fetch(`/api/admin/calculate-seats?year=${year}`, { method: 'POST' });
            const json = await res.json();
            if (res.ok) {
                setRecalcResult({
                    success: true,
                    message: json.message || 'Seats recalculated successfully',
                    stats: json.stats
                });
            } else {
                setRecalcResult({
                    success: false,
                    message: json.error || 'Failed to recalculate seats'
                });
            }
        } catch (err: any) {
            setRecalcResult({
                success: false,
                message: String(err)
            });
        } finally {
            setRecalculating(false);
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-ink">Admin Panel</h1>
                    <p className="mt-1 text-sm text-ink-muted">
                        Tools for testing and maintaining the election experience
                    </p>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Recalculate seat results</CardTitle>
                    <CardSubtitle>
                        Refresh seat distribution using the latest vote data
                    </CardSubtitle>
                </CardHeader>
                <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-3">
                        <Button
                            variant="primary"
                            size="md"
                            onClick={handleRecalculateSeats}
                            disabled={recalculating}
                        >
                            {recalculating ? 'Recalculating...' : 'Recalculate seats'}
                        </Button>
                        <span className="text-sm text-ink-muted">
                            This usually takes a few seconds
                        </span>
                    </div>

                    {recalculating && (
                        <div className="space-y-2">
                            <div className="flex items-center justify-between text-xs uppercase tracking-[0.3px] text-ink-faint">
                                <span>Recalculating seat results</span>
                                <span>In progress</span>
                            </div>
                            <div className="relative h-2 w-full overflow-hidden rounded-full bg-surface-accent">
                                <div className="progress-indeterminate h-full rounded-full bg-brand-gold" />
                            </div>
                        </div>
                    )}

                    {recalcResult && (
                        <div
                            className={`rounded-md border px-4 py-3 text-sm ${recalcResult.success
                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                                    : 'border-red-200 bg-red-50 text-red-800'
                                }`}
                        >
                            <p className="font-semibold">{recalcResult.message}</p>
                            {recalcResult.stats && (
                                <p className="mt-1 text-sm">
                                    Total seats: {recalcResult.stats.seats} | Parties: {recalcResult.stats.parties}
                                </p>
                            )}
                        </div>
                    )}
                </div>
            </Card>

            <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>Ballot kiosk</CardTitle>
                        <CardSubtitle>
                            Open the ballot flow to cast a vote
                        </CardSubtitle>
                    </CardHeader>
                    <div className="flex flex-wrap items-center gap-3">
                        <Button
                            variant="secondary"
                            onClick={() => { navigate('/ballot'); }}
                        >
                            Open ballot
                        </Button>
                        <span className="text-sm text-ink-muted">
                            Requires a valid voting code
                        </span>
                    </div>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Voting code generator</CardTitle>
                        <CardSubtitle>
                            Create one-time codes for testing the ballot flow
                        </CardSubtitle>
                    </CardHeader>
                    <div className="flex flex-wrap items-center gap-3">
                        <Button
                            variant="secondary"
                            onClick={() => { navigate('/code'); }}
                        >
                            Open code generator
                        </Button>
                        <span className="text-sm text-ink-muted">
                            Codes can be used once
                        </span>
                    </div>
                </Card>
            </div>
        </div>
    );
}
