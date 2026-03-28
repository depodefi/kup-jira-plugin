import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box, Stack, Heading, Select, DynamicTable, Spinner, Text, Strong, User
} from '@forge/react';
import { invoke } from '@forge/bridge';

const KupReportPage = () => {
  const [loading, setLoading] = useState(true);
  const [months, setMonths] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState(null);
  
  const [fetchingReport, setFetchingReport] = useState(false);
  const [reportData, setReportData] = useState({ issues: [], totalHours: 0 });

  useEffect(() => {
    async function init() {
      try {
        const availableMonths = await invoke('getAvailableMonths');
        
        // Map to Select options format
        const options = availableMonths.map(m => ({ label: m, value: m }));
        setMonths(options);
        
        // Default to current calendar month logically, or just the first item
        const d = new Date();
        const currentMonthString = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2, '0')}-KUP`;
        const defaultOption = options.find(o => o.value === currentMonthString) || options[0];
        
        if (defaultOption) {
          setSelectedMonth(defaultOption);
        }
      } catch (err) {
        console.error('Failed to load available months', err);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  useEffect(() => {
    async function fetchReport() {
      if (!selectedMonth) return;
      setFetchingReport(true);
      try {
        const data = await invoke('getMyKupReport', { month: selectedMonth.value });
        setReportData(data);
      } catch (err) {
        console.error('Failed to fetch report data', err);
        setReportData({ issues: [], totalHours: 0 });
      } finally {
        setFetchingReport(false);
      }
    }
    fetchReport();
  }, [selectedMonth]);

  if (loading) return <Spinner size="large" />;

  // Build the Dynamic Table structure
  const head = {
    cells: [
      { key: 'issue', content: 'Issue Key' },
      { key: 'summary', content: 'Summary' },
      { key: 'hours', content: 'KUP Hours' }
    ]
  };

  const rows = reportData.issues.map((issue, index) => ({
    key: `row-${index}-${issue.key}`,
    cells: [
      { key: `c-issue-${index}`, content: <Strong>{issue.key}</Strong> },
      { key: `c-summary-${index}`, content: issue.summary },
      { key: `c-hours-${index}`, content: issue.hours }
    ]
  }));

  return (
    <Box padding="space.400">
      <Stack space="space.400">
        <Heading size="large">My KUP Compliance Report</Heading>
        
        <Box>
          <Text>Select a month to instantly calculate your total compliance hours registered across all your assigned Jira issues.</Text>
        </Box>

        <Box>
          <Select
            inputId="month-selector"
            options={months}
            value={selectedMonth}
            onChange={(option) => setSelectedMonth(option)}
            isLoading={fetchingReport}
            isClearable={false}
          />
        </Box>

        {fetchingReport ? (
          <Spinner size="medium" />
        ) : (
          <Stack space="space.300">
            <DynamicTable
              head={head}
              rows={rows}
              emptyView="You have zero KUP hours logged on assigned issues for this month."
            />
            
            <Box paddingBlockStart="space.200">
              <Heading size="medium">
                Total Hours: <Strong>{reportData.totalHours}</Strong>
              </Heading>
            </Box>
          </Stack>
        )}
      </Stack>
    </Box>
  );
};

ForgeReconciler.render(<KupReportPage />);
