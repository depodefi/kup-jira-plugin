import React, { useEffect, useState, useCallback } from 'react';
import ForgeReconciler, {
  Box, Stack, Inline, Heading, Select, DynamicTable, Spinner,
  Text, Strong, Button, SectionMessage, Lozenge, Link, Label,
} from '@forge/react';
import { invoke } from '@forge/bridge';

const STATUS_FILTER_OPTIONS = [
  { label: 'All', value: 'all' },
  { label: 'Pending', value: 'pending' },
  { label: 'Approved', value: 'approved' },
];

const ManagerApprovalPage = () => {
  const [loading, setLoading] = useState(true);
  const [isManager, setIsManager] = useState(false);
  const [months, setMonths] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [statusFilter, setStatusFilter] = useState(STATUS_FILTER_OPTIONS[0]);
  const [reportData, setReportData] = useState(null);
  const [fetchingReport, setFetchingReport] = useState(false);
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [actionMessage, setActionMessage] = useState(null); // { type, text }
  const [actionLoading, setActionLoading] = useState({});   // accountId -> bool

  // Init: check manager role and load available months
  useEffect(() => {
    async function init() {
      try {
        const [roleResult, availableMonths] = await Promise.all([
          invoke('getCurrentUserRole'),
          invoke('getAvailableMonths'),
        ]);

        if (!roleResult.isManager) {
          setIsManager(false);
          setLoading(false);
          return;
        }

        setIsManager(true);

        const options = availableMonths.map(m => ({ label: m, value: m }));
        setMonths(options);

        const d = new Date();
        const currentMonthString = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-KUP`;
        const defaultOption = options.find(o => o.value === currentMonthString) || options[0];
        if (defaultOption) setSelectedMonth(defaultOption);
      } catch (err) {
        console.error('Failed to initialize manager page', err);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  // Fetch report when month or status filter changes
  const fetchReport = useCallback(async () => {
    if (!selectedMonth) return;
    setFetchingReport(true);
    setActionMessage(null);
    try {
      const data = await invoke('getManagerReport', {
        month: selectedMonth.value,
        statusFilter: statusFilter.value,
      });
      setReportData(data.error ? null : data);
    } catch (err) {
      console.error('Failed to fetch manager report', err);
      setReportData(null);
    } finally {
      setFetchingReport(false);
    }
  }, [selectedMonth, statusFilter]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const toggleExpand = (accountId) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      return next;
    });
  };

  const handleApprove = async (user) => {
    setActionLoading(prev => ({ ...prev, [user.accountId]: true }));
    try {
      const result = await invoke('bulkApprove', { accountId: user.accountId, month: selectedMonth.value });
      if (result.success) {
        const n = result.approvedCount;
        setActionMessage({
          type: 'confirmation',
          text: `Approved ${n} issue${n !== 1 ? 's' : ''} for ${user.displayName}.`,
        });
        await fetchReport();
      } else {
        setActionMessage({ type: 'error', text: result.error || 'Approval failed.' });
      }
    } catch (err) {
      setActionMessage({ type: 'error', text: err.message || 'Unexpected error.' });
    } finally {
      setActionLoading(prev => ({ ...prev, [user.accountId]: false }));
    }
  };

  const handleUnapprove = async (user) => {
    setActionLoading(prev => ({ ...prev, [user.accountId]: true }));
    try {
      const result = await invoke('bulkUnapprove', { accountId: user.accountId, month: selectedMonth.value });
      if (result.success) {
        const n = result.unapprovedCount;
        setActionMessage({
          type: 'confirmation',
          text: `Unapproved ${n} issue${n !== 1 ? 's' : ''} for ${user.displayName}.`,
        });
        await fetchReport();
      } else {
        setActionMessage({ type: 'error', text: result.error || 'Unapproval failed.' });
      }
    } catch (err) {
      setActionMessage({ type: 'error', text: err.message || 'Unexpected error.' });
    } finally {
      setActionLoading(prev => ({ ...prev, [user.accountId]: false }));
    }
  };

  // --- Loading state ---
  if (loading) return <Spinner size="large" />;

  // --- Access denied ---
  if (!isManager) {
    return (
      <Box padding="space.400">
        <SectionMessage appearance="warning">
          <Text>You do not have manager access. Contact your Jira administrator.</Text>
        </SectionMessage>
      </Box>
    );
  }

  // --- Build DynamicTable rows ---
  const head = {
    cells: [
      { key: 'user', content: 'User', width: 20 },
      { key: 'issues', content: 'Issues', width: 8 },
      { key: 'totalHours', content: 'Total Hours', width: 10 },
      { key: 'maxHours', content: 'Max Hours', width: 10 },
      { key: 'kupPct', content: 'KUP %', width: 8 },
      { key: 'status', content: 'Status', width: 12 },
      { key: 'action', content: 'Action', width: 12 },
    ],
  };

  const users = reportData?.users || [];
  const rows = [];

  for (const user of users) {
    const isExpanded = expandedRows.has(user.accountId);
    const isActioning = actionLoading[user.accountId];
    const kupPct = reportData?.maxWorkingHours > 0
      ? `${(user.totalHours / reportData.maxWorkingHours * 100).toFixed(1)}%`
      : '—';

    const lozengeAppearance = user.status === 'approved' ? 'success'
      : user.status === 'mixed' ? 'moved' : 'default';
    const lozengeLabel = user.status === 'approved' ? 'Approved'
      : user.status === 'mixed' ? 'Mixed' : 'Pending';

    // User summary row
    rows.push({
      key: `user-${user.accountId}`,
      cells: [
        {
          key: 'user',
          content: (
            <Button appearance="subtle" onClick={() => toggleExpand(user.accountId)}>
              {isExpanded ? '▾' : '▸'} {user.displayName}
            </Button>
          ),
        },
        { key: 'issues', content: <Text>{user.issueCount}</Text> },
        { key: 'totalHours', content: <Text>{user.totalHours}</Text> },
        { key: 'maxHours', content: <Text>{reportData?.maxWorkingHours ?? '—'}</Text> },
        { key: 'kupPct', content: <Text>{kupPct}</Text> },
        { key: 'status', content: <Lozenge appearance={lozengeAppearance}>{lozengeLabel}</Lozenge> },
        {
          key: 'action',
          content: user.status === 'approved'
            ? (
              <Button appearance="subtle" onClick={() => handleUnapprove(user)} isDisabled={isActioning}>
                {isActioning ? '...' : 'Unapprove'}
              </Button>
            )
            : (
              <Button appearance="primary" onClick={() => handleApprove(user)} isDisabled={isActioning}>
                {isActioning ? '...' : 'Approve'}
              </Button>
            ),
        },
      ],
    });

    // Issue detail rows (shown when expanded)
    if (isExpanded) {
      for (const issue of user.issues) {
        const issueLozengeAppearance = issue.status === 'approved' ? 'success' : 'default';
        const issueLozengeLabel = issue.status === 'approved' ? 'Approved' : 'Pending';
        rows.push({
          key: `issue-${user.accountId}-${issue.key}`,
          cells: [
            {
              key: 'user',
              content: (
                <Box paddingInlineStart="space.400">
                  <Link href={`/browse/${issue.key}`} openNewTab={true}>{issue.key}</Link>
                </Box>
              ),
            },
            { key: 'issues', content: <Text>{issue.summary}</Text> },
            { key: 'totalHours', content: <Text>{issue.hours}</Text> },
            { key: 'maxHours', content: <Text> </Text> },
            { key: 'kupPct', content: <Text> </Text> },
            { key: 'status', content: <Lozenge appearance={issueLozengeAppearance}>{issueLozengeLabel}</Lozenge> },
            { key: 'action', content: <Text> </Text> },
          ],
        });
      }
    }
  }

  // Determine empty state message
  let emptyView = 'No KUP hours logged for this month.';
  if (statusFilter.value === 'pending' && users.length === 0 && reportData) {
    emptyView = 'All KUP hours for this month have been approved.';
  }

  return (
    <Box padding="space.400">
      <Stack space="space.400">
        <Heading size="large">KUP Manager Approval</Heading>

        {/* Top controls */}
        <Inline space="space.300" alignBlock="end">
          <Stack space="space.050">
            <Label labelFor="month-select">Month</Label>
            <Select
              inputId="month-select"
              options={months}
              value={selectedMonth}
              onChange={setSelectedMonth}
              isClearable={false}
            />
          </Stack>
          <Stack space="space.050">
            <Label labelFor="status-filter">Status</Label>
            <Select
              inputId="status-filter"
              options={STATUS_FILTER_OPTIONS}
              value={statusFilter}
              onChange={setStatusFilter}
              isClearable={false}
            />
          </Stack>
          <Button onClick={fetchReport} isDisabled={fetchingReport}>Refresh</Button>
        </Inline>

        {/* Action feedback */}
        {actionMessage && (
          <SectionMessage appearance={actionMessage.type}>
            <Text>{actionMessage.text}</Text>
          </SectionMessage>
        )}

        {/* Report table */}
        {fetchingReport ? (
          <Spinner size="medium" />
        ) : (
          <DynamicTable
            head={head}
            rows={rows}
            emptyView={emptyView}
          />
        )}

        {/* Summary footer */}
        {!fetchingReport && reportData && users.length > 0 && (
          <Text>
            <Strong>{users.length}</Strong> user{users.length !== 1 ? 's' : ''} · Max working hours this month: <Strong>{reportData.maxWorkingHours ?? '—'}</Strong>
          </Text>
        )}
      </Stack>
    </Box>
  );
};

ForgeReconciler.render(<ManagerApprovalPage />);
