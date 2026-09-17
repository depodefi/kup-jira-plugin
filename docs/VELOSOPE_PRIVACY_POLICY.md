# Privacy Policy

**Last updated:** 7 September 2026

**Provider:** Michal Karpinski, trading as Veloscope ("Veloscope", "we",
"us", or "our")<br>
**Registered address:** Suchodolska 24, 06-014 Warszawa<br>
**Privacy contact:** majk@veloscope.me

## 1. Scope

This Privacy Policy describes how Veloscope's Atlassian Jira Cloud apps handle
data. It currently covers:

- Epic Delivery Forecast for Jira ("Epic Delivery Forecast"); and
- KUP 50% Compliance for Jira ("KUP").

The products have different data practices. The product-specific sections
below explain which data each product accesses, processes, and stores.

## 2. Epic Delivery Forecast

Epic Delivery Forecast accesses Jira issue, epic, and version data only while
calculating and displaying aggregated delivery metrics in the customer's Jira
site. It does not persist Jira issues, comments, user identifiers, names, or
email addresses. It does not transfer Jira data to a separate Veloscope server
or third-party analytics, advertising, or tracking service.

## 3. KUP 50% Compliance for Jira

KUP helps a customer record eligible 50% KUP creative-work hours on Jira
issues, calculate monthly KUP percentages, manage approvals, and create
payroll summaries. For those functions, KUP processes the following data:

| Data category | Examples | Purpose |
| --- | --- | --- |
| Jira account identifiers | Account IDs of employees, managers, administrators, approvers, and editors | Associating records, authorising access, approvals, and privacy requests |
| KUP work records | Reporting month, KUP hours, Jira issue association, and approval status | Monthly KUP reporting and calculations |
| Working-time adjustments | Absence hours, overtime hours, employee and editor account IDs | Calculating effective monthly working-hour baselines |
| Administration and audit data | Eligible projects and issue types, manager/team membership, approver and acting-user account IDs, timestamps, and change history | App configuration, access control, traceability, and support |
| Generated exports | Employee and approver names and relevant KUP, working-time, and payroll-summary data | Customer-requested CSV and XLSX payroll summaries |

KUP resolves display names from Jira only when needed for display. It does not
persist email addresses, Jira passwords, Atlassian API tokens, or user profile
display names in its normal configuration records. Generated exports may
contain names obtained from Jira because this is necessary for the payroll
workflow.

## 4. Storage, sharing, and retention for KUP

KUP records and related approval/audit properties are stored on the relevant
Jira issues. KUP also uses Atlassian Forge storage for configuration, manager
teams, monthly adjustments, approval logs, temporary exports, and the privacy
lifecycle registry. KUP does not send App data to a separate Veloscope server
or other third-party analytics, advertising, or payroll service.

Atlassian provides Jira Cloud and Forge, which host and process this data.
Their handling of data, including available data-residency options and
international transfers, is governed by the customer's agreement with
Atlassian and applicable Atlassian terms.

| Data | Retention |
| --- | --- |
| KUP issue records and approval properties | Until changed, removed, or erased through the privacy lifecycle below |
| Per-issue audit history | The most recent 50 entries per issue; older entries are replaced |
| Monthly adjustments, configuration, and manager-team records | Until changed, removed by the customer, or erased through the privacy lifecycle below |
| Monthly approval log | The most recent 500 entries per reporting month; older entries are replaced |
| Generated payroll export | Deleted after download or automatically after one hour, whichever occurs first |

We do not sell personal data or use it for advertising or cross-customer
profiling. We disclose data only where necessary to provide the App, comply
with law, protect the App or its users, or as instructed or authorised by the
customer.

## 5. Access, account closure, and deletion

KUP requests the Jira and Forge permissions necessary to read and write the
relevant Jira work data, resolve Jira account identities, store app data,
apply configured manager/group filtering, and report stored account IDs through
Forge's personal-data reporting capability. The Marketplace Privacy & Security
tab describes the current permissions and data practices for the released
version.

KUP reports retained Atlassian account IDs through Forge's personal-data
reporting mechanism. When Atlassian notifies KUP that an account is closed,
KUP erases related KUP issue records, adjustments, manager/team references,
approval and audit references, active temporary exports, and its privacy
registry entry. Failed erasure attempts remain queued for a later retry.

Jira administrators may request correction or deletion by emailing
majk@veloscope.me with the Jira site, relevant account or records, and the
request. We may need to verify the request with the customer administrator.

After KUP is uninstalled, it can no longer access the customer's Jira site.
Atlassian Forge-hosted storage is retained by Atlassian for up to 28 days after
uninstallation under its applicable storage lifecycle. Jira issue properties
written by KUP may remain on the related Jira issues after uninstallation. A
Jira administrator can remove those properties using Jira's issue-property API,
or contact majk@veloscope.me for assistance identifying them before uninstalling
KUP.

## 6. Security and your rights

We rely on the security controls provided by Atlassian Jira Cloud and Forge and
restrict KUP access through Jira permissions and configured App roles. No
security measure is absolute. To report a privacy or security issue, email
majk@veloscope.me and do not include passwords, tokens, or unnecessary personal
data.

Depending on applicable law, individuals may have rights to request access,
correction, deletion, restriction, objection, or portability of their personal
data. Because the customer's organisation normally determines the purposes for
which KUP data is processed, please contact your employer or Jira administrator
first. They can coordinate with us where needed.

## 7. Changes and contact

We may update this policy when a product's functionality or data practices
change. We will publish the current version at
https://veloscope.me/privacy.html and update the date above. For privacy
questions or requests, contact:

Michal Karpinski / Veloscope<br>
Suchodolska 24, 06-014 Warszawa<br>
majk@veloscope.me
