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

// ---------------------------------------------------------------------------
// My KUP Report view
// ---------------------------------------------------------------------------
const MyReportView = ({ months }) => {
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [fetching, setFetching] = useState(false);
  const [reportData, setReportData] = useState({ issues: [], totalHours: 0, maxWorkingHours: null });

  useEffect(() => {
    const d = new Date();
    const currentMonthString = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-KUP`;
    const defaultOption = months.find(o => o.value === currentMonthString) || months[0];
    if (defaultOption) setSelectedMonth(defaultOption);
  }, [months]);

  useEffect(() => {
    if (!selectedMonth) return;
    setFetching(true);
    invoke('getMyKupReport', { month: selectedMonth.value })
      .then(setReportData)
      .catch(() => setReportData({ issues: [], totalHours: 0 }))
      .finally(() => setFetching(false));
  }, [selectedMonth]);

  const head = {
    cells: [
      { key: 'issue', content: 'Issue Key' },
      { key: 'summary', content: 'Summary' },
      { key: 'hours', content: 'KUP Hours' },
    ],
  };

  const rows = reportData.issues.map((issue, i) => ({
    key: `row-${i}-${issue.key}`,
    cells: [
      { key: 'issue', content: <Link href={`/browse/${issue.key}`} openNewTab={true}>{issue.key}</Link> },
      { key: 'summary', content: <Text>{issue.summary}</Text> },
      { key: 'hours', content: <Text>{issue.hours}</Text> },
    ],
  }));

  return (
    <Stack space="space.300">
      <Box>
        <Label labelFor="my-month-select">Month</Label>
        <Select
          inputId="my-month-select"
          options={months}
          value={selectedMonth}
          onChange={setSelectedMonth}
          isClearable={false}
          isLoading={fetching}
        />
      </Box>

      {fetching ? (
        <Spinner size="medium" />
      ) : (
        <Stack space="space.200">
          <DynamicTable
            head={head}
            rows={rows}
            emptyView="You have zero KUP hours logged on assigned issues for this month."
          />
          <Inline space="space.400" alignBlock="center">
            <Text>Total KUP hours: <Strong>{reportData.totalHours}</Strong></Text>
            <Text>Max working hours: <Strong>{reportData.maxWorkingHours ?? '—'}</Strong></Text>
            <Text>KUP %: <Strong>
              {reportData.maxWorkingHours > 0
                ? `${Math.round((reportData.totalHours / reportData.maxWorkingHours) * 100)}%`
                : '—'}
            </Strong></Text>
          </Inline>
        </Stack>
      )}
    </Stack>
  );
};

// ---------------------------------------------------------------------------
// Manager Approval view
// ---------------------------------------------------------------------------
const ManagerApprovalView = ({ months }) => {
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [statusFilter, setStatusFilter] = useState(STATUS_FILTER_OPTIONS[0]);
  const [reportData, setReportData] = useState(null);
  const [fetching, setFetching] = useState(false);
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [actionMessage, setActionMessage] = useState(null);
  const [actionLoading, setActionLoading] = useState({});

  useEffect(() => {
    const d = new Date();
    const currentMonthString = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-KUP`;
    const defaultOption = months.find(o => o.value === currentMonthString) || months[0];
    if (defaultOption) setSelectedMonth(defaultOption);
  }, [months]);

  const fetchReport = useCallback(async () => {
    if (!selectedMonth) return;
    setFetching(true);
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
      setFetching(false);
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
        setActionMessage({ type: 'confirmation', text: `Approved ${n} issue${n !== 1 ? 's' : ''} for ${user.displayName}.` });
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
        setActionMessage({ type: 'confirmation', text: `Unapproved ${n} issue${n !== 1 ? 's' : ''} for ${user.displayName}.` });
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
            ? <Button appearance="subtle" onClick={() => handleUnapprove(user)} isDisabled={isActioning}>{isActioning ? '...' : 'Unapprove'}</Button>
            : <Button appearance="primary" onClick={() => handleApprove(user)} isDisabled={isActioning}>{isActioning ? '...' : 'Approve'}</Button>,
        },
      ],
    });

    if (isExpanded) {
      for (const issue of user.issues) {
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
            { key: 'status', content: <Lozenge appearance={issue.status === 'approved' ? 'success' : 'default'}>{issue.status === 'approved' ? 'Approved' : 'Pending'}</Lozenge> },
            { key: 'action', content: <Text> </Text> },
          ],
        });
      }
    }
  }

  let emptyView = 'No KUP hours logged for this month.';
  if (statusFilter.value === 'pending' && users.length === 0 && reportData) {
    emptyView = 'All KUP hours for this month have been approved.';
  }

  return (
    <Stack space="space.300">
      {/* Controls */}
      <Inline space="space.300" alignBlock="end">
        <Stack space="space.050">
          <Label labelFor="mgr-month-select">Month</Label>
          <Select
            inputId="mgr-month-select"
            options={months}
            value={selectedMonth}
            onChange={setSelectedMonth}
            isClearable={false}
          />
        </Stack>
        <Stack space="space.050">
          <Label labelFor="mgr-status-filter">Status</Label>
          <Select
            inputId="mgr-status-filter"
            options={STATUS_FILTER_OPTIONS}
            value={statusFilter}
            onChange={setStatusFilter}
            isClearable={false}
          />
        </Stack>
        <Button onClick={fetchReport} isDisabled={fetching}>Refresh</Button>
      </Inline>

      {actionMessage && (
        <SectionMessage appearance={actionMessage.type}>
          <Text>{actionMessage.text}</Text>
        </SectionMessage>
      )}

      {fetching ? (
        <Spinner size="medium" />
      ) : (
        <DynamicTable head={head} rows={rows} emptyView={emptyView} />
      )}

      {!fetching && reportData && users.length > 0 && (
        <Text>
          <Strong>{users.length}</Strong> user{users.length !== 1 ? 's' : ''} · Max working hours this month: <Strong>{reportData.maxWorkingHours ?? '—'}</Strong>
        </Text>
      )}
    </Stack>
  );
};

// ---------------------------------------------------------------------------
// Root page — tab switcher for managers, report-only for others
// ---------------------------------------------------------------------------
const TABS = ['My Report', 'Manager Approval'];

const KupGlobalPage = () => {
  const [loading, setLoading] = useState(true);
  const [isManager, setIsManager] = useState(false);
  const [months, setMonths] = useState([]);
  const [activeTab, setActiveTab] = useState('My Report');

  useEffect(() => {
    async function init() {
      try {
        const [roleResult, availableMonths] = await Promise.all([
          invoke('getCurrentUserRole'),
          invoke('getAvailableMonths'),
        ]);
        setIsManager(roleResult.isManager === true);
        setMonths(availableMonths.map(m => ({ label: m, value: m })));
      } catch (err) {
        console.error('Failed to initialize KUP page', err);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  if (loading) return <Spinner size="large" />;

  return (
    <Box padding="space.400">
      <Stack space="space.400">
        <Heading size="large">KUP Compliance</Heading>

        {/* Tab bar — only shown to managers */}
        {isManager && (
          <Inline space="space.200">
            {TABS.map(tab => (
              <Button
                key={tab}
                appearance={activeTab === tab ? 'primary' : 'subtle'}
                onClick={() => setActiveTab(tab)}
              >
                {tab}
              </Button>
            ))}
          </Inline>
        )}

        {/* Tab content */}
        {activeTab === 'My Report' && <MyReportView months={months} />}
        {activeTab === 'Manager Approval' && isManager && <ManagerApprovalView months={months} />}
      </Stack>
    </Box>
  );
};

ForgeReconciler.render(<KupGlobalPage />);
