import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import {
  LayoutDashboard,
  ShoppingBag,
  Package,
  Truck,
  Factory,
  Workflow,
  ShieldCheck,
  Layers,
  Users,
  Wallet,
  ChartNoAxesCombined,
  Settings,
  Search,
  Bell,
  ChevronsUpDown,
  ArrowUpRight,
  LogOut,
  Menu,
  Command,
  CircleHelp,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react';
import { can, type Area, type Notice, type PageResponse, type OrderSummary } from '@loomos/shared';
import { useAuth } from '../../features/auth/Auth';
import { useData } from '../../hooks/useFactory';
import { label } from '../../lib/utils';
import { GlobalSearchModal } from './GlobalSearchModal';
import { NotificationsModal } from './NotificationsModal';
import { HelpModal } from './HelpModal';

interface NavSection {
  name: string;
  items: [string, string, LucideIcon, Area][];
}

const sections: NavSection[] = [
  {
    name: 'WORKSPACE',
    items: [
      ['Overview', '/', LayoutDashboard, 'dashboard'],
      ['Orders', '/orders', ShoppingBag, 'orders'],
      ['Inventory', '/inventory', Package, 'inventory'],
      ['Procurement', '/procurement', Truck, 'procurement'],
    ],
  },
  {
    name: 'FACTORY OPERATIONS',
    items: [
      ['Production', '/production', Workflow, 'production'],
      ['Machine floor', '/machines', Factory, 'machines'],
      ['Quality control', '/quality', ShieldCheck, 'quality'],
      ['Finished rolls', '/rolls', Layers, 'rolls'],
      ['Dispatch', '/dispatch', Truck, 'dispatch'],
    ],
  },
  {
    name: 'BUSINESS',
    items: [
      ['Workers & shifts', '/workforce', Users, 'workforce'],
      ['Finance', '/finance', Wallet, 'finance'],
      ['Reports', '/reports', ChartNoAxesCombined, 'reports'],
    ],
  },
];

export function Workspace() {
  const { user, logout, demo } = useAuth();
  const location = useLocation();
  const client = useQueryClient();

  const [mobile, setMobile] = useState(false);
  const [search, setSearch] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [help, setHelp] = useState(false);
  const [live, setLive] = useState(false);

  const notices = useData<Notice[]>('/notifications', user.role !== 'BUYER');
  const orders = useData<PageResponse<OrderSummary>>('/orders?pageSize=100', can(user.role, 'orders'));

  useEffect(() => {
    const socket = io({ withCredentials: true });
    socket.on('connect', () => {
      setLive(true);
      void client.invalidateQueries();
    });
    socket.on('disconnect', () => setLive(false));
    socket.on('factory.changed', () => void client.invalidateQueries());
    socket.on('orders.changed', () => void client.invalidateQueries());

    return () => {
      socket.disconnect();
    };
  }, [client]);

  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setSearch((v) => !v);
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  useEffect(() => setMobile(false), [location.pathname]);

  const all = sections.flatMap((s) => s.items);
  const title =
    user.role === 'BUYER'
      ? 'Buyer workspace'
      : all.find((i) => i[1] === location.pathname)?.[0] ??
        (location.pathname.startsWith('/orders/')
          ? 'Order details'
          : location.pathname.startsWith('/rolls/')
            ? 'Roll passport'
            : 'Settings');

  return (
    <div className="workspace">
      {mobile && (
        <button
          className="sidebar-scrim"
          onClick={() => setMobile(false)}
          aria-label="Close menu"
        />
      )}

      <aside className={`sidebar ${mobile ? 'sidebar-open' : ''}`}>
        <NavLink to="/" className="brand">
          <div className="brand-mark">
            <Layers size={24} />
          </div>
          Loom<span>OS</span>
          <span className="brand-period">.</span>
        </NavLink>

        <button className="mill-switch" onClick={() => setHelp(true)}>
          <span className="mill-avatar">
            <Factory size={19} />
          </span>
          <span>
            <strong>Everest Textile Mills</strong>
            <small>Manufacturing workspace</small>
          </span>
          <ChevronsUpDown size={14} />
        </button>

        <nav>
          {user.role === 'BUYER' ? (
            <div className="nav-section">
              <span>YOUR WORKSPACE</span>
              <NavLink to="/buyer">
                <ShoppingBag size={18} />
                Your orders
              </NavLink>
            </div>
          ) : (
            sections.map((section) => (
              <div className="nav-section" key={section.name}>
                {section.items.some((i) => can(user.role, i[3])) && (
                  <span>{section.name}</span>
                )}
                {section.items
                  .filter((i) => can(user.role, i[3]))
                  .map(([name, path, Icon]) => (
                    <NavLink key={path} to={path} end={path === '/'}>
                      <Icon size={18} />
                      <span>{name}</span>
                      {name === 'Machine floor' && (
                        <span className={`nav-dot ${live ? 'online' : ''}`} />
                      )}
                    </NavLink>
                  ))}
              </div>
            ))
          )}
        </nav>

        <div className="sidebar-bottom">
          <div className="workspace-note">
            <span className="note-symbol">✳</span>
            <strong>A little more connected.</strong>
            <p>
              One workspace. Every thread
              <br />
              of your factory.
            </p>
            <button onClick={() => setHelp(true)}>
              Explore your workspace <ArrowUpRight size={14} />
            </button>
          </div>

          {can(user.role, 'settings') && (
            <NavLink className="bottom-link" to="/settings">
              <Settings size={18} />
              Settings
            </NavLink>
          )}

          <button className="bottom-link" onClick={() => setHelp(true)}>
            <CircleHelp size={18} />
            Help & getting started
          </button>

          <div className="sidebar-user">
            <span className="avatar avatar-user">
              {user.name
                .split(' ')
                .slice(0, 2)
                .map((n) => n[0])
                .join('')}
            </span>
            <div>
              <strong>{user.name}</strong>
              <small>{label(user.role)}</small>
            </div>
            <button className="icon-button" onClick={logout} aria-label="Sign out">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      <div className="workspace-main">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              onClick={() => setMobile(true)}
              aria-label="Open navigation"
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{title}</strong>
          </div>

          <div className="topbar-actions">
            <button className="global-search" onClick={() => setSearch(true)}>
              <Search size={16} />
              <span>Search anything...</span>
              <kbd>
                <Command size={10} /> K
              </kbd>
            </button>
            <span className="topbar-divider" />
            <span className={`live-indicator ${live ? 'is-live' : ''}`}>
              <i />
              {live ? 'Live updates' : 'Connecting'}
            </span>
            {user.role !== 'BUYER' && (
              <button
                className="notification-button"
                onClick={() => setNotifications(true)}
                aria-label="View notifications"
              >
                <Bell size={19} />
                {!!notices.data?.length && <i />}
              </button>
            )}
            <span className="avatar avatar-top">
              {user.name
                .split(' ')
                .slice(0, 2)
                .map((n) => n[0])
                .join('')}
            </span>
          </div>
        </header>

        <main className="page-content">
          <Outlet />
        </main>

        <footer className="workspace-footer">
          <span>
            <span className="footer-mark">✳</span> LoomOS <span>·</span> Thoughtfully connected.
          </span>
          <span>
            {demo ? 'DEMONSTRATION DATA · ' : ''}
            Operator-reported production
          </span>
        </footer>
      </div>

      <GlobalSearchModal
        open={search}
        onClose={() => setSearch(false)}
        userRole={user.role}
        allNavItems={all}
        ordersData={orders.data}
      />

      <NotificationsModal
        open={notifications}
        onClose={() => setNotifications(false)}
        notices={notices.data}
      />

      <HelpModal open={help} onClose={() => setHelp(false)} />
    </div>
  );
}
