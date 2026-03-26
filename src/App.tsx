import React, { ErrorInfo, ReactNode, useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, Navigate, useNavigate, useLocation } from 'react-router-dom';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signOut,
  User as FirebaseUser,
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  onSnapshot,
  collection,
  query,
  orderBy,
  limit,
  where,
  getDocs,
  getDocFromServer,
  deleteDoc
} from 'firebase/firestore';
import { db, auth, googleProvider, authReady } from './firebase';
import { UserProfile, Match, LongTermPrediction, DailyPrediction, TEAMS, Team } from './types';
import { Trophy, Calendar, LayoutDashboard, ListOrdered, Settings, Info, ChevronRight, CheckCircle2, AlertCircle, Trash2, MapPin, Clock, RefreshCw, Zap, LogOut, Mail, Pencil, Shield, UserPlus } from 'lucide-react';
import { useIPLSchedule, fetchIPLSchedule, IPLMatch } from './iplFeed';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import { format, isAfter, isBefore, subMinutes } from 'date-fns';

// --- Error Handling ---

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {},
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
}

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
          <div className="max-w-md w-full bg-white rounded-3xl shadow-xl p-8 text-center">
            <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-slate-900 mb-2">Something went wrong</h1>
            <p className="text-slate-500 mb-6">We encountered an error. Please try refreshing the page.</p>
            <button 
              onClick={() => window.location.reload()}
              className="bg-slate-900 text-white font-bold py-3 px-8 rounded-xl hover:bg-slate-800 transition-all"
            >
              Refresh Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// --- Components ---

const Navbar = ({ user, points }: { user: UserProfile | null, points: number }) => {
  const location = useLocation();
  const navigate = useNavigate();

  const navItems = [
    { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { path: '/schedule', icon: Calendar, label: 'Schedule' },
    { path: '/predictions', icon: Zap, label: 'Daily' },
    { path: '/long-term', icon: Trophy, label: 'Season' },
    { path: '/leaderboard', icon: ListOrdered, label: 'Leaderboard' },
    { path: '/rules', icon: Info, label: 'Rules' },
  ];

  if (user?.role === 'admin') {
    navItems.push({ path: '/admin', icon: Settings, label: 'Admin' });
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-4 py-2 md:top-0 md:bottom-auto md:border-t-0 md:border-b md:bg-white/80 md:backdrop-blur-md z-50">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <Link to="/" className="hidden md:flex items-center gap-2 font-bold text-slate-900 text-xl shrink-0">
          <img src="/logo.png" alt="Dugout Dost" className="w-9 h-9 rounded-lg object-cover" />
          <span>Dugout Dost</span>
        </Link>

        <div className="flex flex-1 justify-around md:flex-none md:gap-8">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "flex flex-col items-center gap-1 px-3 py-1 rounded-lg transition-colors md:flex-row md:gap-2",
                  isActive ? "text-red-600 bg-red-50" : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
                )}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-medium md:text-sm">{item.label}</span>
              </Link>
            );
          })}
        </div>

        <div className="hidden md:flex items-center gap-4">
          <div className="flex flex-col items-end">
            <span className="text-xs text-slate-500 font-medium">Total Points</span>
            <span className="text-sm font-bold text-red-600">{points} pts</span>
          </div>
          <button
            onClick={() => signOut(auth)}
            className="p-2 text-slate-400 hover:text-red-500 transition-colors"
            title="Sign Out"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </div>
    </nav>
  );
};

const ADMIN_EMAIL = 'sportzwithsardarji@gmail.com';

const Auth = () => {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogle = async () => {
    setLoading(true);
    setError(null);
    try {
      await signInWithPopup(auth, googleProvider);
      window.history.replaceState({}, '', '/');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (mode === 'signup') {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        if (displayName) await updateProfile(cred.user, { displayName });
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      window.history.replaceState({}, '', '/');
    } catch (e: any) {
      const msg = e.code === 'auth/user-not-found' ? 'No account found with this email.'
        : e.code === 'auth/wrong-password' ? 'Incorrect password.'
        : e.code === 'auth/email-already-in-use' ? 'An account with this email already exists.'
        : e.code === 'auth/weak-password' ? 'Password must be at least 6 characters.'
        : e.code === 'auth/invalid-email' ? 'Invalid email address.'
        : e.message;
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/grass.png')] opacity-10 pointer-events-none" />
      <div className="absolute -top-24 -left-24 w-64 h-64 bg-red-500/10 rounded-full blur-3xl" />
      <div className="absolute -bottom-24 -right-24 w-64 h-64 bg-green-500/10 rounded-full blur-3xl" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full bg-white rounded-3xl shadow-xl shadow-slate-200 p-8 text-center relative z-10 border border-slate-100"
      >
        <img src="/logo.png" alt="Dugout Dost" className="w-24 h-24 rounded-2xl object-cover mx-auto mb-5 shadow-lg shadow-red-100" />
        <h1 className="text-3xl font-black text-slate-900 mb-1 tracking-tight uppercase">Dugout Dost</h1>
        <p className="text-slate-500 mb-6 text-sm">The IPL prediction league</p>

        <button
          onClick={handleGoogle}
          disabled={loading}
          className="w-full bg-white border-2 border-slate-200 text-slate-700 font-bold py-3.5 rounded-2xl hover:border-slate-300 hover:bg-slate-50 transition-all flex items-center justify-center gap-3 disabled:opacity-50 mb-4"
        >
          <img src="https://www.google.com/favicon.ico" className="w-5 h-5" alt="Google" />
          Continue with Google
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 h-px bg-slate-100" />
          <span className="text-xs text-slate-400 font-medium">OR</span>
          <div className="flex-1 h-px bg-slate-100" />
        </div>

        <form onSubmit={handleEmailSubmit} className="space-y-3 text-left">
          {mode === 'signup' && (
            <input
              type="text"
              placeholder="Display Name"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              className="w-full p-3 bg-slate-50 border border-slate-100 rounded-xl text-sm font-medium placeholder:text-slate-400"
              required
            />
          )}
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="w-full p-3 bg-slate-50 border border-slate-100 rounded-xl text-sm font-medium placeholder:text-slate-400"
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full p-3 bg-slate-50 border border-slate-100 rounded-xl text-sm font-medium placeholder:text-slate-400"
            required
            minLength={6}
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-red-600 text-white font-bold py-3.5 rounded-2xl hover:bg-red-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Mail className="w-4 h-4" />
            {mode === 'signup' ? 'Create Account' : 'Sign In'}
          </button>
        </form>

        {error && (
          <div className="mt-4 bg-red-50 border border-red-100 rounded-xl p-3 text-xs text-red-600 font-medium text-left">
            {error}
          </div>
        )}

        <button
          onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(null); }}
          className="mt-4 text-sm text-slate-500 hover:text-red-600 transition-colors"
        >
          {mode === 'login' ? "Don't have an account? Sign Up" : 'Already have an account? Sign In'}
        </button>
      </motion.div>
    </div>
  );
};

const Dashboard = ({ user }: { user: UserProfile }) => {
  const [matches, setMatches] = useState<Match[]>([]);
  const [predictions, setPredictions] = useState<DailyPrediction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, 'matches'), where('status', '==', 'upcoming'), orderBy('dateTime', 'asc'), limit(3));
    const unsubscribeMatches = onSnapshot(q, (snapshot) => {
      setMatches(snapshot.docs.map(doc => doc.data() as Match));
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'matches');
    });

    const unsubscribePreds = onSnapshot(collection(db, 'dailyPredictions'), (snapshot) => {
      setPredictions(snapshot.docs.map(doc => doc.data() as DailyPrediction).filter(p => p.uid === user.uid));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'dailyPredictions');
    });

    return () => {
      unsubscribeMatches();
      unsubscribePreds();
    };
  }, [user.uid]);

  return (
    <div className="space-y-8">
      {user.role === 'admin' && (
        <section className="bg-red-50 border border-red-100 rounded-3xl p-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-red-100 rounded-2xl flex items-center justify-center">
              <Settings className="w-6 h-6 text-red-600" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-lg">Admin Access</h3>
              <p className="text-slate-500 text-sm">Manage matches, users, and resolve predictions.</p>
            </div>
          </div>
          <Link 
            to="/admin" 
            className="w-full md:w-auto px-6 py-3 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800 transition-all text-center"
          >
            Open Admin Panel
          </Link>
        </section>
      )}

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-slate-900">Upcoming Matches</h2>
          <Link to="/predictions" className="text-sm font-medium text-red-600 flex items-center gap-1">
            View all <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
        
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {matches.map((match) => {
            const hasPredicted = predictions.some(p => p.matchId === match.matchId);
            const deadline = subMinutes(match.dateTime.toDate(), 15);
            const isLocked = isAfter(new Date(), deadline);

            return (
              <div key={match.matchId} className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                <div className="text-xs font-medium text-slate-400 mb-3">
                  {format(match.dateTime.toDate(), 'EEE, MMM d • h:mm a')}
                </div>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center font-bold text-slate-700">
                      {match.team1.substring(0, 3).toUpperCase()}
                    </div>
                    <span className="text-xs font-bold">{match.team1}</span>
                  </div>
                  <span className="text-slate-300 font-bold italic">VS</span>
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center font-bold text-slate-700">
                      {match.team2.substring(0, 3).toUpperCase()}
                    </div>
                    <span className="text-xs font-bold">{match.team2}</span>
                  </div>
                </div>
                <Link
                  to="/predictions"
                  className={cn(
                    "w-full py-2 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all",
                    isLocked 
                      ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                      : hasPredicted
                        ? "bg-green-50 text-green-600 border border-green-100" 
                        : "bg-red-600 text-white hover:bg-red-700 shadow-lg shadow-red-200"
                  )}
                >
                  {isLocked ? 'Locked' : hasPredicted ? (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      Predicted
                    </>
                  ) : 'Predict Now'}
                </Link>
              </div>
            );
          })}
          {matches.length === 0 && !loading && (
            <div className="col-span-full py-12 text-center bg-slate-50 rounded-3xl border-2 border-dashed border-slate-200">
              <p className="text-slate-400 font-medium">No upcoming matches scheduled.</p>
            </div>
          )}
        </div>
      </section>

      <section className="bg-slate-900 rounded-3xl p-8 text-white relative overflow-hidden">
        <div className="relative z-10">
          <h2 className="text-2xl font-bold mb-2">Season Predictions</h2>
          <p className="text-slate-400 mb-6 max-w-md">Don't forget to lock in your season-long predictions for massive points!</p>
          <Link 
            to="/long-term"
            className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white font-bold px-6 py-3 rounded-xl transition-all"
          >
            Go to Season Form <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
        <Trophy className="absolute -right-8 -bottom-8 w-48 h-48 text-white/5 rotate-12" />
      </section>
    </div>
  );
};

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  UpComing: { bg: 'bg-blue-50 border-blue-100', text: 'text-blue-600', label: 'Upcoming' },
  Completed: { bg: 'bg-green-50 border-green-100', text: 'text-green-600', label: 'Completed' },
  Live: { bg: 'bg-red-50 border-red-100', text: 'text-red-600', label: 'Live' },
};

function getStatusStyle(status: string) {
  return STATUS_STYLES[status] ?? { bg: 'bg-slate-50 border-slate-100', text: 'text-slate-600', label: status };
}

const Schedule = () => {
  const { matches, loading, error, lastUpdated, isMatchDay } = useIPLSchedule();
  const [filter, setFilter] = useState<'all' | 'upcoming' | 'completed'>('all');

  const grouped = matches
    .filter((m) => {
      if (filter === 'upcoming') return m.MatchStatus === 'UpComing';
      if (filter === 'completed') return m.MatchStatus === 'Completed';
      return true;
    })
    .reduce<Record<string, IPLMatch[]>>((acc, m) => {
      const key = m.MatchDateNew;
      (acc[key] ??= []).push(m);
      return acc;
    }, {});

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">IPL 2026 Schedule</h1>
          <p className="text-slate-500 mt-1 text-sm">
            Full season match schedule — live from the official IPL feed.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-400">
          {isMatchDay && (
            <span className="flex items-center gap-1 bg-red-50 text-red-600 font-bold px-2.5 py-1 rounded-full border border-red-100">
              <Zap className="w-3 h-3" /> Match Day — refreshing every 5 min
            </span>
          )}
          {lastUpdated && (
            <span className="flex items-center gap-1">
              <RefreshCw className="w-3 h-3" />
              {format(lastUpdated, 'h:mm a')}
            </span>
          )}
        </div>
      </div>

      <div className="flex gap-2">
        {(['all', 'upcoming', 'completed'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'px-4 py-2 rounded-xl text-sm font-bold capitalize transition-all',
              filter === f
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-10 h-10 border-4 border-red-200 border-t-red-600 rounded-full animate-spin" />
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-100 rounded-2xl p-5 text-red-700 text-sm flex items-start gap-3">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <strong>Failed to load schedule.</strong>
            <p className="text-red-500 mt-1">{error}</p>
          </div>
        </div>
      )}

      {!loading && Object.keys(grouped).length === 0 && (
        <div className="py-16 text-center bg-slate-50 rounded-3xl border-2 border-dashed border-slate-200">
          <p className="text-slate-400 font-medium">No matches found.</p>
        </div>
      )}

      <div className="space-y-8">
        {Object.entries(grouped).map(([dateLabel, dayMatches]) => {
          const isToday = dayMatches[0]?.MatchDate === today;
          return (
            <section key={dateLabel}>
              <div className="flex items-center gap-3 mb-4">
                <h2 className={cn(
                  "text-sm font-bold uppercase tracking-wider",
                  isToday ? "text-red-600" : "text-slate-400"
                )}>
                  {dateLabel}
                </h2>
                {isToday && (
                  <span className="text-[10px] font-black uppercase tracking-widest bg-red-600 text-white px-2 py-0.5 rounded">
                    Today
                  </span>
                )}
                <div className="flex-1 h-px bg-slate-100" />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {dayMatches.map((m) => {
                  const style = getStatusStyle(m.MatchStatus);
                  return (
                    <motion.div
                      key={m.MatchID}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={cn(
                        'bg-white rounded-2xl border shadow-sm overflow-hidden',
                        isToday ? 'border-red-100 ring-1 ring-red-50' : 'border-slate-100'
                      )}
                    >
                      <div className="p-5">
                        <div className="flex items-center justify-between mb-4">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                            {m.MatchOrder}
                          </span>
                          <span className={cn(
                            'px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase border',
                            style.bg, style.text
                          )}>
                            {style.label}
                          </span>
                        </div>

                        <div className="flex items-center justify-between gap-3 mb-4">
                          <div className="flex flex-col items-center gap-1.5 flex-1">
                            <img
                              src={m.HomeTeamLogo}
                              alt={m.FirstBattingTeamCode}
                              className="w-12 h-12 object-contain"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                            <span className="text-sm font-black text-slate-900">{m.FirstBattingTeamCode}</span>
                          </div>

                          <div className="flex flex-col items-center">
                            {m.FirstBattingSummary && m.SecondBattingSummary ? (
                              <div className="text-center">
                                <div className="text-xs font-bold text-slate-700">{m.FirstBattingSummary}</div>
                                <div className="text-xs font-bold text-slate-700">{m.SecondBattingSummary}</div>
                              </div>
                            ) : (
                              <span className="text-slate-300 font-black text-lg">VS</span>
                            )}
                          </div>

                          <div className="flex flex-col items-center gap-1.5 flex-1">
                            <img
                              src={m.AwayTeamLogo}
                              alt={m.SecondBattingTeamCode}
                              className="w-12 h-12 object-contain"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                            <span className="text-sm font-black text-slate-900">{m.SecondBattingTeamCode}</span>
                          </div>
                        </div>

                        {m.MOM && m.MOM !== '' && (
                          <div className="text-center text-xs text-slate-500 mb-3">
                            <span className="font-bold text-yellow-600">MOM:</span> {m.MOM}
                          </div>
                        )}

                        <div className="flex items-center justify-between text-xs text-slate-400 pt-3 border-t border-slate-50">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" />
                            {m.MatchTime} IST
                          </span>
                          <span className="flex items-center gap-1 text-right">
                            <MapPin className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate max-w-[160px]">{m.GroundName}, {m.city}</span>
                          </span>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
};

const Rules = () => {
  return (
    <div className="max-w-3xl mx-auto bg-white rounded-3xl p-8 border border-slate-100 shadow-sm">
      <h1 className="text-3xl font-bold text-slate-900 mb-8">Dugout Dost Rules</h1>
      
      <div className="space-y-8">
        <section>
          <h2 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
            <span className="w-8 h-8 bg-red-100 text-red-600 rounded-lg flex items-center justify-center text-sm">1</span>
            Long-Term Predictions
          </h2>
          <div className="grid gap-2">
            {[
              { label: 'Winner (exact)', pts: 50 },
              { label: 'Runner-up (exact)', pts: 30 },
              { label: 'Top 4 Teams (any order)', pts: '10 each' },
              { label: 'Correct Top 4 Order Bonus', pts: '+20' },
              { label: 'Orange Cap', pts: 25 },
              { label: 'Purple Cap', pts: 25 },
              { label: 'Last Place Team', pts: 20 },
              { label: 'Finalist Pair Bonus', pts: '+20' },
              { label: 'Winner + Runner-up Combo Bonus', pts: '+30' },
            ].map((rule, i) => (
              <div key={i} className="flex justify-between items-center py-2 border-b border-slate-50 last:border-0">
                <span className="text-slate-600">{rule.label}</span>
                <span className="font-bold text-slate-900">{rule.pts} pts</span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
            <span className="w-8 h-8 bg-red-100 text-red-600 rounded-lg flex items-center justify-center text-sm">2</span>
            Daily Match Predictions
          </h2>
          <div className="grid gap-2">
            {[
              { label: 'Correct Winner', pts: 5 },
              { label: 'Player of the Match (optional)', pts: '+2' },
              { label: 'Wrong Prediction', pts: 0 },
            ].map((rule, i) => (
              <div key={i} className="flex justify-between items-center py-2 border-b border-slate-50 last:border-0">
                <span className="text-slate-600">{rule.label}</span>
                <span className="font-bold text-slate-900">{rule.pts} pts</span>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-slate-50 rounded-2xl p-6">
          <h3 className="font-bold text-slate-900 mb-3 flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-red-500" />
            Important Notes
          </h3>
          <ul className="text-sm text-slate-600 space-y-2 list-disc pl-4">
            <li>Tie-breakers: (1) More correct daily predictions, (2) Correct winner pick, (3) Cap predictions, (4) Earlier submission.</li>
            <li>All predictions must be submitted before deadlines.</li>
            <li>In case of duplicacy of entries, first entry shall only be considered.</li>
          </ul>
        </section>
      </div>
    </div>
  );
};

// --- Main App ---

export default function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser: FirebaseUser | null) => {
      if (!firebaseUser) {
        setUser(null);
        setLoading(false);
        return;
      }

      const isAdmin = firebaseUser.email === ADMIN_EMAIL;
      const profileData: Record<string, any> = {
        uid: firebaseUser.uid,
        email: firebaseUser.email || '',
        displayName: firebaseUser.displayName || 'Anonymous',
        totalPoints: 0,
        role: isAdmin ? 'admin' : 'user',
      };
      if (firebaseUser.photoURL) profileData.photoURL = firebaseUser.photoURL;

      const asUserProfile = profileData as UserProfile;

      try {
        const userRef = doc(db, 'users', firebaseUser.uid);
        const userDoc = await getDoc(userRef);

        if (!userDoc.exists()) {
          try {
            await setDoc(userRef, profileData);
            console.log('User profile created in Firestore:', firebaseUser.uid);
          } catch (writeErr) {
            console.warn('Firestore create failed, retrying with merge:', writeErr);
            await setDoc(userRef, profileData, { merge: true });
          }
          setUser(asUserProfile);
        } else {
          const data = userDoc.data() as UserProfile;
          if (isAdmin && data.role !== 'admin') {
            await setDoc(userRef, { role: 'admin' }, { merge: true });
            setUser({ ...data, role: 'admin' });
          } else {
            setUser(data);
          }
        }
      } catch (error) {
        console.error('Firestore profile error (using fallback):', error);
        setUser(asUserProfile);
      } finally {
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-12 h-12 border-4 border-red-200 border-t-red-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return <Auth />;

  return (
    <ErrorBoundary>
      <Router>
        <div className="min-h-screen bg-slate-50 pb-24 md:pb-0 md:pt-20 flex flex-col">
          <Navbar user={user} points={user.totalPoints} />
          
          <main className="max-w-7xl mx-auto p-4 md:p-8 flex-1 w-full">
            <Routes>
              <Route path="/" element={<Dashboard user={user} />} />
              <Route path="/schedule" element={<Schedule />} />
              <Route path="/rules" element={<Rules />} />
              <Route path="/predictions" element={<DailyPredictions user={user} />} />
              <Route path="/long-term" element={<LongTermForm user={user} />} />
              <Route path="/leaderboard" element={<Leaderboard />} />
              {user.role === 'admin' && <Route path="/admin" element={<AdminPanel />} />}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>

          <footer className="hidden md:block w-full bg-[#1b4f7a] mt-8">
            <div className="max-w-7xl mx-auto">
              <img src="/banner.png" alt="Dugout Dost — Podcasts, Live, Reaction Videos, Football Tactical Analysis" className="w-full h-auto object-cover" />
            </div>
            <div className="text-center py-3 text-xs text-white/60 font-medium tracking-wide">
              &copy; {new Date().getFullYear()} Dugout Dost &middot; Sportz with Sardarji
            </div>
          </footer>
        </div>
      </Router>
    </ErrorBoundary>
  );
}

// --- Placeholder Components for Routes ---

const DailyPredictions = ({ user }: { user: UserProfile }) => {
  const [matches, setMatches] = useState<Match[]>([]);
  const [preds, setPreds] = useState<DailyPrediction[]>([]);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [selectedWinners, setSelectedWinners] = useState<Record<string, Team>>({});

  useEffect(() => {
    const unsubscribeMatches = onSnapshot(collection(db, 'matches'), (snapshot) => {
      setMatches(snapshot.docs.map(doc => doc.data() as Match).sort((a, b) => a.dateTime.toDate() - b.dateTime.toDate()));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'matches');
    });

    const unsubscribePreds = onSnapshot(collection(db, 'dailyPredictions'), (snapshot) => {
      const userPreds = snapshot.docs.map(doc => doc.data() as DailyPrediction).filter(p => p.uid === user.uid);
      setPreds(userPreds);
      setSelectedWinners(prev => {
        const next = { ...prev };
        for (const p of userPreds) {
          if (!(p.matchId in next)) next[p.matchId] = p.winner;
        }
        return next;
      });
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'dailyPredictions');
    });

    return () => {
      unsubscribeMatches();
      unsubscribePreds();
    };
  }, [user.uid]);

  const handleSubmit = async (matchId: string) => {
    const winner = selectedWinners[matchId];
    if (!winner) return;
    
    setSubmitting(matchId);
    try {
      const predId = `${user.uid}_${matchId}`;
      const existing = preds.find(p => p.predictionId === predId);
      const now = new Date();
      const newPred: DailyPrediction = {
        predictionId: predId,
        uid: user.uid,
        matchId,
        winner,
        submittedAt: existing?.submittedAt ?? now,
        updatedAt: now,
      };

      await setDoc(doc(db, 'dailyPredictions', predId), newPred);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `dailyPredictions/${user.uid}_${matchId}`);
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold text-slate-900">Daily Predictions</h1>
        <div className="bg-red-50 border border-red-100 p-4 rounded-2xl flex items-start gap-3 max-w-md">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <p className="text-xs text-red-800 leading-relaxed">
            <strong>Note:</strong> You can change your pick as many times as you want until 15 minutes before the match starts. After that, your last saved pick is final.
          </p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {matches.map((match) => {
          const prediction = preds.find(p => p.matchId === match.matchId);
          const deadline = subMinutes(match.dateTime.toDate(), 15);
          const isLocked = isAfter(new Date(), deadline) || match.status === 'completed';
          const selectedWinner = selectedWinners[match.matchId];
          const hasChanged = prediction ? selectedWinner !== prediction.winner : !!selectedWinner;
          
          return (
            <div key={match.matchId} className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm flex flex-col">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <div className="text-sm font-bold text-slate-900 mb-1">{match.team1} vs {match.team2}</div>
                  <div className="text-xs text-slate-400">IST: {format(match.dateTime.toDate(), 'PPP • p')}</div>
                  <div className="text-[10px] font-bold text-red-600 mt-1 uppercase tracking-wider">
                    Deadline: {format(deadline, 'p')}
                  </div>
                </div>
                {match.status === 'completed' ? (
                  <span className="px-3 py-1 bg-slate-100 text-slate-500 text-xs font-bold rounded-full">Completed</span>
                ) : isLocked ? (
                  <span className="px-3 py-1 bg-slate-100 text-slate-500 text-xs font-bold rounded-full">Locked</span>
                ) : prediction ? (
                  <span className="px-3 py-1 bg-green-100 text-green-600 text-xs font-bold rounded-full">Saved</span>
                ) : (
                  <span className="px-3 py-1 bg-amber-100 text-amber-600 text-xs font-bold rounded-full">Open</span>
                )}
              </div>

              <div className="flex items-center justify-between gap-4 mb-6">
                {[match.team1, match.team2].map((team) => {
                  const isSelected = selectedWinner === team;
                  return (
                    <button
                      key={team}
                      disabled={isLocked || submitting === match.matchId}
                      onClick={() => setSelectedWinners(prev => ({ ...prev, [match.matchId]: team }))}
                      className={cn(
                        "flex-1 flex flex-col items-center gap-3 p-4 rounded-2xl border-2 transition-all",
                        isLocked ? "opacity-75 cursor-not-allowed" : "",
                        isSelected
                          ? "border-red-500 bg-red-50" 
                          : "border-slate-50 bg-slate-50 hover:border-slate-200"
                      )}
                    >
                      <div className="w-16 h-16 bg-white rounded-full shadow-sm flex items-center justify-center text-xl font-black text-slate-900">
                        {team.substring(0, 3).toUpperCase()}
                      </div>
                      <span className="font-bold text-slate-900">{team}</span>
                    </button>
                  );
                })}
              </div>

              {isLocked ? (
                prediction ? (
                  <div className="mt-auto pt-4 border-t border-slate-50 flex items-center gap-2 text-sm text-slate-500 justify-center">
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    Your pick: <span className="font-bold text-slate-900">{prediction.winner}</span>
                    {prediction.pointsEarned != null && (
                      <span className={cn("font-bold ml-2", prediction.pointsEarned > 0 ? "text-green-600" : "text-slate-400")}>
                        {prediction.pointsEarned > 0 ? `+${prediction.pointsEarned} pts` : '0 pts'}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="mt-auto pt-4 border-t border-slate-50 text-center text-xs text-red-500 font-bold uppercase">
                    Missed Deadline
                  </div>
                )
              ) : (
                <button
                  disabled={!selectedWinner || !hasChanged || submitting === match.matchId}
                  onClick={() => handleSubmit(match.matchId)}
                  className="mt-auto w-full py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-all disabled:opacity-50 disabled:bg-slate-200 disabled:text-slate-400 shadow-lg shadow-red-100"
                >
                  {submitting === match.matchId
                    ? 'Saving...'
                    : prediction
                      ? 'Update Prediction'
                      : 'Save Prediction'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const LongTermForm = ({ user }: { user: UserProfile }) => {
  const [prediction, setPrediction] = useState<Partial<LongTermPrediction>>({
    top4: []
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const isSeasonStarted = isAfter(new Date(), new Date('2026-04-10T19:29:00'));

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'longTermPredictions', user.uid), (snapshot) => {
      if (snapshot.exists()) {
        setPrediction(snapshot.data() as LongTermPrediction);
      }
      setLoading(false);
    }, (error) => {
      console.error('LongTermPredictions load error:', error);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [user.uid]);

  const handleSave = async () => {
    if (isSeasonStarted) return;
    setSaving(true);
    try {
      const now = new Date();
      await setDoc(doc(db, 'longTermPredictions', user.uid), {
        ...prediction,
        uid: user.uid,
        submittedAt: prediction.submittedAt ?? now,
        updatedAt: now,
      });
      alert('Predictions saved successfully!');
    } catch (error) {
      console.error('Save error:', error);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-10 h-10 border-4 border-red-200 border-t-red-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="bg-red-600 rounded-3xl p-8 text-white">
        <h1 className="text-3xl font-bold mb-2">Season Predictions</h1>
        <p className="opacity-80">
          {isSeasonStarted 
            ? "Season has started. Predictions are now locked." 
            : "Lock in your picks for the entire season. These can be edited until the deadline!"}
        </p>
        <div className={cn(
          "inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-xl text-sm font-bold",
          isSeasonStarted ? "bg-white/10 text-white/70" : "bg-white/20 text-white"
        )}>
          <Clock className="w-4 h-4" />
          {isSeasonStarted ? "Closed on" : "Deadline:"} April 10, 7:29 PM IST
        </div>
      </div>

      <div className={cn("bg-white rounded-3xl p-8 border border-slate-100 shadow-sm space-y-6", isSeasonStarted && "opacity-75 pointer-events-none")}>
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">Winner</label>
            <select 
              value={prediction.winner || ''} 
              onChange={e => setPrediction({...prediction, winner: e.target.value as Team})}
              className="w-full p-3 bg-slate-50 border border-slate-100 rounded-xl font-medium"
            >
              <option value="">Select Team</option>
              {TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">Runner Up</label>
            <select 
              value={prediction.runnerUp || ''} 
              onChange={e => setPrediction({...prediction, runnerUp: e.target.value as Team})}
              className="w-full p-3 bg-slate-50 border border-slate-100 rounded-xl font-medium"
            >
              <option value="">Select Team</option>
              {TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-bold text-slate-700 mb-2">Top 4 Teams</label>
          <div className="grid grid-cols-5 gap-2">
            {TEAMS.map(team => {
              const isSelected = prediction.top4?.includes(team);
              return (
                <button
                  key={team}
                  onClick={() => {
                    const current = prediction.top4 || [];
                    if (isSelected) {
                      setPrediction({...prediction, top4: current.filter(t => t !== team)});
                    } else if (current.length < 4) {
                      setPrediction({...prediction, top4: [...current, team]});
                    }
                  }}
                  className={cn(
                    "py-2 rounded-lg text-xs font-bold transition-all",
                    isSelected ? "bg-red-600 text-white" : "bg-slate-50 text-slate-500 hover:bg-slate-100"
                  )}
                >
                  {team}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="block text-sm font-bold text-slate-700 mb-2">Last Place Team</label>
          <select
            value={prediction.lastPlace || ''}
            onChange={e => setPrediction({...prediction, lastPlace: e.target.value as Team})}
            className="w-full p-3 bg-slate-50 border border-slate-100 rounded-xl font-medium"
          >
            <option value="">Select Team</option>
            {TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">Orange Cap</label>
            <input 
              type="text" 
              placeholder="Player Name"
              value={prediction.orangeCap || ''}
              onChange={e => setPrediction({...prediction, orangeCap: e.target.value})}
              className="w-full p-3 bg-slate-50 border border-slate-100 rounded-xl font-medium"
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">Purple Cap</label>
            <input 
              type="text" 
              placeholder="Player Name"
              value={prediction.purpleCap || ''}
              onChange={e => setPrediction({...prediction, purpleCap: e.target.value})}
              className="w-full p-3 bg-slate-50 border border-slate-100 rounded-xl font-medium"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-bold text-slate-700 mb-2">MVP of the Season</label>
          <input 
            type="text" 
            placeholder="Player Name"
            value={prediction.mvp || ''}
            onChange={e => setPrediction({...prediction, mvp: e.target.value})}
            className="w-full p-3 bg-slate-50 border border-slate-100 rounded-xl font-medium"
          />
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full bg-slate-900 text-white font-bold py-4 rounded-2xl hover:bg-slate-800 transition-all disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Predictions'}
        </button>
      </div>
    </div>
  );
};

const Leaderboard = () => {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, 'users'), orderBy('totalPoints', 'desc'), limit(50));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setUsers(snapshot.docs.map(doc => doc.data() as UserProfile));
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'users');
    });
    return () => unsubscribe();
  }, []);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Leaderboard</h1>
        <p className="text-sm text-slate-500 mt-1">Live rankings — updates automatically as matches are resolved.</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-10 h-10 border-4 border-red-200 border-t-red-600 rounded-full animate-spin" />
        </div>
      ) : users.length === 0 ? (
        <div className="py-16 text-center bg-slate-50 rounded-3xl border-2 border-dashed border-slate-200">
          <ListOrdered className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-400 font-medium">No players on the leaderboard yet.</p>
        </div>
      ) : (
        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
          {users.map((user, i) => (
            <div key={user.uid} className="flex items-center gap-4 p-4 border-b border-slate-50 last:border-0">
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm",
                i === 0 ? "bg-yellow-100 text-yellow-700" : 
                i === 1 ? "bg-slate-100 text-slate-700" :
                i === 2 ? "bg-red-100 text-red-700" : "text-slate-400"
              )}>
                {i + 1}
              </div>
              <img src={user.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.uid}`} className="w-10 h-10 rounded-full bg-slate-100" />
              <div className="flex-1">
                <div className="font-bold text-slate-900">{user.displayName}</div>
                <div className="text-xs text-slate-400">Rank #{i + 1}</div>
              </div>
              <div className="text-lg font-black text-red-600">{user.totalPoints} <span className="text-[10px] font-bold uppercase text-slate-400">pts</span></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const AdminPanel = () => {
  const [matches, setMatches] = useState<Match[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [newMatch, setNewMatch] = useState<Partial<Match>>({
    status: 'upcoming'
  });
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  useEffect(() => {
    if (syncMessage) {
      const timer = setTimeout(() => setSyncMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [syncMessage]);

  useEffect(() => {
    const unsubscribeMatches = onSnapshot(collection(db, 'matches'), (snapshot) => {
      setMatches(snapshot.docs.map(doc => doc.data() as Match).sort((a, b) => a.dateTime.toDate() - b.dateTime.toDate()));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'matches');
    });
    
    const unsubscribeUsers = onSnapshot(collection(db, 'users'), (snapshot) => {
      setUsers(snapshot.docs.map(doc => doc.data() as UserProfile));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'users');
    });

    return () => {
      unsubscribeMatches();
      unsubscribeUsers();
    };
  }, []);

  const handleDeleteUser = async (uid: string) => {
    try {
      setLoading(true);
      // Delete user document
      await deleteDoc(doc(db, 'users', uid));
      // Delete long term predictions
      await deleteDoc(doc(db, 'longTermPredictions', uid));
      // Delete daily predictions
      const dailyPredsSnap = await getDocs(query(collection(db, 'dailyPredictions'), where('uid', '==', uid)));
      for (const dDoc of dailyPredsSnap.docs) {
        await deleteDoc(dDoc.ref);
      }
      console.log('User removed successfully.');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${uid}`);
    } finally {
      setLoading(false);
    }
  };

  const handleImportFromFeed = async () => {
    setLoading(true);
    try {
      const feed = await fetchIPLSchedule();
      const VALID_TEAMS = new Set(TEAMS as readonly string[]);
      let created = 0;
      let skipped = 0;

      for (const m of feed) {
        const team1 = m.FirstBattingTeamCode as Team;
        const team2 = m.SecondBattingTeamCode as Team;
        if (!VALID_TEAMS.has(team1) || !VALID_TEAMS.has(team2)) continue;

        const matchId = `ipl_${m.MatchID}`;
        const existing = await getDoc(doc(db, 'matches', matchId));
        if (existing.exists()) { skipped++; continue; }

        const dateTime = new Date(m.MATCH_COMMENCE_START_DATE);
        const status = m.MatchStatus === 'Completed' ? 'completed' : 'upcoming';

        await setDoc(doc(db, 'matches', matchId), {
          matchId,
          team1,
          team2,
          dateTime,
          status,
        } as Match);
        created++;
      }

      setSyncMessage(`Imported ${created} matches from IPL feed (${skipped} already existed).`);
    } catch (error) {
      console.error('Import error:', error);
      setSyncMessage('Failed to import matches. Check console.');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateMatch = async () => {
    if (!newMatch.team1 || !newMatch.team2 || !newMatch.dateTime) return;
    const matchId = `match_${Date.now()}`;
    await setDoc(doc(db, 'matches', matchId), {
      ...newMatch,
      matchId,
      dateTime: new Date(newMatch.dateTime)
    });
  };

  const handleResolveMatch = async (match: Match, winner: Team, playerOfTheMatch?: string) => {
    try {
      setLoading(true);
      await setDoc(doc(db, 'matches', match.matchId), {
        ...match,
        status: 'completed',
        winner,
        playerOfTheMatch: playerOfTheMatch || match.playerOfTheMatch || ''
      });

      // Logic to update points for all users who predicted this match
      const predsSnap = await getDocs(query(collection(db, 'dailyPredictions'), where('matchId', '==', match.matchId)));
      
      for (const predDoc of predsSnap.docs) {
        const pred = predDoc.data() as DailyPrediction;
        let points = 0;
        if (pred.winner === winner) {
          points = 5; // Correct winner
        }
        
        if (points > 0) {
          await setDoc(doc(db, 'dailyPredictions', pred.predictionId), { ...pred, pointsEarned: points }, { merge: true });
          const userRef = doc(db, 'users', pred.uid);
          const userDoc = await getDoc(userRef);
          if (userDoc.exists()) {
            const userData = userDoc.data() as UserProfile;
            await setDoc(userRef, { totalPoints: userData.totalPoints + points }, { merge: true });
          }
        }
      }
      console.log(`Match ${match.matchId} resolved successfully.`);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `matches/${match.matchId}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSyncIPLFeed = async () => {
    try {
      setLoading(true);
      const feed = await fetchIPLSchedule();

      const TEAM_CODE_MAP: Record<string, Team> = {
        CSK: 'CSK', DC: 'DC', PBKS: 'PBKS', KKR: 'KKR', MI: 'MI',
        RR: 'RR', RCB: 'RCB', SRH: 'SRH', GT: 'GT', LSG: 'LSG',
      };

      let updatedCount = 0;

      for (const feedMatch of feed) {
        if (feedMatch.MatchStatus === 'Completed' && feedMatch.WinningTeamID) {
          const team1 = TEAM_CODE_MAP[feedMatch.FirstBattingTeamCode];
          const team2 = TEAM_CODE_MAP[feedMatch.SecondBattingTeamCode];
          if (!team1 || !team2) continue;

          const existingMatch = matches.find(m =>
            m.status === 'upcoming' &&
            ((m.team1 === team1 && m.team2 === team2) || (m.team1 === team2 && m.team2 === team1))
          );

          if (existingMatch) {
            const winnerCode = feedMatch.FirstBattingTeamCode === feedMatch.WinningTeamID
              ? team1
              : team2;
            const mom = feedMatch.MOM || '';
            await handleResolveMatch(existingMatch, winnerCode, mom);
            updatedCount++;
          }
        }
      }

      setSyncMessage(updatedCount > 0
        ? `Successfully synced ${updatedCount} matches!`
        : 'No new completed matches found in the feed.');
    } catch (error) {
      console.error('IPL Feed Sync Error:', error);
      setSyncMessage('Failed to sync with IPL feed. Check console for details.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetLeaderboard = async () => {
    if (!confirm('Reset leaderboard? This sets totalPoints to 0 for ALL users. This cannot be undone.')) return;
    try {
      setLoading(true);
      const snap = await getDocs(collection(db, 'users'));
      for (const userDoc of snap.docs) {
        await setDoc(userDoc.ref, { totalPoints: 0 }, { merge: true });
      }
      const predsSnap = await getDocs(collection(db, 'dailyPredictions'));
      for (const predDoc of predsSnap.docs) {
        await setDoc(predDoc.ref, { pointsEarned: 0 }, { merge: true });
      }
      setSyncMessage('Leaderboard has been reset to 0 for all users.');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'users');
      setSyncMessage('Failed to reset leaderboard. Check console.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteMatch = async (matchId: string) => {
    try {
      setLoading(true);
      await deleteDoc(doc(db, 'matches', matchId));
      
      // Delete associated predictions
      // Note: We use a try-catch here because getDocs might fail if index is missing
      try {
        const predsSnap = await getDocs(query(collection(db, 'dailyPredictions'), where('matchId', '==', matchId)));
        for (const pDoc of predsSnap.docs) {
          await deleteDoc(pDoc.ref);
        }
      } catch (e) {
        console.warn('Could not delete associated predictions:', e);
      }
      console.log('Match deleted successfully.');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `matches/${matchId}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-slate-900">Admin Panel</h1>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-4">
            <button 
              onClick={handleSyncIPLFeed}
              disabled={loading}
              className="px-4 py-2 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-all disabled:opacity-50 flex items-center gap-2"
            >
              <Calendar className="w-4 h-4" />
              Sync IPL Feed
            </button>
            <button 
              onClick={handleImportFromFeed}
              disabled={loading}
              className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl font-bold hover:bg-slate-200 transition-all disabled:opacity-50"
            >
              Import All Matches from Feed
            </button>
            <button 
              onClick={handleResetLeaderboard}
              disabled={loading}
              className="px-4 py-2 bg-amber-50 text-amber-700 border border-amber-200 rounded-xl font-bold hover:bg-amber-100 transition-all disabled:opacity-50"
            >
              Reset Leaderboard
            </button>
          </div>
          <AnimatePresence>
            {syncMessage && (
              <motion.div 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="text-xs font-bold text-red-600 bg-red-50 px-3 py-1 rounded-full border border-red-100"
              >
                {syncMessage}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      
      <section className="bg-white rounded-3xl p-8 border border-slate-100 shadow-sm">
        <h2 className="text-xl font-bold mb-6">Create Match</h2>
        <div className="grid gap-4 md:grid-cols-4">
          <select onChange={e => setNewMatch({...newMatch, team1: e.target.value as Team})} className="p-3 bg-slate-50 rounded-xl">
            <option value="">Team 1</option>
            {TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select onChange={e => setNewMatch({...newMatch, team2: e.target.value as Team})} className="p-3 bg-slate-50 rounded-xl">
            <option value="">Team 2</option>
            {TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <input type="datetime-local" onChange={e => setNewMatch({...newMatch, dateTime: e.target.value})} className="p-3 bg-slate-50 rounded-xl" />
          <button onClick={handleCreateMatch} className="bg-slate-900 text-white font-bold rounded-xl">Add Match</button>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-bold">Manage Matches</h2>
        {matches.map(match => (
          <div key={match.matchId} className="bg-white p-4 rounded-2xl border border-slate-100 flex items-center justify-between">
            <div>
              <span className="font-bold">{match.team1} vs {match.team2}</span>
              <div className="text-xs text-slate-400">
                {format(match.dateTime.toDate(), 'PPP • p')} • {match.status}
                {match.winner && <span className="ml-2 text-red-600 font-bold">• Winner: {match.winner}</span>}
                {match.playerOfTheMatch && <span className="ml-2 text-slate-600">• MOM: {match.playerOfTheMatch}</span>}
              </div>
            </div>
              <div className="flex items-center gap-2">
                {match.status === 'upcoming' && (
                  <div className="flex gap-2">
                    <button onClick={() => handleResolveMatch(match, match.team1)} className="px-3 py-1 bg-slate-900 text-white text-xs rounded-lg">{match.team1} Won</button>
                    <button onClick={() => handleResolveMatch(match, match.team2)} className="px-3 py-1 bg-slate-900 text-white text-xs rounded-lg">{match.team2} Won</button>
                  </div>
                )}
                <button 
                  onClick={() => handleDeleteMatch(match.matchId)}
                  disabled={loading}
                  className="p-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-all disabled:opacity-50"
                  title="Delete Match"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
          </div>
        ))}
      </section>

      <UserManagement users={users} loading={loading} onDeleteUser={handleDeleteUser} />

      <PredictionLog users={users} matches={matches} />
    </div>
  );
};

const PredictionLog = ({ users, matches }: { users: UserProfile[]; matches: Match[] }) => {
  const [dailyPreds, setDailyPreds] = useState<DailyPrediction[]>([]);
  const [longTermPreds, setLongTermPreds] = useState<LongTermPrediction[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [tab, setTab] = useState<'daily' | 'season'>('daily');

  useEffect(() => {
    const unsubDaily = onSnapshot(collection(db, 'dailyPredictions'), (snap) => {
      setDailyPreds(snap.docs.map(d => d.data() as DailyPrediction));
    }, (error) => handleFirestoreError(error, OperationType.GET, 'dailyPredictions'));

    const unsubLong = onSnapshot(collection(db, 'longTermPredictions'), (snap) => {
      setLongTermPreds(snap.docs.map(d => d.data() as LongTermPrediction));
      setLoading(false);
    }, (error) => handleFirestoreError(error, OperationType.GET, 'longTermPredictions'));

    return () => { unsubDaily(); unsubLong(); };
  }, []);

  const matchMap = Object.fromEntries(matches.map(m => [m.matchId, m]));
  const userMap = Object.fromEntries(users.map(u => [u.uid, u]));

  const userIds = [...new Set([
    ...dailyPreds.map(p => p.uid),
    ...longTermPreds.map(p => p.uid),
  ])];

  const formatTs = (ts: any) => {
    if (!ts) return '—';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return format(d, 'MMM d, h:mm a');
  };

  if (loading) {
    return (
      <section className="space-y-4">
        <h2 className="text-xl font-bold">Prediction Log</h2>
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-4 border-red-200 border-t-red-600 rounded-full animate-spin" />
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Prediction Log</h2>
        <div className="flex gap-2">
          {(['daily', 'season'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'px-4 py-1.5 rounded-lg text-xs font-bold capitalize transition-all',
                tab === t ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              )}
            >
              {t === 'daily' ? 'Daily Predictions' : 'Season Predictions'}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden divide-y divide-slate-50">
        {userIds.length === 0 && (
          <div className="p-8 text-center text-slate-400 text-sm">No predictions yet.</div>
        )}

        {userIds.map(uid => {
          const u = userMap[uid];
          const isExpanded = expandedUser === uid;
          const userDailyPreds = dailyPreds
            .filter(p => p.uid === uid)
            .sort((a, b) => {
              const da = a.updatedAt?.toDate?.() ?? a.submittedAt?.toDate?.() ?? new Date(a.submittedAt);
              const db2 = b.updatedAt?.toDate?.() ?? b.submittedAt?.toDate?.() ?? new Date(b.submittedAt);
              return db2.getTime() - da.getTime();
            });
          const userLongTerm = longTermPreds.find(p => p.uid === uid);

          const predCount = tab === 'daily' ? userDailyPreds.length : (userLongTerm ? 1 : 0);

          return (
            <div key={uid}>
              <button
                onClick={() => setExpandedUser(isExpanded ? null : uid)}
                className="w-full flex items-center gap-4 p-4 hover:bg-slate-50/50 transition-colors text-left"
              >
                <img
                  src={u?.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${uid}`}
                  className="w-9 h-9 rounded-full bg-slate-100 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <span className="font-bold text-slate-900 text-sm">{u?.displayName || uid}</span>
                  <span className="text-xs text-slate-400 ml-2">{u?.email}</span>
                </div>
                <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full shrink-0">
                  {predCount} {tab === 'daily' ? (predCount === 1 ? 'pick' : 'picks') : (predCount === 1 ? 'entry' : 'entries')}
                </span>
                <ChevronRight className={cn('w-4 h-4 text-slate-400 transition-transform', isExpanded && 'rotate-90')} />
              </button>

              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    {tab === 'daily' ? (
                      userDailyPreds.length === 0 ? (
                        <div className="px-6 pb-4 text-sm text-slate-400">No daily predictions.</div>
                      ) : (
                        <div className="px-4 pb-4">
                          <div className="rounded-2xl border border-slate-100 overflow-hidden">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="bg-slate-50 text-left">
                                  <th className="px-4 py-2.5 font-bold text-slate-500 text-xs uppercase tracking-wider">Match</th>
                                  <th className="px-4 py-2.5 font-bold text-slate-500 text-xs uppercase tracking-wider">Pick</th>
                                  <th className="px-4 py-2.5 font-bold text-slate-500 text-xs uppercase tracking-wider">Pts</th>
                                  <th className="px-4 py-2.5 font-bold text-slate-500 text-xs uppercase tracking-wider">Submitted</th>
                                  <th className="px-4 py-2.5 font-bold text-slate-500 text-xs uppercase tracking-wider">Last Updated</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-50">
                                {userDailyPreds.map(pred => {
                                  const m = matchMap[pred.matchId];
                                  return (
                                    <tr key={pred.predictionId} className="hover:bg-slate-50/50">
                                      <td className="px-4 py-3 font-medium text-slate-900">
                                        {m ? `${m.team1} vs ${m.team2}` : pred.matchId}
                                        {m && (
                                          <div className="text-[10px] text-slate-400 mt-0.5">
                                            {format(m.dateTime.toDate(), 'MMM d')}
                                          </div>
                                        )}
                                      </td>
                                      <td className="px-4 py-3">
                                        <span className="px-2 py-0.5 bg-red-50 text-red-600 rounded font-bold text-xs">
                                          {pred.winner}
                                        </span>
                                      </td>
                                      <td className="px-4 py-3">
                                        {pred.pointsEarned != null ? (
                                          <span className={cn('font-bold', pred.pointsEarned > 0 ? 'text-green-600' : 'text-slate-400')}>
                                            {pred.pointsEarned > 0 ? `+${pred.pointsEarned}` : '0'}
                                          </span>
                                        ) : (
                                          <span className="text-slate-300">—</span>
                                        )}
                                      </td>
                                      <td className="px-4 py-3 text-xs text-slate-500">{formatTs(pred.submittedAt)}</td>
                                      <td className="px-4 py-3 text-xs text-slate-500">{formatTs(pred.updatedAt)}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )
                    ) : (
                      !userLongTerm ? (
                        <div className="px-6 pb-4 text-sm text-slate-400">No season prediction submitted.</div>
                      ) : (
                        <div className="px-4 pb-4">
                          <div className="rounded-2xl border border-slate-100 overflow-hidden">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="bg-slate-50 text-left">
                                  <th className="px-4 py-2.5 font-bold text-slate-500 text-xs uppercase tracking-wider">Field</th>
                                  <th className="px-4 py-2.5 font-bold text-slate-500 text-xs uppercase tracking-wider">Pick</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-50">
                                {[
                                  { label: 'Winner', value: userLongTerm.winner },
                                  { label: 'Runner-up', value: userLongTerm.runnerUp },
                                  { label: 'Top 4', value: userLongTerm.top4?.join(', ') },
                                  { label: 'Last Place', value: userLongTerm.lastPlace },
                                  { label: 'Orange Cap', value: userLongTerm.orangeCap },
                                  { label: 'Purple Cap', value: userLongTerm.purpleCap },
                                  { label: 'MVP of the Season', value: userLongTerm.mvp },
                                  { label: 'Submitted', value: formatTs(userLongTerm.submittedAt) },
                                  { label: 'Last Updated', value: formatTs(userLongTerm.updatedAt) },
                                ].map(row => (
                                  <tr key={row.label} className="hover:bg-slate-50/50">
                                    <td className="px-4 py-2.5 font-medium text-slate-500">{row.label}</td>
                                    <td className="px-4 py-2.5 font-bold text-slate-900">{row.value || '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </section>
  );
};

const UserManagement = ({ users, loading, onDeleteUser }: { users: UserProfile[]; loading: boolean; onDeleteUser: (uid: string) => Promise<void> }) => {
  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState<'admin' | 'user'>('user');
  const [saving, setSaving] = useState(false);

  const startEdit = (u: UserProfile) => {
    setEditingUid(u.uid);
    setEditName(u.displayName);
    setEditRole(u.role);
  };

  const cancelEdit = () => setEditingUid(null);

  const saveEdit = async (uid: string) => {
    setSaving(true);
    try {
      await setDoc(doc(db, 'users', uid), { displayName: editName, role: editRole }, { merge: true });
      setEditingUid(null);
    } catch (error) {
      console.error('Update user error:', error);
    } finally {
      setSaving(false);
    }
  };

  const toggleRole = async (u: UserProfile) => {
    const newRole = u.role === 'admin' ? 'user' : 'admin';
    await setDoc(doc(db, 'users', u.uid), { role: newRole }, { merge: true });
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Manage Users</h2>
        <span className="text-xs text-slate-400 font-medium">{users.length} users</span>
      </div>

      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden divide-y divide-slate-50">
        {users.map((u) => {
          const isEditing = editingUid === u.uid;
          return (
            <div key={u.uid} className="p-4">
              {isEditing ? (
                <div className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-3">
                    <input
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      placeholder="Display Name"
                      className="p-2.5 bg-slate-50 border border-slate-100 rounded-xl text-sm font-medium"
                    />
                    <div className="text-sm text-slate-400 flex items-center px-2">{u.email}</div>
                    <select
                      value={editRole}
                      onChange={e => setEditRole(e.target.value as 'admin' | 'user')}
                      className="p-2.5 bg-slate-50 border border-slate-100 rounded-xl text-sm font-medium"
                    >
                      <option value="user">Regular User</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => saveEdit(u.uid)}
                      disabled={saving || !editName.trim()}
                      className="px-4 py-2 bg-slate-900 text-white text-xs font-bold rounded-lg disabled:opacity-50"
                    >
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                    <button onClick={cancelEdit} className="px-4 py-2 text-slate-500 text-xs font-bold hover:text-slate-900">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-4">
                  <img
                    src={u.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${u.uid}`}
                    className="w-10 h-10 rounded-full bg-slate-100 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900 truncate">{u.displayName}</span>
                      <span className={cn(
                        "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase shrink-0",
                        u.role === 'admin' ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-500"
                      )}>
                        {u.role}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 truncate">{u.email}</div>
                  </div>
                  <div className="text-sm font-black text-red-600 shrink-0">{u.totalPoints} <span className="text-[10px] text-slate-400">pts</span></div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => toggleRole(u)}
                      title={u.role === 'admin' ? 'Demote to User' : 'Promote to Admin'}
                      className="p-2 text-slate-400 hover:text-amber-600 transition-colors"
                    >
                      <Shield className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => startEdit(u)}
                      className="p-2 text-slate-400 hover:text-blue-600 transition-colors"
                      title="Edit User"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => onDeleteUser(u.uid)}
                      disabled={u.role === 'admin' || loading}
                      className="p-2 text-slate-400 hover:text-red-600 transition-colors disabled:opacity-30"
                      title="Delete User"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {users.length === 0 && (
          <div className="p-8 text-center text-slate-400 text-sm">No users yet.</div>
        )}
      </div>
    </section>
  );
}
