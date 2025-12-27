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

// Major parties + colors (as requested)
const MAJOR_COLORS: Record<string, string> = {
    SPD: '#E3000F',
    'CDU/CSU': '#000000',
    AFD: '#009EE0',
    GRUNE: '#46962b',
    'DIE LINKE': '#B40089',
    FDP: '#F5D000',
    SSW: '#003063',
};

const FALLBACK_COLOR = '#4B5563'; // dark gray

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
    if (normalized === 'SSW') return MAJOR_COLORS.SSW;
    if (normalized === 'CDU/CSU') return MAJOR_COLORS['CDU/CSU'];

    // Greens (German forms + long name)
    if (normalized === 'GRUNE' || normalized === 'GRUENE' || normalized === 'GRUNEN' || normalized.includes('BUNDNIS 90')) {
        return MAJOR_COLORS.GRUNE;
    }

    // The Left (German forms)
    if (normalized === 'DIE LINKE' || normalized === 'LINKE') {
        return MAJOR_COLORS['DIE LINKE'];
    }

    return FALLBACK_COLOR;
}

export function partyBadgeStyle(partyName: string, opts?: { combineCduCsu?: boolean }): CSSProperties {
    return {
        backgroundColor: getPartyColor(partyName, opts),
        color: '#fff',
    };
}
