import { t, numberText, dateText, monthText, initializeLocale, invoke } from '../i18n-ui.js';
import { PeriodPicker } from '../period-picker.jsx';
import { AllocateHours } from '../allocate-hours.jsx';
import { translate, formatDate } from '../i18n.js';
import { defaultKupPeriod } from '../kup-period.js';
import { useLicenseStatus } from '../use-license-status.js';
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import ForgeReconciler, {
  Box, Stack, Inline, Heading, Select, DynamicTable, Spinner,
  Text, Strong, Button, SectionMessage, Lozenge, Link, Label, UserPicker, Textfield,
} from '@forge/react';

// ---------------------------------------------------------------------------
// Helpers shared across views
// ---------------------------------------------------------------------------
const formatMonthLabel = raw => monthText(raw);

const currentMonthDefault = () => {
  const period = defaultKupPeriod();
  return { label: period, value: period };
};

// Lozenge appearance + label from adjusted KUP %.
const computeStatus = (pct, cap) => {
  if (pct == null || isNaN(pct)) return { appearance: 'default', label: t("No data") };
  if (cap > 0 && pct > cap) return { appearance: 'removed', label: t("Over limit") };
  if (cap > 0 && pct > cap * 0.9) return { appearance: 'moved', label: t("Approaching limit") };
  if (pct < 1) return { appearance: 'default', label: t("No activity") };
  return { appearance: 'success', label: t("On track") };
};

// Tinted stat card built from Box primitives — UI Kit has no card component.
// flexGrow + width make sibling cards share an Inline row at equal widths.
const StatCard = ({ label, value, suffix, footer, backgroundColor = 'color.background.neutral' }) => (
  <Box padding="space.200" backgroundColor={backgroundColor} xcss={{ borderRadius: 'radius.small', flexGrow: 1, width: '100%' }}>
    <Stack space="space.100">
      <Text size="small" weight="bold" color="color.text.subtlest">{label}</Text>
      <Inline space="space.050" alignBlock="baseline">
        <Heading size="large">{numberText(value)}</Heading>
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

const statusFilterOptions = () => [
  { label: t("All"), value: 'all' },
  { label: t("Pending"), value: 'pending' },
  { label: t("Approved"), value: 'approved' },
];
const UNREPORTED_ISSUE_LIMIT = 500;

// ---------------------------------------------------------------------------
// My KUP Report view
// ---------------------------------------------------------------------------
const MyReportView = () => {
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [fetching, setFetching] = useState(false);
  const [reportData, setReportData] = useState({ issues: [], totalHours: 0, maxWorkingHours: null });

  const [absenceHours, setAbsenceHours] = useState('0');
  const [overtimeHours, setOvertimeHours] = useState('0');
  const [adjustmentSaving, setAdjustmentSaving] = useState(false);
  const [adjustmentMessage, setAdjustmentMessage] = useState(null); // { type, text }
  const [unreportedIssues, setUnreportedIssues] = useState(null);
  const [unreportedLoading, setUnreportedLoading] = useState(false);
  const [unreportedError, setUnreportedError] = useState(null);
  const [unreportedTruncated, setUnreportedTruncated] = useState(false);

  useEffect(() => {
    const defaultOption = currentMonthDefault();
    if (defaultOption) setSelectedMonth(defaultOption);
  }, []);

  useEffect(() => {
    if (!selectedMonth) return;
    setFetching(true);
    setAdjustmentMessage(null);
    setUnreportedIssues(null);
    setUnreportedError(null);
    setUnreportedTruncated(false);
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

  const handleFindUnreportedIssues = async () => {
    if (!selectedMonth) return;

    setUnreportedLoading(true);
    setUnreportedError(null);
    try {
      const result = await invoke('getMyUnreportedIssues', { month: selectedMonth.value });
      if (result.error) {
        setUnreportedIssues(null);
        setUnreportedError(result.error);
        return;
      }
      setUnreportedIssues(result.issues || []);
      setUnreportedTruncated(result.truncated === true);
    } catch (err) {
      setUnreportedIssues(null);
      setUnreportedError(err.message || t("Unable to search Jira issues. Please try again."));
    } finally {
      setUnreportedLoading(false);
    }
  };

  const handleSaveAdjustment = async () => {
    const absence = parseFloat(absenceHours) || 0;
    const overtime = parseFloat(overtimeHours) || 0;

    if (absence < 0 || overtime < 0) {
      setAdjustmentMessage({ type: 'error', text: t("Hours cannot be negative.") });
      return;
    }
    if (reportData.maxWorkingHours != null && absence > reportData.maxWorkingHours) {
      setAdjustmentMessage({ type: 'warning', text: t("Absence hours cannot exceed max working hours ({0}).", [reportData.maxWorkingHours]) });
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
        setAdjustmentMessage({ type: 'confirmation', text: t("Adjustment saved.") });
      } else {
        setAdjustmentMessage({ type: 'error', text: result.error || t("Save failed.") });
      }
    } catch (err) {
      setAdjustmentMessage({ type: 'error', text: err.message || t("Unexpected error.") });
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
      {t('Base: {0} h · Absence: {1} h · Overtime: {2} h', [numberText(maxWorking), numberText(absence), numberText(overtime)])}
    </Text>
  ) : (
    <Text size="small" color="color.text.subtlest">
      {selectedMonth ? formatMonthLabel(selectedMonth.value) : ''}
    </Text>
  );

  const pctFooter = kupPctNum != null
    ? <Lozenge appearance={status.appearance}>{status.label}</Lozenge>
    : <Text size="small" color="color.text.subtlest">{t("No working hours set")}</Text>;

  const head = {
    cells: [
      { key: 'issue', content: t("Issue Key") },
      { key: 'summary', content: t("Summary") },
      { key: 'hours', content: t("KUP Hours") },
    ],
  };

  const rows = sortedIssues.map((issue, i) => ({
    key: `row-${i}-${issue.key}`,
    cells: [
      { key: 'issue', content: <Link href={`/browse/${issue.key}`} openNewTab={true}>{issue.key}</Link> },
      { key: 'summary', content: <Text>{issue.summary}</Text> },
      { key: 'hours', content: <Strong>{numberText(issue.hours)}</Strong> },
    ],
  }));

  return (
    <Stack space="space.300">
      <Box xcss={{ maxWidth: '320px' }}>
        <Stack space="space.050">
          <PeriodPicker id="my-period" value={selectedMonth} onChange={setSelectedMonth} />
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
                <Heading size="small">{t("Hours adjustment")}</Heading>
                <Text size="small" color="color.text.subtle">{t("Claim absence to reduce your base, or overtime to raise it.")}</Text>
              </Inline>

              {isLocked && (
                <SectionMessage appearance="information">
                  <Text>{t("Adjustments are locked — your hours for this month have been approved. Contact your manager to unapprove first.")}</Text>
                </SectionMessage>
              )}

              <Inline space="space.200" alignBlock="end">
                <Stack space="space.050">
                  <Label labelFor="absence-hours">{t("Absence hours this month")}</Label>
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
                  <Label labelFor="overtime-hours">{t("Overtime hours this month")}</Label>
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
                  {adjustmentSaving ? t("Saving...") : t("Save adjustment")}
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
              label={t("KUP HOURS")}
              value={reportData.totalHours ?? 0}
              suffix="h"
              footer={
                <Text size="small" color="color.text.subtlest">
                  {t('Issues: {0}', [numberText(issueCount)])}
                </Text>
              }
            />
            <StatCard
              label={hasAdjustment ? t("EFFECTIVE BASE") : t("MAX WORKING HOURS")}
              value={hasAdjustment
                ? (adjustedBase > 0 ? adjustedBase : t("N/A"))
                : (maxWorking || '—')}
              suffix={maxWorking ? 'h' : undefined}
              footer={baseFooter}
            />
            <StatCard
              label={t("KUP %")}
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
                  ? t("Your KUP is {0}%, which exceeds the company limit of {1}%. Your manager will not be able to approve your hours until this is resolved. You have {2} KUP hours remaining.", [numberText(kupPctNum, 1), numberText(maxKupPercent), numberText(remainingHours)])
                  : t("Your KUP is {0}%, which exceeds the company limit of {1}%. Your manager will see a warning when reviewing your hours.", [numberText(kupPctNum, 1), numberText(maxKupPercent)])}
              </Text>
            </SectionMessage>
          )}

          {/* Issues table */}
          <Stack space="space.100">
            <Heading size="small">{t("Issues")}</Heading>
            <DynamicTable
              head={head}
              rows={rows}
              emptyView={t("You have zero KUP hours logged on assigned issues for this month.")}
            />
          </Stack>

          {/* This search is deliberately user-triggered. Most report visits do
              not need a second Jira query, while an empty report provides a
              clear next step instead of leaving the employee at a dead end. */}
          <Box padding="space.250" backgroundColor="color.background.neutral" xcss={{ borderRadius: 'radius.small' }}>
            <Stack space="space.200">
              <Inline spread="space-between" alignBlock="center">
                <Stack space="space.050">
                  <Heading size="small">{t("Completed issues without KUP hours")}</Heading>
                  <Text color="color.text.subtle">
                    {t('Find eligible issues assigned to you and completed in {0} that do not have a KUP entry.', [selectedMonth ? formatMonthLabel(selectedMonth.value) : t('the selected month')])}
                  </Text>
                </Stack>
                <Button onClick={handleFindUnreportedIssues} isDisabled={unreportedLoading}>
                  {unreportedLoading ? t("Searching...") : unreportedIssues === null ? t("Find issues") : t("Refresh list")}
                </Button>
              </Inline>

              {unreportedError && (
                <SectionMessage appearance="error">
                  <Text>{unreportedError}</Text>
                </SectionMessage>
              )}

              {unreportedIssues !== null && (
                <AllocateHours
                  key={selectedMonth.value}
                  issues={unreportedIssues}
                  month={selectedMonth.value}
                  recordedHours={reportData.totalHours}
                  effectiveBase={effectiveBase}
                  maxPercent={maxKupPercent}
                  onSaved={async () => {
                    const [report, remaining] = await Promise.all([
                      invoke('getMyKupReport', { month: selectedMonth.value }),
                      invoke('getMyUnreportedIssues', { month: selectedMonth.value }),
                    ]);
                    if (remaining.error) throw new Error(remaining.error);
                    setReportData(report);
                    setUnreportedIssues(remaining.issues || []);
                    setUnreportedTruncated(remaining.truncated === true);
                  }}
                />
              )}

              {unreportedTruncated && (
                <SectionMessage appearance="information">
                  <Text>{t('Showing the first {0} matching issues.', [numberText(UNREPORTED_ISSUE_LIMIT)])}</Text>
                </SectionMessage>
              )}
            </Stack>
          </Box>
        </Stack>
      )}
    </Stack>
  );
};

// ---------------------------------------------------------------------------
// Manager Approval view
// ---------------------------------------------------------------------------
const allGroupsOption = () => ({ label: t("All users"), value: null });
const exportFormatOptions = () => [
  { label: t("Excel (.xlsx)"), value: 'xlsx' },
  { label: t("CSV (.csv)"), value: 'csv' },
];

const ManagerApprovalView = () => {
  const STATUS_FILTER_OPTIONS = statusFilterOptions();
  const ALL_GROUPS_OPTION = allGroupsOption();
  const EXPORT_FORMAT_OPTIONS = exportFormatOptions();
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
    const defaultOption = currentMonthDefault();
    if (defaultOption) setSelectedMonth(defaultOption);

    Promise.all([
      invoke('getJiraGroups'),
      invoke('getManagerTeam'),
    ]).then(([groups, team]) => {
      setJiraGroups([ALL_GROUPS_OPTION, ...groups.map(g => ({ label: g.name, value: g.groupId }))]);
      // The resolver returns display names freshly resolved from Jira. The
      // fallback keeps the editor usable while a legacy deployment is upgraded.
      const normalized = (team.members || []).map(m => {
        if (typeof m === 'string') return { accountId: m, displayName: m };
        return {
          accountId: m.accountId || m.id || null,
          displayName: m.displayName || m.name || m.accountId || m.id || t("Unknown"),
        };
      });
      setTeamMembers(normalized);
    }).catch(() => console.error('Failed to load groups/team'));
  }, []);

  const fetchAdjustments = useCallback(async (month) => {
    if (!month) return;
    setFetchingAdjustments(true);
    try {
      const data = await invoke('getAdjustmentsForMonth', { month });
      setAdjustmentsMap(data.adjustments || {});
    } catch (err) {
      console.error('Failed to fetch adjustments');
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
      console.error('Failed to fetch manager report');
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
        const text = t('Approved issues: {0}. Employee: {1}.', [numberText(n), user.displayName]) + (result.warning ? ` ⚠ ${result.warning}` : '');
        setActionMessage({ type: result.warning ? 'warning' : 'confirmation', text });
        await fetchReport();
      } else {
        setActionMessage({ type: 'error', text: result.error || t("Approval failed.") });
      }
    } catch (err) {
      setActionMessage({ type: 'error', text: err.message || t("Unexpected error.") });
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
        setActionMessage({ type: 'confirmation', text: t('Unapproved issues: {0}. Employee: {1}.', [numberText(n), user.displayName]) });
        await fetchReport();
      } else {
        setActionMessage({ type: 'error', text: result.error || t("Unapproval failed.") });
      }
    } catch (err) {
      setActionMessage({ type: 'error', text: err.message || t("Unexpected error.") });
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
      console.error('Failed to save team');
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
            setExportErrorMsg(statusResult.message || t("Export failed."));
          } else {
            setTimeout(poll, POLL_INTERVAL_MS);
          }
        } catch (err) {
          setExportStatus('error');
          setExportErrorMsg(err.message || t("Polling failed."));
        }
      };

      setTimeout(poll, POLL_INTERVAL_MS);
    } catch (err) {
      setExportStatus('error');
      setExportErrorMsg(err.message || t("Unexpected error."));
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
      { key: 'user', content: t("User"), width: 16 },
      // Expanded issue rows display their summary in this same column. Giving it
      // enough space prevents a long title from wrapping beside empty detail cells.
      { key: 'issues', content: t("Issues / Summary"), width: 30 },
      { key: 'totalHours', content: t("KUP Hours"), width: 8 },
      { key: 'maxHours', content: t("Max Hours"), width: 8 },
      { key: 'absence', content: t("Absence"), width: 7 },
      { key: 'overtime', content: t("Overtime"), width: 7 },
      { key: 'kupPct', content: t("KUP %"), width: 6 },
      { key: 'status', content: t("Status"), width: 9 },
      { key: 'action', content: t("Action"), width: 9 },
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
        kupPct = !adj && fetchingAdjustments ? '…' : `${numberText(kupPctNum, 1)}%`;
      } else {
        kupPct = t("N/A");
      }
    }

    const userOverLimit = mgrMaxKupPercent && kupPctNum !== null && kupPctNum > mgrMaxKupPercent;
    const approveBlocked = userOverLimit && mgrEnforcement === 'block';

    const lozengeAppearance = user.status === 'approved' ? 'success'
      : user.status === 'mixed' ? 'moved' : 'default';
    const lozengeLabel = user.status === 'approved' ? t("Approved")
      : user.status === 'mixed' ? t("Mixed") : t("Pending");

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
        { key: 'issues', content: <Text>{numberText(user.issueCount)}</Text> },
        { key: 'totalHours', content: <Strong>{numberText(user.totalHours)}</Strong> },
        { key: 'maxHours', content: <Text>{numberText(maxH)}</Text> },
        { key: 'absence', content: <Text>{numberText(absenceH)}</Text> },
        { key: 'overtime', content: <Text>{numberText(overtimeH)}</Text> },
        { key: 'kupPct', content: <Text>{kupPct}</Text> },
        {
          key: 'status',
          content: (
            <Inline space="space.100">
              <Lozenge appearance={lozengeAppearance}>{lozengeLabel}</Lozenge>
              {userOverLimit && <Lozenge appearance="removed">{t("Over limit")}</Lozenge>}
            </Inline>
          ),
        },
        {
          key: 'action',
          content: user.status === 'approved'
            ? <Button appearance="subtle" onClick={() => handleUnapprove(user)} isDisabled={isActioning}>{isActioning ? '...' : t("Unapprove")}</Button>
            : <Button appearance="primary" onClick={() => handleApprove(user)} isDisabled={isActioning || approveBlocked}>
                {isActioning ? '...' : approveBlocked ? `Blocked (${kupPct})` : t("Approve")}
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
            { key: 'totalHours', content: <Text>{numberText(issue.hours)}</Text> },
            { key: 'maxHours', content: <Text> </Text> },
            { key: 'absence', content: <Text> </Text> },
            { key: 'overtime', content: <Text> </Text> },
            { key: 'kupPct', content: <Text> </Text> },
            { key: 'status', content: <Lozenge appearance={issue.status === 'approved' ? 'success' : 'default'}>{issue.status === 'approved' ? t("Approved") : t("Pending")}</Lozenge> },
            { key: 'action', content: <Text> </Text> },
          ],
        });
      }
    }
  }

  const filtersActive = groupFilter.value || myTeamActive;
  let emptyView = filtersActive
    ? t("No users match your current filters for this month.")
    : t("No KUP hours logged for this month.");
  if (!filtersActive && statusFilter.value === 'pending' && users.length === 0 && reportData) {
    emptyView = t("All KUP hours for this month have been approved.");
  }

  return (
    <Stack space="space.300">
      {/* Filter row — controls left, team management right */}
      <Inline spread="space-between" alignBlock="end">
        <Inline space="space.200" alignBlock="end">
          <Stack space="space.050">
            <PeriodPicker id="mgr-period" value={selectedMonth} onChange={setSelectedMonth} />
          </Stack>
          <Stack space="space.050">
            <Label labelFor="mgr-status-filter">{t("Status")}</Label>
            <Select
              inputId="mgr-status-filter"
              options={STATUS_FILTER_OPTIONS}
              value={statusFilter}
              onChange={setStatusFilter}
              isClearable={false}
            />
          </Stack>
          <Stack space="space.050">
            <Label labelFor="mgr-group-filter">{t("Jira group")}</Label>
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
            {myTeamActive ? t("My Team ✓") : t("My Team")}
          </Button>
          <Button onClick={fetchReport} isDisabled={fetching}>{t("Refresh")}</Button>
        </Inline>
        <Button appearance="subtle" onClick={() => setShowTeamEditor(e => !e)}>
          {showTeamEditor ? t("Hide team editor") : t("Manage my team")}
        </Button>
      </Inline>

      {myTeamActive && teamMembers.length === 0 && (
        <Text>{t("Your team is empty — add members below to use this filter.")}</Text>
      )}

      {/* Team editor panel */}
      {showTeamEditor && (
        <Box padding="space.250" backgroundColor="color.background.neutral" xcss={{ borderRadius: 'radius.small' }}>
          <Stack space="space.200">
            <Heading size="small">{t("My Team")}</Heading>

            {/* Add member */}
            <Inline space="space.200" alignBlock="end">
              <Stack space="space.050">
                <Label labelFor="team-user-picker">{t("Add member")}</Label>
                <UserPicker
                  name="team-user-picker"
                  value={newMember}
                  onChange={setNewMember}
                />
              </Stack>
              <Button onClick={handleAddTeamMember} isDisabled={!newMember}>{t("Add")}</Button>
            </Inline>

            {/* Current members list */}
            {teamMembers.length === 0 ? (
              <Text>{t("No team members yet.")}</Text>
            ) : (
              <Stack space="space.100">
                {teamMembers.map(member => (
                  <Inline key={member.accountId} space="space.200" alignBlock="center">
                    <Text><Strong>{member.displayName}</Strong></Text>
                    <Button appearance="subtle" onClick={() => handleRemoveTeamMember(member.accountId)}>{t("Remove")}</Button>
                  </Inline>
                ))}
              </Stack>
            )}

            <Button appearance="primary" onClick={handleSaveTeam} isDisabled={teamSaving}>
              {teamSaving ? t("Saving...") : t("Save Team")}
            </Button>
          </Stack>
        </Box>
      )}

      {/* Summary strip */}
      {!fetching && reportData && (
        <Inline space="space.200" alignBlock="stretch">
          <StatCard
            label={t("USERS")}
            value={users.length}
            footer={<Text size="small" color="color.text.subtlest">{t("in current view")}</Text>}
          />
          <StatCard
            label={t("APPROVED")}
            value={approvedCount}
            footer={<Text size="small" color="color.text.subtlest">{t("fully approved")}</Text>}
          />
          <StatCard
            label={t("PENDING")}
            value={pendingCount}
            footer={<Text size="small" color="color.text.subtlest">{t("awaiting review")}</Text>}
          />
          <StatCard
            label={t("OVER LIMIT")}
            value={overLimitCount}
            backgroundColor={overLimitCount > 0 ? 'color.background.danger' : 'color.background.neutral'}
            footer={
              <Text size="small" color="color.text.subtlest">
                {mgrMaxKupPercent ? `${mgrMaxKupPercent}% cap` : t("no cap set")}
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
          {t('Users: {0} · Total hours: {1} · Monthly working hours: {2}', [numberText(users.length), numberText(totalHoursAll), numberText(maxH)])}
        </Text>
      )}

      {/* Payroll export */}
      <Box padding="space.250" backgroundColor="color.background.neutral" xcss={{ borderRadius: 'radius.small' }}>
        <Stack space="space.200">
          <Inline spread="space-between" alignBlock="center">
            <Heading size="small">{t("Export Payroll Summary")}</Heading>
            <Text size="small" color="color.text.subtle">{t("One row per employee with KUP hours, for accounting.")}</Text>
          </Inline>
          <Inline space="space.200" alignBlock="end">
            <Stack space="space.050">
              <Label labelFor="export-format-select">{t("Format")}</Label>
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
              {exportStatus === 'processing' ? t("Generating...") : t("Generate Export")}
            </Button>
            {exportStatus === 'processing' && <Spinner size="small" />}
          </Inline>

          {exportStatus === 'ready' && exportResult && (
            <SectionMessage appearance="confirmation">
              <Inline space="space.200" alignBlock="center">
                <Text>{t("Export ready.")}</Text>
                <Button
                  appearance="primary"
                  onClick={() => triggerDownload(
                    exportResult.data,
                    exportResult.filename,
                    exportResult.format === 'xlsx'
                      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                      : 'text/csv;charset=utf-8'
                  )}
                >{t("Download")}{exportResult.filename}
                </Button>
              </Inline>
            </SectionMessage>
          )}

          {exportStatus === 'error' && (
            <SectionMessage appearance="error">
              <Text>{t('Export failed: {0}', [exportErrorMsg])}</Text>
            </SectionMessage>
          )}

          {exportStatus === 'timeout' && (
            <SectionMessage appearance="warning">
              <Text>{t("Export timed out after 60 seconds. Please try again or contact your administrator.")}</Text>
            </SectionMessage>
          )}
        </Stack>
      </Box>

      {/* Legacy records without stable employee attribution */}
      {!fetching && reportData?.unassignedIssues?.length > 0 && (
        <Stack space="space.200">
          <Heading size="small">{t('Unattributed Records ({0})', [numberText(reportData.unassignedIssues.length)])}</Heading>
          <Text>{t("These records were created before employee attribution was stored. Review them before approval or export.")}</Text>
          <SectionMessage appearance="warning">
            <Text>{t("These issues have KUP hours logged but no assignee. Ping someone to claim them.")}</Text>
          </SectionMessage>
          <DynamicTable
            head={{ cells: [
              { key: 'key', content: t("Issue"), width: 15 },
              { key: 'summary', content: t("Summary"), width: 60 },
              { key: 'hours', content: t("KUP Hours"), width: 15 },
            ]}}
            rows={reportData.unassignedIssues.map(issue => ({
              key: issue.key,
              cells: [
                { key: 'key', content: <Link href={`/browse/${issue.key}`} openNewTab={true}>{issue.key}</Link> },
                { key: 'summary', content: <Text>{issue.summary}</Text> },
                { key: 'hours', content: <Text>{numberText(issue.hours)}</Text> },
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
const formatAuditDate = iso => dateText(iso);

const AuditLogView = () => {
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [fetching, setFetching] = useState(false);
  const [entries, setEntries] = useState([]);

  useEffect(() => {
    const defaultOption = currentMonthDefault();
    if (defaultOption) setSelectedMonth(defaultOption);
  }, []);

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
    const exportText = key => translate(key, [], 'pl-PL');
    const headers = ['Date / Time', 'Manager', 'Action', 'Employee', 'Issue Count', 'Issue Keys'].map(exportText);
    const csvRows = entries.map(e => [
      formatDate(e.timestamp, 'pl-PL'),
      e.managerName,
      exportText(e.action === 'approval' ? 'Approved' : 'Unapproved'),
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
      { key: 'timestamp', content: t("Date / Time"), width: 16 },
      { key: 'manager', content: t("Manager"), width: 16 },
      { key: 'action', content: t("Action"), width: 10 },
      { key: 'employee', content: t("Employee"), width: 16 },
      { key: 'issues', content: t("Issues"), width: 42 },
    ],
  };

  const rows = entries.map((entry, i) => {
    const actionAppearance = entry.action === 'approval' ? 'success' : 'default';
    const actionLabel = entry.action === 'approval' ? t("Approved") : t("Unapproved");
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
                {t('Issues: {0}', [numberText(entry.issueCount)])}
              </Text>
              {issueKeys.slice(0, MAX_ISSUE_CHIPS).map(k => (
                <Link key={k} href={`/browse/${k}`} openNewTab={true}>{k}</Link>
              ))}
              {issueKeys.length > MAX_ISSUE_CHIPS && (
                <Text size="small" color="color.text.subtlest">+ {issueKeys.length - MAX_ISSUE_CHIPS}{" "}{t("more")}</Text>
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
          <PeriodPicker id="audit-period" value={selectedMonth} onChange={setSelectedMonth} />
        </Stack>
        <Button onClick={handleExportCsv} isDisabled={fetching || entries.length === 0}>{t("Export CSV")}</Button>
      </Inline>

      {fetching ? (
        <Spinner size="medium" />
      ) : (
        <Stack space="space.300">
          {/* Summary strip */}
          <Inline space="space.200" alignBlock="stretch">
            <StatCard
              label={t("TOTAL ACTIONS")}
              value={entries.length}
              footer={
                <Text size="small" color="color.text.subtlest">
                  {selectedMonth ? formatMonthLabel(selectedMonth.value) : ''}
                </Text>
              }
            />
            <StatCard
              label={t("APPROVALS")}
              value={approvals}
              footer={<Text size="small" color="color.text.subtlest">{t("hours signed off")}</Text>}
            />
            <StatCard
              label={t("UNAPPROVALS")}
              value={unapprovals}
              footer={<Text size="small" color="color.text.subtlest">{t("reversals")}</Text>}
            />
            <StatCard
              label={t("ACTIVE MANAGERS")}
              value={uniqueManagers}
              footer={
                <Text size="small" color="color.text.subtlest">
                  {t('Affected employees: {0}', [numberText(uniqueEmployees)])}
                </Text>
              }
            />
          </Inline>

          <DynamicTable
            head={head}
            rows={rows}
            emptyView={t("No approval actions recorded for this month.")}
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
  const { licenseActive, licenseMessage, checkLicense } = useLicenseStatus();
  const [isManager, setIsManager] = useState(false);
  const [activeTab, setActiveTab] = useState('My Report');

  useEffect(() => {
    if (licenseActive !== true) return;

    async function init() {
      try {
        const roleResult = await invoke('getCurrentUserRole');
        const manager = roleResult.isManager === true;
        setIsManager(manager);
        if (manager) setActiveTab('Manager Approval');
      } catch (err) {
        console.error('Failed to initialize KUP page');
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [licenseActive]);

  // Data loading only starts for an active license. Otherwise `loading` stays
  // true, so it must not hide the inactive-license message below.
  if (licenseActive === null || (licenseActive === true && loading)) return <Spinner size="large" />;

  if (!licenseActive) {
    return (
      <Box padding="space.400">
        <SectionMessage appearance="warning" title={licenseMessage.title}>
          <Text>{licenseMessage.text}</Text>
          <Button onClick={checkLicense}>{t("Try again")}</Button>
        </SectionMessage>
      </Box>
    );
  }

  return (
    <Box padding="space.400">
      <Stack space="space.400">
        {/* Page title comes from the global-page module title in manifest.yml —
            no in-app Heading, to avoid a duplicate "KUP 50% Compliance" header. */}

        {/* Tab bar — only shown to managers */}
        {isManager && (
          <Inline space="space.200">
            {TABS.map(tab => (
              <Button
                key={tab}
                appearance={activeTab === tab ? 'primary' : 'subtle'}
                onClick={() => setActiveTab(tab)}
              >
                {t(tab)}
              </Button>
            ))}
          </Inline>
        )}

        {/* Tab content */}
        {activeTab === 'My Report' && <MyReportView />}
        {activeTab === 'Manager Approval' && isManager && <ManagerApprovalView />}
        {activeTab === 'Audit Log' && isManager && <AuditLogView />}
      </Stack>
    </Box>
  );
};

initializeLocale().then(() => ForgeReconciler.render(<KupGlobalPage />));
