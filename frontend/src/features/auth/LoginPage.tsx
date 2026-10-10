import { useState, type FormEvent } from 'react';
import {
  ArrowRight,
  ShieldCheck,
  Layers,
  Factory,
  Check,
  Eye,
  EyeOff,
  UserCheck,
} from 'lucide-react';
import { api, setCsrf } from '../../services/api';
import { Button } from '../../components/ui/button';
import { Spinner } from '../../components/shared/common';

interface LoginPageProps {
  onSuccess: () => void;
}

export function LoginPage({ onSuccess }: LoginPageProps) {
  const [email, setEmail] = useState('owner@loomos.demo');
  const [password, setPassword] = useState('LoomDemo2026!');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const demoAccounts = [
    { label: 'Super Admin', email: 'owner@loomos.demo' },
    { label: 'Production Mgr', email: 'production@loomos.demo' },
    { label: 'Spinning Operator', email: 'spinning@loomos.demo' },
    { label: 'Weaving Operator', email: 'weaving@loomos.demo' },
    { label: 'Dyeing Operator', email: 'dyeing@loomos.demo' },
    { label: 'Buyer Portal', email: 'buyer@loomos.demo' },
  ];

  const handleSelectDemo = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword('LoomDemo2026!');
    setError('');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');

    try {
      const result = await api<{ csrf: string }>('/auth/login', { email, password });
      setCsrf(result.csrf);
      onSuccess();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-story">
        <div className="brand">
          <div className="brand-mark">
            <Layers size={26} />
          </div>
          Loom<span>OS</span>
        </div>

        <div className="login-story-main">
          <span className="eyebrow">THE FABRIC OF A BETTER FACTORY</span>
          <h1>
            Every thread.
            <br />
            One connected
            <br />
            <em>workspace.</em>
          </h1>
          <p>
            From the first yarn receipt to the final roll.
            <br />
            Bring your entire mill into focus.
          </p>

          <div className="woven-art" aria-hidden="true">
            {Array.from({ length: 12 }, (_, i) => (
              <span key={i} />
            ))}
          </div>

          <div className="login-trust">
            <ShieldCheck size={19} />
            <span>Built for the people who keep production moving.</span>
          </div>
        </div>

        <small>LOOMOS / FACTORY OPERATING SYSTEM</small>
      </div>

      <div className="login-form-side">
        <span className="login-top-note">
          <Factory size={16} /> Everest Textile Mills
        </span>

        <div className="login-form">
          <div className="eyebrow">WELCOME TO YOUR WORKSPACE</div>
          <h2>A good day starts here.</h2>
          <p>Sign in to see what’s happening on your factory floor.</p>

          <form onSubmit={handleSubmit}>
            <label className="field">
              <span>Email address</span>
              <input
                id="email"
                name="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="username"
                placeholder="e.g. owner@loomos.demo"
              />
            </label>

            <label className="field">
              <span>Password</span>
              <div className="password-input">
                <input
                  id="password"
                  name="password"
                  type={show ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="Enter your password"
                />
                <button
                  type="button"
                  onClick={() => setShow(!show)}
                  aria-label={show ? 'Hide password' : 'Show password'}
                >
                  {show ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>

            {/* Quick-fill Demo accounts pills */}
            <div style={{ margin: '0.25rem 0 0.75rem' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.375rem',
                  fontSize: '0.75rem',
                  color: 'var(--muted)',
                  marginBottom: '0.375rem',
                }}
              >
                <UserCheck size={13} />
                <span>Quick Fill Demo Roles:</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
                {demoAccounts.map((acc) => (
                  <button
                    key={acc.email}
                    type="button"
                    onClick={() => handleSelectDemo(acc.email)}
                    style={{
                      padding: '3px 8px',
                      fontSize: '0.75rem',
                      borderRadius: '5px',
                      border: '1px solid var(--border)',
                      background: email === acc.email ? 'var(--accent)' : 'var(--panel)',
                      color: email === acc.email ? '#fff' : 'var(--text-secondary)',
                      cursor: 'pointer',
                      fontWeight: email === acc.email ? 600 : 400,
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {acc.label}
                  </button>
                ))}
              </div>
            </div>

            {error && <div className="error-banner">{error}</div>}

            <Button className="login-submit" disabled={busy}>
              {busy ? (
                <Spinner />
              ) : (
                <>
                  Sign in to workspace
                  <ArrowRight size={17} />
                </>
              )}
            </Button>
          </form>

          <div className="login-demo">
            <span className="demo-dot" />
            <div>
              <strong>Demonstration workspace</strong>
              <p>Demo accounts use password: <code style={{ fontWeight: 600, color: 'var(--accent)' }}>LoomDemo2026!</code></p>
            </div>
          </div>

          <div className="login-points">
            <span>
              <Check size={13} /> Role-based access
            </span>
            <span>
              <Check size={13} /> Secure sessions
            </span>
          </div>
        </div>

        <small className="login-foot">Thoughtfully made for textile manufacturing.</small>
      </div>
    </div>
  );
}

// Backwards compatibility alias
export const Login = LoginPage;
