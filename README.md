# 🇵🇱 Jira KUP 50% Compliance Reporter

A Jira Cloud application built to automate reporting and compliance for the Polish "Creative Tax Deduction" (50% Koszty Uzyskania Przychodu - KUP). 

## 📖 Overview
In Poland, employees creating intellectual property (IT, design, journalism) can apply a 50% tax-deductible cost rate to their creative income, significantly reducing their personal income tax. However, Polish tax authorities (Krajowa Informacja Skarbowa) require strict, auditable proof linking the time claimed to specific creative tasks.

**The Problem:** Standard time-tracking apps (like native Jira worklogs or Tempo) track *total time*, but they do not easily generate the legal "Protocols of Acceptance of Creative Work" required by Polish law. HR and Team Leaders often spend days manually extracting and verifying this data every month.

**The Solution:** This app provides a lightweight, audit-proof workflow for developers to declare their creative hours natively inside Jira, alongside two powerful dashboard gadgets to instantly extract this data for Payroll.

## ⚙️ How It Works (The "History" Strategy)
Unlike heavy time-tracking plugins, this app relies on a **Changelog Parsing Strategy** to ensure data is 100% auditable and impossible to accidentally overwrite.

1. **The Custom Fields:** The app utilizes two simple custom fields added to Jira issues:
   * `KUP Month` (Dropdown: January, February, etc.)
   * `KUP Hours` (Number)
2. **The Developer Workflow:** At the end of the month, a developer opens the tickets they worked on, sets the Month, inputs their creative hours, and hits save.
3. **The Audit Trail:** If a ticket spans multiple months (e.g., 50 hours in Jan, 40 hours in Feb), the developer simply updates the fields. Instead of losing the January data, the app's backend API queries the **Jira Issue History (Changelog)** to reconstruct past months. This guarantees a native, defensible audit trail for the tax office.

## ✨ Core Features

* **🛡️ Audit-Proof Tracking:** Leverages native Jira history so you always know who claimed what, and when.
* **🧑‍💻 "My Reported KUP" Gadget (User View):** A Jira Dashboard gadget for individual developers to track their declared creative hours for a given month, ensuring they hit their targets before payroll cutoff.
* **📊 "Monthly Compliance" Gadget (HR/Admin View):** A management dashboard that aggregates all creative hours across the company for a selected month.
* **📥 One-Click Payroll Export:** Instantly download the monthly KUP declarations (Excel/CSV) ready to be handed to HR and Accounting for payroll processing.

## 🛠️ Tech Stack
* **Platform:** Jira Cloud
* **Framework:** Atlassian Forge (Custom UI)
* **Frontend:** React.js
* **Backend:** Node.js (Forge Resolvers & Jira REST API)

## 🎯 Target Audience
This plugin is built specifically for Software Houses, IT Corporations, and Creative Agencies operating in Poland that need a frictionless way to maintain KUP 50% compliance without buying expensive, bloated time-tracking software.
