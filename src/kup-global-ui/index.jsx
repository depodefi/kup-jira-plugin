import React, { useEffect, useMemo, useState, useCallback } from 'react';
import ForgeReconciler, {
  Box, Stack, Inline, Heading, Select, DynamicTable, Spinner,
  Text, Strong, Button, SectionMessage, Lozenge, Link, Label, UserPicker, Textfield,
} from '@forge/react';
import { invoke } from '@forge/bridge';

// ---------------------------------------------------------------------------
// Helpers shared across views
// ---------------------------------------------------------------------------
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// "2026-05-KUP" -> "May 2026"
const formatMonthLabel = (raw) => {
  if (!raw) return '';
  const [y, m] = raw.split('-');
  const idx = Number(m) - 1;
  if (idx < 0 || idx > 11) return raw;
  return `${MONTH_NAMES[idx]} ${y}`;
};

const toMonthOptions = (months) =>
  months.map(m => ({ label: formatMonthLabel(m.value), value: m.value }));

const currentMonthDefault = (months) => {
  const d = new Date();
  const currentMonthString = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-KUP`;
  return months.find(o => o.value === currentMonthString) || months[0];
};

// Lozenge appearance + label from adjusted KUP %.
const computeStatus = (pct, cap) => {
  if (pct == null || isNaN(pct)) return { appearance: 'default', label: 'No data' };
  if (cap > 0 && pct > cap) return { appearance: 'removed', label: 'Over limit' };
  if (cap > 0 && pct > cap * 0.9) return { appearance: 'moved', label: 'Approaching limit' };
  if (pct < 1) return { appearance: 'default', label: 'No activity' };
  return { appearance: 'success', label: 'On track' };
};

// Tinted stat card built from Box primitives — UI Kit has no card component.
// flexGrow + width make sibling cards share an Inline row at equal widths.
const StatCard = ({ label, value, suffix, footer, backgroundColor = 'color.background.neutral' }) => (
  <Box padding="space.200" backgroundColor={backgroundColor} xcss={{ borderRadius: 'radius.small', flexGrow: 1, width: '100%' }}>
    <Stack space="space.100">
      <Text size="small" weight="bold" color="color.text.subtlest">{label}</Text>
      <Inline space="space.050" alignBlock="baseline">
        <Heading size="large">{value}</Heading>
        {suffix && <Text size="medium" color="color.text.subtle">{suffix}</Text>}
      </Inline>
      <Box>{footer}</Box>
    </Stack>
  </Box>
);

// Browser download from a base64 payload (same pattern as the payroll export).
const triggerDownload = (base64Data, filename, mimeType) => {
  const bytes = atob(base64Data);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  const blob = new Blob([arr], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

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

  const [absenceHours, setAbsenceHours] = useState('0');
  const [overtimeHours, setOvertimeHours] = useState('0');
  const [adjustmentSaving, setAdjustmentSaving] = useState(false);
  const [adjustmentMessage, setAdjustmentMessage] = useState(null); // { type, text }

  useEffect(() => {
    const defaultOption = currentMonthDefault(months);
    if (defaultOption) setSelectedMonth(defaultOption);
  }, [months]);

  useEffect(() => {
    if (!selectedMonth) return;
    setFetching(true);
    setAdjustmentMessage(null);
    Promise.all([
      invoke('getMyKupReport', { month: selectedMonth.value }),
      invoke('getMyAdjustment', { month: selectedMonth.value }),
    ]).then(([report, adjustment]) => {
      setReportData(report);
      setAbsenceHours(String(adjustment.absenceHours ?? 0));
      setOvertimeHours(String(adjustment.overtimeHours ?? 0));
    }).catch(() => {
      setReportData({ issues: [], totalHours: 0 });
    }).finally(() => setFetching(false));
  }, [selectedMonth]);

  const handleSaveAdjustment = async () => {
    const absence = parseFloat(absenceHours) || 0;
    const overtime = parseFloat(overtimeHours) || 0;

    if (absence < 0 || overtime < 0) {
      setAdjustmentMessage({ type: 'error', text: 'Hours cannot be negative.' });
      return;
    }
    if (reportData.maxWorkingHours != null && absence > reportData.maxWorkingHours) {
      setAdjustmentMessage({ type: 'warning', text: `Absence hours cannot exceed max working hours (${reportData.maxWorkingHours}).` });
      return;
    }

    setAdjustmentSaving(true);
    setAdjustmentMessage(null);
    try {
      const result = await invoke('saveMyAdjustment', {
        month: selectedMonth.value,
        absenceHours: absence,
        overtimeHours: overtime,
      });
      if (result.success) {
        setAdjustmentMessage({ type: 'confirmation', text: 'Adjustment saved.' });
      } else {
        setAdjustmentMessage({ type: 'error', text: result.error || 'Save failed.' });
      }
    } catch (err) {
      setAdjustmentMessage({ type: 'error', text: err.message || 'Unexpected error.' });
    } finally {
      setAdjustmentSaving(false);
    }
  };

  const isLocked = reportData.hasApprovedIssues === true;

  // Live-preview adjusted KUP %
  const absence = parseFloat(absenceHours) || 0;
  const overtime = parseFloat(overtimeHours) || 0;
  const maxWorking = reportData.maxWorkingHours ?? 0;
  const adjustedBase = maxWorking - absence + overtime;
  const hasAdjustment = absence !== 0 || overtime !== 0;
  const effectiveBase = hasAdjustment ? adjustedBase : maxWorking;
  const kupPctNum = effectiveBase > 0 ? reportData.totalHours / effectiveBase * 100 : null;

  // KUP limit warning for employee
  const maxKupPercent = reportData.maxKupPercent;
  const kupLimitEnforcement = reportData.kupLimitEnforcement;
  const isOverLimit = maxKupPercent && kupPctNum !== null && kupPctNum > maxKupPercent;
  const maxKupHours = maxKupPercent && effectiveBase > 0 ? effectiveBase * (maxKupPercent / 100) : null;
  const remainingHours = maxKupHours !== null ? (maxKupHours - reportData.totalHours).toFixed(1) : null;
  const status = computeStatus(kupPctNum, maxKupPercent || 0);

  const sortedIssues = useMemo(
    () => [...(reportData.issues || [])].sort((a, b) => b.hours - a.hours),
    [reportData.issues]
  );

  const issueCount = reportData.issues?.length || 0;
  const baseFooter = hasAdjustment ? (
    <Text size="small" color="color.text.subtlest">
      {maxWorking}h max − {absence}h absence{overtime > 0 ? ` + ${overtime}h overtime` : ''}
    </Text>
  ) : (
    <Text size="small" color="color.text.subtlest">
      {selectedMonth ? formatMonthLabel(selectedMonth.value) : ''}
    </Text>
  );

  const pctFooter = kupPctNum != null
    ? <Lozenge appearance={status.appearance}>{status.label}</Lozenge>
    : <Text size="small" color="color.text.subtlest">No working hours set</Text>;

  const head = {
    cells: [
      { key: 'issue', content: 'Issue Key' },
      { key: 'summary', content: 'Summary' },
      { key: 'hours', content: 'KUP Hours' },
    ],
  };

  const rows = sortedIssues.map((issue, i) => ({
    key: `row-${i}-${issue.key}`,
    cells: [
      { key: 'issue', content: <Link href={`/browse/${issue.key}`} openNewTab={true}>{issue.key}</Link> },
      { key: 'summary', content: <Text>{issue.summary}</Text> },
      { key: 'hours', content: <Strong>{issue.hours}</Strong> },
    ],
  }));

  return (
    <Stack space="space.300">
      <Box xcss={{ maxWidth: '320px' }}>
        <Stack space="space.050">
          <Label labelFor="my-month-select">Month</Label>
          <Select
            inputId="my-month-select"
            options={toMonthOptions(months)}
            value={selectedMonth ? { label: formatMonthLabel(selectedMonth.value), value: selectedMonth.value } : null}
            onChange={setSelectedMonth}
            isClearable={false}
            isLoading={fetching}
          />
        </Stack>
      </Box>

      {fetching ? (
        <Spinner size="medium" />
      ) : (
        <Stack space="space.300">
          {/* Hours adjustment — placed first so the values feed forward
              into the KPI cards below. */}
          <Box padding="space.250" backgroundColor="color.background.neutral" xcss={{ borderRadius: 'radius.small' }}>
            <Stack space="space.200">
              <Inline spread="space-between" alignBlock="center">
                <Heading size="small">Hours adjustment</Heading>
                <Text size="small" color="color.text.subtle">
                  Claim absence to reduce your base, or overtime to raise it.
                </Text>
              </Inline>

              {isLocked && (
                <SectionMessage appearance="information">
                  <Text>Adjustments are locked — your hours for this month have been approved. Contact your manager to unapprove first.</Text>
                </SectionMessage>
              )}

              <Inline space="space.200" alignBlock="end">
                <Stack space="space.050">
                  <Label labelFor="absence-hours">Absence hours this month</Label>
                  <Textfield
                    id="absence-hours"
                    name="absence-hours"
                    value={absenceHours}
                    onChange={e => !isLocked && setAbsenceHours(e.target.value)}
                    type="number"
                    min="0"
                    isDisabled={isLocked}
                  />
                </Stack>
                <Stack space="space.050">
                  <Label labelFor="overtime-hours">Overtime hours this month</Label>
                  <Textfield
                    id="overtime-hours"
                    name="overtime-hours"
                    value={overtimeHours}
                    onChange={e => !isLocked && setOvertimeHours(e.target.value)}
                    type="number"
                    min="0"
                    isDisabled={isLocked}
                  />
                </Stack>
                <Button appearance="primary" onClick={handleSaveAdjustment} isDisabled={adjustmentSaving || isLocked}>
                  {adjustmentSaving ? 'Saving...' : 'Save adjustment'}
                </Button>
              </Inline>

              {adjustmentMessage && (
                <SectionMessage appearance={adjustmentMessage.type}>
                  <Text>{adjustmentMessage.text}</Text>
                </SectionMessage>
              )}
            </Stack>
          </Box>

          {/* Three KPI cards */}
          <Inline space="space.200" alignBlock="stretch">
            <StatCard
              label="KUP HOURS"
              value={reportData.totalHours ?? 0}
              suffix="h"
              footer={
                <Text size="small" color="color.text.subtlest">
                  across {issueCount} issue{issueCount === 1 ? '' : 's'}
                </Text>
              }
            />
            <StatCard
              label={hasAdjustment ? 'EFFECTIVE BASE' : 'MAX WORKING HOURS'}
              value={hasAdjustment
                ? (adjustedBase > 0 ? adjustedBase : 'N/A')
                : (maxWorking || '—')}
              suffix={maxWorking ? 'h' : undefined}
              footer={baseFooter}
            />
            <StatCard
              label="KUP %"
              value={kupPctNum != null ? kupPctNum.toFixed(1) : '—'}
              suffix={kupPctNum != null ? '%' : undefined}
              footer={pctFooter}
            />
          </Inline>

          {/* KUP limit warning */}
          {isOverLimit && (
            <SectionMessage appearance="warning">
              <Text>
                {kupLimitEnforcement === 'block'
                  ? `Your KUP is ${kupPctNum.toFixed(1)}%, which exceeds the company limit of ${maxKupPercent}%. Your manager will not be able to approve your hours until this is resolved. You have ${remainingHours} KUP hours remaining.`
                  : `Your KUP is ${kupPctNum.toFixed(1)}%, which exceeds the company limit of ${maxKupPercent}%. Your manager will see a warning when reviewing your hours.`}
              </Text>
            </SectionMessage>
          )}

          {/* Issues table */}
          <Stack space="space.100">
            <Heading size="small">Issues</Heading>
            <DynamicTable
              head={head}
              rows={rows}
              emptyView="You have zero KUP hours logged on assigned issues for this month."
            />
          </Stack>
        </Stack>
      )}
    </Stack>
  );
};

// ---------------------------------------------------------------------------
// Manager Approval view
// ---------------------------------------------------------------------------
const ALL_GROUPS_OPTION = { label: 'All users', value: null };
const EXPORT_FORMAT_OPTIONS = [
  { label: 'Excel (.xlsx)', value: 'xlsx' },
  { label: 'CSV (.csv)', value: 'csv' },
];

const ManagerApprovalView = ({ months }) => {
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [statusFilter, setStatusFilter] = useState(STATUS_FILTER_OPTIONS[0]);
  const [reportData, setReportData] = useState(null);
  const [fetching, setFetching] = useState(false);
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [actionMessage, setActionMessage] = useState(null);
  const [actionLoading, setActionLoading] = useState({});

  // Export state
  const [exportFormat, setExportFormat] = useState(EXPORT_FORMAT_OPTIONS[0]);
  const [exportStatus, setExportStatus] = useState(null); // null | 'processing' | 'ready' | 'error' | 'timeout'
  const [exportResult, setExportResult] = useState(null);
  const [exportErrorMsg, setExportErrorMsg] = useState(null);

  // Adjustments (second pass)
  const [adjustmentsMap, setAdjustmentsMap] = useState({});
  const [fetchingAdjustments, setFetchingAdjustments] = useState(false);

  // Group filter
  const [jiraGroups, setJiraGroups] = useState([]);
  const [groupFilter, setGroupFilter] = useState(ALL_GROUPS_OPTION);

  // My Team filter
  const [myTeamActive, setMyTeamActive] = useState(false);
  const [teamMembers, setTeamMembers] = useState([]); // array of accountId strings
  const [showTeamEditor, setShowTeamEditor] = useState(false);
  const [newMember, setNewMember] = useState(null);   // accountId from UserPicker
  const [teamSaving, setTeamSaving] = useState(false);

  // Default month and load groups + team on mount
  useEffect(() => {
    const defaultOption = currentMonthDefault(months);
    if (defaultOption) setSelectedMonth(defaultOption);

    Promise.all([
      invoke('getJiraGroups'),
      invoke('getManagerTeam'),
    ]).then(([groups, team]) => {
      setJiraGroups([ALL_GROUPS_OPTION, ...groups.map(g => ({ label: g.name, value: g.groupId }))]);
      // Normalize members — storage may contain raw UserPicker objects, plain strings,
      // or our canonical { accountId, displayName } format from different versions.
      const normalized = (team.members || []).map(m => {
        if (typeof m === 'string') return { accountId: m, displayName: m };
        return {
          accountId: m.accountId || m.id || null,
          displayName: m.displayName || m.name || m.accountId || m.id || 'Unknown',
        };
      });
      setTeamMembers(normalized);
    }).catch(err => console.error('Failed to load groups/team', err));
  }, [months]);

  const fetchAdjustments = useCallback(async (month) => {
    if (!month) return;
    setFetchingAdjustments(true);
    try {
      const data = await invoke('getAdjustmentsForMonth', { month });
      setAdjustmentsMap(data.adjustments || {});
    } catch (err) {
      console.error('Failed to fetch adjustments', err);
    } finally {
      setFetchingAdjustments(false);
    }
  }, []);

  const fetchReport = useCallback(async () => {
    if (!selectedMonth) return;
    setFetching(true);
    setActionMessage(null);
    try {
      const params = {
        month: selectedMonth.value,
        statusFilter: statusFilter.value,
      };
      if (groupFilter.value) params.groupId = groupFilter.value;
      if (myTeamActive) params.teamFilter = true;

      const data = await invoke('getManagerReport', params);
      setReportData(data.error ? null : data);
    } catch (err) {
      console.error('Failed to fetch manager report', err);
      setReportData(null);
    } finally {
      setFetching(false);
    }
  }, [selectedMonth, statusFilter, groupFilter, myTeamActive]);

  // First pass: fetch report on filter change
  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  // Second pass: fetch adjustments when month changes (independent of filters)
  useEffect(() => {
    if (!selectedMonth) return;
    setAdjustmentsMap({});
    fetchAdjustments(selectedMonth.value);
  }, [selectedMonth, fetchAdjustments]);

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
        const text = result.warning
          ? `Approved ${n} issue${n !== 1 ? 's' : ''} for ${user.displayName}. ⚠ ${result.warning}`
          : `Approved ${n} issue${n !== 1 ? 's' : ''} for ${user.displayName}.`;
        setActionMessage({ type: result.warning ? 'warning' : 'confirmation', text });
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

  const handleAddTeamMember = () => {
    if (!newMember) return;
    const accountId = typeof newMember === 'object'
      ? (newMember.accountId || newMember.id || newMember.value)
      : newMember;
    const displayName = typeof newMember === 'object'
      ? (newMember.name || newMember.displayName || accountId)
      : newMember;
    if (teamMembers.some(m => m.accountId === accountId)) return;
    setTeamMembers(prev => [...prev, { accountId, displayName }]);
    setNewMember(null);
  };

  const handleRemoveTeamMember = (accountId) => {
    setTeamMembers(prev => prev.filter(m => m.accountId !== accountId));
  };

  const handleSaveTeam = async () => {
    setTeamSaving(true);
    try {
      await invoke('saveManagerTeam', { members: teamMembers });
      setShowTeamEditor(false);
      // If My Team filter is active, refresh the report with updated team
      if (myTeamActive) await fetchReport();
    } catch (err) {
      console.error('Failed to save team', err);
    } finally {
      setTeamSaving(false);
    }
  };

  const handleExport = async () => {
    if (!selectedMonth) return;
    setExportStatus('processing');
    setExportResult(null);
    setExportErrorMsg(null);

    try {
      const result = await invoke('requestPayrollExport', {
        month: selectedMonth.value,
        format: exportFormat.value,
      });

      if (result.error) {
        setExportStatus('error');
        setExportErrorMsg(result.error);
        return;
      }

      const startTime = Date.now();
      const TIMEOUT_MS = 60000;
      const POLL_INTERVAL_MS = 3000;

      const poll = async () => {
        if (Date.now() - startTime >= TIMEOUT_MS) {
          setExportStatus('timeout');
          return;
        }

        try {
          const statusResult = await invoke('getExportStatus', { month: selectedMonth.value });
          if (statusResult.status === 'ready') {
            setExportResult(statusResult);
            setExportStatus('ready');
          } else if (statusResult.status === 'error') {
            setExportStatus('error');
            setExportErrorMsg(statusResult.message || 'Export failed.');
          } else {
            setTimeout(poll, POLL_INTERVAL_MS);
          }
        } catch (err) {
          setExportStatus('error');
          setExportErrorMsg(err.message || 'Polling failed.');
        }
      };

      setTimeout(poll, POLL_INTERVAL_MS);
    } catch (err) {
      setExportStatus('error');
      setExportErrorMsg(err.message || 'Unexpected error.');
    }
  };

  const maxH = reportData?.maxWorkingHours;
  const mgrMaxKupPercent = reportData?.maxKupPercent;
  const mgrEnforcement = reportData?.kupLimitEnforcement ?? 'warn';

  // Adjusted KUP % for a user — shared by the table rows and the summary strip.
  const computeUserPct = (user) => {
    if (!(maxH > 0)) return null;
    const adj = adjustmentsMap[user.accountId];
    const base = adj ? maxH - (adj.absenceHours ?? 0) + (adj.overtimeHours ?? 0) : maxH;
    return base > 0 ? user.totalHours / base * 100 : null;
  };

  const users = reportData?.users || [];

  // Summary strip metrics
  const approvedCount = users.filter(u => u.status === 'approved').length;
  const pendingCount = users.length - approvedCount;
  const overLimitCount = mgrMaxKupPercent
    ? users.filter(u => {
        const pct = computeUserPct(u);
        return pct !== null && pct > mgrMaxKupPercent;
      }).length
    : 0;
  const totalHoursAll = users.reduce((s, u) => s + (u.totalHours || 0), 0);

  const head = {
    cells: [
      { key: 'user', content: 'User', width: 18 },
      { key: 'issues', content: 'Issues', width: 6 },
      { key: 'totalHours', content: 'KUP Hours', width: 9 },
      { key: 'maxHours', content: 'Max Hours', width: 9 },
      { key: 'absence', content: 'Absence', width: 8 },
      { key: 'overtime', content: 'Overtime', width: 8 },
      { key: 'kupPct', content: 'KUP %', width: 8 },
      { key: 'status', content: 'Status', width: 10 },
      { key: 'action', content: 'Action', width: 10 },
    ],
  };

  const rows = [];

  for (const user of users) {
    const isExpanded = expandedRows.has(user.accountId);
    const isActioning = actionLoading[user.accountId];
    const adj = adjustmentsMap[user.accountId];
    const absenceH = adj?.absenceHours ?? null;
    const overtimeH = adj?.overtimeHours ?? null;

    const kupPctNum = computeUserPct(user);
    let kupPct = '—';
    if (maxH > 0) {
      if (kupPctNum !== null) {
        kupPct = !adj && fetchingAdjustments ? '…' : `${kupPctNum.toFixed(1)}%`;
      } else {
        kupPct = 'N/A';
      }
    }

    const userOverLimit = mgrMaxKupPercent && kupPctNum !== null && kupPctNum > mgrMaxKupPercent;
    const approveBlocked = userOverLimit && mgrEnforcement === 'block';

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
        { key: 'totalHours', content: <Strong>{user.totalHours}</Strong> },
        { key: 'maxHours', content: <Text>{maxH ?? '—'}</Text> },
        { key: 'absence', content: <Text>{absenceH !== null ? absenceH : '—'}</Text> },
        { key: 'overtime', content: <Text>{overtimeH !== null ? overtimeH : '—'}</Text> },
        { key: 'kupPct', content: <Text>{kupPct}</Text> },
        {
          key: 'status',
          content: (
            <Inline space="space.100">
              <Lozenge appearance={lozengeAppearance}>{lozengeLabel}</Lozenge>
              {userOverLimit && <Lozenge appearance="removed">Over limit</Lozenge>}
            </Inline>
          ),
        },
        {
          key: 'action',
          content: user.status === 'approved'
            ? <Button appearance="subtle" onClick={() => handleUnapprove(user)} isDisabled={isActioning}>{isActioning ? '...' : 'Unapprove'}</Button>
            : <Button appearance="primary" onClick={() => handleApprove(user)} isDisabled={isActioning || approveBlocked}>
                {isActioning ? '...' : approveBlocked ? `Blocked (${kupPct})` : 'Approve'}
              </Button>,
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
            { key: 'absence', content: <Text> </Text> },
            { key: 'overtime', content: <Text> </Text> },
            { key: 'kupPct', content: <Text> </Text> },
            { key: 'status', content: <Lozenge appearance={issue.status === 'approved' ? 'success' : 'default'}>{issue.status === 'approved' ? 'Approved' : 'Pending'}</Lozenge> },
            { key: 'action', content: <Text> </Text> },
          ],
        });
      }
    }
  }

  const filtersActive = groupFilter.value || myTeamActive;
  let emptyView = filtersActive
    ? 'No users match your current filters for this month.'
    : 'No KUP hours logged for this month.';
  if (!filtersActive && statusFilter.value === 'pending' && users.length === 0 && reportData) {
    emptyView = 'All KUP hours for this month have been approved.';
  }

  return (
    <Stack space="space.300">
      {/* Filter row — controls left, team management right */}
      <Inline spread="space-between" alignBlock="end">
        <Inline space="space.200" alignBlock="end">
          <Stack space="space.050">
            <Label labelFor="mgr-month-select">Month</Label>
            <Select
              inputId="mgr-month-select"
              options={toMonthOptions(months)}
              value={selectedMonth ? { label: formatMonthLabel(selectedMonth.value), value: selectedMonth.value } : null}
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
          <Stack space="space.050">
            <Label labelFor="mgr-group-filter">Jira group</Label>
            <Select
              inputId="mgr-group-filter"
              options={jiraGroups}
              value={groupFilter}
              onChange={setGroupFilter}
              isClearable={false}
            />
          </Stack>
          <Button
            appearance={myTeamActive ? 'primary' : 'default'}
            onClick={() => setMyTeamActive(a => !a)}
          >
            {myTeamActive ? 'My Team ✓' : 'My Team'}
          </Button>
          <Button onClick={fetchReport} isDisabled={fetching}>Refresh</Button>
        </Inline>
        <Button appearance="subtle" onClick={() => setShowTeamEditor(e => !e)}>
          {showTeamEditor ? 'Hide team editor' : 'Manage my team'}
        </Button>
      </Inline>

      {myTeamActive && teamMembers.length === 0 && (
        <Text>Your team is empty — add members below to use this filter.</Text>
      )}

      {/* Team editor panel */}
      {showTeamEditor && (
        <Box padding="space.250" backgroundColor="color.background.neutral" xcss={{ borderRadius: 'radius.small' }}>
          <Stack space="space.200">
            <Heading size="small">My Team</Heading>

            {/* Add member */}
            <Inline space="space.200" alignBlock="end">
              <Stack space="space.050">
                <Label labelFor="team-user-picker">Add member</Label>
                <UserPicker
                  name="team-user-picker"
                  value={newMember}
                  onChange={setNewMember}
                />
              </Stack>
              <Button onClick={handleAddTeamMember} isDisabled={!newMember}>Add</Button>
            </Inline>

            {/* Current members list */}
            {teamMembers.length === 0 ? (
              <Text>No team members yet.</Text>
            ) : (
              <Stack space="space.100">
                {teamMembers.map(member => (
                  <Inline key={member.accountId} space="space.200" alignBlock="center">
                    <Text><Strong>{member.displayName}</Strong></Text>
                    <Button appearance="subtle" onClick={() => handleRemoveTeamMember(member.accountId)}>Remove</Button>
                  </Inline>
                ))}
              </Stack>
            )}

            <Button appearance="primary" onClick={handleSaveTeam} isDisabled={teamSaving}>
              {teamSaving ? 'Saving...' : 'Save Team'}
            </Button>
          </Stack>
        </Box>
      )}

      {/* Summary strip */}
      {!fetching && reportData && (
        <Inline space="space.200" alignBlock="stretch">
          <StatCard
            label="USERS"
            value={users.length}
            footer={<Text size="small" color="color.text.subtlest">in current view</Text>}
          />
          <StatCard
            label="APPROVED"
            value={approvedCount}
            footer={<Text size="small" color="color.text.subtlest">fully approved</Text>}
          />
          <StatCard
            label="PENDING"
            value={pendingCount}
            footer={<Text size="small" color="color.text.subtlest">awaiting review</Text>}
          />
          <StatCard
            label="OVER LIMIT"
            value={overLimitCount}
            backgroundColor={overLimitCount > 0 ? 'color.background.danger' : 'color.background.neutral'}
            footer={
              <Text size="small" color="color.text.subtlest">
                {mgrMaxKupPercent ? `${mgrMaxKupPercent}% cap` : 'no cap set'}
              </Text>
            }
          />
        </Inline>
      )}

      {/* Action feedback */}
      {actionMessage && (
        <SectionMessage appearance={actionMessage.type}>
          <Text>{actionMessage.text}</Text>
        </SectionMessage>
      )}

      {/* Report table */}
      {fetching ? (
        <Spinner size="medium" />
      ) : (
        <DynamicTable head={head} rows={rows} emptyView={emptyView} />
      )}

      {!fetching && reportData && users.length > 0 && (
        <Text size="small" color="color.text.subtlest">
          <Strong>{users.length}</Strong> user{users.length !== 1 ? 's' : ''} · <Strong>{totalHoursAll}h</Strong> total logged · max working hours this month: <Strong>{maxH ?? '—'}</Strong>
        </Text>
      )}

      {/* Payroll export */}
      <Box padding="space.250" backgroundColor="color.background.neutral" xcss={{ borderRadius: 'radius.small' }}>
        <Stack space="space.200">
          <Inline spread="space-between" alignBlock="center">
            <Heading size="small">Export Payroll Summary</Heading>
            <Text size="small" color="color.text.subtle">
              One row per employee with KUP hours, for accounting.
            </Text>
          </Inline>
          <Inline space="space.200" alignBlock="end">
            <Stack space="space.050">
              <Label labelFor="export-format-select">Format</Label>
              <Select
                inputId="export-format-select"
                options={EXPORT_FORMAT_OPTIONS}
                value={exportFormat}
                onChange={v => { setExportFormat(v); setExportStatus(null); setExportResult(null); }}
                isClearable={false}
              />
            </Stack>
            <Button
              appearance="default"
              onClick={handleExport}
              isDisabled={!selectedMonth || exportStatus === 'processing'}
            >
              {exportStatus === 'processing' ? 'Generating...' : 'Generate Export'}
            </Button>
            {exportStatus === 'processing' && <Spinner size="small" />}
          </Inline>

          {exportStatus === 'ready' && exportResult && (
            <SectionMessage appearance="confirmation">
              <Inline space="space.200" alignBlock="center">
                <Text>Export ready.</Text>
                <Button
                  appearance="primary"
                  onClick={() => triggerDownload(
                    exportResult.data,
                    exportResult.filename,
                    exportResult.format === 'xlsx'
                      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                      : 'text/csv;charset=utf-8'
                  )}
                >
                  Download {exportResult.filename}
                </Button>
              </Inline>
            </SectionMessage>
          )}

          {exportStatus === 'error' && (
            <SectionMessage appearance="error">
              <Text>Export failed: {exportErrorMsg}</Text>
            </SectionMessage>
          )}

          {exportStatus === 'timeout' && (
            <SectionMessage appearance="warning">
              <Text>Export timed out after 60 seconds. Please try again or contact your administrator.</Text>
            </SectionMessage>
          )}
        </Stack>
      </Box>

      {/* Unassigned issues */}
      {!fetching && reportData?.unassignedIssues?.length > 0 && (
        <Stack space="space.200">
          <Heading size="small">Unassigned Issues ({reportData.unassignedIssues.length})</Heading>
          <SectionMessage appearance="warning">
            <Text>These issues have KUP hours logged but no assignee. Ping someone to claim them.</Text>
          </SectionMessage>
          <DynamicTable
            head={{ cells: [
              { key: 'key', content: 'Issue', width: 15 },
              { key: 'summary', content: 'Summary', width: 60 },
              { key: 'hours', content: 'KUP Hours', width: 15 },
            ]}}
            rows={reportData.unassignedIssues.map(issue => ({
              key: issue.key,
              cells: [
                { key: 'key', content: <Link href={`/browse/${issue.key}`} openNewTab={true}>{issue.key}</Link> },
                { key: 'summary', content: <Text>{issue.summary}</Text> },
                { key: 'hours', content: <Text>{issue.hours}</Text> },
              ],
            }))}
          />
        </Stack>
      )}
    </Stack>
  );
};

// ---------------------------------------------------------------------------
// Audit Log view
// ---------------------------------------------------------------------------
const MAX_ISSUE_CHIPS = 4;

// "2026-05-14T10:32:00Z" -> "2026-05-14 · 10:32"
const formatAuditDate = (iso) => {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd} · ${hh}:${mi}`;
};

const AuditLogView = ({ months }) => {
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [fetching, setFetching] = useState(false);
  const [entries, setEntries] = useState([]);

  useEffect(() => {
    const defaultOption = currentMonthDefault(months);
    if (defaultOption) setSelectedMonth(defaultOption);
  }, [months]);

  useEffect(() => {
    if (!selectedMonth) return;
    setFetching(true);
    invoke('getApprovalAuditLog', { month: selectedMonth.value })
      .then(data => setEntries(data.entries || []))
      .catch(() => setEntries([]))
      .finally(() => setFetching(false));
  }, [selectedMonth]);

  // Summary strip metrics
  const approvals = entries.filter(e => e.action === 'approval').length;
  const unapprovals = entries.length - approvals;
  const uniqueManagers = new Set(entries.map(e => e.managerName)).size;
  const uniqueEmployees = new Set(entries.map(e => e.targetUserName)).size;

  const handleExportCsv = () => {
    const headers = ['Date / Time', 'Manager', 'Action', 'Employee', 'Issue Count', 'Issue Keys'];
    const csvRows = entries.map(e => [
      formatAuditDate(e.timestamp),
      e.managerName,
      e.action === 'approval' ? 'Approved' : 'Unapproved',
      e.targetUserName,
      e.issueCount,
      (e.issueKeys || []).join(' '),
    ]);
    const csvText = [headers, ...csvRows].map(row =>
      row.map(cell => {
        const str = String(cell ?? '');
        return (str.includes(',') || str.includes('"') || str.includes('\n'))
          ? `"${str.replace(/"/g, '""')}"`
          : str;
      }).join(',')
    ).join('\r\n');
    // UTF-8 BOM so Excel renders Polish characters correctly
    const base64 = btoa(unescape(encodeURIComponent('\uFEFF' + csvText)));
    triggerDownload(base64, `KUP_Audit_${selectedMonth.value}.csv`, 'text/csv;charset=utf-8');
  };

  const head = {
    cells: [
      { key: 'timestamp', content: 'Date / Time', width: 16 },
      { key: 'manager', content: 'Manager', width: 16 },
      { key: 'action', content: 'Action', width: 10 },
      { key: 'employee', content: 'Employee', width: 16 },
      { key: 'issues', content: 'Issues', width: 42 },
    ],
  };

  const rows = entries.map((entry, i) => {
    const actionAppearance = entry.action === 'approval' ? 'success' : 'default';
    const actionLabel = entry.action === 'approval' ? 'Approved' : 'Unapproved';
    const issueKeys = entry.issueKeys || [];

    return {
      key: `audit-${i}`,
      cells: [
        { key: 'timestamp', content: <Text color="color.text.subtle">{formatAuditDate(entry.timestamp)}</Text> },
        { key: 'manager', content: <Strong>{entry.managerName}</Strong> },
        { key: 'action', content: <Lozenge appearance={actionAppearance}>{actionLabel}</Lozenge> },
        { key: 'employee', content: <Text>{entry.targetUserName}</Text> },
        {
          key: 'issues',
          content: (
            <Inline space="space.100" alignBlock="center" shouldWrap>
              <Text size="small" weight="bold" color="color.text.subtlest">
                {entry.issueCount} issue{entry.issueCount !== 1 ? 's' : ''}
              </Text>
              {issueKeys.slice(0, MAX_ISSUE_CHIPS).map(k => (
                <Link key={k} href={`/browse/${k}`} openNewTab={true}>{k}</Link>
              ))}
              {issueKeys.length > MAX_ISSUE_CHIPS && (
                <Text size="small" color="color.text.subtlest">+ {issueKeys.length - MAX_ISSUE_CHIPS} more</Text>
              )}
            </Inline>
          ),
        },
      ],
    };
  });

  return (
    <Stack space="space.300">
      {/* Month selector + CSV export */}
      <Inline spread="space-between" alignBlock="end">
        <Stack space="space.050">
          <Label labelFor="audit-month-select">Month</Label>
          <Select
            inputId="audit-month-select"
            options={toMonthOptions(months)}
            value={selectedMonth ? { label: formatMonthLabel(selectedMonth.value), value: selectedMonth.value } : null}
            onChange={setSelectedMonth}
            isClearable={false}
            isLoading={fetching}
          />
        </Stack>
        <Button onClick={handleExportCsv} isDisabled={fetching || entries.length === 0}>
          Export CSV
        </Button>
      </Inline>

      {fetching ? (
        <Spinner size="medium" />
      ) : (
        <Stack space="space.300">
          {/* Summary strip */}
          <Inline space="space.200" alignBlock="stretch">
            <StatCard
              label="TOTAL ACTIONS"
              value={entries.length}
              footer={
                <Text size="small" color="color.text.subtlest">
                  {selectedMonth ? formatMonthLabel(selectedMonth.value) : ''}
                </Text>
              }
            />
            <StatCard
              label="APPROVALS"
              value={approvals}
              footer={<Text size="small" color="color.text.subtlest">hours signed off</Text>}
            />
            <StatCard
              label="UNAPPROVALS"
              value={unapprovals}
              footer={<Text size="small" color="color.text.subtlest">reversals</Text>}
            />
            <StatCard
              label="ACTIVE MANAGERS"
              value={uniqueManagers}
              footer={
                <Text size="small" color="color.text.subtlest">
                  {uniqueEmployees} employee{uniqueEmployees !== 1 ? 's' : ''} affected
                </Text>
              }
            />
          </Inline>

          <DynamicTable
            head={head}
            rows={rows}
            emptyView="No approval actions recorded for this month."
          />
        </Stack>
      )}
    </Stack>
  );
};

// ---------------------------------------------------------------------------
// Root page — tab switcher for managers, report-only for others
// ---------------------------------------------------------------------------
const TABS = ['My Report', 'Manager Approval', 'Audit Log'];

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
        const manager = roleResult.isManager === true;
        setIsManager(manager);
        if (manager) setActiveTab('Manager Approval');
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
        {activeTab === 'Audit Log' && isManager && <AuditLogView months={months} />}
      </Stack>
    </Box>
  );
};

ForgeReconciler.render(<KupGlobalPage />);
