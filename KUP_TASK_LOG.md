# Create Forge App: kup-compliance-reporter

- [x] Write and get approval on the implementation plan
- [x] Run `forge create` with the Custom UI dashboard gadget template
- [x] Inspect and explain the generated project structure
- [x] Update `manifest.yml` to include two Jira Dashboard Gadget modules
- [x] Validate the manifest with `forge lint`

## Native UI Kit Admin Page
- [x] Configure `manifest.yml` for UI Kit 2 native rendering on the `adminPage` module
- [x] Create `src/admin-ui/index.jsx` with `@forge/react`
- [x] Build UI toggle to enable all projects/issue types (Simplification)
- [x] Build multi-selects to handle specific project and issue type overrides
- [x] Explicit 'Save' action mapping
- [x] Verify with `forge lint`
- [x] Redeploy and test on Jira instance

## Phase 3: Custom Fields
- [x] Write and get approval on the implementation plan
- [x] Update admin config backend and UI to handle `availableMonths`
- [x] Register `jira:customField` modules in `manifest.yml`
- [x] Create `isKupEligible` backend resolver logic
- [x] Build Native UI Kit custom field views (`custom-fields-ui`)
- [x] Verify with `forge lint`
- [x] Redeploy and test on Jira instance

## Phase 4: Issue Context Panel with Custom Audit Trail
- [x] Get approval on implementation plan
- [x] Remove `jira:customField` modules, add `jira:issueContext` module to manifest
- [x] Create `panel-resolvers.js` with eligibility, save, and audit log logic
- [x] Build `kup-panel-ui/index.jsx` with Native UI Kit
- [x] Deploy and upgrade on Jira instance
- [x] Manual verification
- [x] Replace month TextArea with predefined checkbox list (2025–2030)

## Phase 5: My KUP Report (Global Page)
- [x] Get approval on implementation plan
- [x] Add `jira:globalPage` module to `manifest.yml`
- [x] Create `report-resolvers.js` with JQL property searching
- [x] Build `kup-report-ui/index.jsx` with `DynamicTable` and `Select`
- [x] Deploy and verify the report totals
- [x] Configure `jira:entityProperty` indexing in manifest for searchable properties
