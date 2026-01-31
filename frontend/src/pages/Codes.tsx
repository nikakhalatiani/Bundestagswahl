import { useState } from 'react';

export function Codes() {
    const [generatedCode, setGeneratedCode] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function generateCode() {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/codes/generate', { method: 'POST' });
            const json = await res.json();
            if (res.ok && json.code) {
                setGeneratedCode(json.code);
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
        <div style={{ padding: 20 }}>
            <h1 className="text-2xl font-bold mb-4">Wahlcode-Generator</h1>
            <p className="mb-4 text-gray-600">
                Generieren Sie neue 16-stellige Wahlcodes für die Stimmabgabe.
            </p>

            <div className="mb-6">
                <button
                    className="bg-blue-600 text-white px-6 py-3 rounded text-lg font-bold disabled:opacity-50 hover:bg-blue-700 transition"
                    onClick={generateCode}
                    disabled={loading}
                >
                    {loading ? 'Generiere...' : 'Neuen Code generieren'}
                </button>
            </div>

            {error && (
                <div className="text-red-600 mb-4">
                    Fehler: {error}
                </div>
            )}

            {generatedCode && (
                <div className="bg-gray-100 p-6 rounded-lg inline-block">
                    <p className="text-sm text-gray-500 mb-2">Generierter Code:</p>
                    <div className="flex items-center gap-4">
                        <code className="text-3xl font-mono tracking-widest bg-white px-4 py-2 rounded border">
                            {formatCode(generatedCode)}
                        </code>
                        <button
                            className="bg-gray-200 hover:bg-gray-300 px-4 py-2 rounded transition"
                            onClick={copyToClipboard}
                            title="In Zwischenablage kopieren"
                        >
                            📋 Kopieren
                        </button>
                    </div>
                    <p className="text-sm text-gray-500 mt-3">
                        Dieser Code kann einmalig zur Stimmabgabe verwendet werden.
                    </p>
                </div>
            )}
        </div>
    );
}
