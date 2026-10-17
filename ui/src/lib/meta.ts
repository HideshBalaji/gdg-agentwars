import {
  Brain,
  Cable,
  CalendarClock,
  CloudSun,
  Eye,
  FileSpreadsheet,
  Handshake,
  Mail,
  Map,
  MessageSquareShare,
  RadioTower,
  Route,
  ShieldCheck,
  Snowflake,
  Sparkles,
  Stethoscope,
  Truck,
  Database,
  type LucideIcon,
} from 'lucide-react';
import type { AgentId, SystemId } from './contract';

export interface AgentMeta {
  id: AgentId;
  name: string;
  role: string;
  model: string;
  color: string;
  icon: LucideIcon;
}

export const AGENTS: Record<AgentId, AgentMeta> = {
  dispatcher: {
    id: 'dispatcher',
    name: 'Dispatcher',
    role: 'Coordinates specialists, picks the plan',
    model: 'Gemini Pro',
    color: '#7883eb',
    icon: RadioTower,
  },
  intake: {
    id: 'intake',
    name: 'Intake',
    role: 'Photos, voice, PDFs, sensors → incident',
    model: 'Gemini Flash',
    color: '#a78bfa',
    icon: Eye,
  },
  route_risk: {
    id: 'route_risk',
    name: 'Route & Risk',
    role: 'Maps, weather, rescue-window math',
    model: 'Gemini Flash',
    color: '#5296ff',
    icon: Route,
  },
  negotiator: {
    id: 'negotiator',
    name: 'Negotiator',
    role: 'Carriers and customers',
    model: 'Gemini Flash · Live',
    color: '#d99a2b',
    icon: Handshake,
  },
  comms: {
    id: 'comms',
    name: 'Comms',
    role: 'Gmail, Calendar, Sheets',
    model: 'Gemini Flash',
    color: '#45ad7a',
    icon: MessageSquareShare,
  },
  validator: {
    id: 'validator',
    name: 'Validator',
    role: 'Reefer, capacity, deadline, hours',
    model: 'Code + Flash',
    color: '#26a69a',
    icon: ShieldCheck,
  },
  watchdog: {
    id: 'watchdog',
    name: 'Watchdog',
    role: 'Retry, fallback, repair',
    model: 'Code + Flash',
    color: '#e5534b',
    icon: Stethoscope,
  },
  critic: {
    id: 'critic',
    name: 'Critic',
    role: 'Ratings → learned preferences',
    model: 'Gemini Flash',
    color: '#c678d0',
    icon: Brain,
  },
};

export const AGENT_ORDER: AgentId[] = [
  'intake',
  'route_risk',
  'validator',
  'negotiator',
  'watchdog',
  'comms',
  'critic',
];

export interface SystemMeta {
  id: SystemId;
  name: string;
  kind: 'model' | 'mcp' | 'google' | 'carrier' | 'store';
  icon: LucideIcon;
}

export const SYSTEMS: Record<SystemId, SystemMeta> = {
  gemini: { id: 'gemini', name: 'Gemini', kind: 'model', icon: Sparkles },
  logistics_mcp: { id: 'logistics_mcp', name: 'logistics-mcp', kind: 'mcp', icon: Cable },
  maps: { id: 'maps', name: 'Maps Routes', kind: 'google', icon: Map },
  weather: { id: 'weather', name: 'Weather', kind: 'google', icon: CloudSun },
  carrier_coldline: { id: 'carrier_coldline', name: 'ColdLine', kind: 'carrier', icon: Snowflake },
  carrier_frostfleet: { id: 'carrier_frostfleet', name: 'FrostFleet', kind: 'carrier', icon: Truck },
  carrier_polar: { id: 'carrier_polar', name: 'PolarRoute', kind: 'carrier', icon: Snowflake },
  gmail: { id: 'gmail', name: 'Gmail', kind: 'google', icon: Mail },
  calendar: { id: 'calendar', name: 'Calendar', kind: 'google', icon: CalendarClock },
  sheets: { id: 'sheets', name: 'Sheets', kind: 'google', icon: FileSpreadsheet },
  memory: { id: 'memory', name: 'Memory', kind: 'store', icon: Database },
};

export const SYSTEM_ORDER: SystemId[] = [
  'gemini',
  'logistics_mcp',
  'maps',
  'weather',
  'carrier_coldline',
  'carrier_frostfleet',
  'carrier_polar',
  'gmail',
  'calendar',
  'sheets',
  'memory',
];

export const CARRIER_SYSTEMS: SystemId[] = ['carrier_coldline', 'carrier_frostfleet', 'carrier_polar'];
