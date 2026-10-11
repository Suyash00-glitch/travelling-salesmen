import { useState, type FormEvent } from 'react';
import { ArrowRight, Factory, Layers, ShieldCheck } from 'lucide-react';
import { api } from '../../services/api';
import { Button } from '../../components/ui/button';
import { Spinner } from '../../components/shared/common';

// Self-registration. The account is created as "pending" and an administrator
// must approve it (and choose the final role) before the person can sign in.
export function SignupPage({ onBack, buyerOnly = false }: { onBack: () => void; buyerOnly?: boolean }) {
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    confirm: '',
    requestedRole: buyerOnly ? 'BUYER' : 'STAFF',
    company: '',
    city: '',
    note: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const set = (name: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [name]: e.target.value });
  const isBuyer = form.requestedRole === 'BUYER';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const { confirm: _confirm, ...body } = form;
      await api('/auth/signup', body);
      setDone(true);
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
          <span className="eyebrow">{buyerOnly ? 'BUYER PORTAL' : 'JOIN YOUR FACTORY WORKSPACE'}</span>
          <h1>
            Ask for access.
            <br />
            We’ll set you up
            <br />
            <em>properly.</em>
          </h1>
          <p>
            Your administrator reviews every request and gives you
            <br />
            exactly the access your job needs.
          </p>
          <div className="login-trust">
            <ShieldCheck size={19} />
            <span>No access to production data until you are approved.</span>
          </div>
        </div>
        <small>LOOMOS / FACTORY OPERATING SYSTEM</small>
      </div>

      <div className="login-form-side">
        <span className="login-top-note">
          <Factory size={16} /> New account request
        </span>

        <div className="login-form">
          <div className="eyebrow">{buyerOnly ? 'NEW BUYER ACCOUNT' : 'CREATE ACCOUNT'}</div>
          <h2>{buyerOnly ? 'Create your buyer account' : 'Request access'}</h2>
          {buyerOnly && <p>Order fabric at fixed prices and track every order. The factory approves new accounts.</p>}

          {done ? (
            <>
              <div className="success-banner" role="status">
                <strong>Request sent.</strong> An administrator will review it and choose your role. You can sign in once it is approved.
              </div>
              <Button className="login-submit" style={{ marginTop: 16 }} onClick={onBack}>
                Back to sign in <ArrowRight size={17} />
              </Button>
            </>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="signup-grid">
                <label className="field field-wide">
                  <span>Full name</span>
                  <input value={form.name} onChange={set('name')} required autoComplete="name" />
                </label>
                <label className="field">
                  <span>Email address</span>
                  <input type="email" value={form.email} onChange={set('email')} required autoComplete="email" />
                </label>
                <label className="field">
                  <span>Phone (optional)</span>
                  <input value={form.phone} onChange={set('phone')} autoComplete="tel" />
                </label>
                <label className="field">
                  <span>Password</span>
                  <input type="password" value={form.password} onChange={set('password')} required minLength={10} autoComplete="new-password" />
                </label>
                <label className="field">
                  <span>Confirm password</span>
                  <input type="password" value={form.confirm} onChange={set('confirm')} required minLength={10} autoComplete="new-password" />
                </label>
                {isBuyer && (
                  <>
                    <label className="field">
                      <span>Company name</span>
                      <input value={form.company} onChange={set('company')} required />
                    </label>
                    <label className="field">
                      <span>City</span>
                      <input value={form.city} onChange={set('city')} required />
                    </label>
                  </>
                )}
                <label className="field field-wide">
                  <span>Note for the administrator (optional)</span>
                  <textarea rows={2} value={form.note} onChange={set('note')} placeholder="e.g. I joined the weaving shed, night shift" />
                </label>
              </div>
              <p className="muted" style={{ fontSize: 12 }}>Passwords need at least 10 characters.</p>

              {error && <div className="error-banner">{error}</div>}

              <Button className="login-submit" disabled={busy}>
                {busy ? <Spinner /> : <>Send request <ArrowRight size={17} /></>}
              </Button>
            </form>
          )}

          <div className="auth-switch">
            Already have an account?
            <button type="button" onClick={onBack}>Sign in</button>
          </div>
        </div>
      </div>
    </div>
  );
}
