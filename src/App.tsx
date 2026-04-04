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
import { Trophy, Calendar, LayoutDashboard, ListOrdered, Settings, Info, ChevronRight, CheckCircle2, AlertCircle, Trash2, MapPin, Clock, RefreshCw, Zap, LogOut, Mail, Pencil, Shield, UserPlus, BarChart3 } from 'lucide-react';
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

let _pendingDisplayName: string | null = null;

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
        _pendingDisplayName = displayName || null;
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        if (displayName) {
          await updateProfile(cred.user, { displayName });
        }
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

      <a
        href="https://www.youtube.com/@DugoutDost"
        target="_blank"
        rel="noopener noreferrer"
        className="block bg-gradient-to-r from-red-600 to-red-500 rounded-3xl p-6 md:p-8 text-white relative overflow-hidden group hover:shadow-xl hover:shadow-red-200 transition-all"
      >
        <div className="flex flex-col md:flex-row items-center gap-5">
          <div className="w-16 h-16 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center shrink-0">
            <svg viewBox="0 0 24 24" className="w-8 h-8 fill-white">
              <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
            </svg>
          </div>
          <div className="text-center md:text-left flex-1">
            <h3 className="text-xl md:text-2xl font-black mb-1">Subscribe to Dugout Dost</h3>
            <p className="text-white/80 text-sm">Podcasts, live reactions, tactical analysis & more — join the community!</p>
          </div>
          <div className="px-6 py-3 bg-white text-red-600 font-black rounded-xl text-sm group-hover:bg-red-50 transition-colors shrink-0">
            Subscribe on YouTube
          </div>
        </div>
      </a>
    </div>
  );
};

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  UpComing: { bg: 'bg-blue-50 border-blue-100', text: 'text-blue-600', label: 'Upcoming' },
  Post: { bg: 'bg-green-50 border-green-100', text: 'text-green-600', label: 'Completed' },
  Completed: { bg: 'bg-green-50 border-green-100', text: 'text-green-600', label: 'Completed' },
  Live: { bg: 'bg-red-50 border-red-100', text: 'text-red-600', label: 'Live' },
};

function getStatusStyle(status: string) {
  return STATUS_STYLES[status] ?? { bg: 'bg-slate-50 border-slate-100', text: 'text-slate-600', label: status };
}

const Schedule = () => {
  const { matches, loading, error, lastUpdated, isMatchDay } = useIPLSchedule();
  const [filter, setFilter] = useState<'all' | 'upcoming' | 'completed'>('upcoming');

  const grouped = matches
    .filter((m) => {
      if (filter === 'upcoming') return m.MatchStatus === 'UpComing' || m.MatchStatus === 'Live';
      if (filter === 'completed') return m.MatchStatus === 'Post' || m.MatchStatus === 'Completed';
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
      const resolvedName = firebaseUser.displayName || _pendingDisplayName || 'Anonymous';
      _pendingDisplayName = null;

      const profileData: Record<string, any> = {
        uid: firebaseUser.uid,
        email: firebaseUser.email || '',
        displayName: resolvedName,
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
          } catch (writeErr) {
            console.warn('Firestore create failed, retrying with merge:', writeErr);
            await setDoc(userRef, profileData, { merge: true });
          }
          setUser(asUserProfile);
        } else {
          const data = userDoc.data() as UserProfile;
          const updates: Record<string, any> = {};

          if (data.displayName === 'Anonymous' && resolvedName !== 'Anonymous') {
            updates.displayName = resolvedName;
          }
          if (isAdmin && data.role !== 'admin') {
            updates.role = 'admin';
          }

          if (Object.keys(updates).length > 0) {
            await setDoc(userRef, updates, { merge: true });
            setUser({ ...data, ...updates });
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
            <a href="https://www.youtube.com/@DugoutDost" target="_blank" rel="noopener noreferrer" className="block">
              <div className="max-w-7xl mx-auto">
                <img src="/banner.png" alt="Dugout Dost — Podcasts, Live, Reaction Videos, Football Tactical Analysis" className="w-full h-auto object-cover" />
              </div>
            </a>
            <div className="text-center py-5 space-y-4">
              <div className="flex items-center justify-center gap-3 flex-wrap">
                <a
                  href="https://www.youtube.com/@DugoutDost"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-5 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-full transition-colors"
                >
                  <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
                    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                  </svg>
                  YouTube
                </a>
                <a
                  href="https://discord.gg/ZMfbB3vu8F"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-5 py-2 bg-[#5865F2] hover:bg-[#4752C4] text-white text-xs font-bold rounded-full transition-colors"
                >
                  <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
                    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/>
                  </svg>
                  Discord
                </a>
                <a
                  href="https://instagram.com/sportswithsardarjiandfriends"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-700 hover:to-pink-600 text-white text-xs font-bold rounded-full transition-colors"
                >
                  <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
                    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/>
                  </svg>
                  Instagram
                </a>
              </div>
              <div className="text-xs text-white/60 font-medium tracking-wide">
                &copy; {new Date().getFullYear()} Dugout Dost &middot; Sportz with Sardarji
              </div>
              <div className="text-[10px] text-white/40 font-medium">
                Built &amp; developed by{' '}
                <a href="https://github.com/AlabhyaVaibhav" target="_blank" rel="noopener noreferrer" className="text-white/60 hover:text-white underline underline-offset-2 transition-colors">
                  Alabhya
                </a>
              </div>
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
  const [selectedPotm, setSelectedPotm] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedMatch, setSavedMatch] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribeMatches = onSnapshot(collection(db, 'matches'), (snapshot) => {
      setMatches(snapshot.docs.map(d => d.data() as Match).sort((a, b) => a.dateTime.toDate() - b.dateTime.toDate()));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'matches');
    });

    const q = query(collection(db, 'dailyPredictions'), where('uid', '==', user.uid));
    const unsubscribePreds = onSnapshot(q, (snapshot) => {
      const userPreds = snapshot.docs.map(d => d.data() as DailyPrediction);
      setPreds(userPreds);
      setSelectedWinners(prev => {
        const next = { ...prev };
        for (const p of userPreds) {
          if (!(p.matchId in next)) next[p.matchId] = p.winner;
        }
        return next;
      });
      setSelectedPotm(prev => {
        const next = { ...prev };
        for (const p of userPreds) {
          if (!(p.matchId in next) && p.playerOfTheMatch) next[p.matchId] = p.playerOfTheMatch;
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

  useEffect(() => {
    if (savedMatch) {
      const t = setTimeout(() => setSavedMatch(null), 3000);
      return () => clearTimeout(t);
    }
  }, [savedMatch]);

  const handleSubmit = async (matchId: string) => {
    const winner = selectedWinners[matchId];
    if (!winner) return;
    
    setSaveError(null);
    setSubmitting(matchId);
    const predId = `${user.uid}_${matchId}`;
    try {
      const existing = preds.find(p => p.predictionId === predId);
      const potm = selectedPotm[matchId]?.trim() || '';
      const now = new Date();
      const newPred: DailyPrediction = {
        predictionId: predId,
        uid: user.uid,
        matchId,
        winner,
        ...(potm ? { playerOfTheMatch: potm } : {}),
        submittedAt: existing?.submittedAt ?? now,
        updatedAt: now,
      };

      await setDoc(doc(db, 'dailyPredictions', predId), newPred);
      setSavedMatch(matchId);
    } catch (error: any) {
      console.error('Daily prediction save failed:', error);
      setSaveError(error?.message || 'Failed to save prediction. Please try again.');
      handleFirestoreError(error, OperationType.WRITE, `dailyPredictions/${predId}`);
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

      <AnimatePresence>
        {saveError && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div className="text-sm text-red-800"><strong>Save failed:</strong> {saveError}</div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid gap-6 md:grid-cols-2">
        {matches.map((match) => {
          const prediction = preds.find(p => p.matchId === match.matchId);
          const deadline = subMinutes(match.dateTime.toDate(), 15);
          const isLocked = isAfter(new Date(), deadline) || match.status === 'completed';
          const selectedWinner = selectedWinners[match.matchId];
          const currentPotm = selectedPotm[match.matchId] ?? '';
          const hasChanged = prediction
            ? selectedWinner !== prediction.winner || currentPotm !== (prediction.playerOfTheMatch || '')
            : !!selectedWinner;
          
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

              <div className="mb-4">
                <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Player of the Match (optional, +2 pts)</label>
                <input
                  type="text"
                  placeholder="e.g. Virat Kohli"
                  value={currentPotm}
                  onChange={e => setSelectedPotm(prev => ({ ...prev, [match.matchId]: e.target.value }))}
                  disabled={isLocked}
                  className="w-full p-3 bg-slate-50 border border-slate-100 rounded-xl text-sm font-medium placeholder:text-slate-400 disabled:opacity-60 disabled:cursor-not-allowed"
                />
              </div>

              {isLocked ? (
                prediction ? (
                  <div className="mt-auto pt-4 border-t border-slate-50 space-y-1 text-center">
                    <div className="flex items-center gap-2 text-sm text-slate-500 justify-center">
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                      Your pick: <span className="font-bold text-slate-900">{prediction.winner}</span>
                      {prediction.pointsEarned != null && (
                        <span className={cn("font-bold ml-2", prediction.pointsEarned > 0 ? "text-green-600" : "text-slate-400")}>
                          {prediction.pointsEarned > 0 ? `+${prediction.pointsEarned} pts` : '0 pts'}
                        </span>
                      )}
                    </div>
                    {prediction.playerOfTheMatch && (
                      <div className="text-xs text-slate-400">POTM: <span className="font-bold text-slate-600">{prediction.playerOfTheMatch}</span></div>
                    )}
                  </div>
                ) : (
                  <div className="mt-auto pt-4 border-t border-slate-50 text-center text-xs text-red-500 font-bold uppercase">
                    Missed Deadline
                  </div>
                )
              ) : (
                <div className="mt-auto space-y-2">
                  <button
                    disabled={!selectedWinner || !hasChanged || submitting === match.matchId}
                    onClick={() => handleSubmit(match.matchId)}
                    className="w-full py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-all disabled:opacity-50 disabled:bg-slate-200 disabled:text-slate-400 shadow-lg shadow-red-100"
                  >
                    {submitting === match.matchId
                      ? 'Saving...'
                      : savedMatch === match.matchId
                        ? '✓ Saved!'
                        : prediction
                          ? 'Update Prediction'
                          : 'Save Prediction'}
                  </button>
                </div>
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
  const [matchPotm, setMatchPotm] = useState<Record<string, string>>({});

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
        const status = (m.MatchStatus === 'Completed' || m.MatchStatus === 'Post') ? 'completed' : 'upcoming';

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
      const mom = playerOfTheMatch || match.playerOfTheMatch || '';
      await setDoc(doc(db, 'matches', match.matchId), {
        ...match,
        status: 'completed',
        winner,
        playerOfTheMatch: mom,
      });

      const predsSnap = await getDocs(query(collection(db, 'dailyPredictions'), where('matchId', '==', match.matchId)));
      
      for (const predDoc of predsSnap.docs) {
        const pred = predDoc.data() as DailyPrediction;
        let points = 0;
        if (pred.winner === winner) {
          points += 5;
        }
        if (mom && pred.playerOfTheMatch && pred.playerOfTheMatch.toLowerCase().trim() === mom.toLowerCase().trim()) {
          points += 2;
        }

        await setDoc(doc(db, 'dailyPredictions', pred.predictionId), { ...pred, pointsEarned: points }, { merge: true });
        if (points > 0) {
          const userRef = doc(db, 'users', pred.uid);
          const userDoc = await getDoc(userRef);
          if (userDoc.exists()) {
            const userData = userDoc.data() as UserProfile;
            await setDoc(userRef, { totalPoints: userData.totalPoints + points }, { merge: true });
          }
        }
      }
      setSyncMessage(`Match resolved: ${winner} won${mom ? `, POTM: ${mom}` : ''}.`);
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
        if ((feedMatch.MatchStatus === 'Completed' || feedMatch.MatchStatus === 'Post') && feedMatch.WinningTeamID) {
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

  const [bonusEmail, setBonusEmail] = useState('');
  const [bonusMatchId, setBonusMatchId] = useState('');
  const [bonusPoints, setBonusPoints] = useState('2');

  const handleAwardBonusPoints = async () => {
    const email = bonusEmail.trim().toLowerCase();
    const delta = Math.round(Number(bonusPoints));
    if (!email || !bonusMatchId || !Number.isFinite(delta) || delta === 0) {
      setSyncMessage('Enter a valid email, match, and non-zero point amount.');
      return;
    }
    const user = users.find(u => u.email.trim().toLowerCase() === email);
    if (!user) {
      setSyncMessage(`No user found with email ${bonusEmail.trim()}.`);
      return;
    }
    const predId = `${user.uid}_${bonusMatchId}`;
    try {
      setLoading(true);
      const predRef = doc(db, 'dailyPredictions', predId);
      const predSnap = await getDoc(predRef);
      if (!predSnap.exists()) {
        setSyncMessage('No daily prediction document for this user and match (expected prediction id: uid_matchId).');
        return;
      }
      const pred = predSnap.data() as DailyPrediction;
      const nextEarned = (pred.pointsEarned ?? 0) + delta;
      await setDoc(predRef, { pointsEarned: nextEarned }, { merge: true });

      const userRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userRef);
      if (userDoc.exists()) {
        const ud = userDoc.data() as UserProfile;
        await setDoc(userRef, { totalPoints: (ud.totalPoints ?? 0) + delta }, { merge: true });
      }
      setSyncMessage(`Awarded ${delta > 0 ? '+' : ''}${delta} pts to ${user.displayName} for the selected match.`);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `dailyPredictions/${predId}`);
      setSyncMessage('Failed to award bonus points. Check console.');
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

  const [adminTab, setAdminTab] = useState<'matches' | 'users' | 'predictions' | 'analytics'>('matches');

  const adminTabs: { key: typeof adminTab; label: string; icon: typeof Calendar }[] = [
    { key: 'matches', label: 'Matches', icon: Calendar },
    { key: 'users', label: 'Users', icon: UserPlus },
    { key: 'predictions', label: 'Prediction Log', icon: Zap },
    { key: 'analytics', label: 'Analytics', icon: BarChart3 },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <h1 className="text-3xl font-bold text-slate-900">Admin Panel</h1>
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

      <div className="flex gap-2 overflow-x-auto pb-1">
        {adminTabs.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setAdminTab(t.key)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold whitespace-nowrap transition-all',
                adminTab === t.key
                  ? 'bg-slate-900 text-white shadow-lg shadow-slate-200'
                  : 'bg-white text-slate-500 border border-slate-100 hover:bg-slate-50'
              )}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {adminTab === 'matches' && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
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
          </div>

          <section className="bg-white rounded-3xl p-8 border border-slate-100 shadow-sm">
            <h2 className="text-lg font-bold mb-4">Create Match</h2>
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
            <h2 className="text-lg font-bold">Manage Matches</h2>
            {matches.map(match => (
              <div key={match.matchId} className="bg-white p-4 rounded-2xl border border-slate-100 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-bold">{match.team1} vs {match.team2}</span>
                    <div className="text-xs text-slate-400">
                      {format(match.dateTime.toDate(), 'PPP • p')} • {match.status}
                      {match.winner && <span className="ml-2 text-red-600 font-bold">• Winner: {match.winner}</span>}
                      {match.playerOfTheMatch && <span className="ml-2 text-slate-600">• POTM: {match.playerOfTheMatch}</span>}
                    </div>
                  </div>
                  <button 
                    onClick={() => handleDeleteMatch(match.matchId)}
                    disabled={loading}
                    className="p-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-all disabled:opacity-50 shrink-0"
                    title="Delete Match"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                {match.status === 'upcoming' && (
                  <div className="flex items-center gap-2 pt-2 border-t border-slate-50">
                    <input
                      type="text"
                      placeholder="Player of the Match"
                      value={matchPotm[match.matchId] || ''}
                      onChange={e => setMatchPotm(prev => ({ ...prev, [match.matchId]: e.target.value }))}
                      className="flex-1 p-2 bg-slate-50 border border-slate-100 rounded-lg text-sm font-medium placeholder:text-slate-400"
                    />
                    <button
                      onClick={() => handleResolveMatch(match, match.team1, matchPotm[match.matchId])}
                      disabled={loading}
                      className="px-3 py-2 bg-slate-900 text-white text-xs font-bold rounded-lg disabled:opacity-50 whitespace-nowrap"
                    >
                      {match.team1} Won
                    </button>
                    <button
                      onClick={() => handleResolveMatch(match, match.team2, matchPotm[match.matchId])}
                      disabled={loading}
                      className="px-3 py-2 bg-slate-900 text-white text-xs font-bold rounded-lg disabled:opacity-50 whitespace-nowrap"
                    >
                      {match.team2} Won
                    </button>
                  </div>
                )}
              </div>
            ))}
          </section>
        </div>
      )}

      {adminTab === 'users' && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <button 
              onClick={handleResetLeaderboard}
              disabled={loading}
              className="px-4 py-2 bg-amber-50 text-amber-700 border border-amber-200 rounded-xl font-bold hover:bg-amber-100 transition-all disabled:opacity-50"
            >
              Reset Leaderboard
            </button>
          </div>

          <section className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm space-y-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Bonus points (e.g. POTM correction)</h2>
              <p className="text-xs text-slate-500 mt-1">
                Adds to both <span className="font-medium">dailyPredictions.pointsEarned</span> for that match and the user&apos;s <span className="font-medium">totalPoints</span>.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <input
                type="email"
                placeholder="user@email.com"
                value={bonusEmail}
                onChange={e => setBonusEmail(e.target.value)}
                className="p-3 bg-slate-50 border border-slate-100 rounded-xl text-sm font-medium placeholder:text-slate-400"
              />
              <select
                value={bonusMatchId}
                onChange={e => setBonusMatchId(e.target.value)}
                className="p-3 bg-slate-50 border border-slate-100 rounded-xl text-sm font-medium"
              >
                <option value="">Select match</option>
                {[...matches]
                  .sort((a, b) => a.dateTime.toDate().getTime() - b.dateTime.toDate().getTime())
                  .map(m => (
                    <option key={m.matchId} value={m.matchId}>
                      {m.team1} vs {m.team2} — {format(m.dateTime.toDate(), 'MMM d, yyyy')}
                    </option>
                  ))}
              </select>
              <input
                type="number"
                placeholder="Points"
                value={bonusPoints}
                onChange={e => setBonusPoints(e.target.value)}
                className="p-3 bg-slate-50 border border-slate-100 rounded-xl text-sm font-medium"
              />
              <button
                type="button"
                onClick={handleAwardBonusPoints}
                disabled={loading}
                className="px-4 py-3 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 transition-all disabled:opacity-50"
              >
                Award points
              </button>
            </div>
          </section>

          <UserManagement users={users} loading={loading} onDeleteUser={handleDeleteUser} />
        </div>
      )}

      {adminTab === 'predictions' && (
        <PredictionLog users={users} matches={matches} />
      )}

      {adminTab === 'analytics' && (
        <AdminAnalytics users={users} matches={matches} />
      )}
    </div>
  );
};

const AdminAnalytics = ({ users, matches }: { users: UserProfile[]; matches: Match[] }) => {
  const [dailyPreds, setDailyPreds] = useState<DailyPrediction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'dailyPredictions'), (snap) => {
      setDailyPreds(snap.docs.map(d => d.data() as DailyPrediction));
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'dailyPredictions');
      setLoading(false);
    });
    return () => unsub();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-10 h-10 border-4 border-red-200 border-t-red-600 rounded-full animate-spin" />
      </div>
    );
  }

  const matchMap = Object.fromEntries(matches.map(m => [m.matchId, m]));

  const trendMap: Record<string, number> = {};
  for (const p of dailyPreds) {
    const m = matchMap[p.matchId];
    if (!m) continue;
    const dateKey = format(m.dateTime.toDate(), 'MMM d');
    trendMap[dateKey] = (trendMap[dateKey] || 0) + 1;
  }
  const trendData = Object.entries(trendMap).sort((a, b) => {
    const ma = matches.find(m => format(m.dateTime.toDate(), 'MMM d') === a[0]);
    const mb = matches.find(m => format(m.dateTime.toDate(), 'MMM d') === b[0]);
    if (ma && mb) return ma.dateTime.toDate().getTime() - mb.dateTime.toDate().getTime();
    return 0;
  });
  const trendMax = Math.max(...trendData.map(d => d[1]), 1);

  const teamPickCounts: Record<string, number> = {};
  for (const p of dailyPreds) {
    teamPickCounts[p.winner] = (teamPickCounts[p.winner] || 0) + 1;
  }
  const teamData = TEAMS.map(t => ({ team: t, count: teamPickCounts[t] || 0 })).sort((a, b) => b.count - a.count);
  const teamMax = Math.max(...teamData.map(d => d.count), 1);

  const teamColors: Record<string, string> = {
    CSK: 'bg-yellow-400', DC: 'bg-blue-500', GT: 'bg-cyan-500', KKR: 'bg-purple-600',
    LSG: 'bg-sky-400', MI: 'bg-blue-600', PBKS: 'bg-red-500', RR: 'bg-pink-500',
    RCB: 'bg-red-600', SRH: 'bg-orange-500',
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center">
              <Zap className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Total Predictions</div>
              <div className="text-3xl font-black text-slate-900">{dailyPreds.length}</div>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
              <UserPlus className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Total Users</div>
              <div className="text-3xl font-black text-slate-900">{users.length}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
        <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-6">Predictions Trend by Match Date</h3>
        {trendData.length === 0 ? (
          <div className="py-8 text-center text-slate-400 text-sm">No prediction data yet.</div>
        ) : (
          <div className="space-y-3">
            {trendData.map(([date, count]) => (
              <div key={date} className="flex items-center gap-3">
                <span className="text-xs font-bold text-slate-500 w-16 shrink-0 text-right">{date}</span>
                <div className="flex-1 bg-slate-50 rounded-full h-7 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${(count / trendMax) * 100}%` }}
                    transition={{ duration: 0.6, ease: 'easeOut' }}
                    className="h-full bg-gradient-to-r from-red-500 to-red-400 rounded-full flex items-center justify-end px-2.5"
                  >
                    <span className="text-[10px] font-black text-white">{count}</span>
                  </motion.div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
        <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-6">Prediction Heatmap by Team</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {teamData.map(({ team, count }) => {
            const intensity = count / teamMax;
            return (
              <div key={team} className="relative bg-slate-50 rounded-2xl p-4 text-center overflow-hidden">
                <div
                  className={cn('absolute inset-0 rounded-2xl transition-opacity', teamColors[team] || 'bg-slate-400')}
                  style={{ opacity: 0.1 + intensity * 0.35 }}
                />
                <div className="relative z-10">
                  <div className="text-lg font-black text-slate-900">{team}</div>
                  <div className="text-2xl font-black text-slate-800 mt-1">{count}</div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase">picks</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
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
                                  <th className="px-4 py-2.5 font-bold text-slate-500 text-xs uppercase tracking-wider">POTM</th>
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
                                      <td className="px-4 py-3 text-xs text-slate-600">
                                        {pred.playerOfTheMatch || <span className="text-slate-300">—</span>}
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
