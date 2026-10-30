import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import {
  appRedirectUrl,
  supabase,
  supabaseConfigured,
  type AppProfile,
} from './supabase';

type SignUpInput = {
  firstName: string;
  lastName: string;
  address: string;
  country: string;
  phone: string;
  email: string;
  password: string;
};

type AuthContextValue = {
  configured: boolean;
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: AppProfile | null;
  profileError: string;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: SignUpInput) => Promise<boolean>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AppProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState('');
  const authVersionRef = useRef(0);
  const profileRequestRef = useRef(0);

  const loadProfile = useCallback(async (userId: string, authVersion: number) => {
    if (!supabase) return null;
    const requestId = ++profileRequestRef.current;
    setProfileError('');

    const { data, error } = await supabase
      .from('profiles')
      .select(
        'id,email,first_name,last_name,address,country,phone,admin_note,role,account_status,kyc_status,withdrawals_enabled,demo_balance,created_at,updated_at',
      )
      .eq('id', userId)
      .maybeSingle();

    if (
      authVersion !== authVersionRef.current ||
      requestId !== profileRequestRef.current
    ) {
      return null;
    }

    if (error) {
      setProfile(null);
      setProfileError(
        'Your profile could not be loaded. Apply the Supabase setup SQL and check the project URL and key.',
      );
      return null;
    }
    if (!data) {
      setProfile(null);
      setProfileError(
        'Your profile is missing. Apply the Supabase setup SQL, then sign out and sign in again.',
      );
      return null;
    }

    const nextProfile = data as AppProfile;
    setProfile(nextProfile);
    return nextProfile;
  }, []);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let active = true;
    const applySession = async (nextSession: Session | null) => {
      if (!active) return;
      const authVersion = ++authVersionRef.current;
      profileRequestRef.current += 1;
      setSession(nextSession);
      setProfileError('');
      if (!nextSession) {
        setProfile(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        await loadProfile(nextSession.user.id, authVersion);
      } catch (error) {
        if (active && authVersion === authVersionRef.current) {
          setProfile(null);
          setProfileError(
            error instanceof Error
              ? error.message
              : 'Your profile could not be loaded. Please try again.',
          );
        }
      }
      if (active && authVersion === authVersionRef.current) setLoading(false);
    };

    const initialAuthVersion = authVersionRef.current;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'INITIAL_SESSION') return;
      void Promise.resolve().then(() => applySession(nextSession));
    });

    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active || authVersionRef.current !== initialAuthVersion) return;
        if (error) {
          setProfileError(error.message);
          setProfile(null);
          setLoading(false);
          return;
        }
        return applySession(data.session);
      })
      .catch((error: unknown) => {
        if (!active || authVersionRef.current !== initialAuthVersion) return;
        setProfileError(
          error instanceof Error
            ? error.message
            : 'Your sign-in session could not be loaded. Please try again.',
        );
        setProfile(null);
        setLoading(false);
      });

    return () => {
      active = false;
      authVersionRef.current += 1;
      profileRequestRef.current += 1;
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) throw new Error('Supabase is not configured for this deployment.');
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) throw error;
  }, []);

  const signUp = useCallback(async (input: SignUpInput) => {
    if (!supabase) throw new Error('Supabase is not configured for this deployment.');
    const { data, error } = await supabase.auth.signUp({
      email: input.email.trim(),
      password: input.password,
      options: {
        data: {
          first_name: input.firstName.trim(),
          last_name: input.lastName.trim(),
          address: input.address.trim(),
          country: input.country.trim(),
          phone: input.phone.trim(),
        },
        emailRedirectTo: appRedirectUrl('/dashboard'),
      },
    });
    if (error) throw error;
    return !data.session;
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (!supabase) throw new Error('Supabase is not configured for this deployment.');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: appRedirectUrl('/dashboard'),
      },
    });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    authVersionRef.current += 1;
    profileRequestRef.current += 1;
    try {
      if (supabase) {
        const { error } = await supabase.auth.signOut({ scope: 'local' });
        if (error) throw error;
      }
    } finally {
      setSession(null);
      setProfile(null);
      setProfileError('');
      setLoading(false);
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!session) return;
    await loadProfile(session.user.id, authVersionRef.current);
  }, [loadProfile, session]);

  const value = useMemo<AuthContextValue>(
    () => ({
      configured: supabaseConfigured,
      loading,
      session,
      user: session?.user ?? null,
      profile,
      profileError,
      signIn,
      signUp,
      signInWithGoogle,
      signOut,
      refreshProfile,
    }),
    [
      loading,
      profile,
      profileError,
      refreshProfile,
      session,
      signIn,
      signInWithGoogle,
      signOut,
      signUp,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider.');
  return context;
}
