import React, { useEffect, useState } from 'react';
import ForgeReconciler, { 
  Text, Select, Toggle, Button, Box, Stack, Heading, SectionMessage, Label, TextArea 
} from '@forge/react';
import { invoke } from '@forge/bridge';

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
  const [availableMonthsText, setAvailableMonthsText] = useState('');

  useEffect(() => {
    async function loadData() {
      try {
        const [context, config] = await Promise.all([
          invoke('getJiraContext'),
          invoke('getKupConfig')
        ]);
        
        setProjectsData(context.projects.map(p => ({ label: `${p.name} (${p.key})`, value: p.id })));
        setIssueTypesData(context.issueTypes.map(it => ({ label: it.name, value: it.id })));

        if (config) {
          setEnableAll(config.enableAll !== false);
          setEnabledProjects(config.enabledProjects || []);
          setProjectIssueTypes(config.projectSpecificIssueTypes || {});
          setAvailableMonthsText((config.availableMonths || []).join(', '));
        }
      } catch (err) {
        setErrorMSG('Failed to load configuration: ' + err.message);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSuccess(false);
    setErrorMSG(null);
    try {
      const parsedMonths = availableMonthsText.split(',').map(m => m.trim()).filter(Boolean);
      await invoke('saveKupConfig', {
        enableAll,
        enabledProjects,
        projectSpecificIssueTypes: projectIssueTypes,
        availableMonths: parsedMonths
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

        <Box paddingBlockStart="space.200">
          <Label labelFor="available-months-textarea">Available Months for KUP Selection (comma separated)</Label>
          <TextArea
            id="available-months-textarea"
            value={availableMonthsText}
            onChange={(e) => setAvailableMonthsText(e.target.value)}
            placeholder="e.g. Dec 2025, Jan 2026, Feb 2026"
          />
        </Box>

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
