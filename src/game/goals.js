// Weekly goals: three targets generated from last week's own data (DESIGN.md section 10).

const STARTER = { practiceDays: 3, breathGroupMeanSec: 1.5, softOnsetShare: 0.5 };

/** Monday of the week containing `day` (YYYY-MM-DD). */
export function weekStart(day) {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

const meanOf = (xs) => {
  const vals = xs.filter((v) => v !== null && v !== undefined);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
};

function measure(records) {
  return {
    practiceDays: new Set(records.map((r) => r.day)).size,
    breathGroupMeanSec: meanOf(records.map((r) => r.metrics.breathGroups.meanSec)),
    softOnsetShare: meanOf(records.map((r) => r.softOnsetShare)),
  };
}

export function generateWeeklyGoals(lastWeekRecords) {
  const last = measure(lastWeekRecords);
  return [
    {
      id: 'practiceDays',
      label: 'Practice days',
      target: lastWeekRecords.length ? Math.min(7, Math.max(STARTER.practiceDays, last.practiceDays + 1)) : STARTER.practiceDays,
    },
    {
      id: 'breathGroupMeanSec',
      label: 'Average breath group',
      target: last.breathGroupMeanSec === null ? STARTER.breathGroupMeanSec : last.breathGroupMeanSec * 1.1,
    },
    {
      id: 'softOnsetShare',
      label: 'Soft starts',
      target: last.softOnsetShare === null ? STARTER.softOnsetShare : Math.min(0.9, last.softOnsetShare + 0.05),
    },
  ];
}

export function goalProgress(goals, thisWeekRecords) {
  const now = measure(thisWeekRecords);
  return goals.map((g) => {
    const value = now[g.id];
    return { ...g, value, met: value !== null && value >= g.target };
  });
}
