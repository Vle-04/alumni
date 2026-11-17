# Metric definitions

Every figure in the outcomes report is computed by pure, unit-tested functions in [`src/domain/metrics/`](../src/domain/metrics). The UI tooltips use the short versions in [`definitions.ts`](../src/domain/metrics/definitions.ts). This document is the long form. If the two ever disagree, the code is right and this file has a bug.

Defaults are listed in the [Settings defaults](#settings-defaults) table. Admins can change them under the `reporting` setting.

---

## Who is counted

| Rule | Detail |
|---|---|
| **Consent** | Only graduates with active `outcomes_reporting` consent are counted. The number left out for this reason is always shown. If a graduate revokes consent, they drop out of every figure immediately. |
| **Deleted graduates** | Deletion anonymises personal data but keeps the graduate's cohort, employment history and consent state, so aggregates don't change when someone is deleted. |
| **Small cohorts** | A cohort with fewer than *k* = 5 reportable graduates is left out of **every** figure, totals included. Only the number of graduates excluded this way is shown (itself suppressed if small). See [Filters](#filters) for why. |
| **Graduation date** | Taken from the cohort, or from the graduate's own override date if staff set one. |

## Presumed status at graduation

New graduates who haven't told us anything (and haven't said they're "not looking") are presumed to be **searching** from their graduation date. That makes them visible to matching and to the "searching for a long time" queue.

The presumption is stored as a record with source `graduation_default` and is **excluded from every outcome metric**:
- such a graduate still counts as **unknown**
- they never raise the response rate
- they never count as "not employed"

Their first real answer replaces it.

## Survey response rate

This is the response rate shown on the Surveys page, per milestone and per cohort. It is separate from the "response rate" next to the employment rate, which is defined under [Employment rate](#employment-rate).

```
survey response rate = (completed + skipped_recent_update)
                       ÷ (sent + completed + bounced + skipped_recent_update)
```

- **Surveys skipped after a recent self-update count as responses.** If a graduate updated their status themselves within the skip window (default 14 days) before a milestone survey was due, that survey is not sent and is recorded as `skipped_recent_update`. It counts as answered, in both the numerator and the denominator, because the graduate did give us a current status.
- **Not counted at all:** surveys still scheduled or queued, milestones `missed` because they had passed before scheduling, and `cancelled` surveys (unsubscribed or deleted graduates).
- **Bounced** surveys count in the denominator, as surveys that went out but couldn't be answered.
- **Catch-up surveys** count under the milestone they replaced. A graduate whose milestones had all passed before scheduling (for example, an imported historical cohort) gets one "where are you now?" catch-up survey.
- **Catch-up answers and milestone figures:** the answer is dated when it was given, so it only counts towards a 6- or 12-month figure if it falls inside that milestone's window.

## Status at a milestone (6 and 12 months)

The milestone date is the graduation date plus N calendar months. A graduate's **status at the milestone** is found like this:

1. Take their employment records reported between **90 days before** and **45 days after** the milestone date.
2. Use the most recent one, skipping any job record whose start date is *after* the milestone (that job didn't exist yet at the milestone).
3. If no record qualifies, the status is **unknown**.

A graduate is included at a milestone only once the milestone date **plus 45 days** has passed. Recent graduates are therefore "not yet measurable" rather than counted as unknown.

## Employment rate

```
employment rate = graduates employed at the milestone
                  ÷ graduates whose status at the milestone is known
```

- **Employed** means full-time, part-time, freelance/contract or internship by default. Each is shown separately in the status breakdown, and the report has "Count as employed" checkboxes to change the set.
- **Response rate** = graduates with a known status ÷ all graduates at the milestone. The response rate and the **unknown count** are always shown next to the employment rate.
- **Lower bound** = employed ÷ **all** graduates at the milestone, as if every unknown were not employed. It's shown alongside, so the real rate is visibly somewhere between the two. Non-responders are never quietly dropped.
- **In-field only:** the numerator counts only jobs marked as in the graduate's field of study. Employed graduates who didn't answer the in-field question are shown separately; they are not counted as in-field.

## Time to first job

- **First job:** the earliest record with a qualifying status. Qualifying means full-time, part-time or freelance; internships are excluded by default (configurable).
- **Time:** days from graduation to that job's **start date**. If no start date was given, the date it was reported is used instead (a conservative, later date).
- **Jobs that started before graduation** count as day 0 and are shown as a separate count.
- **Graduates who haven't found a qualifying job** are not dropped. Each one counts up to their last known update and is then marked as "censored" (still unknown after that). This is the **Kaplan–Meier** estimator:

```
at each day t on which d graduates started their first job, with n graduates still followed at t:
    S(t) = S(t−) × (1 − d / n)          share still without a job
    F(t) = 1 − S(t)                    share employed by day t
```

- **Median, 25th and 75th percentiles:** the first day on which F(t) reaches 50%, 25% and 75%. If that never happens within the data, the value is shown as **"not reached"**. A median isn't invented from the people who succeeded.
- **% employed by month N** = F(N × 30.44 days), for months 0–12. It's shown overall and per cohort.
- **Graduates with no records at all** contribute no information and are left out of this metric. Their count is shown as "no information".
- **Privacy:**
  - Medians and percentiles are hidden unless at least 5 graduates have information and at least 5 found work.
  - A point on a cohort's curve is hidden once fewer than 5 graduates of that cohort are still being followed.

## Top employers

- **Count:** each company is credited with every graduate who ever had an employed status there, counting each graduate once per company.
- **Companies:** names are normalised, so "Google" and "Google LLC" count as one company.
- **Which names appear:** only companies with **at least 5** such graduates, top 10. Every other company is grouped as "Other employers", with its graduate total suppressed if small. That way a company name can never point to one person.
- **Partner vs non-partner:** totals are shown as a pair, with secondary suppression.

## Roles and salary bands

- **Who's counted:** graduates whose **latest** record is an employed status.
- **What's shown:** distributions only; small groups are suppressed and missing answers appear as "Not stated".
- **Salary:** only ever collected as monthly **bands**. Exact salaries are never asked for or stored.

## Cohort comparison and trend

For each cohort, in order of graduation date:
- number of graduates
- response rate at 6 months
- employment rate at 6 and 12 months
- median days to first job (hidden below 5 job starts)

The grouped bar chart shows the trend across cohorts.

## Data freshness

Graduates whose latest record is less than 90 days old ÷ all reportable graduates.

---

## Privacy rules applied to every figure

1. **Small cells.** Any count from 1 to 4 is shown as **"<5"**. Zero is shown as 0.
2. **Secondary suppression.** If a group of counts has a published total and exactly one cell is hidden, the smallest other non-zero cell is hidden too. Otherwise the hidden value could be recovered by subtraction.
3. **Rates.**
   - A rate is shown exactly only when its denominator is at least 5 and **neither** the numerator **nor** its complement is 1–4.
   - Otherwise a bound is shown, such as "<10%" or ">76%". A bound reveals no more than the matching "<5" cell would.
   - If the denominator itself is below 5, the rate shows "Group too small".
4. **Filters.** Filters are program, cohort and graduation-date range, and they always select **whole cohorts**, never individuals.
   - Cohorts below 5 reportable graduates are left out of every result, so comparing two date ranges can't isolate them.
   - If a filter leaves fewer than 5 graduates, nothing is shown.
5. **Names.** Leadership/Marketing get no individual names, emails or salaries anywhere. The report service returns aggregates only; this is covered by integration and e2e tests.
6. **Audit.** Every export (PDF, CSV, PNG) is written to the audit log with the filters used.

## Settings defaults

| Setting | Default |
|---|---|
| `employedStatuses` | full-time, part-time, freelance/contract, internship |
| `qualifyingJobStatuses` (time to first job) | full-time, part-time, freelance/contract |
| `windowBeforeDays` / `graceDays` | 90 / 45 |
| `minCell` (k) | 5 (cannot be set lower) |
| `freshnessDays` | 90 |
