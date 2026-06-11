# KUP Compliance Reporter — User Guide

This guide explains how to use the KUP Compliance Reporter app in Jira Cloud. It is organised by role:

- **[Administrators](#administrator-guide)** — configure the app for your organisation.
- **[Managers](#manager-guide)** — review, approve, and export employees' hours.
- **[Employees](#employee-guide)** — log your KUP hours and check your compliance.

If you are new to the concept, start with [Key concepts](#key-concepts).

---

## Contents

- [Key concepts](#key-concepts)
- [Administrator guide](#administrator-guide)
  - [Opening the configuration page](#opening-the-configuration-page)
  - [Eligible projects & issue types](#1-eligible-projects--issue-types)
  - [Available months](#2-available-months)
  - [Working hours per month](#3-working-hours-per-month)
  - [Managers](#4-managers)
  - [KUP percentage limit](#5-kup-percentage-limit)
  - [Payroll export field mappings](#6-payroll-export-field-mappings)
- [Manager guide](#manager-guide)
  - [Manager Approval tab](#manager-approval-tab)
  - [Approving and un-approving](#approving-and-un-approving)
  - [My Team](#my-team)
  - [Payroll export](#payroll-export)
  - [Audit Log tab](#audit-log-tab)
- [Employee guide](#employee-guide)
  - [Logging KUP hours on an issue](#logging-kup-hours-on-an-issue)
  - [My Report](#my-report)
  - [Hours adjustment](#hours-adjustment-absence--overtime)
- [Frequently asked questions](#frequently-asked-questions)

---

## Key concepts

| Term | Meaning |
|------|---------|
| **KUP** | *Koszty Uzyskania Przychodu* — creative-work hours eligible for the 50% tax-deductible cost (*honorarium autorskie*). |
| **KUP month** | A reporting period, shown as e.g. *"May 2026"*. Hours are logged and approved per month. |
| **Working hours base** | The maximum working hours for a month (set by your admin per month). Your KUP % is measured against this. |
| **Adjustment** | Personal **absence** hours (which *reduce* your base) or **overtime** hours (which *raise* it), giving an **effective base**. |
| **KUP %** | `total KUP hours ÷ effective base × 100`. The headline compliance number. |
| **Limit** | An optional company-wide cap on KUP % set by your admin (e.g. 20%). It can *warn* or *block* approval when exceeded. |
| **Approval** | A manager signs off an employee's hours for a month. Once approved, the employee can no longer edit those hours or adjustments until a manager un-approves. |

**Lifecycle of a month's hours:** employee logs hours on issues → optionally sets absence/overtime → manager reviews on the global page → manager approves (locking edits) → accounting receives the payroll export. A manager can un-approve to re-open edits.

---

## Administrator guide

Administrators set up which work counts as KUP, the working-hour baselines, who the managers are, the optional compliance limit, and the payroll-export column mappings.

### Opening the configuration page

1. Go to the Jira **Settings** (⚙ gear icon, top-right) → **Apps**.
2. In the left sidebar, select **KUP 50% Configuration**.

> You need Jira administrator rights to see this page. The page is admin-only by virtue of being a Jira admin page — that is also what keeps configuration secure from regular users.

Make your changes and click **Save** at the bottom. The page tracks unsaved changes and confirms on a successful save; if a value is rejected it shows an error instead.

### 1. Eligible projects & issue types

Controls **where the KUP panel appears** and which issues can carry KUP hours.

- **Enable for all projects & issue types** — the simplest setup. When on, the KUP panel appears on every issue.
- To scope it down, turn that off and pick specific **projects**. Optionally, per project, restrict to specific **issue types** (leave issue types empty to allow all types in that project).

### 2. Available months

The list of KUP months that appear in every month dropdown across the app.

- Toggle individual months on/off in the table.
- If you never configure this, the app defaults to all twelve months of the **current calendar year**.

### 3. Working hours per month

The **maximum working hours** baseline for each month — the denominator for everyone's KUP %.

- The app ships with a sensible Polish working-calendar default for each month (2025–2030).
- Override any month with your organisation's own figure. Employees' absence/overtime adjust *their own* effective base on top of this.

### 4. Managers

Defines who can see the **Manager Approval** and **Audit Log** tabs and approve hours. You can grant the manager role two ways, and either is sufficient:

- **Manager users** — pick specific people.
- **Manager groups** — pick Jira groups; every member of a selected group is treated as a manager.

### 5. KUP percentage limit

An optional company-wide cap on KUP %.

- **Limit (%)** — leave blank for no limit, or set a cap (e.g. `20`).
- **Enforcement:**
  - **Warn only** — employees and managers see a warning when over the limit, but approval is still allowed.
  - **Block approval** — managers cannot approve an employee who is over the limit; the Approve button shows *"Blocked"* until the hours are brought back under the cap.

### 6. Payroll export field mappings

Optional. Adds extra columns to the payroll export by mapping them to existing Jira **custom fields**.

- **Employee ID** — map to the custom field that holds each person's payroll/HR identifier.
- **Cost Center** — map to the custom field that holds the cost-centre / supervisory org.

Leave either unmapped to omit that column from the export. Values are read from each employee's most recent KUP issue for the month.

---

## Manager guide

Managers work from the global **KUP Compliance** page. Open it from the Jira top navigation: **Apps → KUP Compliance**. Managers land on the **Manager Approval** tab by default; there is also a **My Report** tab (your own hours — see the [Employee guide](#employee-guide)) and an **Audit Log** tab.

### Manager Approval tab

**Filters (top row):**

- **Month** — the reporting period to review.
- **Status** — *All*, *Pending*, or *Approved*.
- **Jira group** — limit the list to members of a Jira group.
- **My Team** — limit the list to your own custom team (see [My Team](#my-team)).
- **Refresh** — re-fetch after changes.

**Summary cards** show, for the current view: total **Users**, **Approved**, **Pending**, and **Over limit** (the last turns red when anyone exceeds the cap).

**The table** lists one row per employee:

| Column | Meaning |
|--------|---------|
| **User** | Click the name to expand and see that person's individual issues and per-issue status. |
| **Issues** | Number of issues with KUP hours this month. |
| **KUP Hours** | Total creative hours logged. |
| **Max Hours** | The month's working-hours base. |
| **Absence / Overtime** | The employee's adjustments, if any. |
| **KUP %** | Computed against the effective (adjusted) base. |
| **Status** | *Pending*, *Approved*, or *Mixed*; an **Over limit** lozenge appears if over the cap. |
| **Action** | Approve / Unapprove. |

Below the table you'll also see any **Unassigned Issues** — issues that have KUP hours logged but no assignee, so someone needs to claim them.

### Approving and un-approving

- **Approve** signs off *all* of that employee's pending issues for the month at once. Approval **locks** the employee out of further edits and adjustments for that month.
- **Unapprove** reverses it and re-opens editing.
- If the **limit** is set to **Block approval** and the employee is over the cap, the Approve button is disabled and shows *"Blocked"*. In **Warn only** mode you can still approve, but you'll get a warning and the action is recorded as such.

Every approve/unapprove is recorded in the [Audit Log](#audit-log-tab).

### My Team

If you don't manage a whole Jira group, you can curate a personal team:

1. Click **Manage my team**.
2. Use the user picker to **Add** members; **Remove** any you don't want.
3. Click **Save Team**.
4. Toggle the **My Team** filter on to restrict the report to just those people.

### Payroll export

Generates a per-employee monthly payroll summary for accounting. It runs in the background so large datasets don't time out.

1. In the **Export Payroll Summary** panel, choose a **format** — Excel (`.xlsx`) or CSV (`.csv`).
2. Click **Generate Export**. A spinner shows while it's processed in the background.
3. When ready, a **Download** button appears — click it to save the file. (CSV uses a UTF-8 BOM so Polish characters render correctly in Excel.)

**Columns:** First/Last name, Manager/Approver, Working Hours, Creative (KUP) Hours, KUP %, and Approval Status — plus **Capped Creative Hours** when a limit is configured, and **Employee ID** / **Cost Center** when your admin has mapped those fields. Only employees with KUP hours > 0 are included.

If an export takes longer than 60 seconds it times out with a message — just try again. Generating a new export for the same month replaces any previous one.

### Audit Log tab

A chronological record of every approval action for the selected month.

- **Stat cards:** Total Actions, Approvals, Unapprovals, Active Managers.
- **Table:** date/time, the **manager** who acted, the action (Approved/Unapproved), the **employee**, and the affected **issues** (shown as clickable links, truncated with "+ N more" when there are many).
- **Export CSV** downloads the month's log for your records.

> Note: the audit log keeps the most recent 500 actions per month and 50 changes per issue. Older entries roll off rather than being archived.

---

## Employee guide

As an employee you do two things: **log your KUP hours** on the relevant issues, and **check your compliance** on your personal report.

### Logging KUP hours on an issue

On any eligible issue, find the **KUP Compliance** panel in the issue's context (right-hand) area.

1. Choose the **KUP Month** the work applies to.
2. Enter the **KUP Hours** for this issue (0–744).
3. Click **Save**.

Notes:

- Every save is recorded under **Compliance Activity** on the panel — a dated trail of what changed.
- Once a manager has **approved** your hours for that month, the panel shows an *"Approved by … "* banner and the fields are **locked**. To make changes, ask your manager to un-approve first.
- The **View KUP Compliance Report** button jumps to your personal report.

### My Report

Open **Apps → KUP Compliance** from the Jira top navigation. Employees see the **My Report** tab.

1. Pick a **Month**.
2. Three cards summarise your standing:
   - **KUP Hours** — your total creative hours that month.
   - **Max Working Hours / Effective Base** — your baseline (flips to *Effective Base* with a breakdown when you have an adjustment).
   - **KUP %** — your percentage, with a status lozenge (*On track*, *Approaching limit*, *Over limit*).
3. The **Issues** table lists every issue contributing hours, sorted by hours.

If you're over the company limit, a warning explains whether your manager can still approve (warn mode) or not (block mode), and how many KUP hours you have left.

### Hours adjustment (absence & overtime)

Your working-hour base can be tuned to reflect reality:

1. In the **Hours adjustment** panel, enter **Absence hours** (e.g. holiday/sick — these *reduce* your base) and/or **Overtime hours** (these *raise* it).
2. Click **Save adjustment**.

The KPI cards and KUP % update to use your **effective base** immediately. Adjustments are **locked** once your month is approved — ask your manager to un-approve if you need to change them.

---

## Frequently asked questions

**Why don't I see the KUP panel on an issue?**
The issue's project or issue type isn't enabled for KUP. Ask your admin to enable it in *KUP 50% Configuration → eligible projects & issue types*.

**Why can't I edit my hours?**
They've been approved for that month. A manager must un-approve before you can edit.

**Why is my KUP % higher than the raw hours suggest?**
KUP % is measured against your **effective base** (working hours − absence + overtime), not the raw monthly maximum. Absence lowers the base and therefore raises the percentage.

**I'm a manager but I don't see the Manager Approval tab.**
Your account isn't listed as a manager. Ask your admin to add you as a *Manager user* or to a *Manager group*.

**The export shows "Former user" as an approver.**
That person's Jira account has been deactivated or removed. The app stores only account IDs and resolves names live, so departed accounts show as *Former user*.

**Do export files linger in storage?**
No. A downloaded export is deleted immediately, and any un-downloaded one is auto-removed after one hour.
