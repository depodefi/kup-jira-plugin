import { useLicenseStatus } from '../use-license-status.js';
import React, { useEffect, useRef, useState } from 'react';
import ForgeReconciler, {
  Text, Select, Toggle, Button, Box, Stack, Inline, Heading, SectionMessage, Label, DynamicTable, Textfield, UserPicker, Lozenge
} from '@forge/react';
import { invoke } from '@forge/bridge';
import { DEFAULT_WORKING_HOURS } from '../kup-defaults.js';

/**
 * Generate all month strings from 2025-01 to 2030-12.
 * Working-hour baselines only; these do not restrict selectable periods.
 */
const ALL_MONTHS = [];
for (let year = 2025; year <= 2030; year++) {
  for (let month = 1; month <= 12; month++) {
    const mm = String(month).padStart(2, '0');
    ALL_MONTHS.push(`${year}-${mm}`);
  }
}

const AdminSettings = () => {
  const [loading, setLoading] = useState(true);
  const { licenseActive, licenseMessage, checkLicense } = useLicenseStatus();
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMSG, setErrorMSG] = useState(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const isLoaded = useRef(false);

  const [projectsData, setProjectsData] = useState([]);
  const [issueTypesData, setIssueTypesData] = useState([]);

  const [enableAll, setEnableAll] = useState(true);
  const [enabledProjects, setEnabledProjects] = useState([]);
  const [projectIssueTypes, setProjectIssueTypes] = useState({});

  // Map of month string → max working hours number
  const [monthWorkingHours, setMonthWorkingHours] = useState({});
  const [showWorkingHours, setShowWorkingHours] = useState(false);

  // Manager role config
  const [managerUsers, setManagerUsers] = useState([]);   // array of accountId strings
  const [managerGroups, setManagerGroups] = useState([]); // array of groupId strings
  const [groupsData, setGroupsData] = useState([]);        // Select options

  // KUP percentage limit
  const [maxKupPercent, setMaxKupPercent] = useState('');
  const [kupLimitEnforcement, setKupLimitEnforcement] = useState({ label: 'Warn only', value: 'warn' });

  // Export field mappings
  const [customFields, setCustomFields] = useState([]);
  const [exportEmployeeIdField, setExportEmployeeIdField] = useState(null);
  const [exportCostCenterField, setExportCostCenterField] = useState(null);

  const ENFORCEMENT_OPTIONS = [
    { label: 'Warn only', value: 'warn' },
    { label: 'Block approval', value: 'block' },
  ];

  useEffect(() => {
    if (licenseActive !== true) return;

    async function loadData() {
      try {
        const [context, config, groups, fields] = await Promise.all([
          invoke('getJiraContext'),
          invoke('getKupConfig'),
          invoke('getJiraGroups'),
          invoke('getCustomFields'),
        ]);
        
        setProjectsData(context.projects.map(p => ({ label: `${p.name} (${p.key})`, value: p.id })));
        setIssueTypesData(context.issueTypes.map(it => ({ label: it.name, value: it.id })));
        setGroupsData((groups || []).map(g => ({ label: g.name, value: g.groupId })));
        const fieldOptions = (fields || []).map(f => ({ label: `${f.name} (${f.id})`, value: f.id }));
        setCustomFields(fieldOptions);

        if (config) {
          setEnableAll(config.enableAll !== false);
          setEnabledProjects(config.enabledProjects || []);
          setProjectIssueTypes(config.projectSpecificIssueTypes || {});
          setMonthWorkingHours(config.monthWorkingHours || {});
          setManagerUsers(config.managerUsers || []);
          setManagerGroups(config.managerGroups || []);
          setMaxKupPercent(config.maxKupPercent != null ? String(config.maxKupPercent) : '');
          const enforcement = config.kupLimitEnforcement || 'warn';
          setKupLimitEnforcement(ENFORCEMENT_OPTIONS.find(o => o.value === enforcement) || ENFORCEMENT_OPTIONS[0]);
          // Export field mappings — restored after custom fields are loaded (set in the fieldOptions effect below)
          setExportEmployeeIdField(config.exportFieldMappings?.employeeId || null);
          setExportCostCenterField(config.exportFieldMappings?.costCenter || null);
        }
      } catch (err) {
        setErrorMSG('Failed to load configuration: ' + err.message);
      } finally {
        setLoading(false);
        isLoaded.current = true;
      }
    }
    loadData();
  }, [licenseActive]);

  useEffect(() => {
    if (isLoaded.current) setHasUnsavedChanges(true);
  }, [enableAll, enabledProjects, projectIssueTypes, monthWorkingHours, managerUsers, managerGroups, maxKupPercent, kupLimitEnforcement, exportEmployeeIdField, exportCostCenterField]);

  const handleSave = async () => {
    setSaving(true);
    setSuccess(false);
    setErrorMSG(null);
    try {
      const parsedMax = parseFloat(maxKupPercent);
      const result = await invoke('saveKupConfig', {
        enableAll,
        enabledProjects,
        projectSpecificIssueTypes: projectIssueTypes,
        monthWorkingHours,
        managerUsers,
        managerGroups,
        maxKupPercent: !isNaN(parsedMax) && parsedMax > 0 ? parsedMax : null,
        kupLimitEnforcement: kupLimitEnforcement.value,
        exportFieldMappings: {
          employeeId: exportEmployeeIdField || null,
          costCenter: exportCostCenterField || null,
        },
      });
      if (result?.success) {
        setSuccess(true);
        setHasUnsavedChanges(false);
      } else {
        setErrorMSG('Failed to save configuration: ' + (result?.error || 'Unknown error'));
      }
    } catch (err) {
      setErrorMSG('Failed to save configuration: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Data loading only starts for an active license. Otherwise `loading` stays
  // true, so it must not hide the inactive-license message below.
  if (licenseActive === null || (licenseActive === true && loading)) return <Text>Loading configuration...</Text>;

  if (!licenseActive) {
    return (
      <Box padding="space.300">
        <SectionMessage appearance="warning" title={licenseMessage.title}>
          <Text>{licenseMessage.text}</Text>
          <Button onClick={checkLicense}>Spróbuj ponownie</Button>
        </SectionMessage>
      </Box>
    );
  }

  // Convert enabledProjects to Select value format
  const selectedProjects = projectsData.filter(p => enabledProjects.includes(p.value));

  return (
    <Box padding="space.300">
      {hasUnsavedChanges && (
        <Box paddingBlockEnd="space.200">
          <Inline space="space.100" alignBlock="center">
            <Lozenge appearance="moved">Unsaved changes</Lozenge>
            <Text>Save the configuration to apply your changes.</Text>
          </Inline>
        </Box>
      )}
      <Heading size="small">Eligible Projects & Issue Types</Heading>
      
      {success && (
        <Box paddingBlock="space.200">
          <SectionMessage title="Success" appearance="success">
            <Text>Configuration saved successfully.</Text>
          </SectionMessage>
        </Box>
      )}

      {errorMSG && (
        <Box paddingBlock="space.200">
          <SectionMessage title="Error" appearance="error">
            <Text>{errorMSG}</Text>
          </SectionMessage>
        </Box>
      )}

      <Stack space="space.400">
        {/* Project & Issue Type Configuration */}
        <Inline space="space.150" alignBlock="center">
          <Toggle
            id="enable-all-toggle"
            label="Enable KUP tracking for all projects and issue types"
            isChecked={enableAll}
            onChange={(e) => setEnableAll(e.target.checked)}
          />
          <Text>
            {enableAll
              ? "KUP tracking is enabled for ALL projects & issue types"
              : "KUP tracking is limited to selected projects & issue types"}
          </Text>
        </Inline>

        {!enableAll && (
          <Stack space="space.300">
            <Box>
              <Label labelFor="project-select">Enable KUP Tracking for Projects</Label>
              <Select
                inputId="project-select"
                isMulti={true}
                options={projectsData}
                value={selectedProjects}
                onChange={(values) => {
                  const newProjects = values ? values.map(v => v.value) : [];
                  setEnabledProjects(newProjects);
                }}
              />
            </Box>

            {enabledProjects.map(projectId => {
              const project = projectsData.find(p => p.value === projectId);
              const selectedIssueTypesIds = projectIssueTypes[projectId] || [];
              const selectedIssueTypes = issueTypesData.filter(it => selectedIssueTypesIds.includes(it.value));

              return (
                <Box key={projectId}>
                  <Label labelFor={`issue-type-${projectId}`}>Issue Types for {project?.label}</Label>
                  <Select
                    inputId={`issue-type-${projectId}`}
                    isMulti={true}
                    options={issueTypesData}
                    value={selectedIssueTypes}
                    onChange={(values) => {
                      const newIssueTypes = values ? values.map(v => v.value) : [];
                      setProjectIssueTypes(prev => ({
                        ...prev,
                        [projectId]: newIssueTypes
                      }));
                    }}
                  />
                </Box>
              );
            })}
          </Stack>
        )}

        {/* Manager Role Configuration + KUP Percentage Limit side by side */}
        <Inline space="space.400" alignBlock="start">
          <Box paddingBlockStart="space.200">
            <Heading size="small">KUP Manager Roles</Heading>
            <Text>Managers can view compliance reports for all users. Assign individual users or entire groups.</Text>
            <Stack space="space.200">
              <Box>
                <UserPicker
                  name="manager-users"
                  label="Individual Manager Users"
                  isMulti={true}
                  defaultValue={managerUsers}
                  onChange={(value) => {
                    if (!value) {
                      setManagerUsers([]);
                    } else if (Array.isArray(value)) {
                      setManagerUsers(value.map(v => v.id));
                    } else {
                      setManagerUsers([value.id]);
                    }
                  }}
                />
              </Box>
              <Box>
                <Label labelFor="manager-groups">Manager Groups</Label>
                <Select
                  inputId="manager-groups"
                  isMulti={true}
                  options={groupsData}
                  value={groupsData.filter(g => managerGroups.includes(g.value))}
                  onChange={(values) => setManagerGroups(values ? values.map(v => v.value) : [])}
                />
              </Box>
            </Stack>
          </Box>

          <Box paddingBlockStart="space.200">
            <Heading size="small">KUP Percentage Limit</Heading>
            <Text>Set a company-wide cap on how much KUP an employee can claim. Leave empty or 0 to disable.</Text>
            <Stack space="space.200">
              <Stack space="space.050">
                <Label labelFor="max-kup-percent">Maximum KUP % (0–100, leave empty to disable)</Label>
                <Textfield
                  id="max-kup-percent"
                  name="max-kup-percent"
                  type="number"
                  min="0"
                  max="100"
                  value={maxKupPercent}
                  onChange={e => setMaxKupPercent(e.target.value)}
                />
              </Stack>
              <Stack space="space.050">
                <Label labelFor="enforcement-mode">Enforcement mode</Label>
                <Select
                  inputId="enforcement-mode"
                  options={ENFORCEMENT_OPTIONS}
                  value={kupLimitEnforcement}
                  onChange={setKupLimitEnforcement}
                  isClearable={false}
                />
              </Stack>
            </Stack>
          </Box>
        </Inline>

        {/* Export Field Mappings */}
        <Box paddingBlockStart="space.200">
          <Heading size="small">Payroll Export Field Mappings</Heading>
          <Text>Map optional Jira custom fields to payroll export columns. Leave unmapped to omit the column from exports.</Text>
          <Stack space="space.200">
            <Box>
              <Label labelFor="export-employee-id">Map Employee ID to issue field</Label>
              <Select
                inputId="export-employee-id"
                options={customFields}
                value={customFields.find(f => f.value === exportEmployeeIdField) || null}
                onChange={opt => setExportEmployeeIdField(opt ? opt.value : null)}
                isClearable={true}
                placeholder="Not mapped (column omitted)"
              />
            </Box>
            <Box>
              <Label labelFor="export-cost-center">Map Cost Center to issue field</Label>
              <Select
                inputId="export-cost-center"
                options={customFields}
                value={customFields.find(f => f.value === exportCostCenterField) || null}
                onChange={opt => setExportCostCenterField(opt ? opt.value : null)}
                isClearable={true}
                placeholder="Not mapped (column omitted)"
              />
            </Box>
          </Stack>
        </Box>

        {/* Monthly working-hour baselines used for percentage calculations. */}
        <Box paddingBlockStart="space.200">
          <Heading size="small">Monthly Working Hours</Heading>
          <Text>Set the standard number of working hours for each month. These values are used to calculate KUP percentages. Defaults are based on the Polish public holiday calendar, and you can adjust them to match your organization’s working calendar.</Text>
          <Inline space="space.100" alignBlock="center">
            <Text>{Object.keys(monthWorkingHours).length === 0
              ? 'Using Polish calendar defaults'
              : `${Object.keys(monthWorkingHours).length} custom override${Object.keys(monthWorkingHours).length === 1 ? '' : 's'}`}</Text>
            <Button appearance="subtle" onClick={() => setShowWorkingHours(current => !current)}>
              {showWorkingHours ? 'Hide overrides' : 'Manage overrides'}
            </Button>
          </Inline>
          {showWorkingHours && (
            <Stack space="space.100">
              {Object.keys(monthWorkingHours).length > 0 && (
                <Inline spread="space-between" alignBlock="center">
                  <Text>Only custom values are saved. Empty fields use the default shown beside them.</Text>
                  <Button appearance="subtle" onClick={() => setMonthWorkingHours({})}>Reset all overrides</Button>
                </Inline>
              )}
              <DynamicTable
                head={{
                  cells: [
                    { key: 'month', content: 'Month', isSortable: true },
                    { key: 'default', content: 'Polish calendar default', width: 20 },
                    { key: 'override', content: 'Custom hours', width: 20 },
                    { key: 'action', content: '', width: 10 },
                  ]
                }}
                rows={ALL_MONTHS.map(month => ({
                  key: month,
                  cells: [
                    { key: 'month', content: month },
                    { key: 'default', content: String(DEFAULT_WORKING_HOURS[month] ?? '—') },
                    { key: 'override', content: (
                      <Textfield
                        id={`hours-${month}`}
                        type="number"
                        value={String(monthWorkingHours[month] ?? '')}
                        placeholder={String(DEFAULT_WORKING_HOURS[month] ?? '')}
                        onChange={(e) => {
                          const val = e.target.value;
                          setMonthWorkingHours(prev => {
                            const next = { ...prev };
                            if (val === '' || Number(val) === DEFAULT_WORKING_HOURS[month]) delete next[month];
                            else next[month] = Number(val);
                            return next;
                          });
                        }}
                      />
                    )},
                    { key: 'action', content: monthWorkingHours[month] !== undefined ? (
                      <Button appearance="subtle" onClick={() => setMonthWorkingHours(prev => {
                        const next = { ...prev };
                        delete next[month];
                        return next;
                      })}>Reset</Button>
                    ) : null },
                  ]
                }))}
                rowsPerPage={12}
              />
            </Stack>
          )}
        </Box>

        {/* Explicit save */}
        <Box paddingBlockStart="space.300">
          <Button appearance="primary" onClick={handleSave}>
            {saving ? 'Saving...' : 'Save Configuration'}
          </Button>
        </Box>
      </Stack>
    </Box>
  );
};

ForgeReconciler.render(<AdminSettings />);
