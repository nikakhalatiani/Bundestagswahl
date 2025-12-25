export interface ApiResponse<T> {
    data: T;
}

export interface SeatDistributionItem {
    party_id: number;
    party_name: string;
    seats: number;
}

export interface MemberItem {
    person_id: number;
    title: string | null;
    first_name: string;
    last_name: string;
    party_id: number;
    party_name: string;
    party_long_name: string;
    state_id: number;
    state_name: string;
    seat_type: string;
    constituency_name: string | null;
    list_position: number | null;
    percent_first_votes: number | null;
}

export interface ConstituencyPartyListItem {
    id: number;
    short_name: string;
    long_name: string;
    votes: number | string;
    vote_type: number;
}

export interface ConstituencyCandidateItem {
    person_id: number;
    title: string | null;
    first_name: string;
    last_name: string;
    party_id: number;
    short_name: string;
    long_name: string;
    first_votes: number | string | null;
    previously_elected: boolean | null;
}

export interface ConstituencyInfo {
    id: number;
    number: number;
    name: string;
}

export interface VoteDistributionItem {
    party_name: string;
    first_votes: number;
    first_percent: number;
    second_votes: number;
    second_percent: number;
}

export interface ConstituencyOverviewResponse {
    constituency: {
        id: number;
        number: number;
        name: string;
        state: string;
    };
    election_stats: {
        eligible_voters?: number;
        total_voters?: number;
        turnout_percent?: number;
        invalid_first?: number;
        invalid_second?: number;
        valid_first?: number;
        valid_second?: number;
    };
    winner: {
        person_id: number;
        full_name: string;
        party_name: string;
        first_votes: number;
        percent_of_valid: number;
        seat_type: string | null;
        got_seat: boolean;
    } | null;
    vote_distribution: VoteDistributionItem[];
    comparison_to_2021: {
        turnout_diff_pts: number;
        winner_2021: string;
        winner_changed: boolean;
    } | null;
}

export interface ConstituencyWinnerItem {
    state_name: string;
    constituency_number: number;
    constituency_name: string;
    winner_name: string;
    party_name: string;
    first_votes: number;
    percent_of_valid: number;
    got_seat: boolean;
}

export interface DirectWithoutCoverageItem {
    constituency_name: string;
    winner_name: string;
    party_name: string;
    state_name: string;
    first_votes: number;
    percent_first_votes: number;
    reason: string;
}

export interface DirectWithoutCoverageResponse {
    total_lost_mandates: number;
    data: DirectWithoutCoverageItem[];
}

export interface ClosestWinnerItem {
    rank: number;
    constituency_name: string;
    state_name: string;
    winner_name: string;
    winner_party: string;
    winner_votes: number;
    runner_up_name: string;
    runner_up_party: string;
    runner_up_votes: number;
    margin_votes: number;
    margin_percent: number;
}

export interface ConstituenciesSingleCandidateItem {
    person_name: string;
    party_name: string;
    vote_count: number;
    is_winner: boolean;
}

export interface ConstituenciesSingleSecondVoteItem {
    party_name: string;
    vote_count: number;
}

export interface ConstituenciesSingleItem {
    constituency_id: number;
    constituency_name: string;
    state_name: string;
    candidates: ConstituenciesSingleCandidateItem[];
    party_second_votes: ConstituenciesSingleSecondVoteItem[];
    total_first_votes: number;
    total_second_votes: number;
}
