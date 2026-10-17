/**
 * Synthetic demo fleet for the Bengaluru – Hosur – Krishnagiri corridor.
 * In live mode the backend sends `truck` events that overwrite these records.
 */
import type { Carrier, Hub, LatLng, Place, TruckState } from './contract';

export const NH48: LatLng[] = [
  { lat: 12.9716, lng: 77.5946 },
  { lat: 12.9177, lng: 77.6238 },
  { lat: 12.8452, lng: 77.6602 },
  { lat: 12.8166, lng: 77.6945 },
  { lat: 12.7999, lng: 77.7046 },
  { lat: 12.7786, lng: 77.7713 },
  { lat: 12.7409, lng: 77.8253 },
  { lat: 12.716, lng: 77.87 },
  { lat: 12.6676, lng: 78.0131 },
  { lat: 12.5266, lng: 78.215 },
];

/** Decorative roads so the map reads as a map. */
export const ROADS: { id: string; name: string; path: LatLng[]; major?: boolean }[] = [
  { id: 'nh48', name: 'NH 48', path: NH48, major: true },
  {
    id: 'orr',
    name: 'Outer Ring Rd',
    path: [
      { lat: 12.9177, lng: 77.6238 },
      { lat: 12.9569, lng: 77.7011 },
      { lat: 13.0012, lng: 77.696 },
      { lat: 13.0358, lng: 77.597 },
      { lat: 13.02, lng: 77.52 },
      { lat: 12.95, lng: 77.5 },
      { lat: 12.9177, lng: 77.6238 },
    ],
  },
  {
    id: 'wfd',
    name: 'Whitefield Rd',
    path: [
      { lat: 12.9569, lng: 77.7011 },
      { lat: 12.9698, lng: 77.75 },
      { lat: 12.99, lng: 77.79 },
    ],
  },
  {
    id: 'sarjapur',
    name: 'Sarjapur Rd',
    path: [
      { lat: 12.9177, lng: 77.6238 },
      { lat: 12.9, lng: 77.69 },
      { lat: 12.86, lng: 77.786 },
      { lat: 12.83, lng: 77.86 },
      { lat: 12.7409, lng: 77.8253 },
    ],
  },
  {
    id: 'anekal',
    name: 'Anekal Rd',
    path: [
      { lat: 12.7999, lng: 77.7046 },
      { lat: 12.7105, lng: 77.697 },
      { lat: 12.62, lng: 77.73 },
    ],
  },
  {
    id: 'nh44',
    name: 'NH 44',
    path: [
      { lat: 12.5266, lng: 78.215 },
      { lat: 12.7, lng: 78.24 },
      { lat: 12.95, lng: 78.26 },
      { lat: 13.08, lng: 78.27 },
    ],
  },
  {
    id: 'denkanikottai',
    name: 'Denkanikottai Rd',
    path: [
      { lat: 12.7409, lng: 77.8253 },
      { lat: 12.6, lng: 77.83 },
      { lat: 12.5266, lng: 77.79 },
    ],
  },
];

export const STATE_BORDER: LatLng[] = [
  { lat: 13.08, lng: 77.98 },
  { lat: 12.92, lng: 77.88 },
  { lat: 12.78, lng: 77.79 },
  { lat: 12.66, lng: 77.72 },
  { lat: 12.45, lng: 77.64 },
];

export const PLACES: Place[] = [
  { id: 'blr', name: 'Bengaluru', lat: 12.9716, lng: 77.5946 },
  { id: 'ecity', name: 'Electronic City', lat: 12.8452, lng: 77.6602 },
  { id: 'attibele', name: 'Attibele', lat: 12.7786, lng: 77.7713 },
  { id: 'hosur', name: 'Hosur', lat: 12.7409, lng: 77.8253 },
  { id: 'shoolagiri', name: 'Shoolagiri', lat: 12.6676, lng: 78.0131 },
  { id: 'krishnagiri', name: 'Krishnagiri', lat: 12.5266, lng: 78.215 },
  { id: 'whitefield', name: 'Whitefield', lat: 12.9698, lng: 77.75 },
];

export const DESTINATIONS: Record<string, Place> = {
  hospital: { id: 'DST-BCH', name: 'Bengaluru Central Hospital', lat: 12.9352, lng: 77.6245 },
  pharmacy: { id: 'DST-WCP', name: 'Whitefield Care Pharmacy', lat: 12.9698, lng: 77.75 },
  lab: { id: 'DST-MDL', name: 'Marathahalli Diagnostics Lab', lat: 12.9569, lng: 77.7011 },
  depot: { id: 'DST-FMD', name: 'FreshMart DC, Electronic City', lat: 12.838, lng: 77.676 },
};

export const HUBS: Hub[] = [
  { id: 'HUB-EC', name: 'Electronic City Cold Hub', lat: 12.856, lng: 77.645, free_capacity_kg: 3200, next_dock: '03:35' },
  { id: 'HUB-HSR', name: 'Hosur SIPCOT Cold Store', lat: 12.726, lng: 77.842, free_capacity_kg: 1800, next_dock: '02:40' },
  { id: 'HUB-KGI', name: 'Krishnagiri Reefer Yard', lat: 12.54, lng: 78.19, free_capacity_kg: 5000, next_dock: '02:30' },
];

export const CARRIERS: Carrier[] = [
  { id: 'coldline', name: 'ColdLine Express', system: 'carrier_coldline', cost_per_km: 42, reliability: 0.97, role: 'primary' },
  { id: 'frostfleet', name: 'FrostFleet', system: 'carrier_frostfleet', cost_per_km: 26, reliability: 0.92, role: 'backup' },
  { id: 'polar', name: 'PolarRoute', system: 'carrier_polar', cost_per_km: 55, reliability: 0.99, role: 'premium' },
];

export const CARRIER_NAME: Record<string, string> = {
  own: 'Own fleet',
  coldline: 'ColdLine Express',
  frostfleet: 'FrostFleet',
  polar: 'PolarRoute',
};

export const TRUCKS: TruckState[] = [
  { id: 'TN-07', carrier_id: 'own', reefer: true, capacity_kg: 1200, free_kg: 780, driver: 'Ravi K.', driver_hours_left: 4.5, status: 'moving', lat: 12.716, lng: 77.87, cargo: 'Vaccines · SH-1042', temp_c: 5.1 },
  { id: 'KA-11', carrier_id: 'coldline', reefer: true, capacity_kg: 1500, free_kg: 1500, driver: 'Suresh M.', driver_hours_left: 6.5, status: 'idle', lat: 12.7786, lng: 77.7713 },
  { id: 'KA-04', carrier_id: 'frostfleet', reefer: true, capacity_kg: 1000, free_kg: 900, driver: 'Manjunath R.', driver_hours_left: 7, status: 'idle', lat: 12.84, lng: 77.668 },
  { id: 'KA-08', carrier_id: 'polar', reefer: true, capacity_kg: 1200, free_kg: 1200, driver: 'Imran S.', driver_hours_left: 5, status: 'idle', lat: 12.7999, lng: 77.7046 },
  { id: 'TN-22', carrier_id: 'own', reefer: false, capacity_kg: 2000, free_kg: 1600, driver: 'Karthik P.', driver_hours_left: 3, status: 'moving', lat: 12.735, lng: 77.835, cargo: 'Dry goods · SH-1077' },
  { id: 'KA-19', carrier_id: 'coldline', reefer: true, capacity_kg: 1200, free_kg: 150, driver: 'Naveen G.', driver_hours_left: 5.5, status: 'moving', lat: 12.748, lng: 77.812, cargo: 'Dairy · SH-1066', temp_c: 3.4 },
  { id: 'KA-27', carrier_id: 'frostfleet', reefer: true, capacity_kg: 1000, free_kg: 1000, driver: 'Prakash V.', driver_hours_left: 0.4, status: 'parked', lat: 12.729, lng: 77.85 },
  { id: 'KA-21', carrier_id: 'own', reefer: true, capacity_kg: 1000, free_kg: 740, driver: 'Deepa N.', driver_hours_left: 5, status: 'moving', lat: 12.79, lng: 77.735, cargo: 'Insulin · SH-1051', temp_c: 4.2 },
  { id: 'KA-02', carrier_id: 'own', reefer: true, capacity_kg: 800, free_kg: 620, driver: 'Arjun T.', driver_hours_left: 6, status: 'moving', lat: 12.93, lng: 77.66, cargo: 'Plasma kits · SH-1088', temp_c: 3.9 },
  { id: 'KA-15', carrier_id: 'own', reefer: true, capacity_kg: 1500, free_kg: 900, driver: 'Farhan A.', driver_hours_left: 4, status: 'moving', lat: 12.83, lng: 77.69, cargo: 'Frozen food · SH-1093', temp_c: -17.5 },
];
