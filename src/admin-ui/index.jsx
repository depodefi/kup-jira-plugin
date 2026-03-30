import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Text, Select, Toggle, Button, Box, Stack, Inline, Heading, SectionMessage, Label, DynamicTable, Textfield, UserPicker
} from '@forge/react';
import { invoke } from '@forge/bridge';

/**
 * Generate all month strings from 2025-01-KUP to 2030-12-KUP.
 * This is the master list — the admin picks which ones are active.
 */
const ALL_MONTHS = [];
for (let year = 2025; year <= 2030; year++) {
  for (let month = 1; month <= 12; month++) {
    const mm = String(month).padStart(2, '0');
    ALL_MONTHS.push(`${year}-${mm}-KUP`);
  }
}

const AdminSettings = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMSG, setErrorMSG] = useState(null);

  const [projectsData, setProjectsData] = useState([]);
  const [issueTypesData, setIssueTypesData] = useState([]);

  const [enableAll, setEnableAll] = useState(true);
  const [enabledProjects, setEnabledProjects] = useState([]);
  const [projectIssueTypes, setProjectIssueTypes] = useState({});

  // Set of month strings that are checked (enabled for issue-level selection)
  const [enabledMonths, setEnabledMonths] = useState(new Set());
  // Map of month string → max working hours number
  const [monthWorkingHours, setMonthWorkingHours] = useState({});

  // Manager role config
  const [managerUsers, setManagerUsers] = useState([]);   // array of accountId strings
  const [managerGroups, setManagerGroups] = useState([]); // array of groupId strings
  const [groupsData, setGroupsData] = useState([]);        // Select options

  useEffect(() => {
    async function loadData() {
      try {
        const [context, config, groups] = await Promise.all([
          invoke('getJiraContext'),
          invoke('getKupConfig'),
          invoke('getJiraGroups'),
        ]);
        
        setProjectsData(context.projects.map(p => ({ label: `${p.name} (${p.key})`, value: p.id })));
        setIssueTypesData(context.issueTypes.map(it => ({ label: it.name, value: it.id })));
        setGroupsData((groups || []).map(g => ({ label: g.name, value: g.groupId })));

        if (config) {
          setEnableAll(config.enableAll !== false);
          setEnabledProjects(config.enabledProjects || []);
          setProjectIssueTypes(config.projectSpecificIssueTypes || {});
          // Restore checked months from saved config
          setEnabledMonths(new Set(config.availableMonths || []));
          setMonthWorkingHours(config.monthWorkingHours || {});
          setManagerUsers(config.managerUsers || []);
          setManagerGroups(config.managerGroups || []);
        }
      } catch (err) {
        setErrorMSG('Failed to load configuration: ' + err.message);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  // Toggle a single month checkbox on/off
  const toggleMonth = (month) => {
    setEnabledMonths(prev => {
      const next = new Set(prev);
      if (next.has(month)) {
        next.delete(month);
      } else {
        next.add(month);
      }
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setSuccess(false);
    setErrorMSG(null);
    try {
      await invoke('saveKupConfig', {
        enableAll,
        enabledProjects,
        projectSpecificIssueTypes: projectIssueTypes,
        availableMonths: Array.from(enabledMonths),
        monthWorkingHours,
        managerUsers,
        managerGroups,
      });
      setSuccess(true);
    } catch (err) {
      setErrorMSG('Failed to save configuration: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Text>Loading configuration...</Text>;

  // Convert enabledProjects to Select value format
  const selectedProjects = projectsData.filter(p => enabledProjects.includes(p.value));

  return (
    <Box padding="space.300">
      <Heading size="medium">KUP 50% Configuration</Heading>
      
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
        <Box>
          <Toggle 
            id="enable-all-toggle" 
            label="Enable KUP Tracking for ALL Projects & Issue Types (Setup Simplification)" 
            isChecked={enableAll} 
            onChange={(e) => setEnableAll(e.target.checked)} 
          />
        </Box>

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

        {/* Manager Role Configuration */}
        <Box paddingBlockStart="space.200">
          <Heading size="small">KUP Manager Roles</Heading>
          <Text>Managers can view compliance reports for all users. Assign individual users or entire groups.</Text>
          <Stack space="space.200">
            <Box>
              <Label labelFor="manager-users">Individual Manager Users</Label>
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

        {/* Available Months — DynamicTable with per-row toggles */}
        <Box paddingBlockStart="space.200">
          <Heading size="small">Available KUP Months</Heading>
          <Text>Toggle the months that should be available for selection on issues. {enabledMonths.size} enabled, {ALL_MONTHS.length - enabledMonths.size} read only.</Text>
          <Box paddingBlock="space.150">
            <Inline space="space.100">
              <Button appearance="subtle" onClick={() => setEnabledMonths(new Set(ALL_MONTHS))}>Enable All</Button>
              <Button appearance="subtle" onClick={() => setEnabledMonths(new Set())}>Disable All</Button>
            </Inline>
          </Box>
          <DynamicTable
            head={{
              cells: [
                { key: 'month', content: 'Month', isSortable: true },
                { key: 'hours', content: 'Max Working Hours', width: 20 },
                { key: 'enabled', content: 'Enabled', width: 10 },
              ]
            }}
            rows={ALL_MONTHS.map(month => ({
              key: month,
              cells: [
                { key: 'month', content: month },
                { key: 'hours', content: (
                  <Textfield
                    id={`hours-${month}`}
                    type="number"
                    value={String(monthWorkingHours[month] ?? '')}
                    onChange={(e) => {
                      const val = e.target.value;
                      setMonthWorkingHours(prev => ({ ...prev, [month]: val === '' ? '' : Number(val) }));
                    }}
                  />
                )},
                { key: 'enabled', content: (
                  <Toggle
                    id={`toggle-${month}`}
                    isChecked={enabledMonths.has(month)}
                    onChange={() => toggleMonth(month)}
                  />
                )},
              ]
            }))}
            rowsPerPage={12}
            defaultPage={(() => {
              const firstIdx = ALL_MONTHS.findIndex(m => enabledMonths.has(m));
              return firstIdx >= 0 ? Math.floor(firstIdx / 12) + 1 : 1;
            })()}
          />
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
