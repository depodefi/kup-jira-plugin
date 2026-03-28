# Walkthrough: kup-compliance-reporter

## What Was Done

1. **Scaffolded** the app using `forge create` with the `jira-dashboard-gadget-custom-ui` template under the **Veloscope** Developer Space
2. **Moved** all generated files into the workspace root (`/Users/michal/repos/kup-jira-plugin/`)
3. **Updated** [manifest.yml](file:///Users/michal/repos/kup-jira-plugin/manifest.yml) with two dashboard gadget modules
4. **Validated** with `forge lint` — no errors

---

## Project Structure

```
kup-jira-plugin/
├── manifest.yml              ← App manifest (modules, permissions, runtime)
├── package.json              ← Root deps (incl. @forge/resolver)
├── src/
│   └── index.js              ← Backend resolver (Forge Functions)
└── static/
    └── hello-world/          ← Custom UI React frontend
        ├── package.json      ← React deps (@forge/bridge, AtlasKit, React)
        ├── public/           ← Static assets (index.html)
        └── src/
            ├── index.js      ← React entry point
            ├── App.js        ← Routes between View and Edit modes
            ├── View.js       ← Gadget display view
            └── Edit.js       ← Gadget configuration/edit view
```

| Layer | Purpose |
|---|---|
| **`manifest.yml`** | Declares modules (gadgets, admin page), permissions (`storage:app`, `read:jira-work`), runtime config, and app ID |
| **`src/index.js`** | Backend entrypoint, exporting handlers for gadgets (`handler`) and admin page (`adminHandler`) |
| **`src/admin-resolvers.js`** | Admin-specific serverless Forge backend logic (`getJiraContext`, `getKupConfig`, `saveKupConfig`) |
| **`static/hello-world/`** | Custom UI React app bundled by `react-scripts` and served in an iframe inside Jira |

---

## App Modules

The [manifest.yml](file:///Users/michal/repos/kup-jira-plugin/manifest.yml) now contains the following modules:

### Dashboard Gadgets (`jira:dashboardGadget`)
| Key | Title | Purpose |
|---|---|---|
| `compliance-overview-gadget` | Compliance Overview | High-level compliance status across Jira projects |
| `compliance-details-gadget` | Compliance Details | Detailed per-issue compliance breakdown and reporting |

### Admin Settings Page (`jira:adminPage`)

Now implemented using **Native UI Kit 2** (`@forge/react`) directly configured in `.jsx` files (no `react-scripts` bundle required).

| Key | Title | Purpose |
|---|---|---|
| `kup-admin-settings` | KUP 50% Configuration | Configures app settings using the `storage:app` API |

**Features Built:**
- Simplification Toggle: "Enable KUP Tracking for ALL Projects & Issue Types"
- Dynamic Projects `Select` (loaded via API)
- Conditional Issue Types `Select` for each selected project individually
### Predefined Month Configurations
The admin settings dynamically generate a grid of checkboxes (2025-01-KUP to 2030-12-KUP). Checked months dictate what shows up locally per issue.

---

### Issue Context Panel & Audit Trail (`jira:issueContext`)

Pivoted from manual Custom Fields to a **zero-setup Issue Context Panel** that appears instantly on the right sidebar for eligible issues.

**Features Built:**
- Validates issue (`projectId`, `issueTypeId`) against configuration before rendering.
- Stores KUP Month and KUP Hours as **Issue Entity Properties** (`kup-data`), keeping them perfectly searchable via JQL while avoiding Jira's restrictive Screen Configurations.
- **Tamper-proof Audit Log:** Every save action appends to a hidden array (`kup-audit-log`).
- **Activity Display:** Renders a beautiful chronological list natively inside the panel, utilizing the Atlassian `<User>` component to instantly render user avatars and full display names based on Account IDs.

---

### My KUP Report (Global Page)

A dedicated, personal reporting page accessible from the Jira "Apps" menu.

**Features Built:**
- **JQL Property Searching:** Uses optimized JQL (`issue.property[kup-data].kupMonth = "..."`) to fetch issues.
- **Privacy-First (asApp):** Executed via `asApp()` to minimize "Allow access" prompts while still filtering for `assignee = currentUser()`.
- **Dynamic Calculation:** Automatically sums the `kupHours` from all returned issues.
- **Native Table Rendering:** Uses Forge `<DynamicTable>` for a high-performance, responsive experience.

Implemented two fields using **Native UI Kit** that conditionally display based on whether the issue is verified as eligible via `isKupEligible` backend resolver.

| Key | Title | Purpose |
|---|---|---|
| `kup-month-field` | KUP Month | Dropdown string field mapped to `availableMonths` global config |
| `kup-hours-field` | KUP Hours | Numeric input field representing compliance hours |

**Features Built:**
- Validates issue (`projectId`, `issueTypeId`) against configuration.
- Native UI `CustomFieldEdit` forms with `Select` and `Textfield` (`number`).
- View mode native rendering fallback strings.

## Validation

```
$ forge lint
No issues found.
```
$ npx jest src/admin-resolvers.test.js
PASS src/admin-resolvers.test.js
  adminResolver
    ✓ getJiraContext should return projects and issue types
    ✓ getKupConfig should return stored config
    ✓ saveKupConfig should save config and return success
```

> [!NOTE]
> Warnings about missing `build/` directory are expected — run `npm run build` in `static/hello-world/` before deploying.

---

## Next Steps

- Run `cd static/hello-world && npm install && npm run build` to build the frontend
- `forge deploy --non-interactive -e development` to deploy
- `forge install --non-interactive --site <your-site> --product jira -e development` to install
