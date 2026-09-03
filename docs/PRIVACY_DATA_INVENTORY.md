# Personal Data Inventory

This document describes the application's current personal-data processing. It
is an engineering inventory, not a substitute for the privacy notice or legal
advice. It must be kept in sync with the Marketplace Privacy & Security tab.

## Purpose

The app associates creative-work (KUP) hours with Jira assignees, supports
manager approval, and produces a monthly payroll export. The app therefore
processes Atlassian account IDs and employment-related work-hour information.

## Stored data

| Location | Personal data | Purpose | Current retention |
| --- | --- | --- | --- |
| Jira issue properties: `kup-data` | KUP month and hours associated with the issue assignee | Employee KUP record and reporting | Until changed or removed |
| Jira issue properties: `kup-approval` | Approver account ID and approval timestamp | Approval status and edit lock | Until changed or removed |
| Jira issue properties: `kup-audit-log` | Acting-user account ID, timestamp, and change history | Auditability | Most recent 50 entries per issue |
| Forge Custom Entity: `user-monthly-adjustment` | Employee and editor account IDs; absence and overtime hours | Working-hour baseline calculation | Until changed or removed |
| Forge KVS: `kup_config` | Explicit manager account IDs | Manager authorization | Until configuration changes |
| Forge KVS: `kup_manager_team_{accountId}` | Manager and member account IDs | Manager-defined report filtering | Until changed or removed |
| Forge KVS: `kup_approval_log_{month}` | Manager and target-user account IDs; issue keys; timestamps | Monthly approval audit log | Most recent 500 entries per month |
| Forge KVS: `export_{accountId}_{month}` | Payroll export containing employee and approver names and hour data | One-time download | One hour; also deleted after download |

Display names are resolved live from Jira for normal UI rendering and are not
persisted in manager-team records. Email addresses are not stored.

## Implemented privacy lifecycle

- A queryable per-account registry is seeded once from existing records and is
  updated whenever new account-linked data is stored.
- A scheduled Forge job reports due accounts through the Forge Privacy API. It
  runs hourly but reports each account no more often than every seven days.
- When Atlassian reports an account as closed, the app removes its KUP issue
  records, adjustments, manager/team references, approval references, audit
  references, active exports, and registry entry. Failed cleanup remains queued
  for a later scheduled retry.
- When Atlassian reports an account as updated, the app removes any legacy
  persisted display names from manager teams. Current names are always resolved
  live from Jira.

## Remaining Marketplace work

Before publication, provide a customer-facing privacy policy describing this
processing, the retention rules, and the contact path for erasure requests.
Deployment will require a major-version upgrade and customer re-consent because
the app now requests Forge's `report:personal-data` scope. The uninstallation
data-retention process must also be documented and verified for the chosen
customer-support model.
