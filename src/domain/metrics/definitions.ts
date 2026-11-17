/**
 * Plain-language metric definitions shown as tooltips in the UI.
 * Keep in sync with docs/METRICS.md (the long-form version).
 */
export const METRIC_DEFINITIONS = {
  employmentRate:
    "Graduates employed at the milestone ÷ graduates whose status we know at the milestone. Employed = full-time, part-time, freelance/contract and internship (each shown separately; configurable). Unknowns are NOT counted as employed or unemployed — they're shown next to the rate, together with the response rate.",
  employmentRateLowerBound:
    "The same employed count ÷ ALL graduates at the milestone, as if every unknown were not employed. The true rate lies between this and the employment rate.",
  responseRate: "Share of graduates at the milestone whose status we know (from a survey, self-update, staff entry or referral hire).",
  statusAtMilestone:
    "A graduate's status at N months is their latest update reported between 90 days before and 45 days after graduation + N months. Jobs that started after the milestone don't count. No update in that window = unknown. Graduates whose milestone hasn't passed (plus 45 days) are not included yet.",
  inField: "Only jobs the graduate (or staff) marked as related to what they studied. Jobs with no answer are counted separately.",
  timeToFirstJob:
    "Days from graduation to the start of the first full-time, part-time or freelance job (internships excluded by default). Graduates who haven't found work are counted until their last update (Kaplan–Meier), so the median isn't inflated by only counting people who succeeded. A job that started before graduation counts as day 0.",
  employedByMonth:
    "Estimated share of graduates who had started a qualifying job by month N after graduation, including those still searching. Points are hidden once fewer than 5 graduates are still being followed.",
  topEmployers: "Graduates who worked at each company (each person counted once per company). Companies with fewer than 5 graduates are grouped as “Other employers”.",
  roles: "Role categories of graduates who are currently employed.",
  salaryBands: "Monthly salary bands reported by currently employed graduates. Exact salaries are never collected.",
  freshness: "Share of graduates whose record was updated in the last 90 days.",
  surveyResponseRate:
    "(Completed + skipped because the graduate self-updated in the last 14 days) ÷ surveys that went out (sent, completed, bounced or skipped). A skipped survey counts as a response because the graduate gave us a current status. Scheduled, missed and cancelled surveys are not counted.",
  suppression:
    "To protect privacy, any group of fewer than 5 people is shown as “<5”, a second number is hidden where needed so the first can't be worked out by subtraction, and cohorts with fewer than 5 reportable graduates are left out of every figure.",
} as const;
export type MetricKey = keyof typeof METRIC_DEFINITIONS;
