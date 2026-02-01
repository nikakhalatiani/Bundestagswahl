import { useEffect, useMemo, useState } from 'react';
import { Autocomplete } from '../components/Autocomplete';
import { Card, CardHeader, CardTitle, CardSubtitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { useConstituencyList } from '../hooks/useQueries';
import type { ConstituencyListItem } from '../types/api';

type CodesProps = {
    year: number;
};

export function Codes({ year }: CodesProps) {
    const [generatedCode, setGeneratedCode] = useState<string | null>(null);
    const [generatedContext, setGeneratedContext] = useState<ConstituencyListItem | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [constituencyQuery, setConstituencyQuery] = useState('');
    const [selectedConstituency, setSelectedConstituency] = useState<ConstituencyListItem | null>(null);

    const { data: constituencyList, isLoading: isLoadingConstituencies, error: constituencyError } = useConstituencyList(year);

    const items = useMemo(() => constituencyList?.data ?? [], [constituencyList]);

    useEffect(() => {
        setSelectedConstituency(null);
        setConstituencyQuery('');
        setGeneratedCode(null);
        setGeneratedContext(null);
        setError(null);
    }, [year]);

    function formatConstituencyLabel(item: ConstituencyListItem) {
        return `${item.number} - ${item.name} (${item.state_name})`;
    }

    async function generateCode() {
        setLoading(true);
        setError(null);
        try {
            if (!selectedConstituency) {
                setError('Please select a constituency before generating a code.');
                return;
            }
            const res = await fetch('/api/codes/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    year,
                    constituencyElectionId: selectedConstituency.bridge_id,
                }),
            });
            const json = await res.json();
            if (res.ok && json.code) {
                setGeneratedCode(json.code);
                setGeneratedContext(selectedConstituency);
            } else {
                setError(json.error || 'Failed to generate code');
            }
        } catch (err: any) {
            setError(String(err));
        } finally {
            setLoading(false);
        }
    }

    function formatCode(code: string) {
        // Format as XXXX-XXXX-XXXX-XXXX
        return code.match(/.{1,4}/g)?.join('-') || code;
    }

    function copyToClipboard() {
        if (generatedCode) {
            navigator.clipboard.writeText(generatedCode);
        }
    }

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>Voting code generator</CardTitle>
                    <CardSubtitle>
                        Generate one-time voting codes for a specific constituency and election year.
                    </CardSubtitle>
                </CardHeader>
                <div className="space-y-4">
                    <Autocomplete
                        id="code-constituency"
                        label="Constituency"
                        items={items}
                        value={constituencyQuery}
                        onChange={(next) => {
                            setConstituencyQuery(next);
                            setSelectedConstituency(null);
                        }}
                        onSelect={(item) => {
                            setSelectedConstituency(item);
                            setConstituencyQuery(formatConstituencyLabel(item));
                        }}
                        getItemLabel={formatConstituencyLabel}
                        placeholder={isLoadingConstituencies ? 'Loading constituencies...' : 'Search by name or number'}
                        disabled={isLoadingConstituencies}
                        className="mb-0"
                    />

                    {constituencyError && (
                        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                            Unable to load constituencies.
                        </div>
                    )}

                    <Button
                        variant="primary"
                        size="md"
                        className="h-11"
                        onClick={generateCode}
                        disabled={loading}
                    >
                        {loading ? 'Generating...' : 'Generate new code'}
                    </Button>

                    {error && (
                        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                            Error: {error}
                        </div>
                    )}
                </div>
            </Card>

            {generatedCode && (
                <Card>
                    <CardHeader>
                        <CardTitle>Generated code</CardTitle>
                        <CardSubtitle>Use this code once to cast a ballot.</CardSubtitle>
                    </CardHeader>
                    <div className="space-y-3">
                        {generatedContext && (
                            <div className="rounded-md border border-line bg-surface-muted px-4 py-2 text-sm text-ink-muted">
                                {formatConstituencyLabel(generatedContext)} · {year}
                            </div>
                        )}
                        <div className="flex flex-wrap items-center gap-3">
                            <code className="flex h-11 items-center rounded-md border border-line bg-surface px-4 font-mono text-lg tracking-[0.3em] text-ink">
                                {formatCode(generatedCode)}
                            </code>
                            <Button variant="secondary" size="md" className="h-11" onClick={copyToClipboard}>
                                Copy code
                            </Button>
                        </div>
                    </div>
                </Card>
            )}
        </div>
    );
}
