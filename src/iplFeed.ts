import { useState, useEffect, useCallback, useRef } from 'react';

function getIPLFeedURL() {
  return `/api/ipl-feed?_=${Date.now()}`;
}

const FIVE_MINUTES = 5 * 60 * 1000;
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

export interface IPLMatch {
  MatchID: number;
  MatchName: string;
  MatchStatus: string;
  MatchTime: string;
  MatchDate: string;
  MatchDateNew: string;
  MATCH_COMMENCE_START_DATE: string;
  GroundName: string;
  city: string;
  FirstBattingTeamCode: string;
  SecondBattingTeamCode: string;
  HomeTeamLogo: string;
  AwayTeamLogo: string;
  MatchOrder: string;
  WinningTeamID: string;
  FirstBattingSummary: string;
  SecondBattingSummary: string;
  MOM: string;
}

export async function fetchIPLSchedule(): Promise<IPLMatch[]> {
  const response = await fetch(getIPLFeedURL());
  const text = await response.text();

  let data: any;
  if (text.trimStart().startsWith('{')) {
    data = JSON.parse(text);
  } else {
    const jsonStr = text.substring(text.indexOf('(') + 1, text.lastIndexOf(')'));
    data = JSON.parse(jsonStr);
  }

  return (data.Matchsummary ?? []) as IPLMatch[];
}

function isMatchDay(matches: IPLMatch[]): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return matches.some((m) => m.MatchDate === today);
}

export function useIPLSchedule() {
  const [matches, setMatches] = useState<IPLMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchIPLSchedule();
      setMatches(data);
      setLastUpdated(new Date());
      setError(null);
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch schedule');
      return matches;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function startPolling() {
      const data = await load();
      if (cancelled) return;

      const interval = isMatchDay(data) ? FIVE_MINUTES : TWENTY_FOUR_HOURS;
      intervalRef.current = setInterval(async () => {
        const fresh = await load();
        if (cancelled) return;
        const newInterval = isMatchDay(fresh) ? FIVE_MINUTES : TWENTY_FOUR_HOURS;
        if (newInterval !== interval) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          intervalRef.current = setInterval(load, newInterval);
        }
      }, interval);
    }

    startPolling();

    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [load]);

  return { matches, loading, error, lastUpdated, isMatchDay: isMatchDay(matches) };
}
