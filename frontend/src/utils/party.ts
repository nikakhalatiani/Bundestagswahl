export type PartyColorScheme = {
    displayName: string;
    color: string;
};

import type { CSSProperties } from 'react';

function normalizePartyName(raw: string): string {
    return raw
        .trim()
        .toUpperCase()
        .replace(/\s+/g, ' ')
        .replace(/Ü/g, 'U')
        .replace(/Ö/g, 'O')
        .replace(/Ä/g, 'A');
}

// Major parties + colors
const MAJOR_COLORS: Record<string, string> = {
    SPD: 'var(--party-spd)',
    'CDU/CSU': 'var(--party-cdu)',
    AFD: 'var(--party-afd)',
    GRUNE: 'var(--party-grune)',
    'DIE LINKE': 'var(--party-linke)',
    FDP: 'var(--party-fdp)',
    BSW: 'var(--party-bsw)',
    SSW: 'var(--party-ssw)',
};

// Known minor party colors
const MINOR_COLORS: Record<string, string> = {
    VOLT: 'var(--party-volt)',
    PIRATEN: 'var(--party-piraten)',
    'DIE PARTEI': 'var(--party-partei)',
    ODP: 'var(--party-odp)',
    TIERSCHUTZ: 'var(--party-tierschutz)',
    MLPD: 'var(--party-mlpd)',
    NPD: 'var(--party-npd)',
    'FREIE WAHLER': 'var(--party-freie-waehler)',
};

const FALLBACK_COLOR = 'var(--party-unknown)';

export function getPartyDisplayName(rawPartyName: string, opts?: { combineCduCsu?: boolean }): string {
    const combineCduCsu = opts?.combineCduCsu ?? false;
    const normalized = normalizePartyName(rawPartyName);

    // CDU/CSU grouping for results only
    if (combineCduCsu && (normalized === 'CDU' || normalized === 'CSU' || normalized === 'CDU/CSU')) {
        return 'CDU/CSU';
    }

    // Do not translate party names; keep the backend-provided short_name/label.
    return rawPartyName.trim();
}

export function getPartyColor(displayNameOrRaw: string, opts?: { combineCduCsu?: boolean }): string {
    const displayName = getPartyDisplayName(displayNameOrRaw, opts);
    const normalized = normalizePartyName(displayName);

    if (normalized === 'AFD') return MAJOR_COLORS.AFD;
    if (normalized === 'SPD') return MAJOR_COLORS.SPD;
    if (normalized === 'FDP') return MAJOR_COLORS.FDP;
    if (normalized === 'BSW' || normalized.includes('WAGENKNECHT')) return MAJOR_COLORS.BSW;
    if (normalized === 'SSW') return MAJOR_COLORS.SSW;
    if (normalized === 'CDU/CSU' || normalized === 'CDU' || normalized === 'CSU') return MAJOR_COLORS['CDU/CSU'];

    // Greens (German forms + long name)
    if (normalized === 'GRUNE' || normalized === 'GRUENE' || normalized === 'GRUNEN' || normalized.includes('BUNDNIS 90')) {
        return MAJOR_COLORS.GRUNE;
    }

    // The Left (German forms)
    if (normalized === 'DIE LINKE' || normalized === 'LINKE') {
        return MAJOR_COLORS['DIE LINKE'];
    }

    if (normalized === 'VOLT') return MINOR_COLORS.VOLT;
    if (normalized === 'PIRATEN') return MINOR_COLORS.PIRATEN;
    if (normalized === 'DIE PARTEI' || normalized === 'PARTEI') return MINOR_COLORS['DIE PARTEI'];
    if (normalized === 'ODP') return MINOR_COLORS.ODP;
    if (normalized.includes('TIERSCHUTZ')) return MINOR_COLORS.TIERSCHUTZ;
    if (normalized === 'MLPD') return MINOR_COLORS.MLPD;
    if (normalized === 'NPD') return MINOR_COLORS.NPD;
    if (normalized.includes('FREIE WAHLER') || normalized === 'FW') return MINOR_COLORS['FREIE WAHLER'];

    return FALLBACK_COLOR;
}

export function partyBadgeStyle(partyName: string, opts?: { combineCduCsu?: boolean }): CSSProperties {
    return {
        backgroundColor: getPartyColor(partyName, opts),
        color: '#fff',
    };
}
