export function getCurrentPlan() {
  return localStorage.getItem('lovea_plan') || 'free';
}

export const PLAN_LIMITS = {
  free:    { maxProfiles: 1, maxMessagesPerDay: 20, history: false, allergies: false },
  famille: { maxProfiles: 3, maxMessagesPerDay: Infinity, history: true, allergies: true },
  pro:     { maxProfiles: Infinity, maxMessagesPerDay: Infinity, history: true, allergies: true },
};

export function canUse(feature) {
  return PLAN_LIMITS[getCurrentPlan()][feature] !== false;
}

export function getDailyMessageCount() {
  const today = new Date().toDateString();
  const stored = JSON.parse(localStorage.getItem('lovea_daily_messages') || '{}');
  if (stored.date !== today) return 0;
  return stored.count || 0;
}

export function incrementDailyMessageCount() {
  const today = new Date().toDateString();
  const count = getDailyMessageCount() + 1;
  localStorage.setItem('lovea_daily_messages', JSON.stringify({ date: today, count }));
  return count;
}

export function hasReachedDailyLimit() {
  const limit = PLAN_LIMITS[getCurrentPlan()].maxMessagesPerDay;
  if (limit === Infinity) return false;
  return getDailyMessageCount() >= limit;
}
