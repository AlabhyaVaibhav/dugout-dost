export type Team = 
  | 'CSK' | 'DC' | 'GT' | 'KKR' | 'LSG' | 'MI' | 'PBKS' | 'RR' | 'RCB' | 'SRH';

export const TEAMS: Team[] = [
  'CSK', 'DC', 'GT', 'KKR', 'LSG', 'MI', 'PBKS', 'RR', 'RCB', 'SRH'
];

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  totalPoints: number;
  role: 'admin' | 'user';
}

export interface LongTermPrediction {
  uid: string;
  winner: Team;
  runnerUp: Team;
  top4: Team[];
  orangeCap: string;
  purpleCap: string;
  lastPlace: Team;
  submittedAt: any;
}

export interface Match {
  matchId: string;
  team1: Team;
  team2: Team;
  dateTime: any;
  status: 'upcoming' | 'completed';
  winner?: Team;
  margin?: string;
  playerOfTheMatch?: string;
}

export interface DailyPrediction {
  predictionId: string;
  uid: string;
  matchId: string;
  winner: Team;
  margin?: string;
  playerOfTheMatch?: string;
  pointsEarned?: number;
  submittedAt: any;
}
