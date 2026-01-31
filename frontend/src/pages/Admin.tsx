import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardSubtitle } from '../components/ui/Card';

export function Admin({ year }: { year: number }) {
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
            <h1 className="text-2xl font-bold text-ink">Admin Panel</h1>

            <Card>
                <CardHeader>
                    <CardTitle>Seat Allocation Cache</CardTitle>
                    <CardSubtitle>
                        Recalculate seat allocation from vote data. This refreshes all materialized views and recomputes seat distribution.
                    </CardSubtitle>
                </CardHeader>
                <div className="p-4">
                    <div className="flex items-center gap-4">
                        <button
                            className="rounded bg-blue-600 px-4 py-2 font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
                            onClick={handleRecalculateSeats}
                            disabled={recalculating}
                        >
                            {recalculating ? 'Recalculating...' : `Recalculate Seats (${year})`}
                        </button>
                        <span className="text-sm text-ink-muted">
                            This may take a few seconds.
                        </span>
                    </div>

                    {recalcResult && (
                        <div className={`mt-4 rounded p-3 ${recalcResult.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
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

            <Card>
                <CardHeader>
                    <CardTitle>Vote Casting (Debug)</CardTitle>
                    <CardSubtitle>
                        Access the ballot page to cast test votes.
                    </CardSubtitle>
                </CardHeader>
                <div className="p-4">
                    <a
                        href="/ballot"
                        className="inline-block rounded bg-gray-600 px-4 py-2 font-semibold text-white transition hover:bg-gray-700"
                    >
                        Open Ballot Page
                    </a>
                </div>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Voting Code Generator</CardTitle>
                    <CardSubtitle>
                        Open the code generator to create voting codes.
                    </CardSubtitle>
                </CardHeader>
                <div className="p-4">
                    <a
                        href="/code"
                        className="inline-block rounded bg-gray-600 px-4 py-2 font-semibold text-white transition hover:bg-gray-700"
                    >
                        Open Code Generator
                    </a>
                </div>
            </Card>
        </div>
    );
}
